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

- Pending.

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

- Pending.

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

- Pending.

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

- Pending.

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

- Pending.

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

- Pending.

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

- Pending.

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

- Pending.

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

- Pending.

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

- Pending.

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
