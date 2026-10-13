variable "maildummy_domain" {
  description = "Full maildummy domain (e.g., maildummy.example.com)"
  type        = string
}

variable "maildummy_subdomain" {
  description = "Deprecated: the Route53 record names are derived from maildummy_domain. If set, it must be the leading part of maildummy_domain (the domain equals it or starts with \"<subdomain>.\"), otherwise the plan fails. Existing Route53 deployments should keep it set: it keeps the record names relative to the zone, as in 1.x; removing it makes them fully qualified, which makes the provider replace the records."
  type        = string
  default     = null
}

variable "dns_provider" {
  description = "Where the module publishes DNS records: 'route53' (records created in route53_zone_id) or 'none' (publish the values from the dns_records output yourself, e.g. with the ses_maildummy_cloudflare module)"
  type        = string
  default     = "none"

  validation {
    condition     = contains(["route53", "none"], var.dns_provider)
    error_message = "dns_provider must be 'route53' or 'none'. For Cloudflare, set dns_provider = \"none\" and pass the dns_records output to the ses_maildummy_cloudflare module."
  }
}

variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for DNS record creation (required when dns_provider = 'route53')"
  type        = string
  default     = null
}

variable "aws_region" {
  description = "Deprecated and ignored: the module uses the aws provider's region. If set, it must equal that region or the plan fails. Remove it from your configuration."
  type        = string
  default     = null
}

variable "s3_bucket_name" {
  description = "Name of the S3 bucket to store incoming emails"
  type        = string
}

variable "sns_topic_name" {
  description = "Name of the SNS topic for email notifications"
  type        = string
}

variable "receipt_rule_set_name" {
  description = "Name of the SES receipt rule set that holds the rule. Must already exist unless create_rule_set = true."
  type        = string
}

variable "create_rule_set" {
  description = "Create the receipt rule set named receipt_rule_set_name. Leave false to add the rule to an existing set."
  type        = bool
  default     = false
}

variable "activate_rule_set" {
  description = "Make receipt_rule_set_name the active receipt rule set. The active set is a per-region singleton: enable this only if no other configuration manages it. Destroying the module then disables email receiving in the region."
  type        = bool
  default     = false
}

variable "receipt_rule_name" {
  description = "Name of the SES receipt rule to create"
  type        = string
}

variable "receipt_rule_after" {
  description = "Name of an existing rule in the set to place this rule after. When null, SES inserts the rule at the beginning of the rule set."
  type        = string
  default     = null
}

variable "email_retention_days" {
  description = "Number of days to retain emails in S3 before auto-deletion"
  type        = number
  default     = 1

  validation {
    condition     = var.email_retention_days > 0
    error_message = "email_retention_days must be greater than 0"
  }
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

variable "enable_dkim" {
  description = "Enable Easy DKIM for the domain and publish its three CNAME records. Works on the first apply; the domain need not be verified first."
  type        = bool
  default     = false
}

variable "wait_for_verification" {
  description = "Block the apply until SES reports the domain identity as verified (aws_ses_domain_identity_verification)"
  type        = bool
  default     = false
}

variable "verification_timeout" {
  description = "How long wait_for_verification waits before failing, as a duration such as \"15m\""
  type        = string
  default     = "15m"

  validation {
    condition     = can(regex("^[0-9]+(s|m|h)$", var.verification_timeout))
    error_message = "verification_timeout must be a duration such as \"90s\", \"15m\" or \"1h\"."
  }
}

variable "enable_sns_notifications" {
  description = "Add an SNS action to the receipt rule that publishes each received email to the topic"
  type        = bool
  default     = true
}

variable "sns_kms_key_arn" {
  description = "ARN of a customer-managed KMS key for SNS topic encryption. null (default) leaves the topic unencrypted. The key policy must allow ses.amazonaws.com kms:GenerateDataKey* and kms:Decrypt (see the sns_kms_key_policy_statement output). The AWS-managed alias/aws/sns key does not work with SES."
  type        = string
  default     = null

  validation {
    condition     = var.sns_kms_key_arn == null || !can(regex("alias/aws/", var.sns_kms_key_arn))
    error_message = "AWS-managed keys (alias/aws/...) cannot be used: SES cannot publish to topics encrypted with them. Use a customer-managed key."
  }
}

