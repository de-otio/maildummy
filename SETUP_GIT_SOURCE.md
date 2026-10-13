# Setting Up Git Source for Maildummy Module

This guide will help you set up the maildummy module to be referenced via git source in your Terraform configurations.

## Step 1: Initialize Git Repository (if not already done)

```bash
cd path/to/maildummy

# Check if git is initialized
git status

# If not initialized, run:
git init
```

## Step 2: Create Initial Commit

```bash
cd path/to/maildummy

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Maildummy infrastructure module"
```

## Step 3: Push to Git Remote

### Option A: GitHub

```bash
# Create a new repository on GitHub (e.g., github.com/de-otio/maildummy)
# Then add the remote:
git remote add origin https://github.com/de-otio/maildummy.git
git branch -M main
git push -u origin main
```

### Option B: GitLab

```bash
# Create a new repository on GitLab
# Then add the remote:
git remote add origin https://gitlab.com/<your-group>/maildummy.git
git branch -M main
git push -u origin main
```

### Option C: Other Git Hosting

```bash
# Add your git remote URL
git remote add origin <your-git-url>
git branch -M main
git push -u origin main
```

## Step 4: Update Terraform Configuration

Once the repository is pushed, update `environments/dev/terraform/main.tf`:

```hcl
module "ses_maildummy" {
  source = "git::https://github.com/de-otio/maildummy.git//terraform/modules/ses_maildummy?ref=main"

  # ... rest of configuration
}
```

If you host your own copy of the repository, replace the URL with your own.

## Step 5: Pin a Tag or Commit (Recommended)

Terraform module releases are tagged `tf-v<version>` (CDK releases use `cdk-v<version>`, which also triggers the npm publish workflow). Reference a tag in Terraform:

```hcl
source = "git::https://github.com/de-otio/maildummy.git//terraform/modules/ses_maildummy?ref=tf-v<version>"
```

For a stronger guarantee, pin the full 40-character commit SHA instead (`?ref=<full-commit-sha>`). A tag can be moved or re-created; a commit SHA cannot.

## Benefits

✅ No fragile file paths  
✅ Works with Terraform Cloud  
✅ Version control and tagging  
✅ Easy to share across projects  
✅ No additional tools required

## Troubleshooting

### Terraform can't find the module

1. Verify the git URL is correct
2. Ensure the repository is accessible (public or you have access)
3. Check that the path `//terraform/modules/ses_maildummy` is correct
4. Verify the branch/tag exists

### Authentication issues

If using a private repository, you may need to configure git credentials or use SSH:

```hcl
source = "git::git@github.com:de-otio/maildummy.git//terraform/modules/ses_maildummy?ref=main"
```

Or use Terraform's built-in credential helpers for HTTPS.
