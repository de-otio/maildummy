# Helper scripts

Maildummy includes scripts in Node.js and Python that retrieve magic links from the S3 bucket. Both do the same thing — pick whichever fits your stack.

## What the scripts do

1. List all objects under `raw/` in the maildummy S3 bucket
2. Sort by last-modified (most recent first)
3. Parse each MIME email and check the `To`/`Cc` headers for the target address
4. Search the email body for a URL containing a `token` query parameter
5. Print the first matching URL and exit

The URL matching tries Supabase auth links first (`*.supabase.co/auth/v1/verify?token=...`), then falls back to any URL with a `token` parameter.

## Node.js

```bash
npm install   # installs @aws-sdk/client-s3 and mailparser
node scripts/get-magic-link-from-s3.js <bucket-name> <email-address> [--region <region>]
```

Default region: `eu-central-1`.

The script also exports `getMagicLinkFromS3(bucketName, emailAddress, region)` for use as a library.

## Python

```bash
pip install boto3
python scripts/get-magic-link-from-s3.py <bucket-name> <email-address> [--region <region>]
```

Default region: `eu-central-1`.

## AWS credentials

Both scripts use the default credential chain (environment variables, `~/.aws/credentials`, instance profile, etc.). Make sure the calling identity has `s3:ListBucket` and `s3:GetObject` on the maildummy bucket.
