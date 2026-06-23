# pkg-guard v0.2.0 Implementation Plan

## Purpose

This plan breaks v0.2.0 into reviewable phases. Each phase should leave the CLI working and tests passing.

## Phase 0: Patch Baseline

Goal: start from a clean v0.1.2 base.

Scope:

- Complete the v0.1.2 patch plan.
- Run full verification.
- Confirm no unrelated work is present.

Acceptance criteria:

- v0.1.2 is merged or its planned changes are intentionally carried into the v0.2.0 branch.

Status:

- Completed on 2026-06-22.
- Working tree was clean before Phase 0.
- `package.json` and `package-lock.json` are both at `0.1.2`.
- Local `v0.1.2` tag is present.
- `npm test` passed: 90 tests across 11 test files.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed.
- `npm pack --dry-run --json --ignore-scripts` passed and produced `pkg-guard-0.1.2.tgz` with the expected package contents.

## Phase 1: Preset Resolution

Goal: make project intent available to checks.

Scope:

- Add `PresetName` and `ResolvedPreset` types.
- Resolve preset during discovery.
- Validate `pkgGuard.preset` against supported names.
- Add tests for config, inferred `cli`, inferred `typescript-library`, and default `generic`.
- Update configuration docs.

Out of scope:

- Changing check behavior beyond what is needed to prove preset resolution.

Acceptance criteria:

- `ProjectContext` includes a resolved preset.
- Invalid configured presets emit `config.invalid`.
- Existing config tests still pass after adjustment.

Status:

- Completed on 2026-06-22.
- Added `PresetName` and `ResolvedPreset` types.
- `ProjectContext` now includes a resolved `preset`.
- `pkgGuard.preset` is validated against `generic`, `typescript-library`, and `cli`.
- Discovery resolves configured presets first, then infers `cli`, then infers `typescript-library`, then defaults to `generic`.
- Updated configuration docs with supported preset values and inference behavior.
- Added discovery tests for configured, invalid, inferred `cli`, inferred `typescript-library`, and default `generic` presets.
- `npm test -- tests/discovery.test.ts` passed: 15 discovery tests.
- `npm test -- tests/discovery.test.ts tests/manifest-checks.test.ts` passed: 23 tests across 2 test files.
- `npm test` passed: 95 tests across 11 test files.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed.

## Phase 2: Preset-Aware Applicability

Goal: reduce noisy checks before adding new ones.

Scope:

- Route TypeScript declaration checks primarily to `typescript-library`.
- Strengthen bin checks for `cli`.
- Ensure critical pack and sensitive-file checks still apply to all publishable packages.
- Add fixture tests for CLI-only and TS-library packages.

Out of scope:

- New finding categories.

Acceptance criteria:

- CLI packages do not receive irrelevant TypeScript-library declaration warnings.
- CLI packages still receive bin target and shebang errors.

Status:

- Completed on 2026-06-22.
- TypeScript declaration-focused checks now run only for the resolved `typescript-library` preset.
- Source `types` metadata checks and invalid/extended `tsconfig` checks remain independent of library preset applicability.
- The `cli` preset now requires at least one usable `bin` target and reports the existing `entrypoint.target-missing` ID when missing.
- Existing bin target and shebang validation still applies to CLI packages.
- Added TypeScript fixture coverage proving the `cli` preset avoids library declaration, declaration-map, and outDir warnings.
- Added entrypoint fixture coverage for configured CLI packages without `bin`.
- `npm test -- tests/typescript.test.ts tests/entrypoints.test.ts` passed: 16 tests across 2 test files.
- `npm test -- tests/pack.test.ts tests/typescript.test.ts tests/entrypoints.test.ts` passed: 20 tests across 3 test files.
- `npm test` passed: 97 tests across 11 test files.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed.

## Phase 3: Lifecycle Script Checks

Goal: cover a supply-chain risk called out in the original MVP.

Scope:

- Add `src/checks/lifecycle.ts`.
- Warn on `preinstall`, `install`, and `postinstall`.
- Add a small high-confidence suspicious matcher.
- Add docs and tests.

Out of scope:

- Broad malware scanning.
- Script execution.

Acceptance criteria:

- Install-time lifecycle scripts produce suppressible findings.
- Suspicious high-confidence patterns can produce an error.
- Private packages are handled according to the preset/applicability policy.

## Phase 4: Release Workflow Validation v2

Goal: recognize common validation and publish forms without changing workflow classification.

Scope:

- Expand package-validation command detection to include `npm exec`, package-manager dlx forms, and `bunx`.
- Add scoped package publish access checks.
- Warn on self-hosted GitHub runners for trusted publishing workflows.
- Add tests for direct workflow commands and script-expanded commands.

Out of scope:

- Treating scripted `npm publish` as publish workflow classification.
- Generating GitLab or CircleCI workflows.

Acceptance criteria:

- Existing v0.1.1 workflow tests still pass.
- New validation command forms satisfy package validation checks.
- Scoped package publish access warnings are stable and documented.

## Phase 5: Entrypoint Pattern and Pack Checks

Goal: improve modern `exports` validation.

Scope:

- Add conservative export pattern target handling.
- Validate pattern target containment.
- Match simple target files when the target prefix exists.
- Cross-check matched files against pack output.
- Add tests for valid patterns, missing pattern output, and unsupported complex patterns.

Out of scope:

- Full Node resolver semantics.
- Build execution.

Acceptance criteria:

- Common `./feature/*` export patterns receive useful validation.
- Unsupported shapes warn without crashing.

## Phase 6: Conservative Fix Expansion

Goal: add useful fixes that remain safe and idempotent.

Scope:

- Add fix plans for `publishConfig.access`, `files`, `engines.node`, and `sideEffects: false`.
- Require narrow source evidence for each fix.
- Add dry-run and idempotency tests.
- Update docs.

Out of scope:

- Rewriting `exports`.
- Removing scripts or dependencies.
- Inferring Node minimum from the currently installed runtime alone.

Acceptance criteria:

- Each new fix is independently tested.
- Running `fix` twice produces no second diff.
- `fix --json` remains schema-compatible.

## Phase 7: Public Docs and Examples

Goal: make v0.2.0 understandable to users.

Scope:

- Update README with preset examples.
- Update checks, configuration, release workflow, and examples docs.
- Add a changelog entry.

Acceptance criteria:

- Docs explain what changed and how to suppress intentional findings.
- Docs avoid exposing internal implementation details.

## Phase 8: Final Verification

Goal: prepare v0.2.0 for release.

Suggested commands:

```sh
npm test
npm run typecheck
npm run lint
npm run build
node dist/cli/index.js check
npm pack --dry-run --json --ignore-scripts
```

Acceptance criteria:

- Full verification passes.
- Packed output is clean.
- The release notes map directly to implemented user-facing behavior.
