# Shared `.eml` fixtures

Raw mails as SES would store them under `raw/`. They are shared by the Python
tests (`python/tests/`) and, later, the Jest tests for the JS helper, so keep
them free of anything but `example.com` / `example.org` addresses. Each file is
stored byte for byte (see `.gitattributes`); `latin1.eml` is not valid UTF-8 on
purpose.

| File | Recipient | Covers | Link or text a helper should find |
|---|---|---|---|
| `plus-address.eml` | `user+tag@example.com` | `+tag` in the recipient | `https://app.example.com/auth/verify?token=plus123&type=magiclink` |
| `mixed-case-recipient.eml` | `User+Tag@EXAMPLE.com` | case-insensitive recipient match | `https://app.example.com/auth/verify?token=case123` |
| `display-name-comma.eml` | `jane@example.com`, `bob@example.org` | quoted display names containing commas in `To` | `https://app.example.com/auth/verify?token=comma123` |
| `encoded-display-name-comma.eml` | `jane.encoded@example.com` | RFC 2047 display name containing a comma | `https://app.example.com/auth/verify?token=encoded123` |
| `cc-only.eml` | `cc.user@example.com` (Cc) | recipient present only in `Cc` | `https://app.example.com/auth/verify?token=cc123` |
| `quoted-printable.eml` | `qp@example.com` | quoted-printable body, soft line breaks inside the URL, `=3D` | `https://app.example.com/auth/verify?token=qp123456789012345678901234567890&type=magiclink&redirect_to=https%3A%2F%2Fapp.example.com%2Fhome` |
| `base64.eml` | `b64@example.com` | base64 body | `https://app.example.com/auth/verify?token=b64123&type=magiclink` |
| `latin1.eml` | `latin1@example.com` | `charset=iso-8859-1` with 8-bit bytes | code `café-grüße-123`; link `https://app.example.com/verify?code=latin1` |
| `unknown-charset.eml` | `unknown@example.com` | unknown declared charset must not crash | `https://app.example.com/auth/verify?token=unknown123` |
| `html-only-amp.eml` | `html@example.com` | HTML only; `&amp;` in the `href` must come back as `&` | `https://app.example.com/auth/verify?token=html123&type=magiclink&redirect_to=https://app.example.com/home` |
| `multipart-plain-preferred.eml` | `alt@example.com` | `multipart/alternative` with the HTML part first; `text/plain` wins | `https://app.example.com/plain-version?token=plain` (not the `html-version` link) |
| `multipart-html-fallback.eml` | `fallback@example.com` | `text/plain` has no link, so the HTML part is searched | `https://app.example.com/only-in-html?a=1&b=2` |
| `fragment-link.eml` | `fragment@example.com` | hash-router link with a second `#` fragment | `https://app.example.com/#/sign-in/link#otp=123456` |
| `plain-ampersand.eml` | `amp@example.com` | `&section=` in a plain-text link must not be HTML-unescaped (`&sect` is an HTML entity) | `https://app.example.com/auth/verify?token=amp123&section=2&type=magiclink` |
