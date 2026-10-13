# Offline plan tests: real provider with fake credentials, every endpoint the
# module touches pointed at a closed localhost port, and only data sources and
# computed ARNs overridden. No AWS API is ever contacted.

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

# Make the bucket ARN known at plan so the policy JSON can be inspected.
override_resource {
  target = aws_s3_bucket.maildummy
  values = { arn = "arn:aws:s3:::example-maildummy" }
}

variables {
  maildummy_domain      = "maildummy.example.com"
  maildummy_subdomain   = "maildummy"
  s3_bucket_name        = "example-maildummy"
  sns_topic_name        = "example-maildummy"
  receipt_rule_set_name = "example-rule-set"
  receipt_rule_name     = "example-rule"
}

run "acls_are_disabled" {
  command = plan

  assert {
    condition     = aws_s3_bucket_ownership_controls.maildummy.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs must be disabled with BucketOwnerEnforced"
  }

  assert {
    condition     = !strcontains(aws_s3_bucket_policy.maildummy.policy, "PutObjectAcl")
    error_message = "the bucket policy must not grant s3:PutObjectAcl; with ACLs disabled SES only needs s3:PutObject"
  }
}

run "ses_may_only_put_under_the_raw_prefix" {
  command = plan

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.maildummy.policy).Statement[0].Sid == "AllowSESPuts" && jsondecode(aws_s3_bucket_policy.maildummy.policy).Statement[0].Action == "s3:PutObject"
    error_message = "SES must be granted exactly s3:PutObject"
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.maildummy.policy).Statement[0].Resource == "arn:aws:s3:::example-maildummy/raw/*"
    error_message = "the SES grant must be scoped to the raw/ prefix the receipt rule writes to"
  }

  assert {
    condition     = [for a in aws_ses_receipt_rule.maildummy.s3_action : a.object_key_prefix] == ["raw/"]
    error_message = "the receipt rule must write under raw/, matching the policy"
  }
}

run "plain_http_is_denied" {
  command = plan

  assert {
    condition = length([
      for s in jsondecode(aws_s3_bucket_policy.maildummy.policy).Statement : s
      if s.Effect == "Deny" && s.Principal == "*" && s.Action == "s3:*" && s.Condition.Bool["aws:SecureTransport"] == "false"
    ]) == 1
    error_message = "the bucket policy must deny every principal when aws:SecureTransport is false"
  }

  assert {
    condition = toset([
      for s in jsondecode(aws_s3_bucket_policy.maildummy.policy).Statement : s.Resource
      if s.Sid == "DenyInsecureTransport"
    ][0]) == toset(["arn:aws:s3:::example-maildummy", "arn:aws:s3:::example-maildummy/*"])
    error_message = "the TLS deny must cover the bucket and its objects"
  }
}
