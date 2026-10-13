# Shared body of the aws5 and aws6 fixture roots (each symlinks this file and
# pins its own provider versions in versions.tf). Placeholder values only.

provider "aws" {
  region = "eu-central-1"
}

provider "cloudflare" {}

# Route 53 users: the core module publishes the records itself.
module "maildummy_route53" {
  source = "../../../modules/ses_maildummy"

  maildummy_domain      = "maildummy.example.com"
  maildummy_subdomain   = "maildummy"
  dns_provider          = "route53"
  route53_zone_id       = "Z0000000000EXAMPLE"
  s3_bucket_name        = "example-maildummy-r53"
  sns_topic_name        = "example-maildummy-r53"
  receipt_rule_set_name = "example-rule-set"
  receipt_rule_name     = "example-maildummy-r53"
  enable_dkim           = true
}

# Cloudflare users: the core module publishes nothing, the submodule takes its
# dns_records output.
module "maildummy" {
  source = "../../../modules/ses_maildummy"

  maildummy_domain      = "maildummy.example.net"
  maildummy_subdomain   = "maildummy"
  dns_provider          = "none"
  s3_bucket_name        = "example-maildummy-cf"
  sns_topic_name        = "example-maildummy-cf"
  receipt_rule_set_name = "example-rule-set"
  receipt_rule_name     = "example-maildummy-cf"
  enable_dkim           = true
}

module "maildummy_cloudflare" {
  source = "../../../modules/ses_maildummy_cloudflare"

  zone_id     = "00000000000000000000000000000000"
  dns_records = module.maildummy.dns_records
}
