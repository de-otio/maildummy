variable "zone_id" {
  description = "Cloudflare zone ID that contains the maildummy domain"
  type        = string
}

variable "dns_records" {
  description = "The dns_records output of the ses_maildummy module"
  type = object({
    verification = object({
      name  = string
      type  = string
      ttl   = number
      value = string
    })
    mx = object({
      name     = string
      type     = string
      ttl      = number
      priority = number
      value    = string
    })
    dkim = list(object({
      name  = string
      type  = string
      ttl   = number
      value = string
    }))
  })
}
