output "record_ids" {
  description = "IDs of the Cloudflare DNS records created"
  value = {
    verification = cloudflare_dns_record.verification.id
    mx           = cloudflare_dns_record.mx.id
    dkim         = cloudflare_dns_record.dkim[*].id
  }
}
