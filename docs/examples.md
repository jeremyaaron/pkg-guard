# Examples

## Add a Local Check Script

```json
{
  "scripts": {
    "pkg:check": "pkg-guard check"
  }
}
```

Run it before publishing:

```sh
npm run build
npm run pkg:check
```

Or let `pkg-guard` add the script when it can do so safely:

```sh
npx pkg-guard init --dry-run
npx pkg-guard init
```

For a workspace root, initialize a workspace-wide check script:

```sh
npx pkg-guard init --workspaces
```

## Single-Package CI

Run the built CLI against the package:

```yaml
- run: npm ci
- run: npm run lint
- run: npm run typecheck
- run: npm test
- run: npm run build
- run: node dist/cli/index.js check
```

For downstream projects that install `pkg-guard` from npm:

```yaml
- run: npm ci
- run: npm run build --if-present
- run: npx pkg-guard check
```

## Workspace CI

Run every publishable workspace package from the repository root:

```yaml
- run: npm ci
- run: npm run build --if-present
- run: npx pkg-guard check --workspaces
```

Workspace mode reads `package.json` `workspaces`, `package.json` `workspaces.packages`, and `pnpm-workspace.yaml` `packages`. Packages with `private: true` are skipped by default:

```sh
npx pkg-guard check --workspaces
```

Include private packages when you want to audit internal packages too:

```sh
npx pkg-guard check --workspaces --include-private
```

Include the root package only when it should also be checked:

```sh
npx pkg-guard check --workspaces --include-root
```

For a private root package, include both flags:

```sh
npx pkg-guard check --workspaces --include-root --include-private
```

Select one package by name or path:

```sh
npx pkg-guard check --workspace @scope/pkg
npx pkg-guard check --workspace packages/pkg
```

## pnpm Workspace Dependencies

pnpm rewrites `workspace:` dependency ranges during `pnpm pack` and `pnpm publish` when the range points to a local workspace package. Use workspace mode from the root so `pkg-guard` can inspect the workspace graph before deciding whether `dependencies.workspace-range` is publish-safe:

```yaml
- run: corepack enable
- run: pnpm install --frozen-lockfile
- run: pnpm run build --if-present
- run: npx pkg-guard check --workspaces
```

This suppresses `dependencies.workspace-range` only for publishable local workspace targets in a pnpm root when no obvious npm publish workflow is present. The finding still appears if the target package is missing, the target is private and would appear in published dependency metadata, or a root or package-local workflow publishes with `npm publish` or `npx semantic-release`.

## SARIF in CI

`--format sarif` is available for `check` in both single-package and workspace modes:

```yaml
- run: npm ci
- run: npm run build --if-present
- run: npx pkg-guard check --format sarif > pkg-guard.sarif
```

For a workspace:

```yaml
- run: npm ci
- run: npm run build --if-present
- run: npx pkg-guard check --workspaces --format sarif > pkg-guard.sarif
```

The SARIF report uses package-relative paths for single-package checks and prefixes workspace package findings with the package path.

## Suppress a Conservative Warning

```json
{
  "pkgGuard": {
    "ignore": ["dependencies.runtime-in-dev"]
  }
}
```

In workspace mode, this config applies only to the package that contains it. Root `pkgGuard` config is not inherited by workspace packages.

For intentional install-time lifecycle scripts, suppress the stable check ID after documenting why the script is needed in the package:

```json
{
  "pkgGuard": {
    "ignore": ["lifecycle.install-script"]
  }
}
```

## Override Package Intent

`pkg-guard` infers a preset from package metadata. Use `pkgGuard.preset` when a package should be treated as a CLI, TypeScript library, or generic package explicitly:

```json
{
  "pkgGuard": {
    "preset": "cli"
  }
}
```

## Preview Metadata Fixes

```sh
npx pkg-guard fix --dry-run
```

`fix` only writes conservative `package.json` metadata changes, such as detected package manager, repository metadata, `types`, `files`, scoped package access, inferred Node engines, and low-risk `sideEffects`.

Preview fixes across publishable workspace packages:

```sh
npx pkg-guard fix --workspaces --dry-run
```

Apply fixes to one selected workspace package:

```sh
npx pkg-guard fix --workspace packages/pkg
```

## Promote a Warning in Strict Mode

```json
{
  "pkgGuard": {
    "strict": ["manifest.files-missing"]
  }
}
```

```sh
npx pkg-guard check --strict
```

## Generate a Release Workflow

```sh
npx pkg-guard init-release
```

After reviewing the generated `.github/workflows/release.yml`, configure npm trusted publishing for the package on npmjs.com.
