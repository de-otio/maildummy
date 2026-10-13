# CDK construct reference

Package: `@de-otio/maildummy-cdk` (in the `cdk/` directory)

## Installation

```bash
npm install @de-otio/maildummy-cdk
```

Pin an exact version in your `package.json`. The package is published from releases tagged `cdk-v<version>`; the publish workflow only runs for a tag that matches the version in `cdk/package.json`, so `@de-otio/maildummy-cdk@<version>` corresponds to the git tag `cdk-v<version>`. For the strongest guarantee, commit your lockfile and review the integrity hash it records.

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
});
```

The three DKIM CNAME records are created in the zone automatically.

### Without DNS (Cloudflare or other provider)

Omit `hostedZone` and configure DNS externally. The construct exposes the values you need:

```ts
const maildummy = new Maildummy(stack, "Maildummy", {
  maildummyDomain: "maildummy.example.com",
  receiptRuleSetName: "my-existing-ruleset",
});

// Create these records in your DNS provider:
// MX  maildummy.example.com → 10 inbound-smtp.<region>.amazonaws.com
// CNAME x3 (verify the domain) → maildummy.dkimRecords [{ name, value }, ...]
```

SES verifies a SESv2 domain identity through its three Easy DKIM CNAME records
(there is no `_amazonses` TXT record), so the identity stays unverified until
they exist. They are exposed as `maildummy.dkimRecords` (name/value pairs) and as
the stack outputs `DkimRecordName1..3` and `DkimRecordValue1..3`. Names are fully
qualified (`<token>._domainkey.maildummy.example.com`); values look like
`<token>.dkim.amazonses.com`. Create them as CNAMEs in your DNS provider; if the
provider proxies records (e.g. Cloudflare), set them to DNS-only.

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
| `enableDkim` | `boolean` | no | `true` | DKIM signing for the identity (2048-bit Easy DKIM). `false` turns signing off only; the verification CNAMEs are always emitted |
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
| `dkimRecords` | `{ name, value }[]` | The three Easy DKIM CNAME records that verify the domain (always three) |
| `dkimTokens` | `string[]` | The CNAME names from `dkimRecords`; kept for backward compatibility |

## Resources created

The construct creates the same resources as the Terraform module:

- SES email identity (via `CfnEmailIdentity` / SESv2), verified through Easy DKIM CNAMEs
- S3 bucket — AES256 encryption, bucket key, public access blocked, ACLs disabled
  (`BucketOwnerEnforced`), TLS-only (denies `aws:SecureTransport` false), lifecycle on `raw/`
- SNS topic — not KMS-encrypted (SES cannot publish to a topic encrypted with the
  AWS-managed SNS key, and this is test infrastructure)
- SES receipt rule — S3 action + optional SNS action
- IAM policies — SES → S3 (`s3:PutObject` on `<bucket>/raw/*` only, no ACL actions,
  conditioned on `AWS:SourceAccount` and the receipt rule's `AWS:SourceArn`), SES → SNS
  (`Publish`, with the same two conditions)
- Route53 records (MX and the three DKIM CNAMEs) when `hostedZone` is provided

## Upgrading from 1.x to 2.0

Run `cdk diff` before you deploy; every change below shows up there.

**Route53 users: the DKIM CNAMEs are now always created.** In 1.x they were
created only with `enableDkim: true`, and that defaulted to `false`, so the domain
identity stayed unverified unless you added the records yourself. 2.0 creates the
three `<token>._domainkey.<domain>` CNAMEs whenever `hostedZone` is set. If you
created them by hand, the deploy fails because the records already exist. Delete
the hand-made records just before deploying, so the gap before the stack
recreates them is short. (Leaving out `hostedZone` instead would also remove the
MX record the stack manages.)

**`enableDkim` now defaults to `true`, and `false` turns signing off.** The
identity now sets `DkimAttributes.SigningEnabled` from `enableDkim`. In 1.x, `false`
only left out the 2048-bit key length and the Route53 CNAMEs; it did not set
`SigningEnabled`. Set `enableDkim: false` explicitly only if you do not want SES to
DKIM-sign mail sent from the domain.

**`dkimTokens` always has three entries.** In 1.x it was empty when DKIM was
disabled. It holds the CNAME names; the new `dkimRecords` property holds the
name/value pairs.

**S3 bucket: ACLs are disabled.** Object ownership becomes `BucketOwnerEnforced`,
an in-place update. Anything that reads the bucket by relying on object ACLs
stops working; SES delivery and the helpers do not use ACLs.

**Policies are scoped to this construct's receipt rule.** The bucket policy's
`AWS:SourceArn` changes from any rule in `receiptRuleSetName` to this construct's
rule only, and the SNS topic policy gains the same condition (1.x had only
`AWS:SourceAccount` there). If another receipt rule in the set writes to this
bucket or publishes to this topic, SES is now denied.

**Six new stack outputs:** `DkimRecordName1..3` and `DkimRecordValue1..3`, under the
construct's path. They count towards CloudFormation's limit of 200 outputs per
stack.

New, opt-in props: `createRuleSet`, `activateRuleSet` and `receiptRuleAfter` (see
[Receipt rule set](#receipt-rule-set)). The defaults keep 1.x behaviour: the rule
is added to an existing set, which the construct does not activate.
