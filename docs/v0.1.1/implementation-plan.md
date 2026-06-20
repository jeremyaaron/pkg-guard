# pkg-guard v0.1.1 Implementation Plan

## Purpose

This plan breaks the v0.1.1 PRD and technical design into a small sequence of implementation phases. The release goal is narrow: reduce false-positive release workflow findings by statically expanding package scripts referenced from GitHub Actions `run:` steps.

Reference documents:

- [PRD](prd.md)
- [Technical Design](technical-design.md)
- [GitHub issue #2](https://github.com/jeremyaaron/pkg-guard/issues/2)

## Release Scope

Version: `v0.1.1`

Release type: patch

Primary change:

- Workflow required-step detection should consider commands reachable through package scripts invoked by npm, pnpm, Yarn, and Bun workflow commands.

Explicitly out of scope:

- New CLI options.
- New check IDs.
- New reporter fields.
- Workflow generation changes.
- Script execution.
- Full shell parsing.
- Classifying a workflow as publish-related solely because a package script contains `npm publish`.
- New package-validation command forms such as `npm exec pkg-guard check`.

## Phase 0: Baseline Verification

Goal: confirm the current failure mode and establish a clean baseline before editing code.

Scope:

- Run the existing workflow tests.
- Optionally add or temporarily exercise a failing fixture that reproduces issue #2.
- Confirm current behavior reports the missing test, build, and package-validation findings for an aggregate script workflow.

Acceptance criteria:

- Existing tests pass before the implementation starts, or any pre-existing failures are documented.
- The false-positive behavior from issue #2 is understood against the current code path.

Status:

- Completed on 2026-06-20.
- `npm test -- tests/workflows.test.ts` passed: 7 workflow tests.
- `npm run typecheck` passed.
- A temporary reproduction fixture confirmed the current implementation reports:
  - `workflow.test-step-missing`
  - `workflow.build-step-missing`
  - `workflow.package-validation-missing`
- The temporary reproduction fixture was removed after verification.

Suggested commands:

```sh
npm test -- tests/workflows.test.ts
npm run typecheck
```

## Phase 1: Test Fixture Support

Goal: make workflow tests able to model package scripts cleanly.

Scope:

- Update `tests/workflows.test.ts` fixture helper to accept optional `scripts`.
- Write provided scripts into the fixture `package.json`.
- Preserve current fixture defaults when `scripts` is omitted.

Out of scope:

- Changing production workflow analysis.
- Rewriting existing tests unrelated to workflow script expansion.

Acceptance criteria:

- Existing workflow tests still pass with the updated fixture helper.
- New tests can express package script chains without duplicating package fixture setup.

Status:

- Completed on 2026-06-20.
- `tests/workflows.test.ts` fixture helper now accepts optional `scripts`.
- The helper preserves existing package fixture defaults when `scripts` is omitted.
- `npm test -- tests/workflows.test.ts` passed: 7 workflow tests.
- `npm run typecheck` passed.

## Phase 2: Failing Coverage for Script Expansion

Goal: encode the PRD acceptance criteria before implementing the production change.

Scope:

- Add a test for `npm run verify:release` where:
  - `verify:release` invokes `npm test`.
  - `verify:release` invokes `npm run build`.
  - `verify:release` invokes `npm run pack:check`.
  - `pack:check` contains `pkg-guard check && npm pack --dry-run --ignore-scripts`.
- Assert that the workflow does not report:
  - `workflow.test-step-missing`
  - `workflow.build-step-missing`
  - `workflow.package-validation-missing`
- Add package-manager equivalent coverage for:
  - `pnpm run verify:release`
  - `yarn verify:release`
  - `bun run verify:release`
- Add edge-case coverage for:
  - cyclic scripts
  - missing referenced scripts
  - malformed or non-string script values

Out of scope:

- Broad command parser tests that do not map to user-facing workflow findings.

Acceptance criteria:

- New tests fail for the expected reason before production implementation.
- Test names clearly describe the behavior being protected.

Status:

- Completed on 2026-06-20.
- Added expected-behavior workflow tests for nested `npm run verify:release` expansion.
- Added package-manager equivalent coverage for `pnpm run verify:release`, `yarn verify:release`, and `bun run verify:release`.
- Added edge-case coverage for cyclic scripts, missing referenced scripts, and malformed or non-string `scripts` values.
- `npm test -- tests/workflows.test.ts` now fails as expected: 5 expansion tests still report `workflow.test-step-missing` before production implementation.
- `npm run typecheck` passed.

## Phase 3: Package Script Extraction

Goal: make workflow analysis aware of string-valued package scripts from the existing project context.

Scope:

- Add a private helper in `src/checks/workflows.ts`:

```ts
function getPackageScripts(value: unknown): Record<string, string>
```

- Return an empty object for missing or malformed `scripts`.
- Include only string-valued script entries.
- Pass extracted scripts from `runWorkflowChecks(context)` into workflow analysis.

Out of scope:

- Adding fields to `ProjectContext`.
- Creating a shared script-analysis module.

Acceptance criteria:

- Malformed `scripts` data does not crash workflow analysis.
- TypeScript remains clean without weakening manifest types.

Status:

- Completed on 2026-06-20.
- Added private `getPackageScripts(value: unknown): Record<string, string>` helper in `src/checks/workflows.ts`.
- Extracted string-valued package scripts from `context.manifest.data.scripts`.
- Passed extracted package scripts into private workflow analysis state without changing `ProjectContext`.
- `npm run typecheck` passed.
- `npm test -- tests/workflows.test.ts` still fails as expected: the same 5 Phase 2 expansion tests require Phase 4-6 production work.

## Phase 4: Script Invocation Detection

Goal: detect package script names referenced inside workflow and package script command strings.

Scope:

- Add a private helper in `src/checks/workflows.ts`:

```ts
function collectScriptInvocations(command: string): string[]
```

- Support:
  - `npm run <script>`
  - `npm run-script <script>`
  - `npm <script>`
  - `pnpm run <script>`
  - `pnpm <script>`
  - `yarn run <script>`
  - `yarn <script>`
  - `bun run <script>`
- Normalize line continuations and whitespace before matching.
- Treat shell operators and whitespace as script-name boundaries.

Out of scope:

- Full shell parsing.
- Command substitution or variable expansion.
- Distinguishing package-manager built-ins unless a matching package script exists.

Acceptance criteria:

- Multiple invocations in one command are discovered.
- Script names with `:`, `-`, `_`, and `.` are discovered.
- Flags after a script name do not prevent discovery.

Status:

- Completed on 2026-06-20.
- Added private `collectScriptInvocations(command: string): string[]` helper in `src/checks/workflows.ts`.
- Supports npm, pnpm, Yarn, and Bun script invocation forms from the technical design.
- Seeds initial workflow-level script invocations in private workflow analysis state for Phase 5.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test -- tests/workflows.test.ts` still fails as expected: the same 5 expansion tests require Phase 5-6 production work.

## Phase 5: Recursive Expansion

Goal: build the expanded command list used by required-step workflow checks.

Scope:

- Add a private helper in `src/checks/workflows.ts`:

```ts
function expandPackageScripts(commands: string[], scripts: Record<string, string>): string[]
```

- Include original workflow commands in the returned list.
- Include every reachable string-valued package script command.
- Use a `visited` set to avoid direct and indirect cycles.
- Use a maximum expansion count, such as `50`, to avoid excessive work.
- Stop silently if the expansion limit is reached.

Out of scope:

- Emitting new findings when expansion is truncated.
- Reporting expansion traces.

Acceptance criteria:

- Nested package scripts become visible to validation detection.
- Cyclic scripts terminate.
- Unknown script names are ignored.

Status:

- Completed on 2026-06-20.
- Added private `expandPackageScripts(commands, scripts)` helper in `src/checks/workflows.ts`.
- Expansion includes original workflow commands and reachable package script commands.
- Expansion uses both visited-script cycle protection and a `50` script expansion cap.
- Private workflow analysis now computes `validationCommands` for Phase 6.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test -- tests/workflows.test.ts` still fails as expected: the same 5 expansion tests require Phase 6 wiring.

## Phase 6: Wire Expanded Commands into Workflow Analysis

Goal: use the expanded command list for missing-step checks while preserving existing publish workflow detection.

Scope:

- Extend the internal `WorkflowAnalysis` shape with `validationCommands`.
- Keep `publishSteps` derived from direct workflow `stepRuns`.
- Run `hasInstallStep`, `hasTestStep`, `hasBuildStep`, and `hasPackageValidationStep` against `validationCommands`.
- Leave token, OIDC, risky-trigger, and YAML parsing behavior unchanged.

Out of scope:

- Changing `isPublishCommand`.
- Treating scripted `npm publish` as enough to classify a workflow as publish-related.
- Changing finding text.

Acceptance criteria:

- Issue #2 false positives are resolved.
- Direct-command workflow behavior remains unchanged.
- Non-publish workflows remain ignored as before.

Status:

- Completed on 2026-06-20.
- Required publish-step checks now use `analysis.validationCommands`.
- Publish workflow detection still derives `publishSteps` from direct workflow `stepRuns`.
- Token, OIDC, risky-trigger, YAML parsing, and finding text behavior were left unchanged.
- `npm test -- tests/workflows.test.ts` passed: 16 workflow tests.
- `npm run typecheck` passed.
- `npm run lint` passed.

## Phase 7: Documentation and Release Notes

Goal: document the behavior change at the user-facing level without exposing implementation detail unnecessarily.

Scope:

- Update `CHANGELOG.md` with an unreleased or v0.1.1 entry.
- Consider a short note in `docs/checks.md` or `docs/release-workflow.md` if the current wording implies only direct workflow commands are inspected.
- Keep development docs in `docs/v0.1.1`.

Out of scope:

- Linking development docs from the README.
- Large public docs restructuring.

Acceptance criteria:

- The changelog describes the false-positive fix clearly.
- User-facing docs remain focused on usage, not internal planning.

Status:

- Completed on 2026-06-20.
- Added a `0.1.1` changelog entry describing package-script workflow validation detection.
- Added a concise workflow note to `docs/checks.md` explaining that direct workflow commands and reachable package scripts are recognized.
- Did not link development docs from the README.

## Phase 8: Final Verification

Goal: verify the patch is ready to release.

Scope:

- Run focused workflow tests.
- Run the full test suite.
- Run typecheck and lint.
- Run build.
- Optionally run `pkg-guard check` against this repo after build to confirm the tool's own release workflow remains clean.

Suggested commands:

```sh
npm test -- tests/workflows.test.ts
npm test
npm run typecheck
npm run lint
npm run build
node dist/cli/index.js check
```

Acceptance criteria:

- All required checks pass.
- No unrelated files are changed.
- The final diff maps cleanly to the v0.1.1 PRD and technical design.

Status:

- Completed on 2026-06-20.
- `npm test -- tests/workflows.test.ts` passed: 16 workflow tests.
- `npm test` passed: 83 tests across 11 test files.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `node dist/cli/index.js check` passed and reported no issues.

## Review Checklist

- Script expansion is static only.
- Expansion is bounded by both visited scripts and a max count.
- Existing check IDs and finding text are preserved.
- Required-step checks use expanded commands.
- Publish workflow detection still uses direct workflow commands.
- Tests cover npm, pnpm, Yarn, Bun, nested scripts, cycles, missing scripts, and malformed scripts.
- Changelog describes the release as a workflow false-positive fix.
