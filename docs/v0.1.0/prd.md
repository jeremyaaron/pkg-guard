# pkg-guard PRD

## Summary

`pkg-guard` is a command-line tool that helps JavaScript and TypeScript package authors publish safer, cleaner, and more portable npm packages.

The first version focuses on TypeScript libraries published from GitHub Actions to npm. It audits `package.json`, TypeScript build output, package entry points, dependency declarations, and release workflow configuration. It explains problems in plain language and can apply low-risk fixes automatically.

The product should feel like a practical maintainer assistant: opinionated enough to be useful, transparent enough to trust, and small enough to add to any project as a dev dependency.

## Package Identity

The project publishes as the unscoped npm package `pkg-guard` and exposes the binary `pkg-guard`.

The unscoped name is preferred because this is a general-purpose OSS tool intended to be added directly to `package.json` scripts and run through `npx`. A personal scope would be useful if the unscoped name were unavailable, if the package were experimental under a personal namespace, or if the project immediately needed a family of related packages. None of those conditions apply to the MVP.

If the project later grows into multiple packages, use an organization scope such as `@pkg-guard/*` for internal packages or official integrations while keeping the primary CLI package and binary as `pkg-guard`.

## Problem

Publishing a package to npm is deceptively easy. Publishing one that is correct across modern JavaScript runtimes, bundlers, package managers, and supply-chain expectations is not.

Common failure modes include:

- Broken or incomplete `exports` maps.
- Type declarations that do not match runtime entry points.
- Confusing ESM/CommonJS behavior.
- Missing `packageManager`, `engines`, `files`, or `sideEffects` metadata.
- Accidentally publishing source, tests, secrets, build caches, or oversized artifacts.
- Dependencies declared in the wrong section.
- Unsafe lifecycle scripts.
- Release workflows that use long-lived npm tokens instead of trusted publishing.
- No pre-publish validation of packed files.
- Poor compatibility with npm, pnpm, Yarn, Bun, Node, bundlers, and edge runtimes.

Existing tools solve pieces of this problem, but maintainers still have to know which tools to combine and how to interpret their output. `pkg-guard` should provide one focused command that catches the highest-value mistakes before a package is published.

## Goals

- Make npm package publishing safer for small and medium JavaScript/TypeScript projects.
- Give maintainers actionable checks that explain both the issue and the fix.
- Provide automatic fixes for deterministic, low-risk package metadata problems.
- Support secure release setup through GitHub Actions and npm trusted publishing.
- Establish a clean architecture for adding checks over time.
- Keep the default experience fast enough to run locally and in CI.

## Non-Goals

- Replacing npm, pnpm, Yarn, Bun, Changesets, semantic-release, or Renovate.
- Becoming a general-purpose linter for all JavaScript code.
- Guaranteeing that a package is secure.
- Auditing transitive dependency vulnerabilities in depth.
- Supporting every package manager and registry on day one.
- Generating application deployment workflows.
- Creating a new package manifest format.

## Target Users

### Primary User

An independent maintainer or small team publishing a TypeScript library to npm from GitHub.

They know enough to ship code, but they do not want to memorize every modern packaging edge case.

### Secondary Users

- Web app developers extracting internal utilities into reusable packages.
- Open source maintainers modernizing older packages.
- Companies publishing internal packages to npm-compatible registries.
- Template authors who want a package-quality gate in starter repos.

## Positioning

`pkg-guard` should be positioned as a package publishing health check, not a security scanner or framework.

Suggested tagline:

> Ship npm packages with fewer manifest, type, export, and release mistakes.

## Product Principles

- Prefer specific checks over vague advice.
- Explain impact before prescribing a fix.
- Make `check` read-only by default.
- Make `fix` explicit, reviewable, and conservative.
- Support CI output without making local output miserable.
- Start narrow, then earn broader coverage.
- Treat package security as practical risk reduction, not theater.

## MVP Scope

The MVP targets:

- TypeScript npm libraries.
- Single-package repositories.
- GitHub-hosted source.
- GitHub Actions-based npm publishing.
- npm registry publishing.
- Node.js runtime packages.

The MVP exposes three commands:

```sh
pkg-guard check
pkg-guard fix
pkg-guard init-release
```

### `pkg-guard check`

Runs all applicable checks and exits non-zero when blocking issues are found.

Expected behavior:

- Detect the project root.
- Read `package.json`.
- Detect package manager from lockfile and `packageManager`.
- Detect TypeScript config when present.
- Detect built package contents using `npm pack --dry-run --json --ignore-scripts` or an equivalent package-manager-aware strategy.
- Print grouped findings with severity, rationale, and suggested fix.
- Support `--json` for CI and editor integrations.
- Support `--strict` to upgrade selected warnings to errors.

Example:

```sh
$ pkg-guard check

pkg-guard found 3 issues

error exports.types-missing
  package.json exports "./dist/index.js" but no matching type declaration is exposed.

  Impact:
    TypeScript consumers may resolve this package as any or fail to import it.

  Fix:
    Add a "types" condition or top-level "types" field that points at the generated .d.ts file.

warning release.trusted-publishing-missing
  This package appears to publish from GitHub Actions but does not use npm trusted publishing.

  Fix:
    Configure npm trusted publishing and remove long-lived npm tokens from the release workflow.
```

### `pkg-guard fix`

Applies deterministic fixes and prints a summary of changed files.

`fix` writes conservative changes by default because invoking a fix command is already an explicit action. It must support `--dry-run` to preview planned changes without writing, and it should print enough file-level detail for maintainers to review the resulting diff.

Initial auto-fixes:

- Add `packageManager` when a lockfile clearly identifies one.
- Add `files` when safe package output can be inferred.
- Add top-level `types` when `dist/index.d.ts` exists and no conflicting type config is present.
- Add `sideEffects: false` only when the package appears to be a pure library and no known side-effect files are present.
- Normalize simple `repository`, `bugs`, and `homepage` metadata when GitHub remote origin is available.
- Add missing `engines.node` only when project config clearly implies a minimum version.

`fix` must not:

- Rewrite complex `exports` maps without confirmation.
- Remove scripts.
- Delete files.
- Change dependency versions.
- Convert CJS to ESM or ESM to CJS.
- Modify release workflow credentials destructively.

### `pkg-guard init-release`

Generates or updates a GitHub Actions workflow for npm publishing.

Initial behavior:

- Creates `.github/workflows/release.yml` when none exists.
- Uses npm trusted publishing-compatible permissions.
- Runs install, test, build, `pkg-guard check`, and publish.
- Uses `v*` Git tags as the default release trigger.
- Leaves clear TODO comments only where user action is required outside the repo, such as configuring trusted publishing in npm.

GitHub Releases may be supported later, but tag-triggered publishing is the MVP default because it is predictable, common for packages, and maps cleanly to npm trusted publisher configuration.

## Check Categories

### Manifest Checks

- `package.name`: present and valid.
- `package.version`: present and semver-valid for publishable packages.
- `package.private`: warn when package appears intended for publish but is private.
- `package.type`: present when module format would otherwise be ambiguous.
- `package.packageManager`: present and consistent with lockfile.
- `package.engines`: present when runtime expectations can be inferred.
- `package.license`: present and valid SPDX expression.
- `package.repository`: present and valid when Git remote is available.
- `package.files`: present or publish output explicitly reviewed.

### Entry Point Checks

- Top-level `main`, `module`, `types`, and `exports` consistency.
- `exports` targets exist on disk after build.
- Type declaration targets exist.
- No `exports` target points to source TypeScript unless intentionally configured.
- Package root import works.
- Declared subpath exports work.
- `bin` targets exist and have executable shebangs where appropriate.

### TypeScript Checks

- `declaration` output exists for published TypeScript libraries.
- `declarationMap` warning when source maps would expose unwanted source paths.
- `types` points to generated declarations, not source files.
- Build output matches package manifest.
- `tsconfig` module settings are compatible with package metadata.

### Publish Contents Checks

- `npm pack --dry-run --ignore-scripts` output does not include obvious junk:
  - `.env` files.
  - Test snapshots.
  - Coverage output.
  - Build caches.
  - Editor directories.
  - Local package manager stores.
  - Large unexpected files.
- Required runtime files are included:
  - JavaScript output.
  - Type declarations.
  - README.
  - License file when license metadata is present.

### Dependency Checks

- Runtime imports are declared in `dependencies`.
- Build-only tools are not declared in `dependencies`.
- Peer dependencies are paired with sensible `peerDependenciesMeta` when optional.
- Dependency ranges are not obviously unsafe for libraries.
- Workspace references are not accidentally published unresolved.
- Import-based dependency analysis is warning-only in the MVP unless a finding is certain, such as an unresolved workspace protocol in a published manifest.

### Lifecycle Script Checks

- Warn on `preinstall`, `install`, and `postinstall`.
- Explain publish and consumer impact of lifecycle scripts.
- Allow explicit ignore comments/config for intentional scripts.
- Error on suspicious install-time network or shell behavior only when confidently detected.

### Release Workflow Checks

- GitHub Actions workflow exists for publish, when repo appears to publish from GitHub.
- Workflow has minimal required permissions.
- Workflow uses supported Node.js setup.
- Workflow runs tests/build before publish.
- Workflow validates packed package before publish.
- Workflow avoids long-lived npm tokens when trusted publishing is available.
- Workflow does not publish on every push to a branch by default.

### Supply Chain Checks

- npm provenance/trusted publishing guidance.
- Lockfile presence for reproducible CI installs.
- Package manager consistency.
- Known risky manifest patterns.
- Optional integration points for external scanners later.

The MVP focuses on npm publishing. Other registries and package indexes may be added after the npm workflow is reliable.

## Severity Model

### Error

The package is likely broken, unsafe to publish, or misconfigured in a way that can directly affect consumers.

Examples:

- `exports` target missing.
- `types` target missing.
- `bin` target missing.
- Package includes `.env`.
- Publish workflow publishes without build output.

### Warning

The package may work, but the configuration is incomplete, risky, confusing, or not aligned with current best practice.

Examples:

- Missing `packageManager`.
- Missing `engines`.
- Missing trusted publishing.
- Missing `files`.

### Info

Useful context that does not require action.

Examples:

- Detected package manager.
- Detected module format.
- Detected publish trigger.

## Configuration

The tool should work without config.

Optional configuration can live in `package.json`:

```json
{
  "pkgGuard": {
    "preset": "typescript-library",
    "ignore": ["release.trusted-publishing-missing"],
    "strict": ["package.files-missing"]
  }
}
```

Future standalone config file support may be added if needed, but the MVP should avoid config sprawl.

## Presets

Initial preset:

- `typescript-library`

Future presets:

- `javascript-library`
- `cli`
- `react-library`
- `monorepo`
- `node-service`
- `edge-worker`

Presets should change check applicability, not hide core safety problems.

## User Experience

### CLI Output

Default output should be human-readable and grouped by severity.

Each finding should include:

- Stable check ID.
- Severity.
- Short title.
- File path when applicable.
- Explanation of impact.
- Suggested fix.
- Whether `pkg-guard fix` can handle it.

### Machine Output

`--json` should return:

```json
{
  "summary": {
    "errors": 1,
    "warnings": 2,
    "info": 3
  },
  "findings": [
    {
      "id": "exports.target-missing",
      "severity": "error",
      "title": "Export target does not exist",
      "file": "package.json",
      "path": "$.exports[\".\"].import",
      "message": "The export target ./dist/index.js does not exist.",
      "fixable": false
    }
  ]
}
```

SARIF output is intentionally deferred until the check IDs, severity model, and finding locations stabilize. JSON is the MVP integration format.

### Exit Codes

- `0`: no errors.
- `1`: one or more errors.
- `2`: invalid CLI usage or configuration.
- `3`: unexpected internal failure.

## Architecture

### Core Concepts

- `ProjectContext`: discovered files, package manager, manifest, Git info, TypeScript info, pack output.
- `Check`: pure function that receives context and returns findings.
- `Finding`: stable, structured issue with severity and optional fix metadata.
- `Fix`: explicit file mutation with previewable diff.
- `Preset`: applicability and severity policy.
- `Reporter`: human, JSON, and future SARIF output.

### Suggested Package Layout

```text
src/
  cli/
    index.ts
    commands/
      check.ts
      fix.ts
      init-release.ts
  core/
    context.ts
    findings.ts
    checks.ts
    fixes.ts
    presets.ts
  checks/
    manifest.ts
    entrypoints.ts
    typescript.ts
    pack.ts
    dependencies.ts
    lifecycle.ts
    release.ts
  reporters/
    human.ts
    json.ts
  utils/
    fs.ts
    package-manager.ts
    git.ts
```

## Technical Requirements

- Written in TypeScript.
- Distributed as an npm package with a `bin` entry.
- Runs on active Node.js LTS versions.
- Uses structured parsing for JSON and YAML.
- Avoids shell-specific behavior where possible.
- Works on macOS, Linux, and Windows.
- Has integration tests using temporary fixture projects.
- Does not require network access for `check` or `fix`.
- `init-release` may generate workflow files but should not call external APIs.

## Possible Dependencies

Prefer small, well-maintained dependencies.

Candidates:

- CLI parsing: `commander`, `cac`, or `clipanion`.
- JSON edits: `jsonc-parser` or similar AST-preserving utility.
- YAML edits: `yaml`.
- Semver validation: `semver`.
- Package manager detection: custom lightweight detection may be enough.
- Terminal formatting: `picocolors`.

Avoid taking on a large framework unless it clearly reduces implementation cost.

## MVP Acceptance Criteria

- A user can install the package and run `pkg-guard check` in a TypeScript library repo.
- The command reports missing or broken entry points with stable check IDs.
- The command inspects the package tarball contents before publish.
- The command detects missing type declarations for exported entry points.
- The command warns about missing `packageManager`.
- The command warns about release workflows that rely on long-lived npm tokens.
- `pkg-guard fix` can safely add simple missing metadata.
- `pkg-guard init-release` creates a usable GitHub Actions release workflow.
- The project has fixture-based tests for passing and failing package examples.
- CI runs typecheck, tests, lint, and package self-check.

## Roadmap

### Phase 0: Foundation

- Create TypeScript CLI package.
- Implement project discovery.
- Implement structured finding model.
- Implement human and JSON reporters.
- Add fixture test harness.

### Phase 1: MVP Checks

- Manifest checks.
- Entry point existence checks.
- Type declaration checks.
- Pack contents checks.
- Basic lifecycle script warnings.
- Basic GitHub Actions release checks.

### Phase 2: Fixes and Release Init

- Implement conservative manifest fixes.
- Implement diff preview.
- Generate release workflow.
- Add config support in `package.json`.

### Phase 3: Broader Coverage

- Add monorepo awareness.
- Add CLI package preset.
- Add React library preset.
- Add SARIF output.
- Add optional dependency import analysis.
- Add JSR and provenance guidance where applicable.

### Phase 4: Ecosystem Integrations

- GitHub Action wrapper.
- Renovate/Dependabot guidance.
- Editor integration via JSON output.
- Template repo examples.

## Product Decisions

- Package name: publish the unscoped npm package `pkg-guard`.
- Binary name: expose `pkg-guard`.
- Fix behavior: `pkg-guard fix` writes conservative changes by default and supports `--dry-run`.
- Trusted publishing scope: npm-only in the MVP.
- Release trigger: default generated workflow publishes from `v*` Git tags.
- Dependency import analysis: warning-only unless a finding is certain.
- Machine-readable output: JSON in the MVP; SARIF later.

## References

- GitHub Octoverse 2025: TypeScript became the most-used language on GitHub in August 2025.
- npm trusted publishing documentation: npm supports publishing from CI through trusted publishing instead of long-lived automation tokens.
- JavaScript Rising Stars 2025: AI SDKs, agent frameworks, browser automation, and modern frontend tooling are active growth areas, but package authors still need reliable release and manifest hygiene.
