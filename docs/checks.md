# Check IDs

Findings use stable IDs so they can be referenced in config, CI logs, and docs. Suppress a finding with `pkgGuard.ignore` or a one-off CLI flag:

```sh
npx pkg-guard check --ignore dependencies.runtime-in-dev
```

## Project and Config

| ID | Default | Rationale |
| --- | --- | --- |
| `project.package-json-missing` | error | `pkg-guard` must run inside a package tree. |
| `project.package-json-invalid` | error | Invalid JSON prevents reliable analysis. |
| `project.package-manager-unknown` | warning | Unknown package managers may produce incorrect install or release guidance. |
| `project.multiple-lockfiles` | warning | Multiple lockfiles often indicate package manager drift. |
| `config.invalid` | error | Invalid `pkgGuard` config makes suppression and strictness ambiguous. |
| `pack.inspect-failed` | warning | Package contents could not be inspected with `npm pack --dry-run --json --ignore-scripts`. |

## Manifest

| ID | Default | Rationale |
| --- | --- | --- |
| `manifest.name-missing` | error | Publishable packages need a name. |
| `manifest.name-invalid` | error | Invalid names cannot be published or consumed reliably. |
| `manifest.version-missing` | error | Publishable packages need a semver version. |
| `manifest.version-invalid` | error | npm expects semver-valid versions. |
| `manifest.package-manager-missing` | warning | `packageManager` improves reproducibility across local and CI installs. |
| `manifest.package-manager-conflict` | warning | Lockfile and manifest package manager disagreement can break installs. |
| `manifest.license-missing` | warning | Consumers need clear reuse terms. |
| `manifest.license-invalid` | warning | License metadata should be SPDX-valid or `UNLICENSED`. |
| `manifest.repository-missing` | warning | Repository metadata improves package traceability. |
| `manifest.files-missing` | warning | Unconstrained packlists can publish unintended files. |
| `manifest.types-missing` | warning | Generated declarations should be exposed through package type metadata. |
| `manifest.publish-access-missing` | warning | Scoped packages should declare npm publish access explicitly. |
| `manifest.engines-node-missing` | warning | Runtime Node support should be exposed when it can be inferred safely. |
| `manifest.private-publishable` | warning | `private: true` conflicts with publish-oriented metadata. |

## Entry Points

| ID | Default | Rationale |
| --- | --- | --- |
| `entrypoint.target-missing` | error | Declared runtime, type, or bin targets must exist. |
| `entrypoint.target-escapes-package` | error | Entry targets must not escape the package root. |
| `entrypoint.bin-shebang-missing` | error | Binary entry files need a shebang to execute correctly. |
| `entrypoint.unsupported-target` | warning | Complex entrypoint shapes are not fully validated yet. |

## Pack Contents

| ID | Default | Rationale |
| --- | --- | --- |
| `pack.sensitive-file-included` | error | Sensitive files such as `.env` must not be published. |
| `pack.junk-file-included` | warning | Cache, coverage, and snapshot files usually do not belong in packages. |
| `pack.readme-missing` | warning | npm consumers should receive package documentation. |
| `pack.license-file-missing` | warning | License metadata should be paired with license text. |
| `pack.entrypoint-missing` | error | Declared targets must be included in the actual tarball. |
| `pack.unsupported-target` | warning | Some entrypoint shapes cannot yet be checked against pack output. |

## TypeScript

| ID | Default | Rationale |
| --- | --- | --- |
| `typescript.tsconfig-invalid` | warning | Invalid `tsconfig.json` prevents TypeScript-specific analysis. |
| `typescript.extends-unresolved` | warning | Extended configs are not resolved yet, so findings are conservative. |
| `typescript.types-source-file` | warning | `types` should usually point at generated `.d.ts` output. |
| `typescript.declaration-missing` | warning | TypeScript libraries should publish declarations. |
| `typescript.declaration-map-enabled` | warning | Declaration maps may expose source layout or local paths. |
| `typescript.outdir-mismatch` | warning | Runtime entrypoints should normally point at generated output. |

## Lifecycle Scripts

| ID | Default | Rationale |
| --- | --- | --- |
| `lifecycle.install-script` | warning | Install-time lifecycle scripts run on consumer machines and should be intentional. |
| `lifecycle.suspicious-install-script` | error | Install-time network, credential, or destructive shell behavior is risky for published packages. |

## Workflows

Workflow validation recognizes direct GitHub Actions `run:` commands and validation commands reached through package scripts such as `npm run verify:release`, `pnpm run verify:release`, `yarn verify:release`, and `bun run verify:release`.

| ID | Default | Rationale |
| --- | --- | --- |
| `workflow.yaml-invalid` | warning | Invalid workflow YAML cannot be analyzed. |
| `workflow.long-lived-npm-token` | warning | npm trusted publishing avoids long-lived npm automation tokens. |
| `workflow.id-token-permission-missing` | warning | Trusted publishing requires GitHub Actions OIDC permission. |
| `workflow.branch-push-publish` | error | Publishing on ordinary branch pushes is risky. |
| `workflow.self-hosted-trusted-publishing` | warning | Self-hosted runners need extra trust review when used with npm trusted publishing. |
| `workflow.publish-access-missing` | warning | Scoped packages should publish with explicit npm access. |
| `workflow.publish-access-mismatch` | warning | Publish workflow access should match `publishConfig.access` when configured. |
| `workflow.install-step-missing` | warning | Publish workflows should install dependencies before publishing. |
| `workflow.test-step-missing` | warning | Publish workflows should run tests before publishing. |
| `workflow.build-step-missing` | warning | Publish workflows should build before publishing. |
| `workflow.package-validation-missing` | warning | Publish workflows should validate package contents before publishing. |

## Dependencies

| ID | Default | Rationale |
| --- | --- | --- |
| `dependencies.workspace-range` | error | `workspace:` ranges should not leak into published manifests. |
| `dependencies.runtime-in-dev` | warning | Known runtime libraries declared only in `devDependencies` may break consumers. |
| `dependencies.optional-peer-metadata-missing` | warning | Optional peers should be marked in `peerDependenciesMeta`. |
| `dependencies.range-too-broad` | warning | Broad dependency ranges are risky for published libraries. |
