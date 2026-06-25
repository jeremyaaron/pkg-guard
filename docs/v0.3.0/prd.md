# pkg-guard v0.3.0 PRD

## Summary

`pkg-guard` v0.3.0 should make the CLI easier to adopt as a standard npm package publishing gate.

The v0.2.0 release made package intent operational through presets and expanded the guard surface across lifecycle scripts, workflows, entrypoints, pack contents, dependency metadata, and conservative fixes. The next minor should focus on making that value easy to roll out across real publisher toolchains, especially repositories with multiple publishable packages and CI workflows that need actionable output.

The central product move is workspace-aware publish readiness.

## Recommendation

Start v0.3.0 directly from the v0.2.0 baseline.

No v0.2.x patch is currently justified. The v0.2.0 package is published, the repository baseline is clean, and local verification passes. A patch release should be reserved for a confirmed v0.2.0 regression such as a broken CLI entrypoint, bad published files, high-noise false positive, or incorrect generated workflow.

The v0.3.0 theme should be:

> One publish guard for every package in the repo.

## Problems

### Workspace Repositories Are Not First-Class

Many npm publishers now maintain packages in npm, pnpm, Yarn, or Bun workspaces. `pkg-guard` currently discovers one package root from the current directory and checks that package. That is simple and correct for single-package repos, but it makes adoption harder for package sets where maintainers want one release validation command before publishing.

Without workspace support, users must write their own loops, normalize exit codes, and interpret findings package by package. That friction is enough to keep `pkg-guard` out of some release pipelines.

### CI Output Is Log-Centric

The current human and JSON reporters are useful, but CI adoption improves when findings appear where maintainers review changes: PR annotations, security views, and machine-ingested reports.

The existing JSON output should remain stable, but v0.3.0 should add at least one CI-native reporting mode so `pkg-guard` is easier to wire into hosted CI systems without custom adapters.

### Initial Adoption Requires Manual Assembly

`pkg-guard init-release` creates a trusted publishing workflow, and `pkg-guard fix` applies conservative package metadata fixes. There is no general command that helps a maintainer add `pkg-guard` to a package or workspace as a local publish gate.

New users still need to decide which scripts to add, whether to configure `pkgGuard.preset`, whether to enable strict mode, and how to preview the change. An adoption initializer would make the first successful integration faster.

### Trusted Publishing Has Moved Forward

npm trusted publishing now has provider-specific requirements and broader provider coverage than the original GitHub-only workflow generation story. npm docs currently state that trusted publishing requires npm CLI 11.5.1 or later and Node 22.14.0 or later, and supports GitHub Actions, GitLab CI/CD, and CircleCI with provider-specific OIDC configuration. Self-hosted runners are not currently supported for trusted publishing.

Reference: <https://docs.npmjs.com/trusted-publishers/>

`pkg-guard` does not need to generate every provider in v0.3.0, but its checks, docs, and generated GitHub workflow should align with current npm guidance.

## Goals

- Add workspace-aware package discovery and checking.
- Make one command able to validate every publishable package in a workspace repository.
- Preserve the single-package workflow as the default behavior.
- Skip private workspace packages by default while allowing explicit checks when requested.
- Include package name and package path in workspace findings.
- Keep `check` read-only and deterministic.
- Keep existing JSON report consumers working for single-package checks.
- Add a CI-native reporter suitable for adoption in pull requests and release workflows.
- Add an initializer that can install package scripts and `pkgGuard` config with a safe dry-run path.
- Refresh trusted publishing checks and docs against current npm guidance.
- Keep v0.3.0 focused on publish readiness, not broad vulnerability scanning.

## Non-Goals

- Replacing dedicated release tools such as Changesets, semantic-release, or release-please.
- Publishing packages directly.
- Executing arbitrary package scripts during analysis.
- Full shell parsing.
- Full Node module resolution.
- Vulnerability scanning or lockfile audit replacement.
- Generating every CI provider workflow.
- Supporting non-npm registries as a first-class target.
- Rewriting complex workspace manifests.
- Breaking the existing `check`, `fix`, or `init-release` command contracts.

## Target Users

Primary:

- Maintainers of npm workspace repositories with multiple publishable packages.
- TypeScript library and CLI package maintainers who want one prepublish gate in CI.
- Template authors who want a reusable package publishing hygiene check.

Secondary:

- Single-package maintainers adopting `pkg-guard` for the first time.
- Maintainers migrating from token-based npm publishing to trusted publishing.
- Teams that need machine-readable publish readiness reports.

## Product Behavior

### Workspace Check

Add workspace-aware checking through explicit CLI flags. The default `pkg-guard check` behavior should remain single-package discovery from the current working directory.

Proposed commands:

```sh
pkg-guard check --workspaces
pkg-guard check --workspace packages/foo
pkg-guard check --workspace @scope/name
```

`--workspaces` should:

- discover workspace packages from the root package manager metadata;
- check each publishable package independently;
- skip `private: true` packages by default;
- include package name and relative path in human output;
- include package name, relative path, and root path in JSON output;
- return a failing exit code if any checked package has an error.

`--workspace <selector>` should check only matching workspace packages. Selectors should support at least package name and relative path.

Private package handling should be conservative:

- Single-package `pkg-guard check` should continue checking the current package, including private-package-specific findings.
- Workspace batch mode should skip private packages by default to avoid noise in app/tooling workspaces.
- A follow-up option such as `--include-private` may be added if the implementation plan confirms it is needed for common workflows.

### Workspace Fix

`pkg-guard fix --workspaces --dry-run` should preview fix plans across publishable workspace packages.

Applying fixes across multiple packages is useful but higher risk. v0.3.0 should support it only if the design can keep output clear and operations scoped. A reasonable minimum is:

```sh
pkg-guard fix --workspaces --dry-run
pkg-guard fix --workspace packages/foo
```

If batch apply is included, changed files must be grouped by package in both human and JSON output.

### CI-Native Reporting

Add one CI-native reporter in v0.3.0. Preferred option:

```sh
pkg-guard check --format sarif
```

SARIF gives `pkg-guard` a standard report format for code scanning and CI ingestion without making the CLI GitHub-only.

Acceptable fallback if SARIF is too large for v0.3.0:

```sh
pkg-guard check --github
```

GitHub annotation output is less portable but easier to implement and valuable for the most common release workflow target already supported by `init-release`.

The selected reporter must support workspace results.

### Adoption Initializer

Add a general initializer:

```sh
pkg-guard init
pkg-guard init --dry-run
pkg-guard init --workspaces --dry-run
```

The initializer should make conservative changes only:

- add or update `pkgGuard.preset` when intent can be inferred;
- add a package script such as `pkg:check`;
- optionally add a root workspace script for batch checking;
- avoid overwriting existing scripts with different commands unless explicitly allowed in a future option;
- show a dry-run plan before writing.

The command should not generate a release workflow by default. It may recommend `pkg-guard init-release` when no release workflow is present.

### Trusted Publishing Refresh

Update workflow checks and docs so they match current npm trusted publishing guidance.

In scope:

- Ensure generated GitHub release workflows use Node and npm versions compatible with current trusted publishing requirements.
- Warn when trusted publishing workflows appear to rely on unsupported self-hosted runners.
- Keep warning on long-lived npm tokens in publish workflows.
- Document GitHub, GitLab, and CircleCI trusted publishing support.
- Clarify that `init-release` remains GitHub Actions generation in v0.3.0.

Potential check additions:

- `workflow.npm-version-too-old`
- `workflow.node-version-too-old`
- `workflow.trusted-publishing-provider-unsupported`

Exact IDs should be finalized in the technical design.

## Functional Requirements

### Workspace Discovery

- Read workspaces from npm-compatible package metadata:
  - `package.json` `workspaces` array.
  - `package.json` `workspaces.packages`.
- Support pnpm workspace manifests when `pnpm-workspace.yaml` is present.
- Ignore missing workspace matches without crashing.
- Ignore `node_modules`.
- Avoid following package roots outside the repository root.
- Deduplicate packages reached through overlapping workspace globs.
- Treat a workspace package as checkable only when it has a readable `package.json`.

Yarn and Bun should be supported where they use package.json workspace metadata. Any provider-specific gaps should be documented.

### Batch Reporting

- Human output should group findings by package.
- A clean workspace run should clearly report the number of packages checked.
- JSON output should remain schema-versioned.
- Single-package JSON output should remain compatible unless a schema version bump is explicitly documented.
- Workspace JSON output may use a new top-level shape if needed, but each finding should retain stable IDs, severity, title, message, file, path, suggestion, and fixability fields where applicable.

### Exit Codes

- Preserve current exit code behavior for single-package runs.
- In workspace mode:
  - return `0` when all checked packages have no errors;
  - return `1` when any checked package has an error;
  - return `2` for CLI usage errors;
  - return `3` for unexpected internal failures.
- Warnings should not fail the command unless promoted through strict config or strict CLI behavior.

### Configuration

- Package-level `pkgGuard` config should apply to that package.
- Root-level config should not silently override package-level config unless a clear inheritance model is designed.
- If root workspace policy is added, it must be explicit and documented.
- Existing `ignore`, `strict`, and `preset` behavior must continue working for single packages.

### Safety

- `check` must not mutate files.
- `fix --dry-run` must not mutate files.
- `init --dry-run` must not mutate files.
- Workspace traversal must stay within the repository root.
- Commands must not execute package lifecycle scripts during analysis.
- `npm pack` inspection should continue using `--ignore-scripts`.

## Acceptance Criteria

- `pkg-guard check` preserves v0.2.0 single-package behavior.
- `pkg-guard check --workspaces` discovers npm package.json workspaces and checks publishable packages.
- `pkg-guard check --workspaces` skips `private: true` workspace packages by default.
- Workspace findings identify the package name and relative package path.
- Workspace mode aggregates exit codes correctly.
- Workspace mode handles at least npm package workspaces and pnpm workspace YAML.
- Workspace mode does not traverse outside the repository root.
- Workspace JSON output is documented and tested.
- The selected CI reporter works for single-package and workspace runs.
- `pkg-guard init --dry-run` shows intended script/config changes without writing.
- `pkg-guard init` writes only conservative package metadata and script changes.
- Trusted publishing docs are updated for current npm requirements and provider support.
- Generated GitHub release workflow remains valid and aligns with current npm trusted publishing requirements.
- Full verification passes:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `node dist/cli/index.js check`
  - `node dist/cli/index.js check --workspaces` where applicable in fixture or self-check coverage

## Release Notes Draft

`pkg-guard` v0.3.0 adds workspace-aware publish readiness checks so one command can validate every publishable package in a repository. It also improves CI adoption with a native report format, adds a safe initializer for first-time setup, and refreshes trusted publishing guidance for current npm requirements.
