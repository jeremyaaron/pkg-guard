# Release Workflow

`pkg-guard init-release` creates `.github/workflows/release.yml` for npm publishing from GitHub Actions.

```sh
npx pkg-guard init-release
```

The command refuses to overwrite an existing release workflow.

The command also refuses to create a publish workflow when `package.json` has `private: true`.

## Generated Behavior

The workflow:

- publishes from `v*` Git tags
- grants `id-token: write`
- uses Node `24`
- installs dependencies with the detected package manager
- runs tests and build scripts when present
- runs `npx pkg-guard check`
- publishes with an npm command selected from package metadata

Publishing still requires npm-side trusted publisher configuration for the package on npmjs.com. Use:

- Provider: GitHub Actions
- Workflow filename: `release.yml`
- Trigger: `v*` Git tags

## Package Managers

Dependency installation is selected from `packageManager` and lockfiles:

| Manager | Install step |
| --- | --- |
| npm | `npm ci` |
| pnpm | `corepack enable` then `pnpm install --frozen-lockfile` |
| Yarn 1 | `corepack enable` then `yarn install --frozen-lockfile` |
| modern Yarn | `corepack enable` then `yarn install --immutable` |
| Bun | `oven-sh/setup-bun@v2` then `bun install --frozen-lockfile` |

## Publish Command

The publish step always uses the npm CLI because npm trusted publishing is tied to npm publishing, but the command changes based on package metadata:

| Package metadata | Publish step |
| --- | --- |
| Unscoped package | `npm publish` |
| Scoped package without `publishConfig.access` | `npm publish --access public` |
| `publishConfig.access: "public"` | `npm publish --access public` |
| `publishConfig.access: "restricted"` | `npm publish --access restricted` |
