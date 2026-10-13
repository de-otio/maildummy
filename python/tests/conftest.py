"""Shared test helpers: a fake S3 client and a fake clock. No network involved."""

from __future__ import annotations

import io
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from botocore.exceptions import ClientError

FIXTURES = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "eml"
T0 = datetime(2026, 10, 13, 9, 0, 0, tzinfo=UTC)


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def client_error(code: str, operation: str = "ListObjectsV2") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": code}}, operation)


class _Paginator:
    def __init__(self, fake: FakeS3) -> None:
        self._fake = fake

    def paginate(self, *, Bucket: str, Prefix: str = "") -> Iterator[dict[str, Any]]:  # noqa: N803
        self._fake.list_calls += 1
        if self._fake.list_error is not None:
            raise self._fake.list_error
        keys = sorted(k for k in self._fake.objects if k.startswith(Prefix))
        size = self._fake.page_size
        for i in range(0, max(len(keys), 1), size):
            chunk = keys[i : i + size]
            page: dict[str, Any] = {"KeyCount": len(chunk), "IsTruncated": i + size < len(keys)}
            if chunk:
                page["Contents"] = [
                    {"Key": k, "LastModified": self._fake.objects[k][1]} for k in chunk
                ]
            yield page


@dataclass
class FakeS3:
    """Just enough of the S3 client: a list_objects_v2 paginator and get_object."""

    objects: dict[str, tuple[bytes, datetime]] = field(default_factory=dict)
    page_size: int = 1000
    list_error: ClientError | None = None
    get_error: ClientError | None = None
    missing_keys: set[str] = field(default_factory=set)
    list_calls: int = 0
    get_calls: list[str] = field(default_factory=list)

    def put(self, key: str, body: bytes, modified: datetime) -> None:
        self.objects[key] = (body, modified)

    def get_paginator(self, operation: str) -> _Paginator:
        assert operation == "list_objects_v2"
        return _Paginator(self)

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        self.get_calls.append(Key)
        if self.get_error is not None:
            raise self.get_error
        if Key in self.missing_keys:
            raise client_error("NoSuchKey", "GetObject")
        return {"Body": io.BytesIO(self.objects[Key][0])}


class FakeClock:
    """Deterministic monotonic clock; sleeping advances it."""

    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def s3() -> FakeS3:
    return FakeS3()


@pytest.fixture
def put_fixture(s3: FakeS3) -> Callable[..., None]:
    counter = 0

    def put(name: str, *, modified: datetime | None = None, key: str | None = None) -> None:
        nonlocal counter
        counter += 1
        s3.put(
            key or f"raw/{counter:08d}-{name}",
            fixture_bytes(name),
            modified or T0 + timedelta(seconds=counter),
        )

    return put
