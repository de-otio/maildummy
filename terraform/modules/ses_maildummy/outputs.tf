output "maildummy_domain" {
  description = "Maildummy domain name"
  value       = var.maildummy_domain
}

output "s3_bucket_name" {
  description = "S3 bucket name for storing emails"
  value       = aws_s3_bucket.maildummy.id
}

output "s3_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.maildummy.arn
}

output "sns_topic_arn" {
  description = "SNS topic ARN for email notifications"
  value       = aws_sns_topic.maildummy.arn
}

output "sns_topic_name" {
  description = "SNS topic name"
  value       = aws_sns_topic.maildummy.name
}

output "receipt_rule_set_name" {
  description = "SES receipt rule set name that holds the rule"
  value       = var.receipt_rule_set_name
}

output "ses_identity_arn" {
  description = "SES domain identity ARN"
  value       = aws_ses_domain_identity.maildummy.arn
}


output "dns_records" {
  description = <<-EOT
    DNS records SES needs, for publishing with any DNS provider. Names are fully
    qualified. `dkim` holds three CNAMEs when enable_dkim is true and is empty
    otherwise; its length is known at plan time even before SES issues the tokens.
  EOT
  value = {
    verification = {
      name  = "_amazonses.${var.maildummy_domain}"
      type  = "TXT"
      ttl   = 300
      value = aws_ses_domain_identity.maildummy.verification_token
    }
    mx = {
      name     = var.maildummy_domain
      type     = "MX"
      ttl      = 300
      priority = 10
      value    = local.ses_inbound_endpoint
    }
    dkim = [
      for i in range(var.enable_dkim ? 3 : 0) : {
        name  = "${aws_ses_domain_dkim.maildummy[0].dkim_tokens[i]}._domainkey.${var.maildummy_domain}"
        type  = "CNAME"
        ttl   = 300
        value = "${aws_ses_domain_dkim.maildummy[0].dkim_tokens[i]}.dkim.amazonses.com"
      }
    ]
  }
}

output "sns_kms_key_policy_statement" {
  description = "Key policy statement a customer-managed key passed as sns_kms_key_arn must contain so SES can publish to the encrypted topic"
  value = jsonencode({
    Sid    = "AllowSESToUseKeyForSNS"
    Effect = "Allow"
    Principal = {
      Service = "ses.amazonaws.com"
    }
    Action   = ["kms:GenerateDataKey*", "kms:Decrypt"]
    Resource = "*"
  })
}
