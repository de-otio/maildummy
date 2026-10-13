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
  dns_provider          = "route53"
  route53_zone_id       = "Z0000000000EXAMPLE"
  s3_bucket_name        = "example-maildummy"
  sns_topic_name        = "example-maildummy"
  receipt_rule_set_name = "example-rule-set"
  receipt_rule_name     = "example-rule"
}

# The real provider leaves dkim_tokens unknown at plan, as on the identity's
# first apply. With for_each over the tokens this failed with
# "Invalid for_each argument".
run "dkim_on_first_apply_plans_three_records" {
  command = plan

  variables {
    enable_dkim = true
  }

  assert {
    condition     = length(aws_route53_record.maildummy_dkim) == 3
    error_message = "enable_dkim must plan three DKIM CNAMEs before the tokens are known"
  }

  assert {
    condition     = length(output.dns_records.dkim) == 3
    error_message = "dns_records.dkim must hold three records"
  }
}

run "dkim_disabled" {
  command = plan

  assert {
    condition     = length(aws_route53_record.maildummy_dkim) == 0 && length(aws_ses_domain_dkim.maildummy) == 0
    error_message = "no DKIM resources without enable_dkim"
  }
}

run "dkim_without_route53_publishes_nothing" {
  command = plan

  variables {
    dns_provider = "none"
    enable_dkim  = true
  }

  assert {
    condition     = length(aws_route53_record.maildummy_dkim) == 0 && length(output.dns_records.dkim) == 3
    error_message = "dns_provider = none must output, not create, the DKIM records"
  }
}

run "no_verification_wait_by_default" {
  command = plan

  assert {
    condition     = length(aws_ses_domain_identity_verification.maildummy) == 0
    error_message = "wait_for_verification must default to false"
  }
}

run "verification_wait" {
  command = plan

  variables {
    wait_for_verification = true
    verification_timeout  = "20m"
  }

  assert {
    condition     = length(aws_ses_domain_identity_verification.maildummy) == 1
    error_message = "wait_for_verification must add the verification resource"
  }

  assert {
    condition     = aws_ses_domain_identity_verification.maildummy[0].domain == "maildummy.example.com"
    error_message = "the verification must wait for the maildummy domain"
  }
}

run "verification_timeout_must_be_a_duration" {
  command = plan

  variables {
    wait_for_verification = true
    verification_timeout  = "soon"
  }

  expect_failures = [var.verification_timeout]
}
