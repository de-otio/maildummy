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

Consumers can install directly from the repository:

```bash
npm install github:your-org/maildummy#main
```

Since `lib/` is not committed, consumers installing from git need to build after install. Add a `prepare` script if you want this to happen automatically:

```json
"scripts": {
  "prepare": "npm run build"
}
```
