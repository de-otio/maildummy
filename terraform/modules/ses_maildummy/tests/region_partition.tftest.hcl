# Offline plan tests: region and partition come from the provider, not from a
# variable. Real provider with fake credentials, every endpoint the module
# touches pointed at a closed localhost port, and only data sources overridden.
# No AWS API is ever contacted.

provider "aws" {
  region                      = "us-west-2"
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

provider "aws" {
  alias                       = "gov"
  region                      = "us-gov-west-1"
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

run "policies_and_mx_follow_the_provider_region" {
  command = plan

  # Make the bucket and topic ARNs known at plan so the policy JSON can be inspected.
  override_resource {
    target = aws_sns_topic.maildummy
    values = { arn = "arn:aws:sns:us-west-2:111122223333:example-maildummy" }
  }

  override_resource {
    target = aws_s3_bucket.maildummy
    values = { arn = "arn:aws:s3:::example-maildummy" }
  }

  assert {
    condition     = jsondecode(aws_sns_topic_policy.maildummy.policy).Statement[0].Condition.ArnLike["AWS:SourceArn"] == "arn:aws:ses:us-west-2:111122223333:receipt-rule-set/example-rule-set:receipt-rule/example-rule"
    error_message = "the SNS policy must name the receipt rule in the provider's region and partition"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.maildummy.policy).Statement[0].Condition.ArnLike["AWS:SourceArn"] == "arn:aws:ses:us-west-2:111122223333:receipt-rule-set/example-rule-set:receipt-rule/example-rule"
    error_message = "the S3 policy must name the receipt rule in the provider's region and partition"
  }

  assert {
    condition     = aws_route53_record.maildummy_mx[0].records == toset(["10 inbound-smtp.us-west-2.amazonaws.com"])
    error_message = "the MX record must point at the provider region's SES inbound endpoint"
  }

  assert {
    condition     = output.dns_records.mx.value == "inbound-smtp.us-west-2.amazonaws.com"
    error_message = "dns_records.mx must carry the provider region's SES inbound endpoint"
  }
}

run "non_default_partition_is_used_in_arns" {
  command = plan

  providers = {
    aws = aws.gov
  }

  override_data {
    target = data.aws_partition.current
    values = { partition = "aws-us-gov" }
  }

  override_resource {
    target = aws_sns_topic.maildummy
    values = { arn = "arn:aws-us-gov:sns:us-gov-west-1:111122223333:example-maildummy" }
  }

  override_resource {
    target = aws_s3_bucket.maildummy
    values = { arn = "arn:aws-us-gov:s3:::example-maildummy" }
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.maildummy.policy).Statement[0].Condition.ArnLike["AWS:SourceArn"] == "arn:aws-us-gov:ses:us-gov-west-1:111122223333:receipt-rule-set/example-rule-set:receipt-rule/example-rule"
    error_message = "the S3 policy must use the provider's partition, not a literal arn:aws"
  }

  assert {
    condition     = jsondecode(aws_sns_topic_policy.maildummy.policy).Statement[0].Condition.ArnLike["AWS:SourceArn"] == "arn:aws-us-gov:ses:us-gov-west-1:111122223333:receipt-rule-set/example-rule-set:receipt-rule/example-rule"
    error_message = "the SNS policy must use the provider's partition, not a literal arn:aws"
  }

  assert {
    condition     = output.dns_records.mx.value == "inbound-smtp.us-gov-west-1.amazonaws.com"
    error_message = "the MX target must follow the provider's region"
  }
}

run "aws_region_matching_the_provider_is_accepted" {
  command = plan

  variables {
    aws_region = "us-west-2"
  }

  assert {
    condition     = output.dns_records.mx.value == "inbound-smtp.us-west-2.amazonaws.com"
    error_message = "a deprecated aws_region equal to the provider region must still work"
  }
}

run "aws_region_differing_from_the_provider_is_rejected" {
  command = plan

  variables {
    aws_region = "eu-west-1"
  }

  expect_failures = [aws_ses_domain_identity.maildummy]
}
