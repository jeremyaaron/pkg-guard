# pkg-guard v0.3.1 Patch Plan

## Summary

`pkg-guard` v0.3.1 should be a narrow patch release that improves trust in TypeScript findings reported by `pkg-guard@0.3.0`.

The release is driven by two feedback issues:

- [#8: `typescript.types-source-file` warns on generated `dist/*.d.ts` type entry](https://github.com/jeremyaaron/pkg-guard/issues/8)
- [#9: Resolve extended tsconfig before warning on declaration settings](https://github.com/jeremyaaron/pkg-guard/issues/9)

Both issues are in the existing TypeScript check surface. This does not need the full PRD -> technical design -> implementation plan sequence because the scope is small, the product direction is clear, and the implementation should stay tightly bounded.

## Product Rationale

`pkg-guard` should be strict enough to catch release blockers, but it should not create noisy warning loops while users are following its own recommendations.

Issue #8 is a correctness bug: `types: "./dist/index.d.ts"` is generated declaration output and should not be flagged as TypeScript source.

Issue #9 is a confidence bug: when `tsconfig.json` extends another config that `pkg-guard` does not resolve, absence-based compiler option findings can be based on incomplete data. A warning about unresolved inheritance is useful; derived warnings from incomplete local config are less useful.

## Goals

- Fix the false positive for generated declaration files in top-level `types` and `typings`.
- Reduce TypeScript warning noise when `tsconfig.json` uses unresolved `extends`.
- Keep v0.3.1 patch-sized and low-risk.
- Preserve existing check IDs.
- Add focused tests that reproduce both issue reports.
- Keep docs and changelog aligned with changed behavior.

## Non-Goals

- Add full TypeScript project graph support.
- Resolve package-based `extends` such as `@tsconfig/node22/tsconfig.json`.
- Model build tools such as `tsup`, `rollup-plugin-dts`, or API Extractor.
- Add new output formats or CLI flags.
- Change the severity model.

## Technical Direction

### Declaration File Detection

`typescript.types-source-file` should warn only when top-level `types` or `typings` points at implementation TypeScript source.

Warn for:

- `.ts`
- `.tsx`
- `.mts`
- `.cts`

Do not warn for:

- `.d.ts`
- `.d.mts`
- `.d.cts`

The fix should be path-syntax based. It should not require the declaration file to exist because missing declared targets are already covered by entrypoint and pack checks.

### Unresolved `extends` Confidence

When `tsconfig.json` has `extends`, v0.3.1 should keep emitting `typescript.extends-unresolved`.

While extended config resolution remains unsupported, suppress absence-based compiler option findings that depend on complete merged config:

- suppress `typescript.declaration-missing` when declaration settings are absent locally but could be inherited

Keep findings based on directly observed local config:

- keep `typescript.declaration-map-enabled` when local `compilerOptions.declarationMap === true`
- keep `typescript.outdir-mismatch` only when local `compilerOptions.outDir` is present, because the finding is based on observed local config
- keep `typescript.types-source-file`, because it is based on package metadata rather than inherited compiler options

This gives users one clear limitation warning instead of compounding it with low-confidence absence warnings.

## Phase 0: Baseline

Goal: confirm the current v0.3.0 state before patch edits.

Scope:

- Run focused TypeScript tests.
- Run typecheck.
- Confirm issue #8 and #9 are still open and mapped to this patch plan.

Suggested commands:

```sh
npm test -- tests/typescript.test.ts
npm run typecheck
```

Acceptance criteria:

- Existing TypeScript tests pass before production edits.
- Baseline status is recorded in this file.

Status:

- Completed on 2026-06-25.
- `npm test -- tests/typescript.test.ts` passed: 7 tests in 1 test file.
- `npm run typecheck` passed.
- Confirmed issue #8 is open: `typescript.types-source-file` warns on generated `dist/*.d.ts` type entry.
- Confirmed issue #9 is open: resolve extended tsconfig before warning on declaration settings.

## Phase 1: Declaration Target Classification

Goal: fix issue #8.

Scope:

- Update `typescript.types-source-file` classification so declaration files are not treated as TypeScript source.
- Add tests for:
  - `types: "./dist/index.d.ts"` does not warn
  - `typings: "./dist/index.d.cts"` does not warn
  - `types: "./src/index.ts"` still warns
  - `types: "./src/index.tsx"` still warns

Out of scope:

- Checking whether the declaration target exists.
- Rewriting package metadata.

Acceptance criteria:

- Issue #8 reproducer no longer reports `typescript.types-source-file`.
- Source TypeScript targets still report `typescript.types-source-file`.

Status:

- Completed on 2026-06-25.
- Added TypeScript tests confirming `types: "./dist/index.d.ts"`, `typings: "./dist/index.d.cts"`, and `types: "./dist/index.d.mts"` do not emit `typescript.types-source-file`.
- Added TypeScript tests confirming implementation source targets `.ts`, `.tsx`, `.mts`, and `.cts` still emit `typescript.types-source-file`.
- Updated the TypeScript source-target classifier to exclude declaration files while preserving implementation source warnings.
- `npm test -- tests/typescript.test.ts` passed: 14 tests in 1 test file.
- `npm run typecheck` passed.

## Phase 2: Extended Tsconfig Confidence Gate

Goal: fix issue #9 without implementing full `extends` resolution.

Scope:

- Keep `typescript.extends-unresolved` when `tsconfig.json` has `extends`.
- Suppress `typescript.declaration-missing` when `extends` is present and local declaration settings are absent.
- Keep direct-observation findings when local config explicitly sets risky values.
- Add tests for:
  - unresolved `extends` with no local `declaration` does not emit `typescript.declaration-missing`
  - unresolved `extends` still emits `typescript.extends-unresolved`
  - local `declarationMap: true` still emits `typescript.declaration-map-enabled`
  - local `outDir` mismatch still emits `typescript.outdir-mismatch`

Out of scope:

- Resolving or merging extended configs.
- Reading `references`.
- Running TypeScript compiler APIs.

Acceptance criteria:

- Issue #9 pattern produces one confidence warning instead of an inferred missing-declaration warning.
- Existing direct config checks remain effective.

Status:

- Completed on 2026-06-25.
- Kept `typescript.extends-unresolved` for `tsconfig.json` files with `extends`.
- Suppressed the absence-based `typescript.declaration-missing` check when unresolved `extends` makes inherited declaration settings unknown.
- Preserved direct-observation checks for local `declarationMap: true` and local `outDir` mismatches.
- Added regression tests for unresolved `extends` without inferred declaration-missing, plus direct local declaration map and outDir findings under `extends`.
- `npm test -- tests/typescript.test.ts` passed: 16 tests in 1 test file.
- `npm run typecheck` passed.

## Phase 3: Documentation and Changelog

Goal: make the patch behavior clear to users.

Scope:

- Add a `0.3.1` changelog entry.
- Update `docs/checks.md` wording if needed to clarify `typescript.types-source-file`.
- Consider a short note in `docs/configuration.md` or `docs/examples.md` only if tests or implementation reveal behavior that needs user-facing explanation.

Acceptance criteria:

- Changelog maps directly to issues #8 and #9.
- Check docs remain accurate.

Status:

- Completed on 2026-06-25.
- Added a `0.3.1` changelog entry for issue #8 declaration target classification and issue #9 unresolved `extends` confidence gating.
- Updated `docs/checks.md` to clarify that `typescript.types-source-file` targets implementation TypeScript source, not generated declaration files.
- Updated `docs/checks.md` to clarify that `typescript.declaration-missing` applies when declaration settings can be checked directly.
- `npm test -- tests/typescript.test.ts` passed: 16 tests in 1 test file.
- `npm run typecheck` passed.
- `npm run lint` passed.

## Phase 4: Final Verification and Release Prep

Goal: prepare v0.3.1 for release.

Scope:

- Run focused tests.
- Run full verification.
- Verify pack output.
- Bump `package.json` and `package-lock.json` from `0.3.0` to `0.3.1`.
- Re-run full verification after the version bump.

Suggested commands:

```sh
npm test -- tests/typescript.test.ts
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
- `CHANGELOG.md` includes `0.3.1`.
- The final diff maps only to this patch plan.

Status:

- Completed on 2026-06-25.
- Pre-bump `npm test -- tests/typescript.test.ts` passed: 16 tests in 1 test file.
- Pre-bump `npm test` passed: 192 tests across 15 test files.
- Pre-bump `npm run typecheck` passed.
- Pre-bump `npm run lint` passed.
- Pre-bump `npm run build` passed.
- Pre-bump `node dist/cli/index.js check` passed with no issues.
- Pre-bump `npm pack --dry-run --json --ignore-scripts` passed and produced `pkg-guard-0.3.0.tgz` with 128 entries.
- Bumped `package.json` and `package-lock.json` from `0.3.0` to `0.3.1` using `npm version 0.3.1 --no-git-tag-version`.
- Confirmed `CHANGELOG.md` includes the `0.3.1` release notes.
- Post-bump `npm test -- tests/typescript.test.ts` passed: 16 tests in 1 test file.
- Post-bump `npm test` initially timed out in `tests/batch.test.ts` while running in parallel with other verification commands; isolated rerun passed: 192 tests across 15 test files.
- Post-bump `npm run typecheck` passed.
- Post-bump `npm run lint` passed.
- Post-bump `npm run build` passed.
- Post-bump `node dist/cli/index.js check` passed with no issues.
- Post-bump `npm pack --dry-run --json --ignore-scripts` passed and produced `pkg-guard-0.3.1.tgz` with 128 entries.
