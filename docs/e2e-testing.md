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

### Using the helper script directly

```ts
import { execSync } from "child_process";

const link = execSync(
  `node scripts/get-magic-link-from-s3.js my-maildummy-bucket ${testEmail} --region eu-central-1`,
  { encoding: "utf-8" }
).trim();
```

### Using the module export

```ts
const { getMagicLinkFromS3 } = require("@deotio/maildummy/scripts/get-magic-link-from-s3");

const link = await getMagicLinkFromS3("my-maildummy-bucket", testEmail, "eu-central-1");
```

### Polling

Emails typically arrive within a few seconds, but delivery is not instant. Wrap the retrieval in a retry loop:

```ts
async function waitForMagicLink(bucket: string, email: string, region: string, timeoutMs = 30000) {
  const { getMagicLinkFromS3 } = require("@deotio/maildummy/scripts/get-magic-link-from-s3");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      return await getMagicLinkFromS3(bucket, email, region);
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`Magic link for ${email} not found within ${timeoutMs}ms`);
}
```

## 4. Complete authentication

```ts
const url = new URL(link);
const token = url.searchParams.get("token");
const type = url.searchParams.get("type");

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
