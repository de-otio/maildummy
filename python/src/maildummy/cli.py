"""``maildummy-link``: print the first matching link from a maildummy bucket."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from datetime import UTC, datetime

from botocore.exceptions import BotoCoreError, ClientError

from maildummy.fetch import DEFAULT_PREFIX, MailTimeout, link_pattern, wait_for_link


def _parse_since(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="maildummy-link",
        description="Print the first link matching a pattern in the newest mail "
        "to ADDRESS in a maildummy S3 bucket.",
    )
    p.add_argument("bucket")
    p.add_argument("address")
    p.add_argument("--region", default=None, help="AWS region (default: the boto3 default chain)")
    which = p.add_mutually_exclusive_group(required=True)
    which.add_argument("--pattern", help="regular expression; the first match is printed")
    which.add_argument("--url-prefix", help="literal URL prefix; prints the link starting with it")
    p.add_argument(
        "--since",
        type=_parse_since,
        default=datetime(1970, 1, 1, tzinfo=UTC),
        metavar="ISO8601",
        help="ignore mail older than this (naive values are UTC; default: no limit)",
    )
    p.add_argument("--timeout", type=float, default=60.0, help="seconds to wait (default: 60)")
    p.add_argument("--poll-interval", type=float, default=2.0, help="seconds between polls")
    p.add_argument("--prefix", default=DEFAULT_PREFIX, help="S3 key prefix (default: raw/)")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    pattern = args.pattern if args.pattern is not None else link_pattern(args.url_prefix)
    try:
        link = wait_for_link(
            args.bucket,
            args.address,
            pattern=pattern,
            since=args.since,
            timeout=args.timeout,
            poll_interval=args.poll_interval,
            region=args.region,
            prefix=args.prefix,
        )
    except (MailTimeout, ClientError, BotoCoreError, ValueError) as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1
    print(link)
    return 0


if __name__ == "__main__":
    sys.exit(main())
