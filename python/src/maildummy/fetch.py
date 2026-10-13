"""Fetch mail captured by a maildummy S3 bucket.

The two entry points are :func:`wait_for_link`, which polls until a link
matching a caller-supplied pattern shows up in a mail for one address, and
:func:`fetch_messages`, which returns the parsed mails themselves.
"""

from __future__ import annotations

import html
import re
import time
from collections.abc import Callable, Iterator
from datetime import datetime
from email import message_from_bytes, policy
from email.message import EmailMessage, Message
from email.utils import getaddresses
from typing import Any

from botocore.exceptions import ClientError

__all__ = ["MailTimeout", "fetch_messages", "link_pattern", "wait_for_link"]

DEFAULT_PREFIX = "raw/"


class MailTimeout(TimeoutError):
    """No qualifying mail with a matching link arrived within the timeout."""


def link_pattern(prefix: str) -> re.Pattern[str]:
    """Build a pattern for a link starting with ``prefix``.

    The prefix is matched literally. The match runs up to the next
    whitespace, quote or angle bracket, so ``#`` fragments such as
    ``https://app.example.com/#/sign-in/link#otp=123456`` are kept whole.
    """
    return re.compile(re.escape(prefix) + r"""[^\s"'<>]*""")


def _compile(pattern: str | re.Pattern[str]) -> re.Pattern[str]:
    return re.compile(pattern) if isinstance(pattern, str) else pattern


def _require_aware(since: datetime) -> None:
    if since.tzinfo is None or since.utcoffset() is None:
        raise ValueError("since must be timezone-aware (e.g. datetime.now(timezone.utc))")


def _default_client(region: str | None) -> Any:
    import boto3

    return boto3.client("s3", region_name=region)


def _recipients(msg: EmailMessage) -> set[str]:
    values = [str(v) for name in ("To", "Cc") for v in msg.get_all(name, [])]
    return {addr.strip().lower() for _, addr in getaddresses(values) if addr}


def _part_text(part: Message[str, str]) -> str:
    """Decode a text part with its declared charset; never raises on bad charsets."""
    assert isinstance(part, EmailMessage)
    try:
        return str(part.get_content())
    except (LookupError, UnicodeError):
        raw = part.get_payload(decode=True)
        data = raw if isinstance(raw, bytes) else b""
        try:
            return data.decode(part.get_content_charset() or "utf-8", errors="replace")
        except LookupError:
            return data.decode("utf-8", errors="replace")


def _bodies(msg: EmailMessage) -> Iterator[tuple[str, bool]]:
    """Yield ``(text, is_html)`` for every text body: text/plain first, then HTML."""
    parts = [
        p
        for p in msg.walk()
        if not p.is_multipart() and p.get_content_disposition() != "attachment"
    ]
    for wanted, is_html in (("text/plain", False), ("text/html", True)):
        for part in parts:
            if part.get_content_type() == wanted:
                yield _part_text(part), is_html


def _find_link(msg: EmailMessage, pattern: re.Pattern[str]) -> str | None:
    for text, is_html in _bodies(msg):
        found = pattern.search(text)
        if found:
            # Only HTML needs unescaping. In plain text "&section=1" is a literal
            # query string, and html.unescape would turn "&sect" into a "§".
            return html.unescape(found.group(0)) if is_html else found.group(0)
    return None


def _iter_candidates(
    client: Any,
    bucket: str,
    address: str,
    since: datetime,
    prefix: str,
    skip: set[str],
) -> Iterator[tuple[str, EmailMessage]]:
    """Yield ``(key, message)`` for mails to ``address`` at or after ``since``, newest first.

    Objects older than ``since`` are never fetched. Keys in ``skip`` are not
    fetched either; the caller uses that to avoid re-downloading mails it has
    already examined (S3 objects are immutable).
    """
    objects: list[dict[str, Any]] = []
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        objects.extend(o for o in page.get("Contents", []) if o["LastModified"] >= since)
    objects.sort(key=lambda o: (o["LastModified"], o["Key"]), reverse=True)

    wanted = address.strip().lower()
    for obj in objects:
        key: str = obj["Key"]
        if key in skip:
            continue
        try:
            body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") == "NoSuchKey":
                continue  # expired by the retention rule between list and get
            raise
        msg = message_from_bytes(body, policy=policy.default)
        assert isinstance(msg, EmailMessage)
        if wanted in _recipients(msg):
            yield key, msg
        else:
            skip.add(key)


def fetch_messages(
    bucket: str,
    address: str,
    *,
    since: datetime,
    prefix: str = DEFAULT_PREFIX,
    region: str | None = None,
    s3_client: Any | None = None,
) -> list[EmailMessage]:
    """Return the mails addressed (To or Cc) to ``address``, newest first.

    Only objects under ``prefix`` whose ``LastModified`` is at or after
    ``since`` (timezone-aware) are downloaded. Recipient comparison is
    case-insensitive and understands ``+tags`` and quoted display names.
    botocore ``ClientError`` (AccessDenied, NoSuchBucket, ...) propagates.
    """
    _require_aware(since)
    client = s3_client if s3_client is not None else _default_client(region)
    return [msg for _, msg in _iter_candidates(client, bucket, address, since, prefix, set())]


def wait_for_link(
    bucket: str,
    address: str,
    *,
    pattern: str | re.Pattern[str],
    since: datetime,
    timeout: float = 60.0,
    poll_interval: float = 2.0,
    region: str | None = None,
    s3_client: Any | None = None,
    prefix: str = DEFAULT_PREFIX,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> str:
    """Poll until a mail to ``address`` contains a match for ``pattern``; return the match.

    ``pattern`` is a regular expression (``str`` or compiled; see
    :func:`link_pattern` for a URL prefix). It is searched in the text/plain
    bodies first, then in the HTML bodies, of the newest qualifying mail first;
    the first match (``group(0)``) is returned, HTML-unescaped if it came from
    HTML. Mails older than ``since`` (timezone-aware) are ignored; allow a
    little slack for clock skew, since S3 timestamps have one-second resolution.

    Raises :class:`MailTimeout` when nothing matches within ``timeout`` seconds
    (one attempt is always made). ``ClientError`` propagates at once and is
    never retried. ``sleep`` and ``monotonic`` are injectable for tests.
    """
    _require_aware(since)
    compiled = _compile(pattern)
    client = s3_client if s3_client is not None else _default_client(region)
    deadline = monotonic() + timeout
    examined: set[str] = set()  # keys of mails already read that had no match

    while True:
        for key, msg in _iter_candidates(client, bucket, address, since, prefix, examined):
            link = _find_link(msg, compiled)
            if link is not None:
                return link
            examined.add(key)
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise MailTimeout(
                f"no mail to {address} in {bucket} matched {compiled.pattern!r} "
                f"within {timeout:g}s"
            )
        sleep(min(poll_interval, remaining))
