# Helper scripts

Maildummy includes scripts in Node.js and Python that retrieve magic links from the S3 bucket. Both do the same thing — pick whichever fits your stack.

## What the helpers do

1. List the objects under `raw/` in the maildummy S3 bucket
2. Parse each MIME email and check the `To`/`Cc` headers for the target address
3. Search the email body for a link and return it

How the mail is selected and how the link is matched is described per language below.

## Node.js

```bash
npm install   # installs @aws-sdk/client-s3 and mailparser
node scripts/get-magic-link-from-s3.js <bucket-name> <email-address> [--region <region>]
```

Default region: `eu-central-1`.

The script also exports `getMagicLinkFromS3(bucketName, emailAddress, region)` for use as a library.

## Python

The Python helper is an installable package, `maildummy`, whose only runtime dependency is `boto3` (Python 3.11 or later). Pin it to a release tag:

```bash
pip install "maildummy @ git+https://github.com/de-otio/maildummy@<tag>#subdirectory=python"
```

### Library

```python
from datetime import datetime, timezone

from maildummy import MailTimeout, fetch_messages, link_pattern, wait_for_link

started = datetime.now(timezone.utc)
# ... trigger the email ...
link = wait_for_link(
    "my-maildummy-bucket",
    "test-123@maildummy.example.com",
    pattern=link_pattern("https://app.example.com/"),
    since=started,
    timeout=60,
)
```

`wait_for_link(bucket, address, *, pattern, since, timeout=60.0, poll_interval=2.0, region=None, s3_client=None)` polls until a mail to `address` contains a match for `pattern`, then returns the first match in the newest qualifying mail. It raises `MailTimeout` (a subclass of `TimeoutError`) if nothing matches in time. A botocore `ClientError` such as `AccessDenied` or `NoSuchBucket` propagates at once and is never retried. Keyword-only extras: `prefix` (default `raw/`), and `sleep` / `monotonic` for deterministic tests.

`fetch_messages(bucket, address, *, since, prefix="raw/", region=None, s3_client=None)` returns the mails to `address` as `email.message.EmailMessage` objects, newest first, for tests that need more than one link or other parts of the mail.

How mail is selected and matched:

- **`since`** must be timezone-aware (a naive value raises `ValueError`). Objects whose S3 `LastModified` is older are never downloaded. S3 timestamps have one-second resolution, so take `since` just before you trigger the email, and allow a little slack if your clock and S3's might differ.
- **Listing** is paginated, so buckets with more than 1000 objects are fully searched. Mails are examined newest first.
- **Recipients** are the `To` and `Cc` addresses, parsed with `email.utils.getaddresses` and compared in lower case. `user+tag@example.com` and display names such as `"Doe, Jane" <jane@example.com>` work.
- **`pattern`** is a regular expression (a string or a compiled `re.Pattern`), or `link_pattern(prefix)`, which matches a literal URL prefix up to the next whitespace, quote or angle bracket and so keeps `#` fragments such as `https://app.example.com/#/sign-in/link#otp=123456` whole. The first match (the whole match, `group(0)`) is returned. Nothing about the link's shape is assumed.
- **Body**: `text/plain` parts are searched first, then HTML parts. A match from HTML is `html.unescape`d (so `&amp;` becomes `&`); a match from plain text is returned as written. Parts are decoded with their declared charset.
- **`s3_client`** lets you pass your own client, for example a fake in unit tests. `region=None` uses the boto3 default chain.

### Command line

```bash
maildummy-link <bucket-name> <email-address> (--pattern <regex> | --url-prefix <prefix>) \
    [--region <region>] [--since <iso8601>] [--timeout <seconds>] [--poll-interval <seconds>] [--prefix <key-prefix>]
```

Prints the link and exits 0; prints `Error: ...` to stderr and exits 1 on timeout or an AWS error. `--since` takes an ISO 8601 timestamp (naive values are read as UTC); without it, mail of any age is considered. The region defaults to the boto3 default chain (earlier versions defaulted to `eu-central-1`).

`scripts/get-magic-link-from-s3.py` is a deprecated shim for the same command. From a checkout it works with only `boto3` installed (`pip install -r requirements.txt`). It no longer guesses at Supabase or `token=` links, so you must pass `--pattern` or `--url-prefix`.

## AWS credentials

Both scripts use the default credential chain (environment variables, `~/.aws/credentials`, instance profile, etc.). Make sure the calling identity has `s3:ListBucket` and `s3:GetObject` on the maildummy bucket.
