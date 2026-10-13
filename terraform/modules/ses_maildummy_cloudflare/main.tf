terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.12.0, < 6.0.0"
    }
  }
}

# Publishes the records produced by the ses_maildummy module (its dns_records
# output) in a Cloudflare zone.

resource "cloudflare_dns_record" "verification" {
  zone_id = var.zone_id
  name    = var.dns_records.verification.name
  type    = "TXT"
  content = var.dns_records.verification.value
  ttl     = var.dns_records.verification.ttl
  comment = "SES domain verification record"
}

resource "cloudflare_dns_record" "mx" {
  zone_id  = var.zone_id
  name     = var.dns_records.mx.name
  type     = "MX"
  priority = var.dns_records.mx.priority
  content  = var.dns_records.mx.value
  ttl      = var.dns_records.mx.ttl
  comment  = "MX record for SES inbound email to maildummy domain"
}

# count is the list length, which ses_maildummy keeps known at plan time even
# while the DKIM tokens themselves are still unknown.
resource "cloudflare_dns_record" "dkim" {
  count = length(var.dns_records.dkim)

  zone_id = var.zone_id
  name    = var.dns_records.dkim[count.index].name
  type    = "CNAME"
  content = var.dns_records.dkim[count.index].value
  ttl     = var.dns_records.dkim[count.index].ttl
  comment = "DKIM record for SES email identity"
}
