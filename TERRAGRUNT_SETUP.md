# Terragrunt Setup Guide

This guide explains how to use the maildummy module with Terragrunt for better module management.

## Option 1: Git Source (Recommended)

The simplest and most maintainable approach is to use Terraform's built-in git source support. Once the maildummy repository is pushed to a git remote, you can reference it directly:

```hcl
module "ses_maildummy" {
  source = "git::https://github.com/de-otio/maildummy.git//terraform/modules/ses_maildummy?ref=tf-v<version>"

  # ... rest of configuration
}
```

### Benefits:

- ✅ No additional tools required
- ✅ Works with Terraform Cloud
- ✅ Version control via git tags/branches
- ✅ No fragile file paths

### Setup Steps:

1. **Initialize git repository** (if not already done):

   ```bash
   cd path/to/maildummy
   git init
   git add .
   git commit -m "Initial commit: Maildummy infrastructure module"
   ```

2. **Push to remote**:

   ```bash
   git remote add origin https://github.com/de-otio/maildummy.git
   git push -u origin main
   ```

3. **Update main.tf** to use git source:

   ```hcl
   module "ses_maildummy" {
     source = "git::https://github.com/de-otio/maildummy.git//terraform/modules/ses_maildummy?ref=main"
     # ... rest of configuration
   }
   ```

4. **Pin a version**. Terraform module releases are tagged `tf-v<version>` (CDK releases use `cdk-v<version>`; see the repository's Tags page for what is published). Reference a tag:

   ```hcl
   source = "git::https://github.com/de-otio/maildummy.git//terraform/modules/ses_maildummy?ref=tf-v<version>"
   ```

   For a stronger guarantee, pin the full 40-character commit SHA instead (`?ref=<full-commit-sha>`): unlike a tag, a commit SHA cannot be moved. Avoid `?ref=main` outside quick experiments.

## Option 2: Terragrunt (Advanced)

Terragrunt provides additional benefits like DRY configuration and better dependency management, but adds complexity.

### Installation

```bash
# macOS
brew install terragrunt

# Or download from https://terragrunt.gruntwork.io/docs/getting-started/install/
```

### Structure

```
skybber_at/
├── terragrunt.hcl              # Root configuration
└── environments/
    └── dev/
        └── terraform/
            └── terragrunt.hcl  # Environment-specific config
```

### Usage

Instead of running `terraform` commands directly, use `terragrunt`:

```bash
# Instead of: terraform init
terragrunt init

# Instead of: terraform plan
terragrunt plan

# Instead of: terraform apply
terragrunt apply
```

### Benefits:

- ✅ DRY configuration across environments
- ✅ Better module dependency management
- ✅ Automatic backend configuration
- ✅ Works with Terraform Cloud

### Drawbacks:

- ❌ Additional tool to learn and maintain
- ❌ Slightly more complex setup
- ❌ Team needs to install terragrunt

## Recommendation

For most use cases, **Option 1 (Git Source)** is recommended because:

1. It's simpler and uses Terraform's built-in features
2. No additional tools required
3. Works seamlessly with Terraform Cloud
4. Provides version control through git tags

Use Terragrunt only if you need its advanced features like:

- Complex dependency management across multiple modules
- DRY configuration across many environments
- Advanced remote state management
