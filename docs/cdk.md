# CDK construct reference

Package: `@de-otio/maildummy-cdk` (in the `cdk/` directory)

## Installation

```bash
npm install @de-otio/maildummy-cdk
# or from git
npm install github:your-org/maildummy#main
```

Peer dependencies: `aws-cdk-lib ^2.100.0`, `constructs ^10.0.0`.

## Usage

### With Route53 DNS

```ts
import { Maildummy } from "@de-otio/maildummy-cdk";
import * as route53 from "aws-cdk-lib/aws-route53";

const zone = route53.HostedZone.fromLookup(stack, "Zone", {
  domainName: "example.com",
});

const maildummy = new Maildummy(stack, "Maildummy", {
  maildummyDomain: "maildummy.example.com",
  receiptRuleSetName: "my-existing-ruleset",
  hostedZone: zone,
  emailRetentionDays: 1,
  enableSnsNotifications: true,
  enableDkim: false,
});
```

### Without DNS (Cloudflare or other provider)

Omit `hostedZone` and configure DNS externally. The construct exposes the values you need:

```ts
const maildummy = new Maildummy(stack, "Maildummy", {
  maildummyDomain: "maildummy.example.com",
  receiptRuleSetName: "my-existing-ruleset",
});

// Create these records in your DNS provider:
// MX  maildummy.example.com → 10 inbound-smtp.<region>.amazonaws.com
// TXT _amazonses.maildummy  → <verification token>
// After enabling DKIM, create CNAME records using maildummy.dkimTokens
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `maildummyDomain` | `string` | yes | — | Full domain, e.g. `maildummy.example.com` |
| `receiptRuleSetName` | `string` | yes | — | Receipt rule set that holds the rule (must exist unless `createRuleSet`) |
| `createRuleSet` | `boolean` | no | `false` | Create `receiptRuleSetName` |
| `activateRuleSet` | `boolean` | no | `false` | Make `receiptRuleSetName` the active set via a custom resource (see below) |
| `receiptRuleAfter` | `string` | no | — | Existing rule to place this rule after; omitted, SES inserts it first |
| `hostedZone` | `IHostedZone` | no | — | Route53 zone; omit to skip DNS record creation |
| `bucketName` | `string` | no | auto | S3 bucket name |
| `snsTopicName` | `string` | no | auto | SNS topic name |
| `emailRetentionDays` | `number` | no | `1` | Days before emails are auto-deleted |
| `enableSnsNotifications` | `boolean` | no | `true` | Add SNS action to the receipt rule |
| `enableDkim` | `boolean` | no | `false` | Enable DKIM signing (after domain verification) |
| `bucketRemovalPolicy` | `RemovalPolicy` | no | `DESTROY` | Removal policy for the S3 bucket |

## Receipt rule set

SES delivers mail only through the active receipt rule set, and each region has at
most one, so exactly one stack or tool must own it. By default the construct adds
its rule to the existing set `receiptRuleSetName` and does not touch activation.

`createRuleSet: true` creates the set (`AWS::SES::ReceiptRuleSet`).
`activateRuleSet: true` adds an `AwsCustomResource` (a Lambda-backed custom resource
calling SES `SetActiveReceiptRuleSet`) that activates the set after the rule exists.
On stack deletion it calls `SetActiveReceiptRuleSet` with no name, which disables
email receiving in the region whichever set is active at that time. Enable it only
if nothing else manages the active set.

Without `receiptRuleAfter`, SES inserts the rule at the beginning of the rule set.

## Exposed properties

| Property | Type | Description |
|----------|------|-------------|
| `bucket` | `s3.Bucket` | The email storage bucket |
| `topic` | `sns.Topic` | The notification topic |
| `domainIdentity` | `ses.CfnEmailIdentity` | The SES domain identity (L1) |
| `dkimTokens` | `string[]` | DKIM token names for external DNS (empty if DKIM disabled) |

## Resources created

The construct creates the same resources as the Terraform module:

- SES email identity (via `CfnEmailIdentity` / SESv2) with optional DKIM
- S3 bucket — AES256 encryption, bucket key, public access blocked, lifecycle on `raw/`
- SNS topic — encrypted with the AWS-managed SNS KMS key
- SES receipt rule — S3 action + optional SNS action
- IAM policies — SES → S3 (`PutObject`/`PutObjectAcl` with source conditions), SES → SNS (`Publish`)
- Route53 records (MX, verification TXT, DKIM CNAMEs) when `hostedZone` is provided
