# Terraform module reference

Module path: `terraform/modules/ses_maildummy`

## Usage

### Route53

```hcl
module "maildummy" {
  source = "github.com/your-org/maildummy//terraform/modules/ses_maildummy"

  maildummy_domain      = "maildummy.example.com"
  dns_provider          = "route53"
  route53_zone_id       = "Z1234567890ABC"
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
  dns_provider          = "none"
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

- Terraform >= 1.7 or OpenTofu >= 1.7 (the module uses a `removed` block)
- AWS provider >= 5.0, < 7.0 (both 5.x and 6.x are tested)
- Cloudflare provider >= 5.12.0, < 6.0.0, only if you use the `ses_maildummy_cloudflare` module
- An SES receipt rule set, active in the region (see [Receipt rule set](#receipt-rule-set))

## Receipt rule set

SES only delivers mail through the **active** receipt rule set, and each region has
at most one. That makes the active set a per-region singleton: exactly one
configuration must own it.

- **Default** (`create_rule_set = false`, `activate_rule_set = false`): the module
  adds its rule to the existing set `receipt_rule_set_name` and leaves activation
  alone. Use this when something else owns the active set.
- **`create_rule_set = true`**: the module creates `receipt_rule_set_name`.
- **`activate_rule_set = true`**: the module makes `receipt_rule_set_name` the active
  set. Enable it only if nothing else manages the active set. Destroying the module
  then disables email receiving in the region (the provider calls
  `SetActiveReceiptRuleSet` with no name, whichever set is active at the time).

An account with no active set receives nothing, so a fresh account needs both
options, or a set created and activated elsewhere.

Without `receipt_rule_after`, SES inserts the rule at the **beginning** of the
rule set. Set `receipt_rule_after` to the name of an existing rule to place it after
that rule instead.

## Resources created

| Resource | Purpose |
|----------|---------|
| `aws_ses_domain_identity` | Verifies the maildummy domain with SES |
| `aws_s3_bucket` + policies | Stores emails under `raw/`, encrypted (AES256), lifecycle-managed. ACLs disabled (`BucketOwnerEnforced`); the policy lets SES `s3:PutObject` under `raw/*` only and denies requests that do not use TLS |
| `aws_sns_topic` + policy | Optional email-arrival notifications (unencrypted unless `sns_kms_key_arn` is set); policy limited to this account's receipt rule |
| `aws_ses_receipt_rule` | Routes inbound mail to S3 (and optionally SNS) |
| `aws_ses_receipt_rule_set` | Only when `create_rule_set = true` |
| `aws_ses_domain_identity_verification` | Only when `wait_for_verification = true`; waits for SES to verify the domain |
| `aws_ses_active_receipt_rule_set` | Only when `activate_rule_set = true` |
| `aws_route53_record` (MX, TXT, DKIM CNAMEs) | Only when `dns_provider = "route53"`; otherwise publish the `dns_records` output yourself |

## Variables

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `maildummy_domain` | `string` | yes | — | Full domain, e.g. `maildummy.example.com`; the single source of the SES identity and the record names |
| `maildummy_subdomain` | `string` | no | `null` | Deprecated. Record names are derived from `maildummy_domain`. If set, `maildummy_domain` must equal it or start with `"<subdomain>."`, or the plan fails. Existing Route53 deployments should keep it (see [Upgrading](#upgrading-from-1x-to-20)). |
| `dns_provider` | `string` | no | `"none"` | `"route53"` or `"none"` |
| `route53_zone_id` | `string` | if route53 | `null` | Route53 hosted zone ID |
| `aws_region` | `string` | no | `null` | Deprecated and ignored: the module uses the aws provider's region. If set, it must equal that region or the plan fails. |
| `s3_bucket_name` | `string` | yes | — | S3 bucket name |
| `sns_topic_name` | `string` | yes | — | SNS topic name |
| `receipt_rule_set_name` | `string` | yes | — | Receipt rule set that holds the rule (must exist unless `create_rule_set`) |
| `create_rule_set` | `bool` | no | `false` | Create `receipt_rule_set_name` |
| `activate_rule_set` | `bool` | no | `false` | Make `receipt_rule_set_name` the active set (per-region singleton; one owner only) |
| `receipt_rule_name` | `string` | yes | — | Name for the new receipt rule |
| `receipt_rule_after` | `string` | no | `null` | Existing rule to place this rule after; `null` inserts it first |
| `email_retention_days` | `number` | no | `1` | Days before emails are auto-deleted (must be > 0) |
| `tags` | `map(string)` | no | `{}` | Tags applied to the S3 bucket and the SNS topic (the other resources are not taggable in the provider) |
| `enable_dkim` | `bool` | no | `false` | Enable Easy DKIM and publish its three CNAME records; works on the first apply |
| `wait_for_verification` | `bool` | no | `false` | Block the apply until SES reports the domain as verified |
| `verification_timeout` | `string` | no | `"15m"` | How long `wait_for_verification` waits (e.g. `"90s"`, `"15m"`, `"1h"`) |
| `enable_sns_notifications` | `bool` | no | `true` | Add SNS action to the receipt rule |
| `sns_kms_key_arn` | `string` | no | `null` | Customer-managed KMS key for the topic; its policy must grant `ses.amazonaws.com` `kms:GenerateDataKey*` and `kms:Decrypt`. `alias/aws/...` keys are rejected because SES cannot use them. |

## Outputs

| Output | Description |
|--------|-------------|
| `maildummy_domain` | The maildummy domain name |
| `s3_bucket_name` | S3 bucket name |
| `s3_bucket_arn` | S3 bucket ARN |
| `sns_topic_arn` | SNS topic ARN |
| `sns_topic_name` | SNS topic name |
| `receipt_rule_set_name` | The receipt rule set that holds the rule |
| `ses_identity_arn` | SES domain identity ARN |
| `sns_kms_key_policy_statement` | JSON key policy statement to add to the key passed as `sns_kms_key_arn` |
| `dns_records` | Records to publish: `verification` (TXT), `mx`, and `dkim` (list of CNAMEs, empty unless `enable_dkim`). Each has a fully qualified `name`, `type`, `ttl` and `value`; `mx` also has `priority`. |

## `ses_maildummy_cloudflare` module

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `zone_id` | `string` | yes | Cloudflare zone that contains the maildummy domain |
| `sns_kms_key_policy_statement` | JSON key policy statement to add to the key passed as `sns_kms_key_arn` |
| `dns_records` | `object` | yes | The `dns_records` output of `ses_maildummy` |

Output: `record_ids` (`verification`, `mx`, `dkim`).

## Upgrading from 1.x to 2.0

**All users:** the SNS topic no longer uses `alias/aws/sns` (SES cannot publish to
topics encrypted with it), so the plan shows an in-place update removing its
encryption; set `sns_kms_key_arn` to a customer-managed key to keep it encrypted.
The topic policy gains `AWS:SourceAccount` and `AWS:SourceArn` conditions.

The region and partition now come from the `aws` provider (`data.aws_region`,
`data.aws_partition`) instead of `var.aws_region` and a literal `arn:aws`. They feed
the receipt-rule ARN in the S3 and SNS policies and the MX target. `aws_region` is
deprecated and ignored: remove it. If you keep it, it must equal the provider's
region or the plan fails with a precondition error. If you relied on the old default
(`eu-central-1`) with a provider in another region, the policies and the MX record
were wrong; the next plan corrects them in place.

**S3 bucket:** object ownership changes from `BucketOwnerPreferred` to
`BucketOwnerEnforced`, which disables ACLs, and the module no longer manages
`aws_s3_bucket_acl`. The bucket policy drops `s3:PutObjectAcl`, limits the SES grant
to `<bucket>/raw/*` (the prefix the receipt rule writes to) and gains a Deny for all
principals when `aws:SecureTransport` is `false`. The plan shows in-place updates of
the ownership controls and the bucket policy, and the ACL resource as "will no
longer be managed, but will not be destroyed". Nothing is deleted in AWS: the
provider's delete for `aws_s3_bucket_acl` makes no API call, and `BucketOwnerEnforced`
makes S3 ignore ACLs anyway. The `removed` block (needs Terraform or OpenTofu >= 1.7)
only makes the plan say so. If you read objects in the bucket with
anything that relies on ACLs, or a client that talks plain HTTP, it breaks; the
module itself and SES delivery do not.

**`maildummy_subdomain`:** `maildummy_domain` is now the only name input and the
Route53 records are named after it, fully qualified (for example
`_amazonses.maildummy.example.com`). `maildummy_subdomain` is optional and
deprecated; if you set it, the plan fails unless `maildummy_domain` equals it or
starts with `"<subdomain>."`, so the two can no longer drift apart.

**Route53 users, read this before removing `maildummy_subdomain`:** 1.x named the
records relative to the zone (`_amazonses.maildummy`). The aws provider stores
`aws_route53_record.name` as configured (lower-cased, trailing dot removed) and
treats a change to it as forcing replacement, so a relative name and the equivalent
fully qualified name are different values. While `maildummy_subdomain` stays set the
module keeps the relative names and the plan shows no change. Once you remove it, the
names become fully qualified and the provider replaces the verification, MX and DKIM
records (destroy, then create), leaving a short gap in DNS for each. Keep
`maildummy_subdomain` for as long as you want to avoid that; new deployments should
leave it out. The `dns_records` output was already fully qualified and is unchanged.

**Route53 users:** `dns_provider` no longer defaults to `"cloudflare"`, so keep
`dns_provider = "route53"` set explicitly. If `enable_dkim = true`, the DKIM
records changed from token keys to indices (1.x used `for_each` over the tokens,
which failed on a first apply). Add one `moved` block per token in your root
module. Index `i` must be the token's position in the `dkim_tokens` list shown by
`tofu state show 'module.maildummy.aws_ses_domain_dkim.maildummy[0]'`:

```hcl
moved {
  from = module.maildummy.aws_route53_record.maildummy_dkim["<dkim_tokens[0]>"]
  to   = module.maildummy.aws_route53_record.maildummy_dkim[0]
}
```

Without them, the plan replaces the records and the create can fail because a
record with the same name still exists.

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

# Only if enable_dkim = true. 1.x keyed the DKIM records by token; add one block
# per token. Index i must be the token's position in the dkim_tokens list shown by
#   tofu state show 'module.maildummy.aws_ses_domain_dkim.maildummy[0]'
moved {
  from = module.maildummy.cloudflare_dns_record.maildummy_dkim["<dkim_tokens[0]>"]
  to   = module.maildummy_cloudflare.cloudflare_dns_record.dkim[0]
}
```

Adjust `module.maildummy` / `module.maildummy_cloudflare` to the names you use.
The new module writes fully qualified record names (1.x wrote names relative to the
zone), so the first plan may show a change to `name`. Run `plan` and check it
before you `apply`; if the provider replaces a record, it is recreated with a
short gap in DNS for that record.
