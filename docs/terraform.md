# Terraform module reference

Module path: `terraform/modules/ses_maildummy`

## Usage

```hcl
module "maildummy" {
  source = "github.com/your-org/maildummy//terraform/modules/ses_maildummy"

  maildummy_domain      = "maildummy.example.com"
  maildummy_subdomain   = "maildummy"
  dns_provider          = "cloudflare"           # or "route53"
  cloudflare_zone_id    = "your-zone-id"         # omit if using route53
  # route53_zone_id     = "Z1234567890ABC"       # omit if using cloudflare
  aws_region            = "eu-central-1"
  s3_bucket_name        = "my-project-maildummy"
  sns_topic_name        = "my-project-maildummy-notifications"
  receipt_rule_set_name = "my-existing-ruleset"
  receipt_rule_name     = "my-project-maildummy-rule"
}
```

## Prerequisites

- Terraform >= 1.0
- AWS provider >= 5.0
- Cloudflare provider = 5.12.0 (only when `dns_provider = "cloudflare"`)
- An **existing active SES receipt rule set** (AWS allows only one active rule set per region; the module appends a rule to it rather than creating one)

## Resources created

| Resource | Purpose |
|----------|---------|
| `aws_ses_domain_identity` | Verifies the maildummy domain with SES |
| `aws_s3_bucket` + policies | Stores emails under `raw/`, encrypted (AES256), lifecycle-managed |
| `aws_sns_topic` + policy | Optional email-arrival notifications (KMS-encrypted) |
| `aws_ses_receipt_rule` | Routes inbound mail to S3 (and optionally SNS) |
| DNS records (MX, TXT, DKIM CNAMEs) | Created in Cloudflare or Route53 depending on `dns_provider` |

## Variables

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `maildummy_domain` | `string` | yes | — | Full domain, e.g. `maildummy.example.com` |
| `maildummy_subdomain` | `string` | yes | — | Subdomain without zone, e.g. `maildummy` |
| `dns_provider` | `string` | no | `"cloudflare"` | `"cloudflare"` or `"route53"` |
| `cloudflare_zone_id` | `string` | if cloudflare | `null` | Cloudflare zone ID |
| `route53_zone_id` | `string` | if route53 | `null` | Route53 hosted zone ID |
| `aws_region` | `string` | no | `"eu-central-1"` | AWS region for SES |
| `s3_bucket_name` | `string` | yes | — | S3 bucket name |
| `sns_topic_name` | `string` | yes | — | SNS topic name |
| `receipt_rule_set_name` | `string` | yes | — | Existing SES receipt rule set to append to |
| `receipt_rule_name` | `string` | yes | — | Name for the new receipt rule |
| `email_retention_days` | `number` | no | `1` | Days before emails are auto-deleted (must be > 0) |
| `tags` | `map(string)` | no | `{}` | Tags applied to all taggable resources |
| `enable_dkim` | `bool` | no | `false` | Create DKIM CNAME records (enable after domain verification) |
| `enable_sns_notifications` | `bool` | no | `true` | Add SNS action to the receipt rule |

## Outputs

| Output | Description |
|--------|-------------|
| `maildummy_domain` | The maildummy domain name |
| `s3_bucket_name` | S3 bucket name |
| `s3_bucket_arn` | S3 bucket ARN |
| `sns_topic_arn` | SNS topic ARN |
| `sns_topic_name` | SNS topic name |
| `receipt_rule_set_name` | The receipt rule set the rule was appended to |
| `ses_identity_arn` | SES domain identity ARN |
