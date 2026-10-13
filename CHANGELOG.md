# Changelog

The repository releases each artifact on its own tag series (see
[Versioning and pinning](docs/terraform.md#versioning-and-pinning)):

- `tf-v<version>`: the Terraform modules under `terraform/modules/`
- `cdk-v<version>`: `@de-otio/maildummy-cdk` on npm

## Terraform modules 2.0.0 (`tf-v2.0.0`)

First tagged Terraform release. Earlier consumers pinned `main` or a commit;
"1.x" below means the module as it was before this release. Upgrade steps:
[Upgrading from 1.x to 2.0](docs/terraform.md#upgrading-from-1x-to-20).

### Breaking

- Requires Terraform or OpenTofu >= 1.7 (the module uses a `removed` block).
- Cloudflare DNS moved out of `ses_maildummy` into the new
  `ses_maildummy_cloudflare` module. `cloudflare_zone_id` is removed and
  `dns_provider` accepts `"route53"` or `"none"`; its default changed from
  `"cloudflare"` to `"none"`. Route53 users must set `dns_provider = "route53"`.
- DKIM records are keyed by index instead of by token. Add `moved` blocks as
  shown in the upgrade guide, or the records are replaced.
- The SNS topic no longer uses `alias/aws/sns`, which SES cannot publish to. It
  is unencrypted unless you pass a customer-managed key as `sns_kms_key_arn`.
- S3 object ownership is `BucketOwnerEnforced` (ACLs disabled), and the module
  no longer manages `aws_s3_bucket_acl`. Nothing is deleted in AWS.
- The S3 bucket policy allows SES only `s3:PutObject` on `raw/*` and denies
  requests that do not use TLS.
- `aws_region` is deprecated and ignored: the region and partition come from the
  aws provider. If set, it must equal the provider's region or the plan fails.
- `maildummy_subdomain` is optional and deprecated. If set, it must be the
  leading part of `maildummy_domain`. Route53 users should keep it set until they
  accept a one-off replacement of the records (see the upgrade guide).

### Added

- aws provider 6.x support (`>= 5.0, < 7.0`).
- `create_rule_set`, `activate_rule_set` and `receipt_rule_after` to create,
  activate and position the SES receipt rule set and rule.
- `enable_dkim` works on the first apply; the domain need not be verified first.
- `wait_for_verification` and `verification_timeout` to block the apply until SES
  reports the domain as verified.
- `sns_kms_key_arn` and the `sns_kms_key_policy_statement` output for an
  encrypted topic.
- `dns_records` output with every record SES needs, fully qualified, for any DNS
  provider.

### Fixed

- SES can publish to the SNS topic (the AWS-managed key blocked it).
- The policies and MX record use the provider's region and partition, not the
  `eu-central-1` default and a literal `arn:aws`.
- The SNS topic policy carries `AWS:SourceAccount` and `AWS:SourceArn`.
- `ses_maildummy` no longer requires the Cloudflare provider.

## @de-otio/maildummy-cdk 2.0.0 (`cdk-v2.0.0`)

Upgrade steps: [Upgrading from 1.x to 2.0](docs/cdk.md#upgrading-from-1x-to-20).

### Breaking

- With `hostedZone`, the three DKIM CNAMEs are always created. Hand-made records
  with the same names make the deploy fail; delete them first.
- `enableDkim` defaults to `true`, and `false` now sets `SigningEnabled: false`
  on the identity.
- `dkimTokens` always has three entries (it was empty with DKIM disabled).
- S3 object ownership is `BucketOwnerEnforced` (ACLs disabled).
- The bucket and topic policies allow SES only for this construct's receipt rule
  (`AWS:SourceArn`), not any rule in the set.

### Added

- `createRuleSet`, `activateRuleSet` and `receiptRuleAfter` props.
- `dkimRecords` property (name/value pairs) and the exported `DkimRecord` type.
- Stack outputs `DkimRecordName1..3` and `DkimRecordValue1..3`.

### Fixed

- The domain identity verifies: SESv2 verifies through the DKIM CNAMEs, which
  1.x did not create by default.
- No literal `arn:aws` partition.

## @de-otio/maildummy-cdk 1.0.1

Released before this changelog was started.
