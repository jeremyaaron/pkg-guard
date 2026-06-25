# pkg-guard

Guard npm package manifests, entry points, and release workflows before publishing.

`pkg-guard` is a TypeScript CLI for npm package publishing hygiene. It audits package metadata, declared entry points, packed package contents, TypeScript declaration settings, GitHub Actions npm publishing workflows, conservative dependency risks, and publishable workspace packages.

Product site: <https://jeremyaaron.github.io/pkg-guard/>

## Install

```sh
npm install -D pkg-guard
```

## Usage

```sh
npx pkg-guard check
npx pkg-guard check --format json
npx pkg-guard check --format sarif
npx pkg-guard fix --dry-run
npx pkg-guard init --dry-run
npx pkg-guard init-release
```

`check` is read-only and exits with `1` when errors are found. Warnings do not fail the command unless promoted through strict config.

`fix` applies only conservative `package.json` metadata fixes such as `packageManager`, repository metadata, `types`, `files`, scoped package access, inferred Node engines, and low-risk `sideEffects`. Use `--dry-run` to preview changes.

`init` adds a local `pkg:check` script and conservative `pkgGuard` config when it can infer package intent safely. Use `--dry-run` to preview changes.

`init-release` creates `.github/workflows/release.yml` for npm trusted publishing and refuses to overwrite an existing release workflow.

## Workspaces

Run checks across publishable workspace packages:

```sh
npx pkg-guard check --workspaces
npx pkg-guard check --workspaces --format sarif > pkg-guard.sarif
npx pkg-guard fix --workspaces --dry-run
npx pkg-guard init --workspaces
```

Select one package by package name or repository-relative path:

```sh
npx pkg-guard check --workspace @scope/pkg
npx pkg-guard fix --workspace packages/pkg
```

Workspace mode reads `package.json` `workspaces`, `package.json` `workspaces.packages`, and `pnpm-workspace.yaml` `packages`. It skips packages with `private: true` by default. Add `--include-private` to include private packages and `--include-root` to include the workspace root when using `--workspaces`; a private root also needs `--include-private`.

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

In workspace mode, each package uses its own `package.json` `pkgGuard` config. Root config is not silently inherited by workspace packages.

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
