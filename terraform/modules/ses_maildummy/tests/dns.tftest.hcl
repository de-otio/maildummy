# Offline plan tests: real provider with fake credentials, every endpoint the
# module touches pointed at a closed localhost port, and the only data source
# overridden. No AWS API is ever contacted.

provider "aws" {
  region                      = "eu-central-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
  endpoints {
    route53 = "http://127.0.0.1:1"
    s3      = "http://127.0.0.1:1"
    ses     = "http://127.0.0.1:1"
    sns     = "http://127.0.0.1:1"
    sts     = "http://127.0.0.1:1"
  }
}

override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "111122223333" }
}

variables {
  maildummy_domain      = "maildummy.example.com"
  maildummy_subdomain   = "maildummy"
  s3_bucket_name        = "example-maildummy"
  sns_topic_name        = "example-maildummy"
  receipt_rule_set_name = "example-rule-set"
  receipt_rule_name     = "example-rule"
}

run "route53_publishes_records" {
  command = plan

  variables {
    dns_provider    = "route53"
    route53_zone_id = "Z0000000000EXAMPLE"
  }

  assert {
    condition     = length(aws_route53_record.maildummy_verification) == 1 && length(aws_route53_record.maildummy_mx) == 1
    error_message = "route53 must publish the verification TXT and the MX record"
  }

  assert {
    condition     = aws_route53_record.maildummy_mx[0].records == toset(["10 inbound-smtp.eu-central-1.amazonaws.com"])
    error_message = "MX must point at the regional SES inbound endpoint"
  }
}

run "none_publishes_nothing_but_outputs_values" {
  command = plan

  variables {
    dns_provider = "none"
  }

  assert {
    condition     = length(aws_route53_record.maildummy_verification) == 0 && length(aws_route53_record.maildummy_mx) == 0
    error_message = "dns_provider = none must not create Route53 records"
  }

  assert {
    condition     = output.dns_records.verification.name == "_amazonses.maildummy.example.com" && output.dns_records.mx.priority == 10
    error_message = "dns_records must carry fully qualified record names"
  }

  assert {
    condition     = length(output.dns_records.dkim) == 0
    error_message = "no DKIM records without enable_dkim"
  }
}

run "cloudflare_is_no_longer_a_core_dns_provider" {
  command = plan

  variables {
    dns_provider = "cloudflare"
  }

  expect_failures = [var.dns_provider]
}
