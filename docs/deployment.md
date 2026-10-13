# Deployment guide

## Prerequisites

- An AWS account with SES enabled in your target region
- A DNS zone you control (Cloudflare, Route53, or another provider)
- An active SES receipt rule set. AWS allows only one active rule set per region, so it must have exactly one owner. If something else already manages it, point `receipt_rule_set_name` / `receiptRuleSetName` at that set. In a fresh account, set `create_rule_set` and `activate_rule_set` (Terraform) or `createRuleSet` and `activateRuleSet` (CDK) to have maildummy create and activate one.

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

## SNS notifications and topic encryption

SNS notifications are optional (`enable_sns_notifications`); S3 storage is enough for most testing workflows.

When SES creates a receipt rule with an SNS action it checks that it can publish to the topic. SES cannot publish to a topic encrypted with the AWS-managed key `alias/aws/sns`: that key's policy does not let AWS services call `kms:GenerateDataKey` / `kms:Decrypt`, and it cannot be edited. The Terraform module therefore leaves the topic unencrypted by default. To encrypt it, pass a customer-managed key as `sns_kms_key_arn` whose key policy includes:

```json
{
  "Sid": "AllowSESToUseKeyForSNS",
  "Effect": "Allow",
  "Principal": { "Service": "ses.amazonaws.com" },
  "Action": ["kms:GenerateDataKey*", "kms:Decrypt"],
  "Resource": "*"
}
```

The module also outputs this statement as `sns_kms_key_policy_statement`. The topic policy allows `SNS:Publish` from SES only for this account (`AWS:SourceAccount`) and this receipt rule (`AWS:SourceArn`).

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
- The SNS topic is unencrypted by default (SES cannot use the AWS-managed SNS key); the Terraform module accepts a customer-managed key via `sns_kms_key_arn`. The topic policy restricts publishing to SES for this account and receipt rule.
- The S3 bucket policy restricts writes to SES using `SourceAccount` and `SourceArn` conditions.
- Emails are automatically deleted after the configured retention period.
- Use a dedicated subdomain (e.g. `maildummy.*`) that is isolated from production mail.

## Cost

- **SES**: Free for receiving email
- **S3**: Negligible — emails are small and short-lived
- **SNS**: Negligible
- **DNS**: Free on Cloudflare; standard Route53 pricing applies
