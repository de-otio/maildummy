# Deployment guide

## Prerequisites

- An AWS account with SES enabled in your target region
- A DNS zone you control (Cloudflare, Route53, or another provider)
- An **existing active SES receipt rule set** — AWS allows only one active rule set per region, so the module/construct appends to an existing one rather than creating its own

## Initial deployment

### Step 1 — Deploy without DKIM

Deploy the infrastructure with `enable_dkim = false` (the default). This creates the domain identity, S3 bucket, SNS topic, receipt rule, and DNS records.

**Terraform:**

```bash
terraform apply
```

**CDK:**

```bash
npx cdk deploy
```

### Step 2 — Verify the domain

SES verifies the domain automatically once the DNS records propagate. Check the status:

```bash
aws ses get-identity-verification-attributes \
  --identities maildummy.example.com \
  --region eu-central-1
```

Wait for `VerificationStatus: Success` (usually a few minutes).

### Step 3 — Enable DKIM (optional)

Once the domain is verified, set `enable_dkim = true` and apply again. This creates the three DKIM CNAME records.

## SNS notification issue

AWS SES validates SNS topic permissions synchronously when creating a receipt rule. This validation can fail with `InvalidSnsTopic` even when the policy is correct, due to propagation delays.

**Workaround:**

1. Set `enable_sns_notifications = false`
2. Deploy successfully
3. Set `enable_sns_notifications = true` and deploy again

SNS notifications are optional — S3 storage is sufficient for most testing workflows.

## Troubleshooting

### Emails not appearing in S3

1. **Check the MX record** — it must point to `inbound-smtp.<region>.amazonaws.com` (not `amazonses.com`):

   ```bash
   dig MX maildummy.example.com
   ```

2. **Check domain verification**:

   ```bash
   aws ses get-identity-verification-attributes --identities maildummy.example.com
   ```

3. **Check the receipt rule set is active**:

   ```bash
   aws ses describe-active-receipt-rule-set --region eu-central-1
   ```

4. **Check the bucket policy** allows SES to write:

   ```bash
   aws s3api get-bucket-policy --bucket my-maildummy-bucket
   ```

### DKIM records not created on first apply

DKIM tokens are generated asynchronously by SES after domain verification. If the first apply produces no DKIM records, run `terraform apply` (or `cdk deploy`) a second time.

## Security notes

- The S3 bucket is private, encrypted (AES256 with bucket key), and blocks all public access.
- The SNS topic is encrypted with the AWS-managed SNS KMS key.
- The S3 bucket policy restricts writes to SES using `SourceAccount` and `SourceArn` conditions.
- Emails are automatically deleted after the configured retention period.
- Use a dedicated subdomain (e.g. `maildummy.*`) that is isolated from production mail.

## Cost

- **SES**: Free for receiving email
- **S3**: Negligible — emails are small and short-lived
- **SNS**: Negligible
- **DNS**: Free on Cloudflare; standard Route53 pricing applies
