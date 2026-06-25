# pkg-guard v0.3.0 Implementation Plan

## Purpose

This plan breaks v0.3.0 into reviewable phases. Each phase should leave the CLI working and tests passing.

The release priority is workspace-aware publish readiness. CI reporting, adoption initialization, and trusted publishing refreshes should support that central adoption story without turning v0.3.0 into a broad rewrite.

## Phase 0: Baseline

Goal: confirm the current v0.2.0 state before feature work starts.

Scope:

- Confirm the working tree is clean except approved v0.3.0 planning docs.
- Confirm `package.json` and `package-lock.json` are at `0.2.0`.
- Run full verification.
- Confirm the published npm latest is still `0.2.0`.

Suggested commands:

```sh
git status --short --branch
npm view pkg-guard version --json
npm test
npm run typecheck
npm run lint
npm run build
node dist/cli/index.js check
npm pack --dry-run --json --ignore-scripts
```

Acceptance criteria:

- Full verification passes.
- No unreviewed source edits are present before Phase 1.
- Any discovered v0.2.0 regression is triaged before continuing.

Status:

- Completed on 2026-06-24.
- Current branch is `v0.3.0`.
- Working tree contained only approved untracked `docs/v0.3.0/` planning docs before verification.
- `package.json` and `package-lock.json` are both at `0.2.0`.
- `npm view pkg-guard version --json` returned `"0.2.0"`.
- `npm test` passed: 126 tests across 12 test files.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.
- `npm pack --dry-run --json --ignore-scripts` passed and produced `pkg-guard-0.2.0.tgz`.
- Dry-run pack output included the new v0.3.0 planning docs because `docs` is part of the package files list; this is expected while the planning docs remain in-tree.

## Phase 1: CLI Option Model

Goal: add the v0.3.0 CLI surface without changing behavior yet.

Scope:

- Add the `init` command to command parsing and help output.
- Add parsed options for:
  - `--workspaces`
  - `--workspace <selector>`
  - `--include-private`
  - `--include-root`
  - `--format <human|json|sarif>`
- Keep `--json` as an alias for `--format json`.
- Reject invalid option combinations early.
- Keep existing `check`, `fix`, and `init-release` behavior unchanged when new options are not used.

Out of scope:

- Workspace discovery.
- SARIF output.
- Init file mutation.
- Batch fix behavior.

Acceptance criteria:

- Existing CLI option tests still pass.
- New parser tests cover valid and invalid v0.3.0 flags.
- `pkg-guard check --json` and `pkg-guard check --format json` parse equivalently.
- Unsupported `--format sarif` on commands other than `check` fails with exit code `2`.
- `init-release` rejects workspace flags with a clear usage error.

Status:

- Completed on 2026-06-24.
- Added `init` to the command parser and command help.
- Added parsed options for `--workspaces`, `--workspace <selector>`, `--include-private`, `--include-root`, and `--format <human|json|sarif>`.
- Kept `--json` as an alias for `--format json`.
- Added validation for invalid formats, missing option values, conflicting workspace selectors, include flags without workspace selection, SARIF on non-`check` commands, and workspace flags on `init-release`.
- Left later-phase surfaces intentionally stubbed at runtime: workspace modes, SARIF check output, and `init` return clear exit code `2` messages until their implementation phases.
- Updated help output for the new command and options.
- Added CLI coverage for new parsing and validation behavior.
- `npm test -- tests/cli-run.test.ts` passed: 19 tests.
- `npm run typecheck` passed.
- `npm test` passed: 136 tests across 12 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.
- `node dist/cli/index.js check --format json` passed.
- `node dist/cli/index.js init --help` passed.
- `node dist/cli/index.js fix --format sarif` returned the expected usage error.

## Phase 2: Workspace Discovery

Goal: discover workspace package targets safely and deterministically.

Scope:

- Add a workspace discovery module.
- Read workspace patterns from:
  - `package.json` `workspaces` arrays.
  - `package.json` `workspaces.packages`.
  - `pnpm-workspace.yaml` `packages`.
- Add narrow workspace pattern expansion for:
  - literal relative package paths.
  - one-segment `*` patterns.
  - scoped layouts such as `packages/@scope/*`.
  - negated patterns beginning with `!`.
- Ignore `node_modules`, `.git`, coverage directories, package manager stores, and hidden directories.
- Prevent traversal outside the workspace root.
- Deduplicate and sort discovered package roots.
- Parse package names and `private` flags for target metadata.
- Add batch-level workspace finding IDs to docs once finalized.

Out of scope:

- Running checks against discovered packages.
- Recursive `**` support unless it is cheap and well tested.
- Root-level config inheritance.

Acceptance criteria:

- Tests cover package.json workspace array discovery.
- Tests cover package.json `workspaces.packages` discovery.
- Tests cover `pnpm-workspace.yaml`.
- Tests cover private package metadata.
- Tests cover negated patterns.
- Tests cover path escape prevention.
- Tests cover deterministic sorting and deduplication.
- Unsupported patterns emit a stable workspace finding instead of crashing.

Status:

- Completed on 2026-06-24.
- Added `src/core/workspaces.ts` for workspace metadata discovery.
- Reads workspace patterns from `package.json` `workspaces`, `package.json` `workspaces.packages`, and `pnpm-workspace.yaml` `packages`.
- Supports literal relative package paths, complete-segment `*` patterns, scoped layouts such as `packages/@scope/*`, and negated patterns.
- Rejects unsafe or unsupported patterns such as paths outside the workspace root and recursive `**` patterns with `workspace.pattern-unsupported`.
- Ignores `node_modules`, VCS directories, package manager stores, coverage directories, and hidden directories during wildcard expansion.
- Deduplicates package roots and returns them sorted by repository-relative path.
- Reads package name and `private: true` metadata for discovered packages.
- Reports invalid root workspace config with `workspace.config-invalid`.
- Reports invalid workspace package manifests with `workspace.package-json-invalid` and skips those packages.
- Documented workspace finding IDs in `docs/checks.md`.
- Added `tests/workspaces.test.ts` coverage for package.json workspaces, `workspaces.packages`, pnpm workspace YAML, private metadata, scoped layouts, negated patterns, deduplication, path escape prevention, unsupported recursive patterns, invalid manifests, invalid config, and ignored directories.
- Workspace discovery is intentionally not wired into CLI target selection until Phase 3.
- `npm test -- tests/workspaces.test.ts` passed: 12 tests.
- `npm run typecheck` passed.
- `npm test` passed: 148 tests across 13 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.

## Phase 3: Workspace Target Selection

Goal: select the right package set for workspace CLI flags.

Scope:

- Implement `--workspaces` target selection.
- Implement `--workspace <selector>` by package name and relative path.
- Skip `private: true` packages by default in batch mode.
- Implement `--include-private`.
- Implement `--include-root`.
- Return a usage error when selectors do not match.
- Make target summaries available to later reporters.

Out of scope:

- Batch check execution.
- Batch JSON shape.
- Batch fix application.

Acceptance criteria:

- `--workspaces` selects workspace children and excludes the root by default.
- `--workspaces --include-root` includes the root when eligible.
- Private packages are skipped unless `--include-private` is set.
- `--workspace @scope/name` selects by package name.
- `--workspace packages/foo` selects by relative path.
- Missing selectors produce `workspace.selector-not-found` and exit code `2`.
- Selection order is stable.

Status:

- Completed on 2026-06-24.
- Added `WorkspaceRunTarget`, `WorkspaceTargetSelectionOptions`, and `WorkspaceTargetSelection` models.
- Added `selectWorkspaceTargets` on top of Phase 2 discovery.
- `--workspaces` selection includes workspace children and excludes the root by default.
- `--include-root` includes the root package when eligible.
- `private: true` packages are skipped by default and tracked in the skipped target summary.
- `--include-private` includes private workspace packages and private root packages when selected.
- `--workspace <selector>` selection supports exact package names and normalized relative package paths.
- Missing selectors produce `workspace.selector-not-found` findings.
- Target and skipped lists are sorted deterministically.
- Wired workspace CLI flags through target selection before the Phase 4 batch-execution stub.
- CLI workspace commands now report selected/skipped package counts when selection succeeds, and selector/config errors before batch execution.
- Added workspace selection tests for default child selection, private skipping, `--include-private`, `--include-root`, private root skipping, package-name selectors, relative-path selectors, and missing selectors.
- Updated CLI tests for selection-aware workspace stubs and missing selector errors.
- `npm test -- tests/workspaces.test.ts tests/cli-run.test.ts` passed: 39 tests across 2 test files.
- `npm run typecheck` passed.
- `npm test` passed: 156 tests across 13 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.
- `node dist/cli/index.js check --workspaces` returned the expected Phase 4 batch-execution stub after selecting 0 packages in this non-workspace repo.

## Phase 4: Batch Check Execution

Goal: run existing checks across selected workspace packages.

Scope:

- Add a batch check coordinator.
- Build one existing `ProjectContext` per selected package.
- Run existing checks for each package.
- Apply package-level `pkgGuard` policy per package.
- Apply CLI `--ignore` and `--strict` across packages.
- Aggregate package reports and exit codes.
- Preserve single-package `check` behavior when workspace flags are absent.

Out of scope:

- SARIF.
- Batch fix.
- Init.
- Parallel execution.

Acceptance criteria:

- `pkg-guard check --workspaces` checks each selected publishable package.
- A finding in one package does not prevent other packages from being checked.
- Package-level ignores and strict settings apply only to that package.
- CLI ignores and strict settings apply to every package.
- Batch exit code is `1` when any package has an error.
- Batch exit code is `0` when packages have only warnings.
- Existing single-package check tests still pass.

Status:

- Completed on 2026-06-24.
- Added `src/core/batch.ts` with `runBatchChecks`, package-level reports, batch summaries, skipped package tracking, and aggregate exit-code calculation.
- Batch checks build one existing `ProjectContext` per selected workspace target and reuse the existing check registry.
- Package-level `pkgGuard.ignore` and `pkgGuard.strict` are applied independently per package.
- CLI `--ignore` and `--strict` are applied across all checked packages.
- A package with findings does not stop later selected packages from being checked.
- Workspace `check` now runs batch checks in human mode and returns `1` when any checked package has an error.
- Workspace `check --format json` remains an explicit Phase 5 boundary.
- Workspace `check --format sarif` remains an explicit Phase 6 boundary.
- Added batch tests for multi-package execution, continuing after errors, package-level ignore, CLI ignore, and package-level strict policy.
- Updated CLI tests for real workspace check execution, aggregate failure exit codes, and the JSON later-phase boundary.
- `npm test -- tests/batch.test.ts tests/cli-run.test.ts tests/workspaces.test.ts` passed: 46 tests across 3 test files.
- `npm run typecheck` passed.
- `npm test` passed: 163 tests across 14 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.
- `node dist/cli/index.js check --workspaces` passed in this non-workspace repo with 0 checked packages and 0 skipped packages.

## Phase 5: Human and JSON Batch Reporting

Goal: make workspace results understandable to humans and stable for machines.

Scope:

- Add a human workspace report grouped by package.
- Add workspace summary counts:
  - checked packages
  - skipped packages
  - errors
  - warnings
- Add a batch JSON wrapper for workspace mode.
- Keep single-package JSON unchanged.
- Include package name, relative path, and private status in workspace JSON entries.
- Include top-level workspace discovery findings separately from package findings.

Out of scope:

- SARIF.
- Changing existing single-package reporter text.

Acceptance criteria:

- Clean workspace output reports the number of checked and skipped packages.
- Human findings are grouped under package path and name.
- Workspace JSON output is schema-versioned.
- Single-package `--json` output remains compatible with v0.2.0.
- Reporter tests cover mixed clean and failing packages.

Status:

- Completed on 2026-06-24.
- Added `src/reporters/batch.ts` with dedicated human and JSON renderers for batch check reports.
- Replaced the temporary inline workspace summary in the CLI with the batch human reporter.
- Enabled `pkg-guard check --workspaces --format json`.
- Batch JSON uses a schema-versioned wrapper and keeps package findings inside each package report.
- Batch JSON includes top-level workspace findings separately from package findings.
- Batch JSON includes package name, relative path, private status, source, and skipped package metadata.
- Single-package JSON output remains unchanged.
- Added reporter tests for grouped batch human output and the batch JSON wrapper.
- Updated CLI tests for workspace JSON output through the command path.
- `npm test -- tests/reporters.test.ts tests/cli-run.test.ts tests/batch.test.ts` passed: 32 tests across 3 test files.
- `npm run typecheck` passed.
- `npm test` passed: 165 tests across 14 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.
- `node dist/cli/index.js check --workspaces` passed in this non-workspace repo with 0 checked packages and 0 skipped packages.
- `node dist/cli/index.js check --workspaces --format json` passed and emitted the batch JSON wrapper.

## Phase 6: SARIF Reporter

Goal: add a CI-native report format for `check`.

Scope:

- Add `src/reporters/sarif.ts`.
- Emit SARIF 2.1.0 JSON for single-package and workspace reports.
- Map finding IDs to SARIF rule IDs.
- Map severities to SARIF levels.
- Resolve artifact URIs relative to the checked package or workspace root.
- Include finding JSON paths in SARIF properties.
- Wire `--format sarif` into `check`.

Out of scope:

- Uploading SARIF to any CI provider.
- Adding a GitHub Action wrapper.
- Replacing existing JSON output.

Acceptance criteria:

- `pkg-guard check --format sarif` emits valid-looking SARIF with `version: "2.1.0"`.
- SARIF includes stable tool metadata for `pkg-guard`.
- SARIF includes rules for emitted finding IDs.
- SARIF includes results for package findings.
- Workspace SARIF paths include the package relative path.
- No new runtime dependency is added unless implementation shows it materially reduces risk.

Status:

- Completed on 2026-06-24.
- Added `src/reporters/sarif.ts` with hand-built SARIF 2.1.0 output and no new runtime dependency.
- Added SARIF output for single-package `pkg-guard check --format sarif`.
- Added SARIF output for workspace `pkg-guard check --workspaces --format sarif`.
- Maps finding IDs to SARIF `ruleId` values and tool driver rules.
- Maps severities to SARIF levels: error, warning, and note.
- Includes stable `pkg-guard` tool metadata and GitHub repository information URI.
- Emits artifact locations for findings with files.
- Prefixes workspace package finding URIs with the package relative path.
- Includes finding JSON paths, suggestions, and fixability in SARIF result properties when present.
- Added reporter tests for single-package SARIF and workspace SARIF package paths.
- Updated CLI tests for single-package and workspace SARIF output.
- `npm test -- tests/reporters.test.ts tests/cli-run.test.ts` passed: 30 tests across 2 test files.
- `npm run typecheck` passed.
- `npm test` passed: 168 tests across 14 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check --format sarif` passed and emitted SARIF 2.1.0.
- `node dist/cli/index.js check --workspaces --format sarif` passed and emitted SARIF 2.1.0.
- `node dist/cli/index.js check` passed with no issues.

## Phase 7: Workspace Fix Dry-Run and Selected Fix Apply

Goal: make fixes useful in workspace repos while keeping write behavior conservative.

Scope:

- Support `pkg-guard fix --workspaces --dry-run`.
- Support `pkg-guard fix --workspace <selector>` for selected package fixes.
- Aggregate fix plans by package.
- Report changed files by package for selected-package apply.
- Return a usage error for `fix --workspaces` without `--dry-run` unless batch apply is explicitly approved during implementation.
- Preserve existing single-package fix behavior.

Out of scope:

- Applying fixes across all workspace packages by default.
- Cross-package manifest rewrites.
- New fix categories.

Acceptance criteria:

- Workspace dry-run writes no files.
- Workspace dry-run reports planned fixes grouped by package.
- Selected workspace fix applies only to selected package manifests.
- Existing fix idempotency tests still pass.
- Batch apply without `--dry-run` either works with clear tests or fails with a clear exit code `2` message.

Status:

- Completed on 2026-06-24.
- Added batch fix support to `src/core/batch.ts`.
- Added package-level fix reports with findings, fix plans, and changed files grouped by workspace target.
- Added aggregate batch fix summaries with package, skipped, fix, changed-file, and finding counts.
- Added batch fix human and JSON renderers in `src/reporters/batch.ts`.
- `pkg-guard fix --workspaces --dry-run` now plans fixes across selected publishable workspace packages without writing.
- `pkg-guard fix --workspace <selector>` can apply fixes to selected workspace packages.
- `pkg-guard fix --workspaces` without `--dry-run` returns exit code `2` with a clear safety message.
- Workspace fix JSON output includes package metadata, package findings, changed files, and fix plans.
- Existing single-package fix behavior remains unchanged.
- Added CLI fix tests for workspace dry-run, selected workspace apply, all-workspace apply rejection, and workspace fix JSON output.
- `npm test -- tests/fixes.test.ts tests/cli-run.test.ts tests/reporters.test.ts` passed: 47 tests across 3 test files.
- `npm run typecheck` passed.
- `npm test` passed: 172 tests across 14 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.
- `node dist/cli/index.js fix --workspaces --dry-run` passed in this non-workspace repo with no fixable workspace issues.
- `node dist/cli/index.js fix --workspaces` returned the expected exit code `2` safety message.

## Phase 8: Adoption Init Command

Goal: provide a safe first-run setup path.

Scope:

- Implement `pkg-guard init`.
- Add dry-run and JSON or human output for init plans.
- Add single-package init plans for:
  - `pkgGuard.preset` when inferred as `cli` or `typescript-library`.
  - `scripts["pkg:check"] = "pkg-guard check"` when no equivalent script exists.
- Add workspace root init plans for:
  - `scripts["pkg:check"] = "pkg-guard check --workspaces"`.
- Support `init --workspace <selector>` for selected packages.
- Support `init --workspaces --dry-run`.
- Avoid overwriting existing scripts with different commands.
- Print a recommendation for `init-release` when no release workflow exists.

Out of scope:

- Calling `init-release` from `init`.
- Adding dependencies automatically.
- Writing many workspace package manifests in non-dry-run batch mode unless explicitly approved.

Acceptance criteria:

- `init --dry-run` writes no files.
- `init` writes only conservative package.json changes.
- Existing scripts are not overwritten.
- Existing equivalent `pkg-guard check` scripts avoid duplicate script creation.
- Workspace root script planning is tested.
- Init output is understandable in human mode.

Status:

- Completed on 2026-06-24.
- Added `src/core/init.ts` with conservative init planning, application, and human/JSON rendering.
- `pkg-guard init` now adds `scripts.pkg:check = "pkg-guard check"` when no equivalent script exists.
- `pkg-guard init` now adds `pkgGuard.preset` only when package intent is inferred as `cli` or `typescript-library` and no preset is already configured.
- `pkg-guard init --dry-run` previews changes without writing.
- `pkg-guard init --format json` emits schema-versioned init output.
- Existing `pkg:check` scripts are not overwritten.
- Existing scripts that already run `pkg-guard check` avoid duplicate script creation.
- Human init output recommends `pkg-guard init-release` when no release workflow is present.
- `pkg-guard init --workspaces` plans/applies the root workspace `pkg:check = "pkg-guard check --workspaces"` script.
- `pkg-guard init --workspaces --dry-run` previews the root workspace script without writing.
- `pkg-guard init --workspace <selector>` applies init changes only to selected workspace packages.
- Added init tests for dry-run safety, single-package apply, existing script and preset protection, duplicate script avoidance, JSON output, workspace root planning/apply, and selected workspace package apply.
- `npm test -- tests/init.test.ts tests/cli-run.test.ts` passed: 31 tests across 2 test files.
- `npm run typecheck` passed.
- `npm test` passed: 180 tests across 15 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js init --dry-run` passed and previewed init changes without writing.
- `node dist/cli/index.js init --workspaces --dry-run` passed and previewed workspace root init changes without writing.
- `node dist/cli/index.js check` passed with no issues.

## Phase 9: Trusted Publishing Refresh

Goal: align generated and checked release workflows with current npm trusted publishing requirements.

Scope:

- Update generated GitHub release workflows to use Node and npm behavior compatible with npm trusted publishing requirements.
- Add or update checks for obvious old Node versions in publish workflows.
- Add or update checks for obvious old pinned npm versions in publish workflows.
- Strengthen the self-hosted trusted publishing warning text.
- Keep long-lived npm token warnings.
- Update release workflow docs for GitHub, GitLab CI/CD, and CircleCI support while keeping generation GitHub-only.

Out of scope:

- Generating GitLab or CircleCI workflows.
- Full semantic analysis of every setup-node or npm install form.
- Failing workflows when versions cannot be statically determined.

Acceptance criteria:

- Generated GitHub workflow remains valid.
- Generated GitHub workflow uses a trusted-publishing-compatible Node/npm path.
- Clear old Node versions produce `workflow.node-version-too-old`.
- Clear old npm versions produce `workflow.npm-version-too-old`.
- Unknown versions do not warn.
- Check IDs are documented.
- Release workflow docs cite current trusted publishing requirements.

Status:

- Completed on 2026-06-24.
- Checked the current npm trusted publishing documentation and aligned Phase 9 with npm CLI `11.5.1+`, Node `22.14.0+`, and hosted-provider support.
- Generated GitHub release workflows now use Node `24` and install `npm@^11.5.1` before dependency installation and publishing.
- Added `workflow.node-version-too-old` for statically clear `actions/setup-node` versions below Node `22.14.0` in publish jobs.
- Added `workflow.npm-version-too-old` for statically clear pinned npm CLI versions below `11.5.1` in publish workflows.
- Unknown or dynamic Node/npm versions remain conservative and do not warn.
- Strengthened `workflow.self-hosted-trusted-publishing` guidance to note that npm trusted publishing does not currently support self-hosted runners.
- Documented the new workflow check IDs in `docs/checks.md`.
- Updated `docs/release-workflow.md` with generated npm update behavior, current Node/npm requirements, and GitHub/GitLab/CircleCI provider notes while keeping generation GitHub-only.
- `npm test -- tests/workflows.test.ts tests/release.test.ts` passed: 38 tests across 2 test files.
- `npm run typecheck` passed.
- `npm test` passed: 183 tests across 15 test files.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.

## Phase 10: Documentation and Examples

Goal: make v0.3.0 understandable and adoptable.

Scope:

- Update `README.md` with workspace usage and SARIF usage.
- Update `docs/checks.md` with new workspace and workflow check IDs.
- Update `docs/configuration.md` with package-local config behavior in workspaces.
- Update `docs/examples.md` with single-package, workspace, and SARIF CI examples.
- Update `docs/release-workflow.md` for trusted publishing requirements and provider notes.
- Add a `0.3.0` changelog entry.
- Review the product site for high-level copy updates.

Out of scope:

- Full tutorial site redesign.
- Provider-specific release workflow generation docs beyond GitHub generation and provider notes.

Acceptance criteria:

- Docs describe new commands and flags accurately.
- Docs explain private package skipping and `--include-private`.
- Docs explain that root config does not silently inherit into packages.
- Docs include a workspace CI example.
- Changelog maps directly to implemented behavior.

Status:

- Completed on 2026-06-24.
- Updated `README.md` with workspace usage, SARIF usage, `init`, private-package selection, root inclusion, and package-local config behavior.
- Reviewed `docs/checks.md`; workspace check IDs and trusted publishing workflow IDs are documented.
- Updated `docs/configuration.md` to explain package-local workspace config, no silent root inheritance, `--include-private`, and `--include-root`.
- Updated `docs/examples.md` with single-package CI, workspace CI, SARIF CI, workspace init, workspace fix preview, selected workspace fix, private package inclusion, and private root inclusion examples.
- Updated `docs/release-workflow.md` to clarify that `init-release` does not accept workspace options and should be run package by package.
- Added the `0.3.0` changelog entry with workspace, SARIF, init, fix, and trusted publishing behavior.
- Refreshed the static product site copy for workspace checks and SARIF output.
- `npm test` passed: 183 tests across 15 test files.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed with no issues.
- `node dist/cli/index.js check --format sarif > /tmp/pkg-guard-phase10.sarif` passed and produced SARIF `2.1.0`.
- `node dist/cli/index.js check --workspaces` passed in this non-workspace repo with 0 checked packages and 0 skipped packages.

## Phase 11: Final Verification and Release Prep

Goal: prepare v0.3.0 for release.

Scope:

- Run full verification.
- Run workspace self-check if the repo has workspace fixtures or an applicable test fixture command.
- Verify pack output.
- Bump `package.json` and `package-lock.json` from `0.2.0` to `0.3.0`.
- Re-run full verification after the version bump.
- Confirm release notes match implemented behavior.

Suggested commands:

```sh
npm test
npm run typecheck
npm run lint
npm run build
node dist/cli/index.js check
node dist/cli/index.js check --format sarif > /tmp/pkg-guard.sarif
npm pack --dry-run --json --ignore-scripts
```

Acceptance criteria:

- Full verification passes after version bump.
- SARIF command succeeds.
- Packed output is clean.
- `CHANGELOG.md` includes `0.3.0`.
- The final diff maps to the approved PRD, technical design, and implementation plan.

Status:

- Pending.
