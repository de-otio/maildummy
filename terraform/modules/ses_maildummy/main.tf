terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 7.0"
    }
  }
}

# SES Domain Identity for maildummy domain (supports DKIM)
resource "aws_ses_domain_identity" "maildummy" {
  domain = var.maildummy_domain

  lifecycle {
    # aws_region is deprecated and ignored; it may only repeat the provider's
    # region. A different value used to point the policies and the MX record at a
    # region the module is not deployed in.
    # maildummy_subdomain is deprecated; if set it may only repeat the leading
    # label(s) of maildummy_domain, so the two inputs cannot drift apart.
    precondition {
      condition = (
        var.maildummy_subdomain == null
        || var.maildummy_subdomain == ""
        || local.subdomain == local.domain
        || startswith(local.domain, "${local.subdomain}.")
      )
      error_message = "maildummy_subdomain (\"${coalesce(var.maildummy_subdomain, "-")}\") must be the leading part of maildummy_domain (\"${var.maildummy_domain}\"), i.e. the domain must equal it or start with \"<subdomain>.\". maildummy_subdomain is deprecated: the record names are derived from maildummy_domain, so you can remove it."
    }

    precondition {
      condition     = var.aws_region == null || var.aws_region == local.region
      error_message = "aws_region is deprecated and the module now uses the provider's region (${local.region}). Remove aws_region, or configure the aws provider for ${coalesce(var.aws_region, "that region")}."
    }
  }
}

# Domain verification TXT record for SES (Route53)
resource "aws_route53_record" "maildummy_verification" {
  count = var.dns_provider == "route53" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = "_amazonses.${local.record_name_base}"
  type    = "TXT"
  ttl     = 300
  records = [aws_ses_domain_identity.maildummy.verification_token]
}

# Optionally wait until SES reports the domain as verified. Off by default:
# the apply blocks until DNS has propagated and SES has checked it, up to
# verification_timeout. With dns_provider = "none" the records must already be
# published elsewhere, or the wait times out.
resource "aws_ses_domain_identity_verification" "maildummy" {
  count = var.wait_for_verification ? 1 : 0

  domain = aws_ses_domain_identity.maildummy.domain

  timeouts {
    create = var.verification_timeout
  }

  depends_on = [aws_route53_record.maildummy_verification]
}

# S3 bucket for storing incoming emails
resource "aws_s3_bucket" "maildummy" {
  bucket = var.s3_bucket_name

  tags = var.tags

  lifecycle {
    prevent_destroy = false
  }
}

# ACLs are disabled: the bucket owner owns every object, and access is granted
# only through the bucket policy. SES delivery needs just s3:PutObject (see
# "Give SES permission to write to an S3 bucket" in the SES developer guide).
resource "aws_s3_bucket_ownership_controls" "maildummy" {
  bucket = aws_s3_bucket.maildummy.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# 1.x managed the bucket ACL. Destroying aws_s3_bucket_acl only drops it from
# state (the provider's delete is a no-op), so this block just makes the plan say
# so instead of "destroy". Requires Terraform or OpenTofu >= 1.7.
removed {
  from = aws_s3_bucket_acl.maildummy

  lifecycle {
    destroy = false
  }
}

# Enable server-side encryption for S3 bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "maildummy" {
  bucket = aws_s3_bucket.maildummy.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "maildummy" {
  bucket = aws_s3_bucket.maildummy.id

  rule {
    id     = "auto-delete-old-emails"
    status = "Enabled"

    filter {
      prefix = local.raw_prefix
    }

    expiration {
      days = var.email_retention_days
    }
  }
}

resource "aws_s3_bucket_public_access_block" "maildummy" {
  bucket = aws_s3_bucket.maildummy.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SNS topic for email notifications.
# Unencrypted unless sns_kms_key_arn is set. The AWS-managed key (alias/aws/sns)
# cannot be used: its key policy does not let AWS services such as SES call
# kms:GenerateDataKey / kms:Decrypt, and it cannot be edited. A customer-managed
# key must grant ses.amazonaws.com those actions (see the
# sns_kms_key_policy_statement output).
resource "aws_sns_topic" "maildummy" {
  name = var.sns_topic_name

  kms_master_key_id = var.sns_kms_key_arn

  tags = var.tags
}

# SES receipt rule set. By default the module adds its rule to an existing set
# (receipt_rule_set_name). create_rule_set creates that set; activate_rule_set
# makes it the active set. The active set is a per-region singleton: exactly one
# configuration may own it, so only enable activate_rule_set if nothing else in
# the account and region manages the active receipt rule set.
resource "aws_ses_receipt_rule_set" "maildummy" {
  count = var.create_rule_set ? 1 : 0

  rule_set_name = var.receipt_rule_set_name
}

resource "aws_ses_active_receipt_rule_set" "maildummy" {
  count = var.activate_rule_set ? 1 : 0

  rule_set_name = var.receipt_rule_set_name

  # Activate once the rule exists; on destroy, deactivate before removing it.
  depends_on = [
    aws_ses_receipt_rule_set.maildummy,
    aws_ses_receipt_rule.maildummy,
  ]
}

# SES Receipt Rule - stores emails in S3 and notifies SNS.
# SES places the rule after the rule named in receipt_rule_after; when that is
# null, SES inserts it at the beginning of the rule set.
resource "aws_ses_receipt_rule" "maildummy" {
  name          = var.receipt_rule_name
  rule_set_name = var.create_rule_set ? aws_ses_receipt_rule_set.maildummy[0].rule_set_name : var.receipt_rule_set_name
  after         = var.receipt_rule_after
  recipients    = [var.maildummy_domain]
  enabled       = true
  scan_enabled  = false

  # S3 action - store emails in S3
  s3_action {
    bucket_name       = aws_s3_bucket.maildummy.id
    object_key_prefix = local.raw_prefix
    position          = 1
  }

  # SNS action - notify when emails are received
  dynamic "sns_action" {
    for_each = var.enable_sns_notifications ? [1] : []
    content {
      topic_arn = aws_sns_topic.maildummy.arn
      position  = 2
      encoding  = "UTF-8"
    }
  }

  depends_on = [
    aws_s3_bucket_policy.maildummy,
    aws_sns_topic_policy.maildummy
  ]
}

# Bucket policy: SES may write under the raw prefix only, and every request must
# use TLS.
resource "aws_s3_bucket_policy" "maildummy" {
  bucket = aws_s3_bucket.maildummy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESPuts"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.maildummy.arn}/${local.raw_prefix}*"
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "AWS:SourceArn" = local.receipt_rule_arn
          }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.maildummy.arn,
          "${aws_s3_bucket.maildummy.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# Topic policy: only this account's receipt rule may publish via SES.
resource "aws_sns_topic_policy" "maildummy" {
  arn = aws_sns_topic.maildummy.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESPublish"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.maildummy.arn
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "AWS:SourceArn" = local.receipt_rule_arn
          }
        }
      }
    ]
  })
}

# MX record in Route53 for SES inbound email
resource "aws_route53_record" "maildummy_mx" {
  count = var.dns_provider == "route53" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = local.record_name_base
  type    = "MX"
  ttl     = 300
  records = ["10 ${local.ses_inbound_endpoint}"]
}

# Enable DKIM signing for the domain. SES returns the three tokens as soon as
# this is created; the domain does not have to be verified first.
resource "aws_ses_domain_dkim" "maildummy" {
  count  = var.enable_dkim ? 1 : 0
  domain = aws_ses_domain_identity.maildummy.domain
}

# Create DKIM CNAME records in Route53. SES always issues three tokens; the
# count is static so the records plan even while the tokens are unknown (the
# identity's first apply).
resource "aws_route53_record" "maildummy_dkim" {
  count = var.dns_provider == "route53" && var.enable_dkim ? 3 : 0

  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.maildummy[0].dkim_tokens[count.index]}._domainkey.${local.record_name_base}"
  type    = "CNAME"
  ttl     = 300
  records = ["${aws_ses_domain_dkim.maildummy[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# Note: The _amazonses TXT record is used for domain verification.
# Once the domain is verified, DKIM tokens are available and can be used
# for DKIM signing. The domain verification record takes precedence.

# Account, region and partition all come from the provider configuration, so the
# policies and the MX target follow wherever the module is deployed.
data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

# aws 6 exposes the region as `region` and deprecates `name` and `id`; aws 5 has
# no `region`, only `name`. A plain `.region` reference fails validation on aws 5
# even inside try(), so the attribute is read by key with lookup(): it uses
# `region` where it exists and only then touches `name`, which keeps the module
# working on both without a deprecation warning.
data "aws_region" "current" {}

locals {
  # Key prefix SES writes received mail under; the S3 policy and the lifecycle
  # rule are scoped to it.
  raw_prefix = "raw/"

  # Normalised for comparison only; the domain identity uses var.maildummy_domain
  # as given.
  domain    = lower(trimsuffix(var.maildummy_domain, "."))
  subdomain = var.maildummy_subdomain == null ? "" : lower(trimsuffix(var.maildummy_subdomain, "."))

  # Route53 record names. Derived from maildummy_domain, as a fully qualified
  # name, which Route53 accepts. A caller that still passes the deprecated
  # maildummy_subdomain keeps the zone-relative names it had in 1.x: the provider
  # stores `name` as configured and forces a replacement when it changes, so
  # switching an existing record between relative and fully qualified recreates it.
  record_name_base = var.maildummy_subdomain == null ? var.maildummy_domain : var.maildummy_subdomain

  region = try(lookup(data.aws_region.current, "region"), lookup(data.aws_region.current, "name"))

  # SES inbound endpoint for the provider's region.
  ses_inbound_endpoint = "inbound-smtp.${local.region}.amazonaws.com"

  # ARN of the receipt rule, used as AWS:SourceArn in the S3 and SNS policies.
  receipt_rule_arn = "arn:${data.aws_partition.current.partition}:ses:${local.region}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${var.receipt_rule_set_name}:receipt-rule/${var.receipt_rule_name}"
}
