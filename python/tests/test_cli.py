from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

import pytest

from maildummy import cli
from maildummy.fetch import MailTimeout
from tests.conftest import client_error


class Recorder:
    def __init__(self, result: str | Exception) -> None:
        self.result = result
        self.calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    def __call__(self, *args: Any, **kwargs: Any) -> str:
        self.calls.append((args, kwargs))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def test_prints_the_link_with_url_prefix(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rec = Recorder("https://app.example.com/#/sign-in/link#otp=123456")
    monkeypatch.setattr(cli, "wait_for_link", rec)
    code = cli.main(
        [
            "my-bucket",
            "user+tag@example.com",
            "--region",
            "eu-central-1",
            "--url-prefix",
            "https://app.example.com/",
            "--since",
            "2026-10-13T09:00:00",
            "--timeout",
            "5",
        ]
    )
    assert code == 0
    assert capsys.readouterr().out == "https://app.example.com/#/sign-in/link#otp=123456\n"
    (args, kwargs), = rec.calls
    assert args == ("my-bucket", "user+tag@example.com")
    assert kwargs["region"] == "eu-central-1"
    assert kwargs["since"] == datetime(2026, 10, 13, 9, 0, tzinfo=UTC)  # naive means UTC
    assert kwargs["timeout"] == 5.0
    assert isinstance(kwargs["pattern"], re.Pattern)
    assert kwargs["pattern"].search("https://app.example.com/x") is not None


def test_pattern_is_passed_through(monkeypatch: pytest.MonkeyPatch) -> None:
    rec = Recorder("x")
    monkeypatch.setattr(cli, "wait_for_link", rec)
    assert cli.main(["b", "a@example.com", "--pattern", r"code: \d+"]) == 0
    assert rec.calls[0][1]["pattern"] == r"code: \d+"


@pytest.mark.parametrize(
    "error", [MailTimeout("nothing arrived"), client_error("AccessDenied"), ValueError("bad")]
)
def test_errors_exit_1_with_message(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], error: Exception
) -> None:
    monkeypatch.setattr(cli, "wait_for_link", Recorder(error))
    assert cli.main(["b", "a@example.com", "--pattern", "x"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.startswith("Error: ")


def test_a_pattern_or_url_prefix_is_required(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["b", "a@example.com"])
    assert exit_info.value.code == 2
    assert "--pattern" in capsys.readouterr().err
