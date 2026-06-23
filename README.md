# pkg-guard

Guard npm package manifests, entry points, and release workflows before publishing.

`pkg-guard` is a TypeScript CLI for npm package publishing hygiene. It audits package metadata, declared entry points, packed package contents, TypeScript declaration settings, GitHub Actions npm publishing workflows, and conservative dependency risks.

Product site: <https://jeremyaaron.github.io/pkg-guard/>

## Install

```sh
npm install -D pkg-guard
```

## Usage

```sh
npx pkg-guard check
npx pkg-guard check --json
npx pkg-guard fix --dry-run
npx pkg-guard init-release
```

`check` is read-only and exits with `1` when errors are found. Warnings do not fail the command unless promoted through strict config.

`fix` applies only conservative `package.json` metadata fixes such as `packageManager`, repository metadata, `types`, `files`, scoped package access, inferred Node engines, and low-risk `sideEffects`. Use `--dry-run` to preview changes.

`init-release` creates `.github/workflows/release.yml` for npm trusted publishing and refuses to overwrite an existing release workflow.

## Configuration

Optional config lives in `package.json`:

```json
{
  "pkgGuard": {
    "preset": "typescript-library",
    "ignore": ["dependencies.runtime-in-dev"],
    "strict": ["manifest.files-missing"]
  }
}
```

`pkg-guard` infers `cli`, `typescript-library`, or `generic` from package metadata. Configure `preset` when the inferred intent is too broad or too narrow for the package.

See [configuration](docs/configuration.md) and [check IDs](docs/checks.md).

## Docs

- [Check IDs](docs/checks.md)
- [Configuration](docs/configuration.md)
- [Release workflow generation](docs/release-workflow.md)
- [Publishing](docs/publishing.md)
- [Examples](docs/examples.md)

## Development

```sh
npm install
npm run lint
npm run typecheck
npm test
npm run build
node dist/cli/index.js check
```
