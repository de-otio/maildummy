import { Construct } from "constructs";
import {
  ArnFormat,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  aws_s3 as s3,
  aws_sns as sns,
  aws_ses as ses,
  aws_route53 as route53,
  aws_iam as iam,
  custom_resources as cr,
} from "aws-cdk-lib";

export interface MaildummyProps {
  /**
   * Full maildummy domain (e.g., maildummy.example.com).
   */
  readonly maildummyDomain: string;

  /**
   * Name of the SES receipt rule set that holds the rule.
   * Must already exist unless `createRuleSet` is true.
   */
  readonly receiptRuleSetName: string;

  /**
   * Create the receipt rule set named `receiptRuleSetName`.
   * Leave false to add the rule to an existing set.
   * @default false
   */
  readonly createRuleSet?: boolean;

  /**
   * Make `receiptRuleSetName` the active receipt rule set (via a custom
   * resource calling SES SetActiveReceiptRuleSet).
   *
   * The active rule set is a per-region singleton: enable this only if no
   * other stack or tool manages it. Deleting the construct then disables
   * email receiving in the region (SetActiveReceiptRuleSet with no name),
   * whichever set is active at that time.
   * @default false
   */
  readonly activateRuleSet?: boolean;

  /**
   * Name of an existing rule in the set to place this rule after.
   * When omitted, SES inserts the rule at the beginning of the rule set.
   * @default - first in the rule set
   */
  readonly receiptRuleAfter?: string;

  /**
   * Route53 hosted zone for DNS record creation.
   * If omitted, no DNS records are created and you must configure DNS externally.
   * The MX record should point to `inbound-smtp.<region>.amazonaws.com`.
   */
  readonly hostedZone?: route53.IHostedZone;

  /**
   * Optional S3 bucket name. If omitted, CDK will generate a unique name.
   */
  readonly bucketName?: string;

  /**
   * Optional SNS topic name. If omitted, CDK will generate a unique name.
   */
  readonly snsTopicName?: string;

  /**
   * Number of days to retain emails in S3 before auto-deletion. Must be >= 1.
   * @default 1
   */
  readonly emailRetentionDays?: number;

  /**
   * Add an SNS action to the receipt rule that publishes each received email
   * to the topic.
   * @default true
   */
  readonly enableSnsNotifications?: boolean;

  /**
   * Whether SES DKIM-signs mail sent from the domain (Easy DKIM, 2048-bit key).
   *
   * This does NOT control domain verification. SES verifies a domain identity
   * by finding the three Easy DKIM CNAME records in DNS, so those records are
   * always exposed (and created in Route53 when `hostedZone` is given),
   * whatever this is set to. When false, the records still prove ownership
   * but SES leaves DKIM signing switched off for the identity.
   * @default true
   */
  readonly enableDkim?: boolean;

  /**
   * Removal policy for the S3 bucket.
   * @default RemovalPolicy.DESTROY
   */
  readonly bucketRemovalPolicy?: RemovalPolicy;
}

/** A DNS CNAME record, as a name/value pair. */
export interface DkimRecord {
  /** Fully qualified record name. */
  readonly name: string;
  /** Record target. */
  readonly value: string;
}

/**
 * CDK construct that creates SES email testing infrastructure.
 *
 * Mirrors the functionality of the Terraform `ses_maildummy` module:
 * - SES domain identity (SESv2), verified via Easy DKIM CNAME records
 * - S3 bucket for storing incoming emails (encrypted, lifecycle-managed)
 * - SNS topic for email notifications (not KMS-encrypted; see the topic below)
 * - SES receipt rule routing emails to S3 (and optionally SNS)
 * - Route53 DNS records (MX + DKIM CNAMEs) when a hosted zone is provided
 *
 * For Cloudflare or other DNS providers, omit `hostedZone` and configure DNS
 * records externally using the exposed `dkimRecords` property (or the
 * `DkimRecordName*` / `DkimRecordValue*` stack outputs) and the
 * MX endpoint `inbound-smtp.<region>.amazonaws.com`.
 */
export class Maildummy extends Construct {
  /** The S3 bucket storing incoming emails. */
  public readonly bucket: s3.Bucket;

  /** The SNS topic for email notifications. */
  public readonly topic: sns.Topic;

  /** The SES domain identity (L1 CfnEmailIdentity). */
  public readonly domainIdentity: ses.CfnEmailIdentity;

  /**
   * The three Easy DKIM CNAME records that verify the domain, as name/value
   * pairs. Create them in any DNS provider (they are created automatically in
   * Route53 when `hostedZone` is provided). Names are fully qualified
   * (`<token>._domainkey.<domain>`); values are `<token>.dkim.amazonses.com`.
   */
  public readonly dkimRecords: DkimRecord[];

  /**
   * DKIM CNAME record names only. Kept for backward compatibility; prefer
   * `dkimRecords`, which also carries the values.
   */
  public readonly dkimTokens: string[];

  constructor(scope: Construct, id: string, props: MaildummyProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const region = stack.region;
    const account = stack.account;
    const emailRetentionDays = props.emailRetentionDays ?? 1;
    const enableSns = props.enableSnsNotifications ?? true;
    const enableDkim = props.enableDkim ?? true;
    const removalPolicy = props.bucketRemovalPolicy ?? RemovalPolicy.DESTROY;

    if (!props.maildummyDomain || !/^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$/.test(props.maildummyDomain)) {
      throw new Error("maildummyDomain must be a valid domain name (e.g., maildummy.example.com)");
    }

    if (emailRetentionDays < 1) {
      throw new Error("emailRetentionDays must be >= 1");
    }

    // ── SES Domain Identity ──────────────────────────────────────────

    // SESv2 CfnEmailIdentity. A domain identity without BYODKIM uses Easy DKIM,
    // and SES verifies it by finding the three DKIM CNAME records in DNS (there
    // is no _amazonses TXT record in SESv2). The records are therefore always
    // emitted below; `enableDkim` only decides whether SES signs mail.
    this.domainIdentity = new ses.CfnEmailIdentity(this, "DomainIdentity", {
      emailIdentity: props.maildummyDomain,
      dkimAttributes: { signingEnabled: enableDkim },
      dkimSigningAttributes: enableDkim
        ? { nextSigningKeyLength: "RSA_2048_BIT" }
        : undefined,
    });

    // ARN of this construct's receipt rule, built from names rather than the
    // rule resource: the bucket and topic policies reference it while the rule
    // references the bucket and topic, so using the resource would be circular.
    // formatArn keeps the partition a token (no literal "arn:aws").
    const receiptRuleName = `${id}-maildummy-rule`;
    const receiptRuleArn = stack.formatArn({
      service: "ses",
      resource: "receipt-rule-set",
      resourceName: `${props.receiptRuleSetName}:receipt-rule/${receiptRuleName}`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });

    // The three Easy DKIM CNAMEs (name and target) that verify the domain.
    this.dkimRecords = [1, 2, 3].map((i) => ({
      name: this.domainIdentity.getAtt(`DkimDNSTokenName${i}`).toString(),
      value: this.domainIdentity.getAtt(`DkimDNSTokenValue${i}`).toString(),
    }));
    this.dkimTokens = this.dkimRecords.map((record) => record.name);

    // ── S3 Bucket ────────────────────────────────────────────────────

    this.bucket = new s3.Bucket(this, "EmailBucket", {
      bucketName: props.bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // ACLs disabled: SES writes with PutObject only, so no PutObjectAcl grant.
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: "auto-delete-old-emails",
          prefix: "raw/",
          expiration: Duration.days(emailRetentionDays),
        },
      ],
    });

    // Allow SES to write to the bucket — scoped to this account and rule set.
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowSESPuts",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [this.bucket.arnForObjects("raw/*")],
        conditions: {
          StringEquals: {
            "AWS:SourceAccount": account,
          },
          ArnLike: {
            "AWS:SourceArn": receiptRuleArn,
          },
        },
      })
    );

    // ── SNS Topic ────────────────────────────────────────────────────

    this.topic = new sns.Topic(this, "EmailTopic", {
      topicName: props.snsTopicName,
      // No KMS encryption — SES cannot publish to KMS-encrypted SNS topics
      // without explicit key policy grants, and the AWS-managed key
      // (alias/aws/sns) doesn't allow modification. This is test infrastructure.
    });

    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
        actions: ["SNS:Publish"],
        resources: [this.topic.topicArn],
        conditions: {
          StringEquals: {
            "AWS:SourceAccount": account,
          },
          ArnLike: {
            "AWS:SourceArn": receiptRuleArn,
          },
        },
      })
    );

    // ── SES Receipt Rule (L1) ────────────────────────────────────────
    // We use L1 CfnReceiptRule instead of the L2 sesActions.S3 because
    // the L2 action auto-generates a permissive S3 bucket policy (no
    // SourceAccount/SourceArn conditions), which would bypass the
    // scoped policy we defined above.

    const receiptRuleActions: ses.CfnReceiptRule.ActionProperty[] = [
      {
        s3Action: {
          bucketName: this.bucket.bucketName,
          objectKeyPrefix: "raw/",
        },
      },
    ];

    if (enableSns) {
      receiptRuleActions.push({
        snsAction: {
          topicArn: this.topic.topicArn,
          encoding: "UTF-8",
        },
      });
    }

    const ruleSet = (props.createRuleSet ?? false)
      ? new ses.CfnReceiptRuleSet(this, "ReceiptRuleSet", {
          ruleSetName: props.receiptRuleSetName,
        })
      : undefined;

    // Without `after`, SES inserts the rule at the beginning of the rule set.
    const cfnReceiptRule = new ses.CfnReceiptRule(this, "ReceiptRule", {
      ruleSetName: ruleSet ? ruleSet.ref : props.receiptRuleSetName,
      after: props.receiptRuleAfter,
      rule: {
        name: receiptRuleName,
        enabled: true,
        scanEnabled: false,
        recipients: [props.maildummyDomain],
        actions: receiptRuleActions,
      },
    });

    // Ensure policies are in place before the rule is created
    cfnReceiptRule.node.addDependency(this.bucket);
    cfnReceiptRule.node.addDependency(this.topic);

    // ── Active Receipt Rule Set (optional) ───────────────────────────
    // CloudFormation has no resource for the active rule set, so call SES
    // directly. The activation depends on the rule, so it runs after the rule
    // is created and, on delete, deactivates before the rule (and a rule set
    // created above) is removed.

    if (props.activateRuleSet ?? false) {
      const activation = new cr.AwsCustomResource(this, "ActiveReceiptRuleSet", {
        onCreate: {
          service: "SES",
          action: "SetActiveReceiptRuleSet",
          parameters: { RuleSetName: props.receiptRuleSetName },
          physicalResourceId: cr.PhysicalResourceId.of(
            `active-receipt-rule-set-${props.receiptRuleSetName}`
          ),
        },
        onUpdate: {
          service: "SES",
          action: "SetActiveReceiptRuleSet",
          parameters: { RuleSetName: props.receiptRuleSetName },
          physicalResourceId: cr.PhysicalResourceId.of(
            `active-receipt-rule-set-${props.receiptRuleSetName}`
          ),
        },
        onDelete: {
          service: "SES",
          action: "SetActiveReceiptRuleSet",
          parameters: {},
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        installLatestAwsSdk: false,
      });
      activation.node.addDependency(cfnReceiptRule);
    }

    // ── DNS Records (Route53 only) ───────────────────────────────────

    if (props.hostedZone) {
      const zoneName = props.hostedZone.zoneName.replace(/\.$/, "");
      const subdomain = props.maildummyDomain.endsWith(`.${zoneName}`)
        ? props.maildummyDomain.slice(
            0,
            props.maildummyDomain.length - zoneName.length - 1
          )
        : props.maildummyDomain;

      // MX record pointing to SES inbound endpoint
      new route53.MxRecord(this, "MxRecord", {
        zone: props.hostedZone,
        recordName: subdomain,
        values: [
          {
            priority: 10,
            hostName: `inbound-smtp.${region}.amazonaws.com`,
          },
        ],
        ttl: Duration.seconds(300),
      });

      // DKIM CNAME records — these verify the domain, so always create them.
      // Uses L1 CfnRecordSet because DkimDNSTokenName returns the full FQDN
      // (e.g. token._domainkey.maildummy.example.com) and the L2 CnameRecord
      // would append the zone name again.
      this.dkimRecords.forEach((record, index) => {
        new route53.CfnRecordSet(this, `DkimRecord${index + 1}`, {
          hostedZoneId: props.hostedZone!.hostedZoneId,
          name: record.name,
          type: "CNAME",
          ttl: "300",
          resourceRecords: [record.value],
        });
      });
    }

    // ── Outputs ──────────────────────────────────────────────────────
    // Name/value pairs so the CNAMEs can be created in any DNS provider.

    this.dkimRecords.forEach((record, index) => {
      new CfnOutput(this, `DkimRecordName${index + 1}`, {
        value: record.name,
        description: `DKIM CNAME record ${index + 1} name`,
      });
      new CfnOutput(this, `DkimRecordValue${index + 1}`, {
        value: record.value,
        description: `DKIM CNAME record ${index + 1} value`,
      });
    });
  }
}
