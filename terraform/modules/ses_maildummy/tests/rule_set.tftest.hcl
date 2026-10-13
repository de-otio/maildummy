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

run "defaults_use_an_existing_inactive_set" {
  command = plan

  assert {
    condition     = length(aws_ses_receipt_rule_set.maildummy) == 0 && length(aws_ses_active_receipt_rule_set.maildummy) == 0
    error_message = "by default the module must neither create nor activate a rule set"
  }

  assert {
    condition     = aws_ses_receipt_rule.maildummy.rule_set_name == "example-rule-set" && aws_ses_receipt_rule.maildummy.after == null
    error_message = "the rule must go into receipt_rule_set_name with no after"
  }
}

run "create_and_activate" {
  command = plan

  variables {
    create_rule_set   = true
    activate_rule_set = true
  }

  assert {
    condition     = aws_ses_receipt_rule_set.maildummy[0].rule_set_name == "example-rule-set"
    error_message = "create_rule_set must create receipt_rule_set_name"
  }

  assert {
    condition     = aws_ses_active_receipt_rule_set.maildummy[0].rule_set_name == "example-rule-set"
    error_message = "activate_rule_set must activate receipt_rule_set_name"
  }

  assert {
    condition     = aws_ses_receipt_rule.maildummy.rule_set_name == "example-rule-set"
    error_message = "the rule must go into the created set"
  }
}

run "activate_existing_set_only" {
  command = plan

  variables {
    activate_rule_set = true
  }

  assert {
    condition     = length(aws_ses_receipt_rule_set.maildummy) == 0 && length(aws_ses_active_receipt_rule_set.maildummy) == 1
    error_message = "activate_rule_set without create_rule_set must activate the existing set"
  }
}

run "after_places_the_rule" {
  command = plan

  variables {
    receipt_rule_after = "existing-rule"
  }

  assert {
    condition     = aws_ses_receipt_rule.maildummy.after == "existing-rule"
    error_message = "receipt_rule_after must be passed to the rule"
  }
}
