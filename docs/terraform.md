# Terraform module reference

Module path: `terraform/modules/ses_maildummy`

## Usage

### Route53

```hcl
module "maildummy" {
  source = "github.com/your-org/maildummy//terraform/modules/ses_maildummy"

  maildummy_domain      = "maildummy.example.com"
  maildummy_subdomain   = "maildummy"
  dns_provider          = "route53"
  route53_zone_id       = "Z1234567890ABC"
  aws_region            = "eu-central-1"
  s3_bucket_name        = "my-project-maildummy"
  sns_topic_name        = "my-project-maildummy-notifications"
  receipt_rule_set_name = "my-existing-ruleset"
  receipt_rule_name     = "my-project-maildummy-rule"
}
```

### Cloudflare

The core module needs only the AWS provider. Cloudflare records live in a separate
module, `terraform/modules/ses_maildummy_cloudflare`, which takes the core module's
`dns_records` output:

```hcl
module "maildummy" {
  source = "github.com/your-org/maildummy//terraform/modules/ses_maildummy"

  maildummy_domain      = "maildummy.example.com"
  maildummy_subdomain   = "maildummy"
  dns_provider          = "none"
  aws_region            = "eu-central-1"
  s3_bucket_name        = "my-project-maildummy"
  sns_topic_name        = "my-project-maildummy-notifications"
  receipt_rule_set_name = "my-existing-ruleset"
  receipt_rule_name     = "my-project-maildummy-rule"
}

module "maildummy_cloudflare" {
  source = "github.com/your-org/maildummy//terraform/modules/ses_maildummy_cloudflare"

  zone_id     = "your-zone-id"
  dns_records = module.maildummy.dns_records
}
```

### Any other DNS provider

Set `dns_provider = "none"` and publish the records in the `dns_records` output
(verification TXT, MX, and the DKIM CNAMEs) with whatever provider you use.

## Prerequisites

- Terraform >= 1.0 or OpenTofu
- AWS provider >= 5.0, < 7.0 (both 5.x and 6.x are tested)
- Cloudflare provider >= 5.12.0, < 6.0.0, only if you use the `ses_maildummy_cloudflare` module
- An **existing active SES receipt rule set** (AWS allows only one active rule set per region; the module appends a rule to it rather than creating one)

## Resources created

| Resource | Purpose |
|----------|---------|
| `aws_ses_domain_identity` | Verifies the maildummy domain with SES |
| `aws_s3_bucket` + policies | Stores emails under `raw/`, encrypted (AES256), lifecycle-managed |
| `aws_sns_topic` + policy | Optional email-arrival notifications (KMS-encrypted) |
| `aws_ses_receipt_rule` | Routes inbound mail to S3 (and optionally SNS) |
| `aws_route53_record` (MX, TXT, DKIM CNAMEs) | Only when `dns_provider = "route53"`; otherwise publish the `dns_records` output yourself |

## Variables

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `maildummy_domain` | `string` | yes | — | Full domain, e.g. `maildummy.example.com` |
| `maildummy_subdomain` | `string` | yes | — | Subdomain without zone, e.g. `maildummy` |
| `dns_provider` | `string` | no | `"none"` | `"route53"` or `"none"` |
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
| `dns_records` | Records to publish: `verification` (TXT), `mx`, and `dkim` (list of CNAMEs, empty unless `enable_dkim`). Each has a fully qualified `name`, `type`, `ttl` and `value`; `mx` also has `priority`. |

## `ses_maildummy_cloudflare` module

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `zone_id` | `string` | yes | Cloudflare zone that contains the maildummy domain |
| `dns_records` | `object` | yes | The `dns_records` output of `ses_maildummy` |

Output: `record_ids` (`verification`, `mx`, `dkim`).

## Upgrading from 1.x to 2.0

**Route53 users:** no address changes. `dns_provider` no longer defaults to
`"cloudflare"`, so keep `dns_provider = "route53"` set explicitly.

**Cloudflare users:** the Cloudflare records moved out of the core module. Set
`dns_provider = "none"`, remove `cloudflare_zone_id`, add the
`ses_maildummy_cloudflare` module as shown above, and add `moved` blocks in your
root module so the existing records are kept rather than destroyed and recreated.
`moved` across module boundaries must be written in the calling (root) module:

```hcl
moved {
  from = module.maildummy.cloudflare_dns_record.maildummy_verification[0]
  to   = module.maildummy_cloudflare.cloudflare_dns_record.verification
}

moved {
  from = module.maildummy.cloudflare_dns_record.maildummy_mx[0]
  to   = module.maildummy_cloudflare.cloudflare_dns_record.mx
}

# Only if enable_dkim = true. 1.x keyed the DKIM records by token; list them with
#   tofu state list 'module.maildummy.cloudflare_dns_record.maildummy_dkim'
# and add one block per token (indices 0, 1, 2 in any order).
moved {
  from = module.maildummy.cloudflare_dns_record.maildummy_dkim["<token-1>"]
  to   = module.maildummy_cloudflare.cloudflare_dns_record.dkim[0]
}
```

Adjust `module.maildummy` / `module.maildummy_cloudflare` to the names you use.
The new module writes fully qualified record names (1.x wrote names relative to the
zone), so the first plan may show an in-place update of `name`; it must not show a
destroy/create. Run `plan` and check before you `apply`.
