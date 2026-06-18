# pkg-guard Implementation Plan

## Purpose

This plan breaks the PRD and technical design into implementation phases sized for one normal code-review-commit cycle. Each phase should leave the repository in a working state with tests passing and a coherent diff.

The phases are intentionally smaller than the technical design milestones. The milestones describe product capability groups; this plan describes practical build increments.

## Phase Sizing

A phase should usually fit in one focused implementation pass when:

- It changes a small number of architectural surfaces.
- It has clear acceptance criteria.
- It can be reviewed without understanding unrelated future phases.
- It leaves the CLI runnable or tests meaningfully improved.
- It avoids combining parsing, analysis, mutation, and reporting in one diff.

If a phase starts producing broad incidental refactors, split it before continuing.

## Phase 0: Repository Scaffold

Goal: turn the empty repo into a working TypeScript CLI package.

Scope:

- Create `package.json` for the unscoped `pkg-guard` package.
- Configure TypeScript.
- Add CLI entrypoint with `pkg-guard --help`.
- Add build, typecheck, test, and lint scripts.
- Add initial README usage stub.
- Add basic CI workflow for install, typecheck, test, and build.

Out of scope:

- Real checks.
- Project discovery.
- Release workflow generation.

Acceptance criteria:

- `npm test`, `npm run typecheck`, and `npm run build` pass.
- Built package exposes the `pkg-guard` binary.
- CLI help renders without throwing.

## Phase 1: Command Shell and Reporters

Goal: establish the command structure and output contracts before adding real analysis.

Scope:

- Implement `check`, `fix`, and `init-release` command shells.
- Add shared command option parsing.
- Add `Finding` and severity types.
- Add human reporter.
- Add JSON reporter.
- Add exit-code handling.
- Add tests for reporter output and exit behavior.

Out of scope:

- Filesystem discovery beyond current working directory.
- Real checks.
- File mutation.

Acceptance criteria:

- `pkg-guard check` returns success with an empty finding set.
- `pkg-guard check --json` emits valid JSON with schema/version metadata.
- Reporter tests cover errors, warnings, and info findings.

## Phase 2: Project Discovery

Goal: build the first useful `ProjectContext`.

Scope:

- Discover project root by locating `package.json`.
- Parse `package.json`.
- Detect package manager from `packageManager` and lockfiles.
- Read Git remote metadata when available.
- Read direct `tsconfig.json` when present.
- Discover GitHub Actions workflow files.
- Add fixture test harness.

Out of scope:

- Deep TypeScript config resolution.
- YAML workflow analysis.
- Pack inspection.
- Entry point validation.

Acceptance criteria:

- Discovery works from nested directories.
- Package manager conflicts become structured findings or context warnings.
- Fixture tests cover npm, pnpm, Yarn, Bun, and missing manifest cases.

## Phase 3: First Manifest Checks

Goal: ship the first real `pkg-guard check` value.

Scope:

- Add check registry.
- Add config loading from `package.json` `pkgGuard`.
- Implement manifest checks for:
  - missing or invalid `name`
  - missing or invalid `version`
  - missing `packageManager`
  - conflicting package manager metadata
  - missing `license`
  - missing `repository` when Git remote is available
  - missing `files`
  - `private: true` on a package that otherwise appears publishable
- Add ignore and strictness policy.

Out of scope:

- Auto-fixes.
- Entry point checks.
- Pack inspection.

Acceptance criteria:

- `pkg-guard check` reports stable check IDs for manifest issues.
- `pkg-guard check --json` includes file and JSON path locations.
- Configured ignores suppress selected findings.

## Phase 4: Conservative Manifest Fixes

Goal: make `pkg-guard fix` useful for low-risk metadata repairs.

Scope:

- Add fix plan model.
- Add JSON edit runner.
- Add `--dry-run`.
- Implement fixes for:
  - `packageManager` when lockfile is unambiguous
  - repository metadata from GitHub remote
  - `bugs` and `homepage` from GitHub remote
  - top-level `types` when `dist/index.d.ts` exists
- Add idempotency tests.

Out of scope:

- Rewriting `exports`.
- Adding `sideEffects`.
- Workflow edits.

Acceptance criteria:

- `pkg-guard fix --dry-run` prints planned changes without writing.
- `pkg-guard fix` writes deterministic JSON edits.
- Running `pkg-guard fix` twice produces no second change.

## Phase 5: Entry Point Checks

Goal: catch packages that cannot be imported as declared.

Scope:

- Normalize top-level `main`, `module`, `types`, `exports`, and `bin`.
- Support string and object `exports`.
- Validate declared targets do not escape package root.
- Validate target files exist on disk.
- Validate `bin` files have shebangs.
- Add fixture projects for broken runtime and type targets.

Out of scope:

- Full conditional export semantics.
- Packlist-aware validation.
- TypeScript compiler API.

Acceptance criteria:

- Broken `main`, `types`, `exports`, and `bin` targets produce errors.
- Unsupported complex export shapes produce warnings, not crashes.
- Valid simple ESM TypeScript library fixture passes entry checks.

## Phase 6: Pack Inspection

Goal: inspect actual publish contents using npm pack behavior.

Scope:

- Run `npm pack --dry-run --json --ignore-scripts`.
- Parse pack output into `PackInfo`.
- Detect sensitive or junk files in pack output.
- Detect required files missing from pack output.
- Cross-check declared entry points against packed files.

Out of scope:

- Running builds automatically.
- Network access.
- Lifecycle script execution.

Acceptance criteria:

- `.env` in pack output is an error.
- Missing packed runtime or declaration target is an error.
- Missing README or license file is a warning when applicable.
- Pack command failure becomes a finding, not an internal crash.

## Phase 7: TypeScript Checks

Goal: add TypeScript-specific package correctness checks without overbuilding compiler integration.

Scope:

- Inspect direct `tsconfig.json` compiler options.
- Warn when published TypeScript library lacks declaration output.
- Warn when `types` points to source TypeScript.
- Warn when `declarationMap` may expose unwanted source paths.
- Check `outDir` consistency against manifest targets when obvious.

Out of scope:

- Full `extends` resolution.
- Creating a TypeScript program.
- Import graph analysis.

Acceptance criteria:

- Fixture with missing declarations is flagged.
- Fixture with source `types` path is flagged.
- Extended tsconfig produces a conservative warning when not fully resolvable.

## Phase 8: GitHub Actions Workflow Checks

Goal: detect risky npm publishing workflows.

Scope:

- Parse workflow YAML.
- Detect likely npm publish workflows.
- Detect long-lived npm token usage.
- Detect missing `id-token: write`.
- Detect unsafe branch-push publishing.
- Detect missing install, test, build, or package validation steps.

Out of scope:

- Proving npm-side trusted publisher configuration.
- Supporting every release tool deeply.
- Editing existing workflows.

Acceptance criteria:

- Workflow with `NPM_TOKEN` gets a warning.
- Workflow with `id-token: write` and tag trigger avoids the OIDC warning.
- Workflow that publishes on ordinary branch push gets an error or warning according to risk.

## Phase 9: Release Workflow Generation

Goal: make `pkg-guard init-release` generate a practical trusted-publishing workflow.

Scope:

- Generate `.github/workflows/release.yml`.
- Use `v*` tag trigger.
- Use trusted-publishing-compatible Node/npm versions.
- Select install command from detected package manager.
- Run test, build, `pkg-guard check`, and `npm publish`.
- Refuse to overwrite an existing release workflow.

Out of scope:

- Updating arbitrary existing workflow files.
- Release notes.
- Changesets integration.

Acceptance criteria:

- Generated workflow snapshots are stable.
- Existing workflow is not overwritten.
- Output clearly states npm-side trusted publisher setup required outside the repo.

## Phase 10: Dependency Checks

Goal: add conservative dependency hygiene checks.

Scope:

- Detect unresolved `workspace:` dependency ranges in publishable manifests.
- Warn on obvious runtime packages in `devDependencies` only when confidence is high.
- Warn on optional peer dependencies missing `peerDependenciesMeta`.
- Warn on suspiciously broad dependency ranges for libraries.

Out of scope:

- Full import graph analysis.
- Bundler-aware tree shaking analysis.
- Vulnerability scanning.

Acceptance criteria:

- Unresolved workspace protocol in a published manifest is an error.
- Heuristic findings are warnings.
- False-positive-prone checks are documented and suppressible.

## Phase 11: Documentation and Self-Check

Goal: prepare the project for first public use.

Scope:

- Document CLI usage.
- Document check IDs.
- Document config.
- Document generated release workflow.
- Add examples.
- Run `pkg-guard` against its own package.

Out of scope:

- Website.
- GitHub Action wrapper.
- SARIF output.

Acceptance criteria:

- README is sufficient for installation and first run.
- Check ID docs explain severity, rationale, and suppression.
- Project CI runs `pkg-guard check`.

## Phase 12: First Publish Readiness

Goal: make the package ready for an initial npm release.

Scope:

- Finalize package metadata.
- Verify packed contents.
- Verify binary execution from packed artifact.
- Configure release workflow.
- Add changelog or release notes baseline.
- Confirm npm trusted publisher setup instructions.

Out of scope:

- Multi-package architecture.
- Monorepo support.
- Non-npm registries.

Acceptance criteria:

- `npm pack --dry-run --json --ignore-scripts` contains only expected files.
- Packed CLI runs locally.
- Release workflow is present and reviewable.
- Repository is ready for `v0.1.0`.

## Scope Notes

Phase 0 and Phase 1 may be combined if the scaffold is straightforward. Do not combine Phase 2 and Phase 3 unless the discovery layer stays small.

Phase 5, Phase 6, and Phase 8 should remain separate. Each has enough edge cases to deserve its own review.

Phase 10 may move later if the first public version is stronger by focusing on manifest, entrypoint, pack, and release workflow quality first.
