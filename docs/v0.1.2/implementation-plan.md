# pkg-guard v0.1.2 Implementation Plan

## Purpose

This patch should clean up two small correctness issues before v0.2.0 starts. Keep each phase independently reviewable and avoid broad refactors.

## Phase 0: Baseline

Goal: confirm the current v0.1.1 state.

Scope:

- Run the focused release and fix tests.
- Run typecheck.

Suggested commands:

```sh
npm test -- tests/release.test.ts tests/fixes.test.ts
npm run typecheck
```

Acceptance criteria:

- Existing tests pass before production edits.

Status:

- Completed on 2026-06-21.
- `npm test -- tests/release.test.ts tests/fixes.test.ts` passed: 13 tests across 2 test files.
- `npm run typecheck` passed.

## Phase 1: Publish Command Selection

Goal: generate the right npm publish command for scoped and private packages.

Scope:

- Add a helper in `src/core/release.ts` that derives a publish command from `package.json`.
- Keep `npm publish` for unscoped packages.
- Use `npm publish --access public` for scoped public packages.
- Respect `publishConfig.access` when it is `public` or `restricted`.
- Refuse to create a workflow for `private: true`.
- Include the selected publish command in `InitReleaseResult`.

Out of scope:

- npm staged publishing.
- Multiple registries.
- Provider-specific workflow variants.

Acceptance criteria:

- Release tests cover unscoped, scoped public, scoped restricted, and private package behavior.
- Existing npm, pnpm, Yarn, and Bun install command tests still pass.

## Phase 2: Types Fix Finding Consistency

Goal: make `fix.types` trace back to a real documented finding.

Preferred scope:

- Add a `manifest.types-missing` warning when:
  - the package is publishable,
  - neither `types` nor `typings` exists,
  - `dist/index.d.ts` exists.
- Mark the finding as fixable.
- Document the check ID in `docs/checks.md`.
- Keep `fix.types` using `findingId: "manifest.types-missing"`.

Fallback scope:

- If the new warning proves too noisy, make `FixPlan.findingId` optional and omit it for opportunistic fixes.

Acceptance criteria:

- `check` reports `manifest.types-missing` only in the narrow detectable case.
- `fix --json` references only real finding IDs.
- Existing fix idempotency tests still pass.

## Phase 3: Documentation and Changelog

Goal: make the patch easy to review and release.

Scope:

- Add a `0.1.2` changelog entry.
- Update release workflow docs to mention scoped package access behavior.
- Update check docs if `manifest.types-missing` is added.

Acceptance criteria:

- User-facing docs describe behavior, not implementation internals.

## Phase 4: Final Verification

Goal: verify the patch is release-ready.

Suggested commands:

```sh
npm test -- tests/release.test.ts tests/fixes.test.ts tests/manifest-checks.test.ts
npm test
npm run typecheck
npm run lint
npm run build
node dist/cli/index.js check
npm pack --dry-run --json --ignore-scripts
```

Acceptance criteria:

- All checks pass.
- Packed output remains clean.
- The final diff maps only to v0.1.2 scope.
