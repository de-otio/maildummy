import { Construct } from "constructs";
import {
  Duration,
  RemovalPolicy,
  Stack,
  aws_s3 as s3,
  aws_sns as sns,
  aws_ses as ses,
  aws_route53 as route53,
  aws_iam as iam,
} from "aws-cdk-lib";

export interface MaildummyProps {
  /**
   * Full maildummy domain (e.g., maildummy.example.com).
   */
  readonly maildummyDomain: string;

  /**
   * Name of an existing SES receipt rule set to append the rule to.
   * Only one active receipt rule set is allowed per region, so this must
   * reference an existing ruleset.
   */
  readonly receiptRuleSetName: string;

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
   * Enable SNS notifications for received emails.
   * Disable initially if receipt rule creation fails due to policy propagation,
   * then re-enable after policies propagate.
   * @default true
   */
  readonly enableSnsNotifications?: boolean;

  /**
   * Enable DKIM signing for the domain.
   * Set to false for initial deployment; enable after domain verification.
   * @default false
   */
  readonly enableDkim?: boolean;

  /**
   * Removal policy for the S3 bucket.
   * @default RemovalPolicy.DESTROY
   */
  readonly bucketRemovalPolicy?: RemovalPolicy;
}

/**
 * CDK construct that creates SES email testing infrastructure.
 *
 * Mirrors the functionality of the Terraform `ses_maildummy` module:
 * - SES domain identity (SESv2) with optional DKIM
 * - S3 bucket for storing incoming emails (encrypted, lifecycle-managed)
 * - SNS topic for email notifications (encrypted)
 * - SES receipt rule routing emails to S3 (and optionally SNS)
 * - Route53 DNS records (MX + DKIM CNAMEs) when a hosted zone is provided
 *
 * For Cloudflare or other DNS providers, omit `hostedZone` and configure DNS
 * records externally using the exposed `dkimTokens` property and the
 * MX endpoint `inbound-smtp.<region>.amazonaws.com`.
 */
export class Maildummy extends Construct {
  /** The S3 bucket storing incoming emails. */
  public readonly bucket: s3.Bucket;

  /** The SNS topic for email notifications. */
  public readonly topic: sns.Topic;

  /** The SES domain identity (L1 CfnEmailIdentity). */
  public readonly domainIdentity: ses.CfnEmailIdentity;

  /** DKIM tokens for external DNS setup (empty if DKIM is disabled). */
  public readonly dkimTokens: string[];

  constructor(scope: Construct, id: string, props: MaildummyProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const region = stack.region;
    const account = stack.account;
    const emailRetentionDays = props.emailRetentionDays ?? 1;
    const enableSns = props.enableSnsNotifications ?? true;
    const enableDkim = props.enableDkim ?? false;
    const removalPolicy = props.bucketRemovalPolicy ?? RemovalPolicy.DESTROY;

    if (!props.maildummyDomain || !/^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$/.test(props.maildummyDomain)) {
      throw new Error("maildummyDomain must be a valid domain name (e.g., maildummy.example.com)");
    }

    if (emailRetentionDays < 1) {
      throw new Error("emailRetentionDays must be >= 1");
    }

    // ── SES Domain Identity ──────────────────────────────────────────

    // SESv2 CfnEmailIdentity — uses DKIM-based verification by default.
    this.domainIdentity = new ses.CfnEmailIdentity(this, "DomainIdentity", {
      emailIdentity: props.maildummyDomain,
      dkimSigningAttributes: enableDkim
        ? { nextSigningKeyLength: "RSA_2048_BIT" }
        : undefined,
    });

    // ── S3 Bucket ────────────────────────────────────────────────────

    this.bucket = new s3.Bucket(this, "EmailBucket", {
      bucketName: props.bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
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
            "AWS:SourceArn": `arn:aws:ses:${region}:${account}:receipt-rule-set/${props.receiptRuleSetName}:receipt-rule/*`,
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

    const cfnReceiptRule = new ses.CfnReceiptRule(this, "ReceiptRule", {
      ruleSetName: props.receiptRuleSetName,
      rule: {
        name: `${id}-maildummy-rule`,
        enabled: true,
        scanEnabled: false,
        recipients: [props.maildummyDomain],
        actions: receiptRuleActions,
      },
    });

    // Ensure policies are in place before the rule is created
    cfnReceiptRule.node.addDependency(this.bucket);
    cfnReceiptRule.node.addDependency(this.topic);

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

      // DKIM CNAME records (SESv2 CfnEmailIdentity provides 3 DKIM tokens)
      // Uses L1 CfnRecordSet because DkimDNSTokenName returns the full FQDN
      // (e.g. token._domainkey.maildummy.example.com) and the L2 CnameRecord
      // would append the zone name again.
      if (enableDkim) {
        for (let i = 1; i <= 3; i++) {
          const tokenName = this.domainIdentity
            .getAtt(`DkimDNSTokenName${i}`)
            .toString();
          const tokenValue = this.domainIdentity
            .getAtt(`DkimDNSTokenValue${i}`)
            .toString();

          new route53.CfnRecordSet(this, `DkimRecord${i}`, {
            hostedZoneId: props.hostedZone.hostedZoneId,
            name: tokenName,
            type: "CNAME",
            ttl: "300",
            resourceRecords: [tokenValue],
          });
        }
      }
    }

    // Store DKIM tokens for external DNS setup
    this.dkimTokens = enableDkim
      ? [1, 2, 3].map((i) =>
          this.domainIdentity.getAtt(`DkimDNSTokenName${i}`).toString()
        )
      : [];
  }
}
