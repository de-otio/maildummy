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

# Make the topic ARN known at plan so the topic policy JSON can be inspected.
override_resource {
  target = aws_sns_topic.maildummy
  values = { arn = "arn:aws:sns:eu-central-1:111122223333:example-maildummy" }
}

variables {
  maildummy_domain      = "maildummy.example.com"
  maildummy_subdomain   = "maildummy"
  s3_bucket_name        = "example-maildummy"
  sns_topic_name        = "example-maildummy"
  receipt_rule_set_name = "example-rule-set"
  receipt_rule_name     = "example-rule"
}

run "topic_unencrypted_by_default_and_policy_scoped" {
  command = plan

  assert {
    condition     = aws_sns_topic.maildummy.kms_master_key_id == null
    error_message = "the topic must not use the AWS-managed SNS key, which SES cannot use"
  }

  assert {
    condition     = jsondecode(aws_sns_topic_policy.maildummy.policy).Statement[0].Condition.StringEquals["AWS:SourceAccount"] == "111122223333"
    error_message = "the topic policy must restrict SES to this account"
  }

  assert {
    condition     = jsondecode(aws_sns_topic_policy.maildummy.policy).Statement[0].Condition.ArnLike["AWS:SourceArn"] == "arn:aws:ses:eu-central-1:111122223333:receipt-rule-set/example-rule-set:receipt-rule/example-rule"
    error_message = "the topic policy must restrict SES to this receipt rule"
  }
}

run "customer_managed_key" {
  command = plan

  variables {
    sns_kms_key_arn = "arn:aws:kms:eu-central-1:111122223333:key/00000000-0000-0000-0000-000000000000"
  }

  assert {
    condition     = aws_sns_topic.maildummy.kms_master_key_id == "arn:aws:kms:eu-central-1:111122223333:key/00000000-0000-0000-0000-000000000000"
    error_message = "sns_kms_key_arn must encrypt the topic"
  }

  assert {
    condition     = contains(jsondecode(output.sns_kms_key_policy_statement).Action, "kms:Decrypt") && jsondecode(output.sns_kms_key_policy_statement).Principal.Service == "ses.amazonaws.com"
    error_message = "the recommended key policy statement must grant SES kms:Decrypt"
  }
}

run "aws_managed_key_rejected" {
  command = plan

  variables {
    sns_kms_key_arn = "alias/aws/sns"
  }

  expect_failures = [var.sns_kms_key_arn]
}
