# Security Review - Maildummy Terraform Module

## Review Date

2024

## Executive Summary

This document outlines the security review findings and improvements made to the maildummy Terraform module and, where noted, the CDK construct. It was first written in 2024 and has been corrected to describe what the code on this branch actually does.

maildummy is test infrastructure for receiving disposable test mail on a dedicated subdomain. It is not a hardened mail store: do not route real or sensitive mail to it. Residual risks are listed under "Residual risks" below.

## Security Improvements Implemented

### 1. S3 Bucket Security ✅

**Issues Found:**

- Missing server-side encryption
- Missing tags on bucket resource
- ACLs were managed on the bucket, and the bucket policy let SES do more than write received mail
- No TLS requirement on the bucket

**Fixes Applied:**

- ✅ Added `aws_s3_bucket_server_side_encryption_configuration` with AES256 encryption
- ✅ Enabled bucket key for cost optimization
- ✅ Applied the `tags` variable to the S3 bucket resource
- ✅ Disabled ACLs (`BucketOwnerEnforced` object ownership)
- ✅ Scoped the SES grant to `s3:PutObject` on `raw/*` only
- ✅ Terraform bucket policy denies every request made without TLS (`aws:SecureTransport` is `false`)

**Current Status:**

- ✅ Public access blocked (already implemented)
- ✅ Lifecycle policy configured for the `raw/` prefix (already implemented)
- ✅ Server-side encryption enabled (AES256 / S3-managed keys, not customer-managed)
- ✅ ACLs disabled; access is controlled by the bucket policy alone
- ✅ CDK construct: same ownership, `raw/*` scoping and encryption; TLS is enforced with `enforceSSL: true`, which adds CDK's own deny statement rather than the one the Terraform module writes
- ⚠️ Versioning, access logging and object lock are not configured

### 2. SNS Topic Security ✅

**Issues Found:**

- Missing encryption at rest
- Topic policy not conditioned on the source account or receipt rule

**Fixes Applied:**

- ✅ Terraform: optional customer-managed KMS encryption through `sns_kms_key_arn`. The AWS-managed key (`alias/aws/sns`) is rejected by a variable validation, because its key policy cannot be edited and does not let SES call `kms:GenerateDataKey*` / `kms:Decrypt`, so SES could not publish. The key policy a customer-managed key needs is exposed as the `sns_kms_key_policy_statement` output.
- ✅ Topic policy allows `SNS:Publish` from `ses.amazonaws.com` only with `AWS:SourceAccount` (this account) and `AWS:SourceArn` (this receipt rule) conditions, in both Terraform and CDK

**Current Status:**

- ⚠️ The topic is **unencrypted by default**. Terraform encrypts it only when `sns_kms_key_arn` is set. The CDK construct has no KMS option and always creates an unencrypted topic.
- ✅ Tags applied to the topic in Terraform through the `tags` variable (already implemented)

### 3. IAM Policy Security ✅

**Issues Found:**

- IAM policies only checked source account, not source ARN
- Missing additional layer of security through ARN-based conditions

**Fixes Applied:**

- ✅ Added `AWS:SourceAccount` and `ArnLike` `AWS:SourceArn` conditions to the S3 bucket policy to restrict access to this account's SES receipt rule (Terraform and CDK)
- ✅ Added the same two conditions to the SNS topic policy (Terraform and CDK)

**Current Status:**

- ✅ Source account validation
- ✅ Source ARN validation (the receipt rule's ARN, built from the rule set and rule names)
- ✅ The SES principal gets only `s3:PutObject` under `raw/*` and `SNS:Publish` on the topic

### 4. Variable Validation ✅

**Issues Found:**

- Missing validation for `email_retention_days` (could be 0 or negative)
- No explicit validation for zone_id requirements

**Fixes Applied:**

- ✅ Added validation to ensure `email_retention_days > 0`
- ✅ Zone ID validation handled naturally by Terraform (will fail if null when needed)

**Current Status:**

- ✅ Input validation in place
- ✅ DNS provider validation (already implemented)

### 5. Resource Tagging ✅

**Issues Found:**

- S3 bucket missing tags

**Fixes Applied:**

- ✅ Added tags to S3 bucket resource

**Current Status:**

- ✅ Terraform applies the `tags` variable to the S3 bucket and the SNS topic
- ⚠️ The SES domain identity, DKIM, receipt rule set and receipt rule, and the Route53 records are not tagged: the AWS provider does not accept tags on those resources
- ⚠️ The CDK construct has no tags prop and sets no tags itself. Tags added with `Tags.of(...)` or stack tags reach the resources CDK can tag (such as the bucket and topic).

## Security Best Practices Compliance

### ✅ Implemented Best Practices

1. **Encryption at Rest**

   - S3: AES256 server-side encryption with bucket key enabled
   - SNS: unencrypted by default; Terraform can encrypt the topic with a customer-managed KMS key (`sns_kms_key_arn`); the CDK construct cannot

2. **Encryption in Transit**

   - SES receives mail over SMTP; whether the sending side uses TLS is up to the sender (SES offers STARTTLS but a sender may deliver in plaintext)
   - S3: the bucket policy denies requests that do not use TLS (Terraform policy; `enforceSSL` in CDK)
   - SNS: the AWS endpoints use HTTPS; the topic policy does not add a TLS-only condition

3. **Least Privilege Access**

   - The S3 bucket policy grants SES `s3:PutObject` on `raw/*` only (plus a TLS-only deny)
   - The SNS topic policy grants SES `SNS:Publish` only
   - Both grants carry `AWS:SourceAccount` and `AWS:SourceArn` conditions
   - Reading the stored mail is left to the caller's own IAM permissions; the module creates no reader role

4. **Public Access Prevention**

   - S3 bucket has public access block enabled
   - ACLs are disabled (`BucketOwnerEnforced`)

5. **Data Retention**

   - Lifecycle policy automatically deletes emails after retention period
   - Configurable retention period with validation

6. **Input Validation**

   - DNS provider validation
   - Email retention days validation
   - Type checking on all variables

7. **Resource Tagging**
   - The Terraform `tags` variable is applied to the S3 bucket and SNS topic; SES resources and DNS records are not taggable (see section 5)

### ⚠️ Considerations and Recommendations

1. **SES Domain Verification**

   - In Terraform, `aws_ses_domain_identity_verification` is created only when `wait_for_verification = true` (default `false`), because the apply blocks until DNS has propagated
   - **Recommendation**: Check verification in a separate CI/CD step instead of blocking the apply
   - **Risk**: Low - DNS records are still created (or published by you with `dns_provider = "none"`) and SES verifies the domain asynchronously

2. **KMS Key Management**

   - The SNS topic is unencrypted by default; the AWS-managed key `alias/aws/sns` cannot be used because SES cannot publish to a topic encrypted with it
   - **Recommendation**: If the notification payload must be encrypted at rest, pass a customer-managed key as `sns_kms_key_arn` (Terraform only) with the key policy statement from the `sns_kms_key_policy_statement` output
   - **Trade-off**: A customer-managed key costs more and needs its key policy maintained; the CDK construct has no equivalent option

3. **S3 Bucket Versioning**

   - Versioning is not enabled
   - **Recommendation**: Consider enabling versioning if email recovery is needed
   - **Trade-off**: Increases storage costs but provides data recovery capability

4. **S3 Bucket Logging**

   - Access logging is not configured
   - **Recommendation**: Enable S3 access logging for audit trails
   - **Trade-off**: Additional storage costs but provides security audit capability

5. **CloudWatch Monitoring**

   - No CloudWatch alarms configured
   - **Recommendation**: Add alarms for:
     - Unusual S3 access patterns
     - SNS topic errors
     - SES bounce/complaint rates
   - **Benefit**: Early detection of security issues

6. **Route53 Zone ID Validation**
   - Zone ID format is not validated
   - **Recommendation**: Add regex validation for Route53 zone ID format
   - **Risk**: Low - Terraform will fail if invalid format is used

## Compliance Considerations

### AWS Well-Architected Framework

This is an informal mapping, not an assessment or certification.

- **Security Pillar**: S3 encryption and access control are in place; SNS encryption is optional; monitoring is not provided (see considerations above)
- **Operational Excellence**: Lifecycle management and declarative deployment; tagging is partial
- **Cost Optimization**: Lifecycle policies, bucket keys, and retention policies
- **Reliability**: Not addressed beyond SES and S3 managed-service defaults; the module has no alarms or retries of its own

### Data Protection

- ✅ Encryption at rest for S3 (AES256); SNS only with a customer-managed key in Terraform
- ✅ TLS required for S3 requests
- ✅ Automatic data deletion of `raw/` objects after the retention period (lifecycle policy)
- ⚠️ Access logging is not configured by the module

### Access Control

- ✅ The SES grants are narrow: `s3:PutObject` on `raw/*`, `SNS:Publish` on the topic
- ✅ Service-specific access restrictions
- ✅ Source account and ARN validation
- ✅ Public access prevention

## Residual risks

- **Any sender can deliver mail.** The receipt rule accepts every message addressed to the domain (spam and virus scanning are off, `scan_enabled = false`). Anyone who can reach the MX record can place mail in the bucket and trigger SNS notifications, so tests must not trust the sender or content of a received message.
- **Stored mail is plaintext to anyone with bucket read access.** S3 encryption at rest does not protect it from principals who can call `s3:GetObject`. Keep test accounts and the bucket's IAM access narrow.
- **The SNS topic is unencrypted by default** (and always, in the CDK construct).
- **Retention is best effort.** Lifecycle expiry runs asynchronously and applies only under `raw/`; the minimum retention is one day.
- **Dev defaults are destructive.** The CDK construct defaults to `RemovalPolicy.DESTROY` with auto-deleted objects, and activating the receipt rule set affects the whole region.
- **No monitoring, versioning or access logging** is provisioned.

## Remaining Security Considerations

1. **Network Security**

   - Consider VPC endpoints if accessing from VPC
   - Consider IP restrictions if needed (not applicable for SES)

2. **Monitoring and Alerting**

   - Implement CloudWatch alarms (recommended)
   - Set up S3 access logging (recommended)
   - Monitor SES bounce/complaint rates

3. **Compliance Requirements**

   - Review data retention requirements for your jurisdiction
   - Consider additional encryption for sensitive test data
   - Document data handling procedures

4. **Operational Security**
   - Rotate AWS credentials regularly
   - Use IAM roles instead of access keys where possible
   - Enable CloudTrail for API auditing

## Testing Recommendations

1. **Security Testing**

   - Verify S3 bucket is not publicly accessible
   - Test IAM policy restrictions
   - Verify encryption is enabled
   - Test lifecycle policy deletion

2. **Compliance Testing**
   - Verify tags are applied correctly
   - Test retention policy enforcement
   - Verify DNS record creation

## Conclusion

The maildummy Terraform module has been reviewed and improved with the following security enhancements:

- ✅ S3 bucket encryption enabled (AES256), ACLs disabled, SES writes limited to `raw/*`, TLS required
- ✅ SNS topic encryption available through a customer-managed key (Terraform only); off by default
- ✅ Bucket and topic policies conditioned on the source account and receipt rule ARN (Terraform and CDK)
- ✅ Input validation added
- ✅ `tags` applied to the S3 bucket and SNS topic

maildummy is intended as test infrastructure: it receives disposable test mail on a dedicated subdomain in a non-production account. These measures limit what the AWS resources expose; they do not make it suitable for storing real or sensitive mail, and it ships with no monitoring or alerting. Read the residual risks above before deploying it anywhere that matters.

## References

- [AWS S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [AWS SNS Security Best Practices](https://docs.aws.amazon.com/sns/latest/dg/sns-security-best-practices.html)
- [AWS SES Security Best Practices](https://docs.aws.amazon.com/ses/latest/dg/security-best-practices.html)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
