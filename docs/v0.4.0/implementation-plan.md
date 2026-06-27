# pkg-guard v0.4.0 Implementation Plan

## Purpose

v0.4.0 moves `pkg-guard` toward published artifact contract verification while keeping the existing CLI stable. The release should build on current packlist validation, add opt-in consumer smoke checks, and introduce an internal analysis boundary that can later support IDE integrations.

The implementation should avoid turning `pkg-guard` into a release orchestrator or package-manager simulator. Default checks stay deterministic and read-only. Slower package-manager work belongs behind `--consumer-smoke`.

## Design Decisions

The technical design left several choices open. For implementation, use these defaults:

- Move CLI check orchestration to `src/core/analysis.ts` immediately, and route both single-package and workspace check paths through it.
- Keep the analysis API internal in v0.4.0. Do not add package `exports` for it yet.
- Keep artifact contract checks in the default path because they already rely on `PackInfo`.
- Do not add an `--artifact` flag.
- Keep `pack.entrypoint-missing` and `pack.unsupported-target` for packlist target validation. Do not add `artifact.*` IDs in v0.4.0.
- Create consumer smoke tarballs inside `src/core/consumer-smoke.ts` with `npm pack --json --ignore-scripts --pack-destination`.
- Include runtime and bin smoke first, then add best-effort TypeScript smoke if it can be done without network access.
- Use npm for consumer tarball install in v0.4.0, even for pnpm/Yarn/Bun source projects.
- Do not execute package runtime modules or bin commands in smoke checks.
- Do not add new contract presets in v0.4.0 unless implementation reveals a concrete noise problem.

## Phase 0: Baseline

Goal: confirm the v0.3.2 release baseline before production changes.

Scope:

- Run focused pack, entrypoint, CLI, and batch tests.
- Run typecheck.
- Confirm the repo version is at `0.3.2` and the v0.4.0 PRD/design exist.

Suggested commands:

```sh
npm test -- tests/pack.test.ts tests/entrypoints.test.ts tests/cli-run.test.ts tests/batch.test.ts
npm run typecheck
```

Acceptance criteria:

- Existing focused tests pass.
- Baseline status is recorded in this file.

Status:

- Completed on 2026-06-27.
- Confirmed `package.json` and `package-lock.json` are at `0.3.2`.
- Confirmed `docs/v0.4.0/prd.md` and `docs/v0.4.0/technical-design.md` exist.
- `npm test -- tests/pack.test.ts tests/entrypoints.test.ts tests/cli-run.test.ts tests/batch.test.ts` passed: 57 tests across 4 test files.
- `npm run typecheck` passed.

## Phase 1: CLI Option Model

Goal: add the `--consumer-smoke` option without behavior changes.

Scope:

- Add `consumerSmoke: boolean` to `ParsedOptions`.
- Parse `--consumer-smoke`.
- Allow it only for `check`.
- Update help text.
- Add CLI option tests for:
  - accepted with `check`;
  - accepted with `check --workspaces`;
  - rejected for `fix`, `init`, and `init-release`.

Out of scope:

- Running smoke checks.
- Analysis layer refactor.
- Reporter changes.

Acceptance criteria:

- Existing `check` behavior is unchanged when `--consumer-smoke` is absent.
- Invalid command combinations return usage errors.
- Typecheck passes.

Suggested commands:

```sh
npm test -- tests/cli-run.test.ts
npm run typecheck
```

Status:

- Pending.

## Phase 2: Shared Package Target Collection

Goal: extract declared package target collection from `pack.ts` for reuse by pack checks and smoke checks.

Scope:

- Add `src/core/package-targets.ts`.
- Move collection of:
  - `main`
  - `module`
  - `types`
  - `typings`
  - `bin`
  - string export targets
  - simple export patterns
  - nested conditional export targets
- Preserve unsupported-shape findings as `pack.unsupported-target`.
- Add `conditions: string[]` metadata for export condition traversal.
- Update `src/checks/pack.ts` to consume the shared target collector.
- Preserve existing `pack.entrypoint-missing` behavior and IDs.

Out of scope:

- Consumer smoke.
- New artifact IDs.
- Full Node export resolution.

Acceptance criteria:

- Existing pack and entrypoint tests pass.
- New target-collection unit coverage confirms nested condition metadata.
- Pack warnings/errors remain stable except for intentional message improvements.

Suggested commands:

```sh
npm test -- tests/pack.test.ts tests/entrypoints.test.ts
npm run typecheck
```

Status:

- Pending.

## Phase 3: Analysis Boundary

Goal: move check orchestration out of CLI rendering and into `src/core/analysis.ts`.

Scope:

- Add `analyzePackage`.
- Add `analyzeWorkspacePackage` or equivalent package-level helper for batch checks.
- Move these responsibilities into analysis:
  - `discoverProject`;
  - optional workspace context attachment;
  - `runChecks`;
  - package config policy;
  - CLI ignore/strict policy.
- Keep report creation, rendering, and exit-code selection in CLI/reporting layers.
- Update single-package `check` path to use `analyzePackage`.
- Update workspace batch checks to use the analysis helper.

Out of scope:

- Exporting a public API from package metadata.
- Consumer smoke behavior beyond a placeholder option path.
- Fix/init command refactors.

Acceptance criteria:

- Single-package and workspace `check` behavior is unchanged without `--consumer-smoke`.
- Existing CLI, batch, dependency, and reporter tests pass.
- The new analysis functions return structured findings without writing to stdout/stderr.

Suggested commands:

```sh
npm test -- tests/cli-run.test.ts tests/batch.test.ts tests/dependencies.test.ts tests/reporters.test.ts
npm run typecheck
```

Status:

- Pending.

## Phase 4: Consumer Smoke Skeleton

Goal: add the smoke-check execution path with safe pack/install failure reporting.

Scope:

- Add `src/core/consumer-smoke.ts`.
- Add `runConsumerSmokeChecks(context, options)`.
- Create and clean up temporary directories.
- Run `npm pack --json --ignore-scripts --pack-destination <temp>`.
- Run `npm install --ignore-scripts --no-audit --no-fund <tarball>` in a temp consumer project.
- Add timeout handling.
- Emit:
  - `consumer.pack-failed`
  - `consumer.install-failed`
- Wire `--consumer-smoke` through `analyzePackage`.
- Add tests proving lifecycle scripts are not run.

Out of scope:

- Runtime import/require probes.
- TypeScript probes.
- Bin probes.
- Workspace-specific smoke behavior beyond the common package analysis path.

Acceptance criteria:

- `pkg-guard check --consumer-smoke` runs smoke setup and returns normal findings.
- Pack/install failures produce stable findings.
- Smoke checks do not run package lifecycle scripts.
- Temp files are cleaned up.

Suggested commands:

```sh
npm test -- tests/consumer-smoke.test.ts tests/cli-run.test.ts
npm run typecheck
```

Status:

- Pending.

## Phase 5: Runtime Resolution Smoke

Goal: detect consumer runtime resolution failures without executing package modules.

Scope:

- Use shared package target metadata and manifest name.
- Derive public probes:
  - bare package name when no `exports` exists;
  - explicit export subpaths when `exports` exists;
  - skip export patterns.
- Run CJS probes with `require.resolve`.
- Run ESM probes with `import.meta.resolve`.
- Choose probe kind from export conditions and package `"type"`.
- Emit:
  - `consumer.require-unresolved`
  - `consumer.import-unresolved`
- Include `file` and `path` pointing back to `package.json` target metadata when possible.

Out of scope:

- Executing imported modules.
- Pattern export representative subpath generation.
- Bundler-specific resolution.

Acceptance criteria:

- Missing consumer runtime targets are detected from installed tarballs.
- Valid packages pass runtime smoke.
- Export pattern targets are skipped without false errors.
- Findings render correctly in human output.

Suggested commands:

```sh
npm test -- tests/consumer-smoke.test.ts tests/cli-run.test.ts
npm run typecheck
```

Status:

- Pending.

## Phase 6: Bin and Best-Effort Type Smoke

Goal: add non-executing installed bin checks and TypeScript declaration resolution when local TypeScript is available.

Scope:

- Bin smoke:
  - read installed package metadata;
  - verify declared bin entries exist after install;
  - verify installed bin targets have shebangs;
  - emit `consumer.bin-unresolved`.
- Type smoke:
  - resolve local TypeScript without network access;
  - create a temporary TypeScript consumer file;
  - run TypeScript with `--noEmit`, `moduleResolution nodenext`, `module nodenext`, and `target es2022`;
  - emit `consumer.types-unresolved` on resolution failure;
  - silently skip type smoke if TypeScript is unavailable.

Out of scope:

- Running CLI bins.
- TypeScript build orchestration.
- Remote `npx` TypeScript downloads.

Acceptance criteria:

- Installed bin layout issues are detected without executing bins.
- Type declaration resolution issues are detected when TypeScript is available.
- No network access is required for type smoke.
- Smoke tests remain deterministic.

Suggested commands:

```sh
npm test -- tests/consumer-smoke.test.ts tests/typescript.test.ts tests/entrypoints.test.ts
npm run typecheck
```

Status:

- Pending.

## Phase 7: Workspace and Reporter Smoke Coverage

Goal: verify consumer smoke through workspace and user-facing reporter paths.

Scope:

- Add workspace CLI tests for `check --workspaces --consumer-smoke`.
- Confirm package-scoped JSON findings.
- Confirm SARIF renders consumer findings with package-relative paths.
- Confirm workspace smoke continues after one package fails.
- Document known workspace install limitation in test names or comments where relevant.

Out of scope:

- Installing the entire workspace.
- Package-manager-specific workspace publish simulation.
- Reporter schema changes.

Acceptance criteria:

- Workspace smoke findings stay inside package reports.
- JSON and SARIF schemas remain unchanged.
- Human output is understandable without new sections.

Suggested commands:

```sh
npm test -- tests/cli-run.test.ts tests/batch.test.ts tests/reporters.test.ts
npm run typecheck
```

Status:

- Pending.

## Phase 8: Documentation and Changelog

Goal: document artifact contract checks, consumer smoke mode, and IDE-readiness.

Scope:

- Add a `0.4.0` changelog entry.
- Update `docs/checks.md`:
  - clarify `pack.entrypoint-missing`;
  - document `consumer.*` IDs.
- Update `docs/examples.md` with `pkg-guard check --consumer-smoke`.
- Update `docs/configuration.md` only if config or preset behavior changes.
- Add a short package contract class explanation.
- Mention that IDE integration is future-facing and enabled by internal analysis cleanup.

Acceptance criteria:

- Docs explain when smoke checks run and why they are opt-in.
- Docs explain that consumer smoke uses npm tarball install and does not run lifecycle scripts.
- Docs explain workspace smoke limitations.
- Changelog maps to the v0.4.0 PRD.

Suggested commands:

```sh
npm run lint
```

Status:

- Pending.

## Phase 9: Final Verification and Release Prep

Goal: prepare v0.4.0 for release.

Scope:

- Run focused tests.
- Run full verification.
- Verify pack output.
- Bump `package.json` and `package-lock.json` from `0.3.2` to `0.4.0`.
- Re-run full verification after the version bump.

Suggested commands:

```sh
npm test -- tests/pack.test.ts tests/consumer-smoke.test.ts tests/cli-run.test.ts tests/batch.test.ts
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
- `CHANGELOG.md` includes `0.4.0`.
- The final diff maps to the v0.4.0 PRD, technical design, and implementation plan.

Status:

- Pending.
