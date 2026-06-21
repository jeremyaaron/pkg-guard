# pkg-guard v0.1.2 PRD

## Summary

`pkg-guard` v0.1.2 should be a small patch release before the next minor version. The current v0.1.1 baseline is healthy enough to start v0.2.0 planning, but two small polish items are worth resolving first because they affect trust in generated output and machine-readable fix metadata.

The patch should not add a new capability area. It should tighten behavior that already exists.

## Recommendation

Ship v0.1.2 before v0.2.0 if the project wants a clean base for the next development cycle.

This is not a blocker for local development on v0.2.0, but it is the right release sequencing:

1. Publish a narrow v0.1.2 patch.
2. Cut a `v0.2.0` development branch or begin the v0.2.0 phases from a clean main branch.

## Problems

### Scoped Package Release Workflows

`pkg-guard init-release` currently generates `npm publish` for every package.

That is correct for unscoped public packages, but scoped public packages usually need `npm publish --access public` unless package metadata or npm-side configuration handles access explicitly. A generated workflow should not fail for the common scoped-public package case.

### Opportunistic Types Fix Metadata

`pkg-guard fix` can add top-level `types` when `dist/index.d.ts` exists, but the fix plan reports `findingId: "manifest.types-missing"`.

That finding ID is not emitted by `pkg-guard check` and is not documented in `docs/checks.md`. Human output is still understandable, but JSON consumers receive a source finding that does not exist.

## Goals

- Keep v0.1.2 patch-sized and low-risk.
- Make generated release workflows handle scoped public packages more accurately.
- Make fix-plan metadata internally consistent.
- Preserve existing CLI commands and options.
- Preserve existing check IDs unless a new check is clearly necessary and documented.
- Add focused tests for the two behaviors.

## Non-Goals

- Add presets.
- Add monorepo support.
- Add new workflow providers.
- Add staged publishing support.
- Add broad package validation command coverage.
- Add import graph analysis.
- Redesign JSON output.

## Functional Requirements

### Release Workflow Publish Command

- For unscoped packages, keep generating `npm publish`.
- For scoped packages that appear public, generate `npm publish --access public`.
- If `publishConfig.access` is set, respect it instead of guessing:
  - `public` -> `npm publish --access public`
  - `restricted` -> `npm publish --access restricted`
- If `private: true`, `init-release` should return a clear non-created result instead of generating a publish workflow.
- Human and JSON init-release output should include the publish command used.

### Types Fix Metadata

Choose the smallest consistent implementation:

- Preferred: add a documented `manifest.types-missing` warning when a publishable package has `dist/index.d.ts` but lacks `types` and `typings`.
- Alternative: change `FixPlan` so opportunistic fixes do not claim a source finding ID.

The preferred path keeps the existing JSON shape and makes the existing fixable behavior discoverable through `check`.

## Acceptance Criteria

- `init-release` generates `npm publish --access public` for `@scope/name` packages without explicit private access.
- `init-release` preserves `npm publish` for unscoped packages.
- `init-release` handles `publishConfig.access` explicitly.
- `init-release` refuses private packages with a clear message and no workflow write.
- `fix --json` no longer reports a nonexistent finding ID.
- `docs/checks.md` documents any new finding ID.
- Full verification passes:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `node dist/cli/index.js check`
