# @de-otio/maildummy-cdk

AWS CDK construct for SES email testing infrastructure. See the [main README](../README.md) for an overview and the [CDK construct reference](../docs/cdk.md) for full usage documentation.

## Building

```bash
cd cdk
npm install
npm run build
```

This compiles TypeScript from `src/` into `lib/` (JS + declaration files).

Use `npm run watch` to recompile on changes during development.

## Publishing to npm

Releases are published from CI, not from a workstation. Bump `version` in `cdk/package.json`, merge, then create a GitHub release tagged `cdk-v<version>`. The [publish workflow](../.github/workflows/publish.yml) builds and tests that tag and stages it on npm with `npm stage publish` (Trusted Publishing, with provenance). The version goes live only after a maintainer approves it with 2FA, either on npmjs.com (package, then **Staged Packages**, then **Approve**) or with `npm stage approve <stage-id>`.

If the run for a release fails, fix the cause and stage the same tag again from the Actions tab (**Publish to npm**, then **Run workflow**, with the tag as input). A version that is already staged has to be approved or rejected (`npm stage reject <stage-id>`) before it can be staged again.

The `files` field in `package.json` ensures only `lib/**/*.js` and `lib/**/*.d.ts` are included in the published package.

## Using from git (without publishing)

`npm install github:de-otio/maildummy#<ref>` installs the repository's root package (`@de-otio/maildummy`, the Node helper), not this one, so the construct cannot be installed straight from git. Install it from npm (`npm install @de-otio/maildummy-cdk`), or build it from a checkout of the tag you want and use `npm pack` or `npm link`.
