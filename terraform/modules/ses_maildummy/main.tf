terraform {
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
}

# Domain verification TXT record for SES (Route53)
resource "aws_route53_record" "maildummy_verification" {
  count = var.dns_provider == "route53" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = "_amazonses.${var.maildummy_subdomain}"
  type    = "TXT"
  ttl     = 300
  records = [aws_ses_domain_identity.maildummy.verification_token]
}

# Verify domain identity (waits for DNS propagation)
# TEMPORARILY COMMENTED OUT - causing pipeline hangs
# resource "aws_ses_domain_identity_verification" "maildummy" {
#   domain = aws_ses_domain_identity.maildummy.id
#
#   timeouts {
#     create = "5m"
#   }
#
#   depends_on = [aws_route53_record.maildummy_verification]
# }

# S3 bucket for storing incoming emails
resource "aws_s3_bucket" "maildummy" {
  bucket = var.s3_bucket_name

  tags = var.tags

  lifecycle {
    prevent_destroy = false
  }
}

# Allow SES to set ACLs on delivered objects.
resource "aws_s3_bucket_ownership_controls" "maildummy" {
  bucket = aws_s3_bucket.maildummy.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "maildummy" {
  bucket = aws_s3_bucket.maildummy.id
  acl    = "private"

  depends_on = [aws_s3_bucket_ownership_controls.maildummy]
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
      prefix = "raw/"
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

# SNS topic for email notifications
resource "aws_sns_topic" "maildummy" {
  name = var.sns_topic_name

  kms_master_key_id = "alias/aws/sns" # Use AWS managed key for encryption

  tags = var.tags
}

# SES Receipt Rule - stores emails in S3 and notifies SNS
# Note: This rule is appended to an existing receipt rule set (provided via receipt_rule_set_name variable).
# Only one active receipt rule set is allowed per region, so the module does not create or activate rule sets.
# The rule will be appended to the end of the existing ruleset automatically.
# Note: Using separate SNS action instead of topic_arn in s3_action to avoid
# policy validation issues during initial creation
resource "aws_ses_receipt_rule" "maildummy" {
  name          = var.receipt_rule_name
  rule_set_name = var.receipt_rule_set_name
  recipients    = [var.maildummy_domain]
  enabled       = true
  scan_enabled  = false

  # S3 action - store emails in S3
  s3_action {
    bucket_name       = aws_s3_bucket.maildummy.id
    object_key_prefix = "raw/"
    position          = 1
  }

  # SNS action - notify when emails are received (optional to avoid policy validation issues)
  # If receipt rule creation fails, set enable_sns_notifications = false, create the rule,
  # then set it back to true and apply again
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

# IAM policy for SES to write to S3 bucket
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
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = "${aws_s3_bucket.maildummy.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "AWS:SourceArn" = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${var.receipt_rule_set_name}:receipt-rule/${var.receipt_rule_name}"
          }
        }
      }
    ]
  })
}

# IAM policy for SES to publish to SNS topic
# Note: Policy is intentionally simple (no conditions) to avoid AWS SES validation issues
# The policy allows SES service from any account in the same region to publish
# In production, consider adding SourceAccount condition after initial deployment
resource "aws_sns_topic_policy" "maildummy" {
  arn = aws_sns_topic.maildummy.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.maildummy.arn
        # No conditions - AWS SES validation is very strict and can fail even with SourceAccount condition
        # After successful deployment, you can manually add SourceAccount condition if needed for security
      }
    ]
  })
}

# MX record in Route53 for SES inbound email
resource "aws_route53_record" "maildummy_mx" {
  count = var.dns_provider == "route53" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.maildummy_subdomain
  type    = "MX"
  ttl     = 300
  records = ["10 ${local.ses_inbound_endpoint}"]
}

# Enable DKIM signing for the domain (only after verification)
# Note: Verification dependency temporarily removed - verification resource is commented out
resource "aws_ses_domain_dkim" "maildummy" {
  count  = var.enable_dkim ? 1 : 0
  domain = aws_ses_domain_identity.maildummy.domain

  # depends_on = [aws_ses_domain_identity_verification.maildummy]  # Temporarily removed
}

# Local value to safely extract DKIM tokens
locals {
  dkim_tokens = var.enable_dkim && length(aws_ses_domain_dkim.maildummy) > 0 ? (
    try(aws_ses_domain_dkim.maildummy[0].dkim_tokens, [])
  ) : []
}

# Create DKIM CNAME records in Route53
resource "aws_route53_record" "maildummy_dkim" {
  for_each = var.dns_provider == "route53" && length(local.dkim_tokens) > 0 ? {
    for token in local.dkim_tokens : token => token
  } : {}

  zone_id = var.route53_zone_id
  name    = "${each.value}._domainkey.${var.maildummy_subdomain}"
  type    = "CNAME"
  ttl     = 300
  records = ["${each.value}.dkim.amazonses.com"]
}

# Note: The _amazonses TXT record is used for domain verification.
# Once the domain is verified, DKIM tokens are available and can be used
# for DKIM signing. The domain verification record takes precedence.

# Get current AWS account ID
data "aws_caller_identity" "current" {}

# Build SES inbound endpoint dynamically from region
locals {
  ses_inbound_endpoint = "inbound-smtp.${var.aws_region}.amazonaws.com"
}
