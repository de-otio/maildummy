import { App, Stack, RemovalPolicy } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Maildummy, MaildummyProps } from "../src";

const defaultProps: MaildummyProps = {
  maildummyDomain: "maildummy.example.com",
  receiptRuleSetName: "my-rule-set",
};

function createStack(props: MaildummyProps = defaultProps) {
  const app = new App();
  const stack = new Stack(app, "TestStack", {
    env: { account: "123456789012", region: "us-east-1" },
  });
  const construct = new Maildummy(stack, "Test", props);
  return { app, stack, construct, template: Template.fromStack(stack) };
}

describe("Maildummy", () => {
  // ── Input Validation ─────────────────────────────────────────────

  describe("input validation", () => {
    it("throws on empty domain", () => {
      const app = new App();
      const stack = new Stack(app, "S");
      expect(
        () => new Maildummy(stack, "M", { ...defaultProps, maildummyDomain: "" })
      ).toThrow("maildummyDomain must be a valid domain name");
    });

    it("throws on invalid domain with spaces", () => {
      const app = new App();
      const stack = new Stack(app, "S");
      expect(
        () =>
          new Maildummy(stack, "M", {
            ...defaultProps,
            maildummyDomain: "not a domain",
          })
      ).toThrow("maildummyDomain must be a valid domain name");
    });

    it("throws on domain starting with hyphen", () => {
      const app = new App();
      const stack = new Stack(app, "S");
      expect(
        () =>
          new Maildummy(stack, "M", {
            ...defaultProps,
            maildummyDomain: "-bad.example.com",
          })
      ).toThrow("maildummyDomain must be a valid domain name");
    });

    it("throws on emailRetentionDays < 1", () => {
      const app = new App();
      const stack = new Stack(app, "S");
      expect(
        () =>
          new Maildummy(stack, "M", { ...defaultProps, emailRetentionDays: 0 })
      ).toThrow("emailRetentionDays must be >= 1");
    });

    it("accepts valid domains", () => {
      const app = new App();
      const stack = new Stack(app, "S", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      expect(
        () => new Maildummy(stack, "M", defaultProps)
      ).not.toThrow();
    });
  });

  // ── SES Domain Identity ──────────────────────────────────────────

  describe("SES domain identity", () => {
    it("creates email identity with the provided domain", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::SES::EmailIdentity", {
        EmailIdentity: "maildummy.example.com",
      });
    });

    it("uses Easy DKIM with signing enabled by default", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::SES::EmailIdentity", {
        DkimAttributes: { SigningEnabled: true },
        DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
      });
    });

    it("sets DKIM attributes when enableDkim is true", () => {
      const { template } = createStack({
        ...defaultProps,
        enableDkim: true,
      });
      template.hasResourceProperties("AWS::SES::EmailIdentity", {
        DkimAttributes: { SigningEnabled: true },
        DkimSigningAttributes: {
          NextSigningKeyLength: "RSA_2048_BIT",
        },
      });
    });

    it("disables DKIM signing, not verification, when enableDkim is false", () => {
      const { template } = createStack({
        ...defaultProps,
        enableDkim: false,
      });
      template.hasResourceProperties("AWS::SES::EmailIdentity", {
        DkimAttributes: { SigningEnabled: false },
        DkimSigningAttributes: Match.absent(),
      });
    });

    it("never uses BYODKIM (no selector or private key)", () => {
      const { template } = createStack();
      const identities = template.findResources("AWS::SES::EmailIdentity");
      const props = Object.values(identities)[0].Properties;
      expect(JSON.stringify(props)).not.toMatch(/PrivateKey|DomainSigningSelector/);
    });
  });

  // ── DKIM records and outputs ─────────────────────────────────────

  describe("DKIM records and outputs", () => {
    it.each([true, false, undefined])(
      "outputs three CNAME name/value pairs when enableDkim is %s",
      (enableDkim) => {
        const { template } = createStack({ ...defaultProps, enableDkim });
        const outputs = template.findOutputs("*");
        for (const i of [1, 2, 3]) {
          const name = Object.entries(outputs).find(([k]) =>
            k.startsWith(`TestDkimRecordName${i}`)
          )?.[1];
          const value = Object.entries(outputs).find(([k]) =>
            k.startsWith(`TestDkimRecordValue${i}`)
          )?.[1];
          expect(name).toBeDefined();
          expect(value).toBeDefined();
          expect(JSON.stringify(name?.Value)).toContain(`DkimDNSTokenName${i}`);
          expect(JSON.stringify(value?.Value)).toContain(`DkimDNSTokenValue${i}`);
        }
        expect(Object.keys(outputs)).toHaveLength(6);
      }
    );

    it("exposes dkimRecords as three name/value pairs, always", () => {
      for (const enableDkim of [undefined, true, false]) {
        const { construct, stack } = createStack({ ...defaultProps, enableDkim });
        expect(construct.dkimRecords).toHaveLength(3);
        construct.dkimRecords.forEach((record, index) => {
          expect(JSON.stringify(stack.resolve(record.name))).toContain(
            `DkimDNSTokenName${index + 1}`
          );
          expect(JSON.stringify(stack.resolve(record.value))).toContain(
            `DkimDNSTokenValue${index + 1}`
          );
        });
      }
    });
  });

  // ── S3 Bucket ────────────────────────────────────────────────────

  describe("S3 bucket", () => {
    it("creates bucket with SSE-S3 encryption", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              BucketKeyEnabled: true,
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
      });
    });

    it("blocks all public access", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it("has lifecycle rule for raw/ prefix", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: "auto-delete-old-emails",
              Prefix: "raw/",
              ExpirationInDays: 1,
              Status: "Enabled",
            }),
          ]),
        },
      });
    });

    it("respects custom emailRetentionDays", () => {
      const { template } = createStack({
        ...defaultProps,
        emailRetentionDays: 7,
      });
      template.hasResourceProperties("AWS::S3::Bucket", {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              ExpirationInDays: 7,
            }),
          ]),
        },
      });
    });

    it("uses custom bucket name when provided", () => {
      const { template } = createStack({
        ...defaultProps,
        bucketName: "my-custom-bucket",
      });
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: "my-custom-bucket",
      });
    });

    it("bucket policy scopes SES to s3:PutObject on raw/*", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: "AllowSESPuts",
              Action: "s3:PutObject",
              Principal: { Service: "ses.amazonaws.com" },
              Condition: {
                StringEquals: {
                  "AWS:SourceAccount": "123456789012",
                },
                ArnLike: Match.anyValue(),
              },
            }),
          ]),
        },
      });
    });

    it("enforces SSL on bucket", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: {
                Bool: { "aws:SecureTransport": "false" },
              },
            }),
          ]),
        },
      });
    });
  });

  // ── SNS Topic ────────────────────────────────────────────────────

  describe("SNS topic", () => {
    it("creates topic", () => {
      const { template } = createStack();
      template.resourceCountIs("AWS::SNS::Topic", 1);
    });

    it("uses custom topic name when provided", () => {
      const { template } = createStack({
        ...defaultProps,
        snsTopicName: "my-topic",
      });
      template.hasResourceProperties("AWS::SNS::Topic", {
        TopicName: "my-topic",
      });
    });

    it("topic policy has SourceAccount condition", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::SNS::TopicPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: "ses.amazonaws.com" },
              Action: "SNS:Publish",
              Condition: {
                StringEquals: {
                  "AWS:SourceAccount": "123456789012",
                },
              },
            }),
          ]),
        },
      });
    });
  });

  // ── SES Receipt Rule ─────────────────────────────────────────────

  describe("SES receipt rule", () => {
    it("creates rule in the specified rule set", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::SES::ReceiptRule", {
        RuleSetName: "my-rule-set",
        Rule: Match.objectLike({
          Enabled: true,
          Recipients: ["maildummy.example.com"],
        }),
      });
    });

    it("includes S3 action with raw/ prefix", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::SES::ReceiptRule", {
        Rule: Match.objectLike({
          Actions: Match.arrayWith([
            Match.objectLike({
              S3Action: Match.objectLike({
                ObjectKeyPrefix: "raw/",
              }),
            }),
          ]),
        }),
      });
    });

    it("includes SNS action by default", () => {
      const { template } = createStack();
      template.hasResourceProperties("AWS::SES::ReceiptRule", {
        Rule: Match.objectLike({
          Actions: Match.arrayWith([
            Match.objectLike({
              SNSAction: Match.objectLike({
                Encoding: "UTF-8",
              }),
            }),
          ]),
        }),
      });
    });

    it("excludes SNS action when enableSnsNotifications is false", () => {
      const { template } = createStack({
        ...defaultProps,
        enableSnsNotifications: false,
      });
      const rules = template.findResources("AWS::SES::ReceiptRule");
      const ruleKey = Object.keys(rules)[0];
      const actions = rules[ruleKey].Properties.Rule.Actions;
      expect(actions).toHaveLength(1);
      expect(actions[0].S3Action).toBeDefined();
    });
  });

  // ── Receipt Rule Set ─────────────────────────────────────────────

  describe("receipt rule set", () => {
    it("neither creates nor activates a rule set by default", () => {
      const { template } = createStack();
      template.resourceCountIs("AWS::SES::ReceiptRuleSet", 0);
      template.resourceCountIs("Custom::AWS", 0);
      template.hasResourceProperties("AWS::SES::ReceiptRule", {
        RuleSetName: "my-rule-set",
        After: Match.absent(),
      });
    });

    it("creates the rule set and puts the rule in it when createRuleSet is true", () => {
      const { template } = createStack({ ...defaultProps, createRuleSet: true });
      template.hasResourceProperties("AWS::SES::ReceiptRuleSet", {
        RuleSetName: "my-rule-set",
      });
      const ruleSets = template.findResources("AWS::SES::ReceiptRuleSet");
      const ruleSetId = Object.keys(ruleSets)[0];
      template.hasResourceProperties("AWS::SES::ReceiptRule", {
        RuleSetName: { Ref: ruleSetId },
      });
    });

    it("activates the rule set with SetActiveReceiptRuleSet when activateRuleSet is true", () => {
      const { template } = createStack({
        ...defaultProps,
        createRuleSet: true,
        activateRuleSet: true,
      });
      const activations = template.findResources("Custom::AWS");
      const ids = Object.keys(activations);
      expect(ids).toHaveLength(1);
      const activation = activations[ids[0]];
      const create = JSON.stringify(activation.Properties.Create);
      expect(create).toContain("SetActiveReceiptRuleSet");
      expect(create).toContain("my-rule-set");
      const del = JSON.stringify(activation.Properties.Delete);
      expect(del).toContain("SetActiveReceiptRuleSet");
      expect(del).not.toContain("my-rule-set");
      // Activation waits for the rule (and so, on delete, runs before it).
      const rules = template.findResources("AWS::SES::ReceiptRule");
      expect(activation.DependsOn).toEqual(
        expect.arrayContaining([Object.keys(rules)[0]])
      );
    });

    it("grants the activation function ses:SetActiveReceiptRuleSet", () => {
      const { template } = createStack({ ...defaultProps, activateRuleSet: true });
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Action: "ses:SetActiveReceiptRuleSet" }),
          ]),
        },
      });
      template.resourceCountIs("AWS::SES::ReceiptRuleSet", 0);
    });

    it("passes receiptRuleAfter to the rule", () => {
      const { template } = createStack({
        ...defaultProps,
        receiptRuleAfter: "existing-rule",
      });
      template.hasResourceProperties("AWS::SES::ReceiptRule", {
        After: "existing-rule",
      });
    });
  });

  // ── DNS Records ──────────────────────────────────────────────────

  describe("DNS records", () => {
    function createStackWithHostedZone(extraProps = {}) {
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        stack,
        "Zone",
        { hostedZoneId: "Z1234", zoneName: "example.com" }
      );
      const construct = new Maildummy(stack, "Test", {
        ...defaultProps,
        hostedZone,
        ...extraProps,
      });
      return { stack, construct, template: Template.fromStack(stack) };
    }

    it("does not create DNS records without hostedZone", () => {
      const { template } = createStack();
      template.resourceCountIs("AWS::Route53::RecordSet", 0);
    });

    it("creates MX record when hostedZone is provided", () => {
      const { template } = createStackWithHostedZone();
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "MX",
        Name: "maildummy.example.com.",
        ResourceRecords: ["10 inbound-smtp.us-east-1.amazonaws.com"],
      });
    });

    it.each([undefined, true, false])(
      "creates 3 DKIM CNAME records by default and when enableDkim is %s",
      (enableDkim) => {
        const { template } = createStackWithHostedZone({ enableDkim });
        // 1 MX + 3 DKIM CNAMEs: the CNAMEs verify the domain, signing or not
        template.resourceCountIs("AWS::Route53::RecordSet", 4);
        const cnames = template.findResources("AWS::Route53::RecordSet", {
          Properties: { Type: "CNAME" },
        });
        expect(Object.keys(cnames)).toHaveLength(3);
      }
    );
  });

  // ── Removal Policy ───────────────────────────────────────────────

  describe("removal policy", () => {
    it("defaults to DESTROY with autoDeleteObjects", () => {
      const { template } = createStack();
      const buckets = template.findResources("AWS::S3::Bucket");
      const bucketKey = Object.keys(buckets)[0];
      expect(buckets[bucketKey].UpdateReplacePolicy).toBe("Delete");
      expect(buckets[bucketKey].DeletionPolicy).toBe("Delete");
    });

    it("respects RETAIN removal policy", () => {
      const { template } = createStack({
        ...defaultProps,
        bucketRemovalPolicy: RemovalPolicy.RETAIN,
      });
      const buckets = template.findResources("AWS::S3::Bucket");
      const bucketKey = Object.keys(buckets)[0];
      expect(buckets[bucketKey].DeletionPolicy).toBe("Retain");
    });
  });

  // ── Public Properties ────────────────────────────────────────────

  describe("public properties", () => {
    it("exposes bucket, topic, and domainIdentity", () => {
      const { construct } = createStack();
      expect(construct.bucket).toBeDefined();
      expect(construct.topic).toBeDefined();
      expect(construct.domainIdentity).toBeDefined();
    });

    it("dkimTokens has 3 entries by default", () => {
      const { construct } = createStack();
      expect(construct.dkimTokens).toHaveLength(3);
    });

    it("dkimTokens has 3 entries when DKIM signing is disabled", () => {
      const { construct } = createStack({ ...defaultProps, enableDkim: false });
      expect(construct.dkimTokens).toHaveLength(3);
    });
  });
});
