# Offline plan tests: the Route53 record names come from maildummy_domain alone;
# maildummy_subdomain is deprecated and only checked against it. Real provider
# with fake credentials, every endpoint the module touches pointed at a closed
# localhost port, and only data sources and computed attributes overridden. No
# AWS API is ever contacted.

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

# SES issues the DKIM tokens at apply; fix them so the record names are known.
override_resource {
  target = aws_ses_domain_dkim.maildummy
  values = { dkim_tokens = ["token1", "token2", "token3"] }
}

# No maildummy_subdomain: the domain is the only name input.
variables {
  maildummy_domain      = "maildummy.example.com"
  dns_provider          = "route53"
  route53_zone_id       = "Z0000000000EXAMPLE"
  s3_bucket_name        = "example-maildummy"
  sns_topic_name        = "example-maildummy"
  receipt_rule_set_name = "example-rule-set"
  receipt_rule_name     = "example-rule"
  enable_dkim           = true
}

run "record_names_are_derived_from_the_domain" {
  command = plan

  assert {
    condition     = aws_route53_record.maildummy_verification[0].name == "_amazonses.maildummy.example.com"
    error_message = "the verification record must be named after maildummy_domain"
  }

  assert {
    condition     = aws_route53_record.maildummy_mx[0].name == "maildummy.example.com"
    error_message = "the MX record must be named after maildummy_domain"
  }

  assert {
    condition     = aws_route53_record.maildummy_dkim[1].name == "token2._domainkey.maildummy.example.com"
    error_message = "the DKIM records must be named after maildummy_domain"
  }
}

run "changing_the_domain_moves_every_record" {
  command = plan

  variables {
    maildummy_domain = "mail.dev.example.org"
  }

  assert {
    condition = (
      aws_route53_record.maildummy_verification[0].name == "_amazonses.mail.dev.example.org"
      && aws_route53_record.maildummy_mx[0].name == "mail.dev.example.org"
      && aws_route53_record.maildummy_dkim[0].name == "token1._domainkey.mail.dev.example.org"
    )
    error_message = "with no second input to keep in sync, every record name must follow maildummy_domain"
  }
}

run "consistent_subdomain_keeps_the_1x_relative_names" {
  command = plan

  variables {
    maildummy_subdomain = "maildummy"
  }

  assert {
    condition = (
      aws_route53_record.maildummy_verification[0].name == "_amazonses.maildummy"
      && aws_route53_record.maildummy_mx[0].name == "maildummy"
      && aws_route53_record.maildummy_dkim[2].name == "token3._domainkey.maildummy"
    )
    error_message = "callers that still pass maildummy_subdomain must keep their zone-relative record names, or the provider replaces the records"
  }

  assert {
    condition     = output.dns_records.verification.name == "_amazonses.maildummy.example.com"
    error_message = "dns_records must stay fully qualified"
  }
}

run "subdomain_check_ignores_case" {
  command = plan

  variables {
    maildummy_domain    = "Maildummy.Example.com"
    maildummy_subdomain = "MailDummy."
  }

  assert {
    condition     = aws_route53_record.maildummy_mx[0].name == "maildummy"
    error_message = "DNS names are case-insensitive and a subdomain may carry a trailing dot; the provider normalises the name"
  }
}

run "inconsistent_subdomain_is_rejected" {
  command = plan

  variables {
    maildummy_subdomain = "other"
  }

  expect_failures = [aws_ses_domain_identity.maildummy]
}

run "subdomain_that_only_shares_a_prefix_is_rejected" {
  command = plan

  variables {
    maildummy_subdomain = "maildum"
  }

  expect_failures = [aws_ses_domain_identity.maildummy]
}
