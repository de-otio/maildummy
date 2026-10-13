variable "maildummy_domain" {
  description = "Full maildummy domain (e.g., maildummy.example.com)"
  type        = string
}

variable "maildummy_subdomain" {
  description = "Maildummy subdomain without zone (e.g., maildummy for maildummy.example.com). Used for the Route53 record names."
  type        = string
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
  description = "AWS region for SES resources"
  type        = string
  default     = "eu-central-1"
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
  description = "Enable DKIM records creation (set to false for initial deployment, enable after domain verification)"
  type        = bool
  default     = false
}

variable "enable_sns_notifications" {
  description = "Enable SNS notifications for received emails (set to false initially if receipt rule creation fails, then enable after policies propagate)"
  type        = bool
  default     = true
}

