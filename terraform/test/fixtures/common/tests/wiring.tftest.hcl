# Plans the fixture root fully offline: real providers (so attributes such as
# the DKIM tokens stay unknown at plan, as on a first apply), fake credentials,
# every API endpoint pointed at a closed localhost port, and the only data
# source overridden. No cloud API is ever contacted.

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

provider "cloudflare" {
  api_token = "0000000000000000000000000000000000000000"
  base_url  = "http://127.0.0.1:1/client/v4"
}

override_data {
  target = module.maildummy_route53.data.aws_caller_identity.current
  values = { account_id = "111122223333" }
}

override_data {
  target = module.maildummy.data.aws_caller_identity.current
  values = { account_id = "111122223333" }
}

run "cloudflare_submodule_plans_dkim_with_unknown_tokens" {
  command = plan

  assert {
    condition     = length(module.maildummy_cloudflare.record_ids.dkim) == 3
    error_message = "the Cloudflare submodule must plan three DKIM records before SES has issued the tokens"
  }

  assert {
    condition     = module.maildummy.dns_records.mx.name == "maildummy.example.net"
    error_message = "the MX record must be named after the maildummy domain"
  }

  assert {
    condition     = module.maildummy.dns_records.mx.value == "inbound-smtp.eu-central-1.amazonaws.com"
    error_message = "the MX record must point at the regional SES inbound endpoint"
  }
}
