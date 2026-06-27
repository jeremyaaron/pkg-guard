# pkg-guard v0.3.2 Implementation Plan

## Purpose

This patch refines `dependencies.workspace-range` for pnpm workspaces without weakening publish safety. The work should stay focused on issue #11 and avoid turning into a broader release-orchestration feature.

The implementation should preserve single-package behavior, keep the existing finding ID, and make workspace-mode checks precise enough to avoid blocking valid pnpm local workspace dependencies.

## Phase 0: Baseline

Goal: confirm the current v0.3.1 state before implementation.

Scope:

- Run focused dependency and batch tests.
- Run typecheck.
- Confirm issue #11 is still open and mapped to the v0.3.2 PRD/design.

Suggested commands:

```sh
npm test -- tests/dependencies.test.ts tests/batch.test.ts tests/cli-run.test.ts
npm run typecheck
```

Acceptance criteria:

- Existing focused tests pass before production edits.
- Baseline status is recorded in this file.

Status:

- Completed on 2026-06-26.
- `npm test -- tests/dependencies.test.ts tests/batch.test.ts tests/cli-run.test.ts` passed: 36 tests across 3 test files.
- `npm run typecheck` passed.
- Confirmed issue #11 is open: `dependencies.workspace-range` should account for pnpm workspace publish semantics.

## Phase 1: Workspace Publish Context Model

Goal: create the narrow data model needed by dependency checks.

Scope:

- Add optional workspace context types to `src/core/context.ts`:
  - `WorkspacePackageContext`
  - `WorkspacePackageMetadata`
  - `WorkspacePublishPath`
- Add a batch-level workspace context type in `src/core/batch.ts` or `src/core/workspaces.ts`.
- Keep `ProjectContext.workspace` optional.
- Do not change check behavior yet.

Out of scope:

- Dependency severity changes.
- Publish-path detection.
- Reporter schema changes.

Acceptance criteria:

- Existing single-package checks still compile and behave the same.
- Batch code can carry workspace metadata without applying it yet.
- Typecheck passes.

Suggested commands:

```sh
npm run typecheck
npm test -- tests/batch.test.ts
```

Status:

- Completed on 2026-06-26.
- Added optional `ProjectContext.workspace`.
- Added `WorkspacePackageContext`, `WorkspacePackageMetadata`, and `WorkspacePublishPath` to `src/core/context.ts`.
- Added `WorkspaceCheckContext` and optional `BatchCheckOptions.workspaceContext` to `src/core/batch.ts`.
- No check behavior changes were made in this phase.
- `npm run typecheck` passed.
- `npm test -- tests/batch.test.ts` passed: 5 tests in 1 test file.

## Phase 2: Workspace Context Plumbing

Goal: attach package-specific workspace context during workspace checks.

Scope:

- Build workspace package metadata from `WorkspaceDiscovery.packages`.
- Index only named workspace packages by package name.
- Pass root package manager info into batch execution.
- Attach `context.workspace` after `discoverProject(target.root)` in workspace batch checks.
- Include root workflows and package workflows as inputs to later publish-path detection, but keep publish path initially conservative.

Out of scope:

- Dependency check changes.
- Fix-mode workspace context unless needed by shared types.

Acceptance criteria:

- `pkg-guard check --workspaces` still reports existing findings.
- Workspace package reports can run with optional context attached.
- Existing workspace and batch tests pass.

Suggested commands:

```sh
npm test -- tests/workspaces.test.ts tests/batch.test.ts tests/cli-run.test.ts
npm run typecheck
```

Status:

- Completed on 2026-06-26.
- Exported the existing project-discovery helpers needed by workspace discovery: lockfile detection, package-manager parsing/detection, and workflow reading.
- Extended `WorkspaceDiscovery` with root package-manager information and root workflow metadata.
- Added `createWorkspaceCheckContext` to build a batch-level context from discovered workspace packages, indexing only named packages.
- Attached optional per-package `context.workspace` during workspace batch checks, with publish path still set to conservative `unknown`.
- Updated workspace CLI checks to pass the generated context into batch execution.
- Added batch coverage for named package indexing, private package metadata, root workflow carry-through, and root package manager carry-through.
- `npm test -- tests/workspaces.test.ts tests/batch.test.ts tests/cli-run.test.ts` passed: 48 tests across 3 test files.
- `npm run typecheck` passed.
- `npm test` passed: 193 tests across 15 test files.

## Phase 3: Publish Path Inference

Goal: conservatively classify workspace publish path as `pnpm`, `npm`, or `unknown`.

Scope:

- Add a small publish-path helper, likely in `src/core/batch.ts` or a new `src/core/publish-path.ts`.
- Infer `pnpm` only when root package manager is pnpm and no relevant npm publish workflow is detected.
- Infer `npm` when root or package workflows contain direct `npm publish` or `npx semantic-release`.
- Infer `unknown` for non-pnpm root managers or insufficient confidence.
- Add focused tests for:
  - pnpm root with no publish workflow -> `pnpm`
  - pnpm root with root `npm publish` workflow -> `npm`
  - pnpm root with package-local `npm publish` workflow -> `npm`
  - npm root -> `unknown`

Out of scope:

- Parsing package scripts for publish commands.
- Generating pnpm release workflows.
- Semantic-release config parsing.

Acceptance criteria:

- Obvious npm publish paths force `npm`.
- pnpm-safe path is inferred only in the absence of obvious npm publish workflows.
- Typecheck passes.

Suggested commands:

```sh
npm test -- tests/batch.test.ts tests/workflows.test.ts
npm run typecheck
```

Status:

- Completed on 2026-06-26.
- Added `inferWorkspacePublishPath` in `src/core/publish-path.ts`.
- The helper classifies obvious `npm publish` and `npx semantic-release` workflow commands as `npm`, including both root and package-local workflows.
- Non-pnpm root package managers classify as `unknown`.
- pnpm roots with no npm publish workflow classify as `pnpm`.
- Workspace batch context now uses root-only inference at creation time and recomputes package context with package-local workflows when attaching `context.workspace`.
- Added focused coverage for pnpm-safe, root npm-publish, package-local npm-publish, semantic-release, and npm-root cases.
- `npm test -- tests/batch.test.ts tests/workflows.test.ts` passed: 39 tests across 2 test files.
- `npm run typecheck` passed.
- `npm test` passed: 198 tests across 15 test files.

## Phase 4: Workspace-Range Decision Logic

Goal: refine `dependencies.workspace-range` using workspace context.

Scope:

- Change `checkWorkspaceRanges` to receive `ProjectContext`.
- Preserve existing error behavior when no workspace context exists.
- Preserve error behavior for non-pnpm or unknown publish paths.
- Suppress the finding when:
  - root manager is pnpm,
  - publish path is `pnpm`,
  - the dependency name resolves to a local workspace package,
  - the target package is not private.
- Emit `dependencies.workspace-range` error when the workspace target is missing.
- Emit `dependencies.workspace-range` error when public package runtime/peer/optional metadata depends on a private workspace package.
- Emit `dependencies.workspace-range` warning when only `devDependencies` points to a private workspace target under otherwise pnpm-safe context.
- Improve messages and suggestions based on reason.

Out of scope:

- New check IDs.
- JSON schema changes.
- Full pnpm manifest rewrite simulation.

Acceptance criteria:

- Single-package `workspace:*` remains an error.
- Valid pnpm workspace dependency on a publishable local package emits no finding.
- Missing workspace target emits an error.
- Private runtime target emits an error.
- Private dev-only target emits a warning.
- npm publish path emits an error even in pnpm workspaces.

Suggested commands:

```sh
npm test -- tests/dependencies.test.ts tests/batch.test.ts tests/cli-run.test.ts
npm run typecheck
```

Status:

- Completed on 2026-06-26.
- Changed `dependencies.workspace-range` analysis to receive the full `ProjectContext`.
- Preserved single-package conservative behavior when no workspace context exists.
- Preserved errors for non-pnpm workspace roots and npm/unknown publish paths.
- Suppressed `dependencies.workspace-range` for pnpm-safe workspace dependencies that resolve to publishable local workspace packages.
- Added missing-target errors with a targeted suggestion.
- Added private-target handling: errors for publish-relevant dependency sections and warnings for `devDependencies`.
- Added focused batch coverage for valid pnpm workspace dependencies, missing targets, private runtime targets, private dev-only targets, npm roots, and pnpm workspaces that publish through npm.
- `npm test -- tests/dependencies.test.ts tests/batch.test.ts tests/cli-run.test.ts` passed: 43 tests across 3 test files.
- `npm run typecheck` passed.
- `npm test` passed: 204 tests across 15 test files.

## Phase 5: CLI and Reporter Smoke Coverage

Goal: verify the refined behavior through user-facing workspace commands.

Scope:

- Add or update CLI tests for `pkg-guard check --workspaces` in pnpm fixtures.
- Cover human output enough to verify release-blocking errors disappear for pnpm-safe cases.
- Cover JSON output enough to verify findings remain package-scoped.
- Confirm SARIF output requires no schema changes.

Out of scope:

- Snapshot-heavy reporter rewrites.
- New reporter fields.

Acceptance criteria:

- CLI workspace behavior matches dependency/batch behavior.
- JSON and SARIF still render valid reports.

Suggested commands:

```sh
npm test -- tests/cli-run.test.ts tests/reporters.test.ts
npm run typecheck
```

Status:

- Completed on 2026-06-27.
- Added CLI smoke coverage for pnpm-safe workspace ranges in human workspace output.
- Added CLI JSON coverage proving `dependencies.workspace-range` remains inside the affected package report rather than root workspace findings.
- Added CLI SARIF coverage for workspace-range findings, including package-relative artifact URIs and existing SARIF properties.
- Confirmed no reporter schema changes were needed.
- `npm test -- tests/cli-run.test.ts tests/reporters.test.ts` passed: 33 tests across 2 test files.
- `npm run typecheck` passed.
- `npm test` passed: 207 tests across 15 test files.

## Phase 6: Documentation and Changelog

Goal: document the pnpm nuance and the npm-publish caveat.

Scope:

- Add a `0.3.2` changelog entry.
- Update `docs/checks.md` for refined `dependencies.workspace-range` behavior.
- Update `docs/examples.md` with a short pnpm workspace example.
- Update `docs/release-workflow.md` only if needed to clarify that generated workflows publish with npm.

Acceptance criteria:

- Docs explain why pnpm workspace dependencies can be safe.
- Docs explain why npm publish workflows still make `workspace:` ranges unsafe.
- Changelog maps directly to issue #11.

Suggested commands:

```sh
npm run lint
```

Status:

- Completed on 2026-06-27.
- Added a `0.3.2` changelog entry mapped to issue #11 and the refined `dependencies.workspace-range` behavior.
- Updated `docs/checks.md` to explain when pnpm workspace protocol ranges are safe, and why missing targets, private targets, non-pnpm roots, unknown paths, and npm publish paths remain findings.
- Added a pnpm workspace dependency example to `docs/examples.md` showing `pkg-guard check --workspaces`.
- Updated `docs/release-workflow.md` to clarify that generated workflows still publish with `npm publish`, which does not rewrite pnpm `workspace:` ranges.
- `npm run lint` passed.

## Phase 7: Final Verification and Release Prep

Goal: prepare v0.3.2 for release.

Scope:

- Run focused tests.
- Run full verification.
- Verify pack output.
- Bump `package.json` and `package-lock.json` from `0.3.1` to `0.3.2`.
- Re-run full verification after the version bump.

Suggested commands:

```sh
npm test -- tests/dependencies.test.ts tests/batch.test.ts tests/cli-run.test.ts
npm test
npm run typecheck
npm run lint
npm run build
node dist/cli/index.js check
npm pack --dry-run --json --ignore-scripts
```

Acceptance criteria:

- Full verification passes after version bump.
- Packed output is clean.
- `CHANGELOG.md` includes `0.3.2`.
- The final diff maps to the v0.3.2 PRD, technical design, and implementation plan.

Status:

- Completed on 2026-06-27.
- Pre-bump verification passed:
  - `npm test -- tests/dependencies.test.ts tests/batch.test.ts tests/cli-run.test.ts` passed: 46 tests across 3 test files.
  - `npm test` passed: 207 tests across 15 test files.
  - `npm run typecheck` passed.
  - `npm run lint` passed.
  - `npm run build` passed.
  - `node dist/cli/index.js check` passed with no issues.
  - `npm pack --dry-run --json --ignore-scripts` passed for `pkg-guard@0.3.1` with 135 entries.
- Bumped `package.json` and `package-lock.json` from `0.3.1` to `0.3.2` using `npm version 0.3.2 --no-git-tag-version`.
- Post-bump verification passed:
  - `npm test -- tests/dependencies.test.ts tests/batch.test.ts tests/cli-run.test.ts` passed: 46 tests across 3 test files.
  - `npm test` passed: 207 tests across 15 test files.
  - `npm run typecheck` passed.
  - `npm run lint` passed.
  - `npm run build` passed.
  - `node dist/cli/index.js check` passed with no issues.
  - `npm pack --dry-run --json --ignore-scripts` passed for `pkg-guard@0.3.2` with 135 entries, package size 128030 bytes, unpacked size 579540 bytes.
- Confirmed `CHANGELOG.md` includes `0.3.2`.
