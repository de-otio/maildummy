# Maildummy

SES-based email capture for automated testing. Intercepts emails sent to a `maildummy.*` subdomain, stores them in S3, and lets your E2E tests retrieve magic links or other content.

## How it works

1. An MX record routes mail for `maildummy.example.com` to AWS SES
2. An SES receipt rule stores each message as a raw MIME file in S3 under `raw/`
3. Helper scripts (Node.js or Python) list the bucket, parse the MIME, and extract URLs

## Infrastructure options

Maildummy ships two equivalent ways to provision the AWS resources:

| Option | Location | DNS support |
|--------|----------|-------------|
| **Terraform module** | `terraform/modules/ses_maildummy` | Cloudflare or Route53 |
| **CDK construct** | `cdk/` (`@deotio/maildummy-cdk`) | Route53 (or bring your own) |

Both create the same set of resources: SES domain identity, S3 bucket, SNS topic, SES receipt rule, and the required IAM policies.

## Documentation

- [Terraform module reference](docs/terraform.md)
- [CDK construct reference](docs/cdk.md)
- [Deployment guide](docs/deployment.md) - initial setup, DKIM, troubleshooting
- [E2E testing guide](docs/e2e-testing.md) - wiring maildummy into your test suite
- [Helper scripts](docs/helper-scripts.md) - retrieving magic links from S3

## Quick start (Terraform)

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

## Quick start (CDK)

```ts
import { Maildummy } from "@deotio/maildummy-cdk";

new Maildummy(stack, "Maildummy", {
  maildummyDomain: "maildummy.example.com",
  receiptRuleSetName: "my-existing-ruleset",
  hostedZone: myZone,
});
```

## License

MIT
