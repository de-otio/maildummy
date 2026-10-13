# E2E testing guide

This page shows how to wire maildummy into an automated test suite to capture emails and extract magic links.

## Overview

1. Generate a unique test email address at the maildummy domain
2. Trigger the action that sends an email (e.g. magic link, verification code)
3. Poll the S3 bucket until the email arrives
4. Parse the email and extract the data you need

## 1. Generate a test address

Use a unique address per test run to avoid collisions:

```ts
const testEmail = `test-${Date.now()}@maildummy.example.com`;
```

Any address at the maildummy domain will be captured — there is no need to pre-register recipients.

## 2. Trigger the email

```ts
await fetch(`${API_URL}/auth/send-magic-link`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: testEmail }),
});
```

## 3. Retrieve the magic link

### Using the Node.js helper

Install the package, pinned to a release tag:

```bash
npm install --save-dev "github:de-otio/maildummy#<tag>"
```

`waitForLink` does the polling for you. Take `since` just before you trigger the email so that mail from earlier runs is ignored:

```ts
const { waitForLink, linkPattern } = require("@de-otio/maildummy");

const since = new Date();
// ... trigger the email ...
const link = await waitForLink("my-maildummy-bucket", testEmail, {
  pattern: linkPattern("https://app.example.com/"),
  since,
  timeout: 60_000, // milliseconds
});
// a MailTimeout is thrown if no mail arrives in time
```

Or run the command line tool, which prints the link:

```ts
import { execFileSync } from "child_process";

const link = execFileSync(
  "npx",
  ["maildummy-link", "my-maildummy-bucket", testEmail, "--url-prefix", "https://app.example.com/", "--timeout", "60"],
  { encoding: "utf-8" }
).trim();
```

### From Python (pytest)

Install the `maildummy` package, pinned to a release tag:

```bash
pip install "maildummy @ git+https://github.com/de-otio/maildummy@<tag>#subdirectory=python"
```

`wait_for_link` does the polling for you. Take `since` just before you trigger the email so that mail from earlier runs is ignored:

```python
from datetime import datetime, timezone

from maildummy import link_pattern, wait_for_link


def test_sign_in(api_client):
    test_email = "test-123@maildummy.example.com"
    started = datetime.now(timezone.utc)

    api_client.post("/auth/send-magic-link", json={"email": test_email})

    link = wait_for_link(
        "my-maildummy-bucket",
        test_email,
        pattern=link_pattern("https://app.example.com/"),
        since=started,
        timeout=60,
    )
    # a MailTimeout (a TimeoutError) is raised if no mail arrives in time
```

See [Helper scripts](helper-scripts.md) for the full reference.

## 4. Complete authentication

Read the parameters from the link. Some apps put them in the query string (`https://app.example.com/auth/callback?token=...`), others in the URL fragment, which `url.searchParams` does not see: `https://app.example.com/callback#token=...`, or with a hash router `https://app.example.com/#/sign-in/link#otp=123456` (a second `#`) or `https://app.example.com/#/sign-in?otp=123456`. This helper reads all of them; a query-string value wins if the same name appears in both:

```ts
function linkParams(link: string): URLSearchParams {
  const url = new URL(link);
  const params = new URLSearchParams(url.search);
  const fragment = url.hash.slice(1);
  // Parameters follow the first "?" or "#" inside the fragment (hash router),
  // or make up the whole fragment when it has no path ("#token=...").
  const sep = fragment.search(/[?#]/);
  const fragmentParams = sep >= 0 ? fragment.slice(sep + 1) : fragment.includes("=") ? fragment : "";
  for (const [key, value] of new URLSearchParams(fragmentParams)) {
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

const params = linkParams(link);
const token = params.get("token");
const type = params.get("type");

await fetch(`${API_URL}/auth/callback`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token, type }),
});
```

## Tips

- **Retention**: Emails are auto-deleted after `emailRetentionDays` (default 1 day), so stale data does not accumulate.
- **Parallelism**: Each test should use a unique email address. The helper scripts match by recipient, so parallel tests will not interfere with each other.
- **SNS notifications**: If you subscribe a Lambda or SQS queue to the SNS topic, you can use event-driven polling instead of listing S3 objects.
