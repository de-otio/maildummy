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

```bash
npm run build
npm publish --access public
```

The `prepublishOnly` script runs the build automatically, so `npm publish` alone is sufficient.

The `files` field in `package.json` ensures only `lib/**/*.js` and `lib/**/*.d.ts` are included in the published package.

## Using from git (without publishing)

`npm install github:de-otio/maildummy#<ref>` installs the repository's root package (`@de-otio/maildummy`, the Node helper), not this one, so the construct cannot be installed straight from git. Install it from npm (`npm install @de-otio/maildummy-cdk`), or build it from a checkout of the tag you want and use `npm pack` or `npm link`.
