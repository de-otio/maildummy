from __future__ import annotations

import io
import re
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

import boto3
import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody
from botocore.stub import Stubber

from maildummy import MailTimeout, fetch_messages, link_pattern, wait_for_link
from tests.conftest import T0, FakeClock, FakeS3, client_error, fixture_bytes

BUCKET = "test-bucket"
EARLIER = T0 - timedelta(hours=1)
PutFixture = Callable[..., None]


def wait(
    s3: FakeS3,
    clock: FakeClock,
    address: str,
    pattern: str | re.Pattern[str],
    *,
    since: datetime = EARLIER,
    timeout: float = 0.0,
    poll_interval: float = 2.0,
    prefix: str = "raw/",
) -> str:
    return wait_for_link(
        BUCKET,
        address,
        pattern=pattern,
        since=since,
        timeout=timeout,
        poll_interval=poll_interval,
        s3_client=s3,
        prefix=prefix,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )


APP = link_pattern("https://app.example.com/")


# --- recipients ------------------------------------------------------------------------


def test_plus_address_is_matched(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    # The old regex reduced "user+tag@example.com" to "tag@example.com" and never matched.
    put_fixture("plus-address.eml")
    link = wait(s3, clock, "user+tag@example.com", APP)
    assert link == "https://app.example.com/auth/verify?token=plus123&type=magiclink"


def test_plus_address_does_not_match_the_base_address(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml")
    with pytest.raises(MailTimeout):
        wait(s3, clock, "user@example.com", APP)
    with pytest.raises(MailTimeout):
        wait(s3, clock, "tag@example.com", APP)


def test_recipient_comparison_is_case_insensitive(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("mixed-case-recipient.eml")
    assert wait(s3, clock, "user+tag@example.com", APP).endswith("token=case123")
    assert wait(s3, clock, "USER+TAG@EXAMPLE.COM", APP).endswith("token=case123")


@pytest.mark.parametrize("address", ["jane@example.com", "bob@example.org"])
def test_display_name_with_comma(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture, address: str
) -> None:
    # The old comma split cut '"Doe, Jane" <jane@example.com>' in two.
    put_fixture("display-name-comma.eml")
    assert wait(s3, clock, address, APP).endswith("token=comma123")


def test_rfc2047_display_name_with_comma(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("encoded-display-name-comma.eml")
    assert wait(s3, clock, "jane.encoded@example.com", APP).endswith("token=encoded123")


def test_cc_only_recipient(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    put_fixture("cc-only.eml")
    assert wait(s3, clock, "cc.user@example.com", APP).endswith("token=cc123")
    with pytest.raises(MailTimeout):
        wait(s3, clock, "nobody@example.com", APP)


# --- bodies and decoding ---------------------------------------------------------------


def test_quoted_printable_body_with_soft_breaks(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("quoted-printable.eml")
    assert wait(s3, clock, "qp@example.com", APP) == (
        "https://app.example.com/auth/verify?token=qp123456789012345678901234567890"
        "&type=magiclink&redirect_to=https%3A%2F%2Fapp.example.com%2Fhome"
    )


def test_base64_body(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    put_fixture("base64.eml")
    link = wait(s3, clock, "b64@example.com", APP)
    assert link == "https://app.example.com/auth/verify?token=b64123&type=magiclink"


def test_declared_charset_is_used(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    # The old script decoded as utf-8 with errors="ignore", dropping the non-ASCII bytes.
    put_fixture("latin1.eml")
    assert wait(s3, clock, "latin1@example.com", r"Code: \S+") == "Code: café-grüße-123"
    assert wait(s3, clock, "latin1@example.com", APP) == "https://app.example.com/verify?code=latin1"


def test_unknown_charset_does_not_crash(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("unknown-charset.eml")
    assert wait(s3, clock, "unknown@example.com", APP).endswith("token=unknown123")


def test_html_only_is_unescaped(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    put_fixture("html-only-amp.eml")
    assert wait(s3, clock, "html@example.com", APP) == (
        "https://app.example.com/auth/verify?token=html123"
        "&type=magiclink&redirect_to=https://app.example.com/home"
    )


def test_plain_text_is_preferred_over_html(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    # The HTML part comes first in the fixture; the old script took HTML whenever it existed.
    put_fixture("multipart-plain-preferred.eml")
    link = wait(s3, clock, "alt@example.com", APP)
    assert link == "https://app.example.com/plain-version?token=plain"


def test_html_is_the_fallback_when_plain_has_no_match(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("multipart-html-fallback.eml")
    link = wait(s3, clock, "fallback@example.com", APP)
    assert link == "https://app.example.com/only-in-html?a=1&b=2"


def test_plain_text_links_are_not_html_unescaped(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("plain-ampersand.eml")
    link = wait(s3, clock, "amp@example.com", APP)
    assert link == "https://app.example.com/auth/verify?token=amp123&section=2&type=magiclink"


def test_hash_router_fragment_link(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    put_fixture("fragment-link.eml")
    expected = "https://app.example.com/#/sign-in/link#otp=123456"
    assert wait(s3, clock, "fragment@example.com", link_pattern("https://app.example.com/#")) == (
        expected
    )
    assert wait(s3, clock, "fragment@example.com", APP) == expected
    # Parsing the fragment is the caller's job; make sure nothing cut it short.
    assert expected.endswith("otp=123456")


# --- pattern forms ---------------------------------------------------------------------


def test_pattern_may_be_str_or_compiled_or_prefix(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml")
    expected = "https://app.example.com/auth/verify?token=plus123&type=magiclink"
    address = "user+tag@example.com"
    assert wait(s3, clock, address, r"https://app\.example\.com/\S+") == expected
    assert wait(s3, clock, address, re.compile(r"HTTPS://APP\.EXAMPLE\.COM/\S+", re.I)) == expected
    assert wait(s3, clock, address, link_pattern("https://app.example.com/auth/")) == expected


def test_link_pattern_escapes_the_prefix_and_stops_at_delimiters() -> None:
    pat = link_pattern("https://app.example.com/a?b=")
    assert pat.search('<a href="https://app.example.com/a?b=1&c=2">x</a>') is not None
    assert pat.search("https://appXexample.com/a?b=1") is None
    found = pat.search('see "https://app.example.com/a?b=1"> or https://app.example.com/a?b=2')
    assert found is not None
    assert found.group(0) == "https://app.example.com/a?b=1"


def test_pattern_with_no_match_times_out(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml")
    with pytest.raises(MailTimeout):
        wait(s3, clock, "user+tag@example.com", r"https://other\.example\.org/\S+")


# --- ordering --------------------------------------------------------------------------


def test_newest_mail_wins(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    # Keys sort the opposite way to LastModified, so only the timestamp can order them.
    put_fixture("plus-address.eml", key="raw/zzz-old", modified=T0)
    s3.put("raw/aaa-new", fixture_bytes("mixed-case-recipient.eml"), T0 + timedelta(minutes=5))
    link = wait(s3, clock, "user+tag@example.com", APP)
    assert link.endswith("token=case123")


def test_fetch_messages_returns_newest_first_as_email_messages(
    s3: FakeS3, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml", modified=T0)
    put_fixture("mixed-case-recipient.eml", modified=T0 + timedelta(minutes=1))
    put_fixture("cc-only.eml", modified=T0 + timedelta(minutes=2))
    msgs = fetch_messages(BUCKET, "user+tag@example.com", since=EARLIER, s3_client=s3)
    assert [m["Message-ID"] for m in msgs] == ["<fixture@example.org>"] * 2
    first, second = msgs
    assert "case123" in first.get_content()
    assert "plus123" in second.get_content()
    assert first["Subject"] == "Sign in"


# --- listing: pagination and since -----------------------------------------------------


def test_more_than_1000_keys_are_all_considered(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    # Old script: one list_objects_v2 call, so only the first 1000 keys were ever seen.
    for i in range(2500):
        s3.put(f"raw/{i:05d}", fixture_bytes("cc-only.eml"), T0 + timedelta(seconds=i))
    # The target sorts last by key (page 3) and is not the newest by time.
    s3.put("raw/99999-target", fixture_bytes("plus-address.eml"), T0 + timedelta(seconds=1))
    link = wait(s3, clock, "user+tag@example.com", APP)
    assert "token=plus123" in link
    assert s3.list_calls == 1  # one paginate() call, driven through every page


def test_stubbed_boto3_paginator_follows_continuation_tokens() -> None:
    client = boto3.client(
        "s3",
        region_name="eu-central-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106
    )
    first = {"IsTruncated": True, "NextContinuationToken": "t1"}
    second = {"IsTruncated": False}
    with Stubber(client) as stub:
        stub.add_response(
            "list_objects_v2",
            {**first, "Contents": [{"Key": "raw/a", "LastModified": T0}]},
            {"Bucket": BUCKET, "Prefix": "raw/"},
        )
        stub.add_response(
            "list_objects_v2",
            {**second, "Contents": [{"Key": "raw/b", "LastModified": T0}]},
            {"Bucket": BUCKET, "Prefix": "raw/", "ContinuationToken": "t1"},
        )
        for key in ("raw/b", "raw/a"):  # equal timestamps: ties broken by key, descending
            data = fixture_bytes("plus-address.eml")
            stub.add_response(
                "get_object",
                {"Body": StreamingBody(io.BytesIO(data), len(data))},
                {"Bucket": BUCKET, "Key": key},
            )
        msgs = fetch_messages(BUCKET, "user+tag@example.com", since=EARLIER, s3_client=client)
        stub.assert_no_pending_responses()
    assert len(msgs) == 2


def test_since_filters_before_get_object(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml", key="raw/old-1", modified=T0 - timedelta(seconds=2))
    put_fixture("plus-address.eml", key="raw/old-2", modified=T0 - timedelta(days=3))
    put_fixture("mixed-case-recipient.eml", key="raw/at-since", modified=T0)
    put_fixture("cc-only.eml", key="raw/new", modified=T0 + timedelta(seconds=5))
    with pytest.raises(MailTimeout):
        wait(s3, clock, "nobody@example.com", APP, since=T0)
    assert sorted(s3.get_calls) == ["raw/at-since", "raw/new"]  # old objects never fetched

    s3.get_calls.clear()
    link = wait(s3, clock, "user+tag@example.com", APP, since=T0)
    assert link.endswith("token=case123")  # the old plus-address mails are ignored
    assert "raw/old-1" not in s3.get_calls and "raw/old-2" not in s3.get_calls


def test_since_applies_to_fetch_messages(s3: FakeS3, put_fixture: PutFixture) -> None:
    put_fixture("plus-address.eml", key="raw/old", modified=T0 - timedelta(minutes=1))
    put_fixture("mixed-case-recipient.eml", key="raw/new", modified=T0)
    msgs = fetch_messages(BUCKET, "user+tag@example.com", since=T0, s3_client=s3)
    assert len(msgs) == 1
    assert s3.get_calls == ["raw/new"]


def test_since_in_another_timezone_is_compared_as_an_instant(
    s3: FakeS3, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml", key="raw/a", modified=T0)
    plus_two = timezone(timedelta(hours=2))
    assert fetch_messages(
        BUCKET, "user+tag@example.com", since=(T0 + timedelta(hours=2)).astimezone(plus_two),
        s3_client=s3,
    ) == []
    assert len(
        fetch_messages(BUCKET, "user+tag@example.com", since=T0.astimezone(plus_two), s3_client=s3)
    ) == 1


def test_custom_prefix(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    put_fixture("plus-address.eml", key="other/1")
    with pytest.raises(MailTimeout):
        wait(s3, clock, "user+tag@example.com", APP)
    assert "plus123" in wait(s3, clock, "user+tag@example.com", APP, prefix="other/")


@pytest.mark.parametrize("naive", [datetime(2026, 10, 13, 9, 0, 0), datetime(2026, 1, 1)])
def test_naive_since_is_rejected(s3: FakeS3, clock: FakeClock, naive: datetime) -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        wait(s3, clock, "a@example.com", APP, since=naive)
    with pytest.raises(ValueError, match="timezone-aware"):
        fetch_messages(BUCKET, "a@example.com", since=naive, s3_client=s3)
    assert s3.list_calls == 0


# --- polling and errors ----------------------------------------------------------------


def test_timeout_raises_mail_timeout_deterministically(s3: FakeS3, clock: FakeClock) -> None:
    with pytest.raises(MailTimeout) as err:
        wait(s3, clock, "a@example.com", APP, timeout=5.0, poll_interval=2.0)
    assert isinstance(err.value, TimeoutError)
    assert clock.sleeps == [2.0, 2.0, 1.0]  # the last sleep is clipped to the deadline
    assert s3.list_calls == 4
    assert clock.now == 5.0


def test_zero_timeout_still_tries_once(s3: FakeS3, clock: FakeClock, put_fixture: PutFixture) -> None:
    put_fixture("plus-address.eml")
    assert "plus123" in wait(s3, clock, "user+tag@example.com", APP, timeout=0)
    assert clock.sleeps == []


def test_mail_arriving_later_is_found_by_polling(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    original_sleep = clock.sleep

    def sleep_then_deliver(seconds: float) -> None:
        original_sleep(seconds)
        if len(clock.sleeps) == 2:
            put_fixture("plus-address.eml", modified=T0 + timedelta(seconds=30))

    link = wait_for_link(
        BUCKET,
        "user+tag@example.com",
        pattern=APP,
        since=T0,
        timeout=60,
        poll_interval=2,
        s3_client=s3,
        sleep=sleep_then_deliver,
        monotonic=clock.monotonic,
    )
    assert "plus123" in link
    assert clock.sleeps == [2, 2]


def test_mails_already_read_are_not_downloaded_again(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("cc-only.eml", key="raw/other-recipient")
    put_fixture("plus-address.eml", key="raw/no-match")
    with pytest.raises(MailTimeout):
        wait(s3, clock, "user+tag@example.com", r"nothing-matches-this", timeout=10, poll_interval=2)
    assert sorted(s3.get_calls) == ["raw/no-match", "raw/other-recipient"]  # once each, 6 polls


@pytest.mark.parametrize("code", ["AccessDenied", "NoSuchBucket"])
def test_list_errors_propagate_without_retry(s3: FakeS3, clock: FakeClock, code: str) -> None:
    s3.list_error = client_error(code)
    with pytest.raises(ClientError) as err:
        wait(s3, clock, "a@example.com", APP, timeout=60)
    assert err.value.response["Error"]["Code"] == code
    assert s3.list_calls == 1
    assert clock.sleeps == []


def test_get_object_access_denied_propagates_without_retry(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml")
    s3.get_error = client_error("AccessDenied", "GetObject")
    with pytest.raises(ClientError):
        wait(s3, clock, "user+tag@example.com", APP, timeout=60)
    assert len(s3.get_calls) == 1
    assert clock.sleeps == []


def test_object_expired_between_list_and_get_is_skipped(
    s3: FakeS3, clock: FakeClock, put_fixture: PutFixture
) -> None:
    put_fixture("plus-address.eml", key="raw/gone", modified=T0 + timedelta(seconds=9))
    put_fixture("mixed-case-recipient.eml", key="raw/here", modified=T0)
    s3.missing_keys.add("raw/gone")
    assert wait(s3, clock, "user+tag@example.com", APP).endswith("token=case123")
