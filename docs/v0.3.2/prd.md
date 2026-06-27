# pkg-guard v0.3.2 PRD

## Summary

`pkg-guard` v0.3.2 should refine `dependencies.workspace-range` so it remains a real publish guard without creating false confidence or unnecessary noise for pnpm workspace publishers.

The release is driven by [issue #11: `dependencies.workspace-range` should account for pnpm workspace publish semantics](https://github.com/jeremyaaron/pkg-guard/issues/11).

This is a patch release candidate because the finding already exists and is currently too blunt for a common workspace publishing setup. The scope is larger than the v0.3.1 TypeScript patch because the correct behavior depends on package manager, workspace graph, dependency target metadata, and publish path.

## Recommendation

Build v0.3.2 as a focused patch after v0.3.1.

Use the normal PRD -> technical design -> implementation plan sequence, but keep each document compact. The product decision needs review before implementation because the easy fix, suppressing all pnpm `workspace:` ranges, would weaken `pkg-guard` in npm-publish workflows.

## Problem

`pkg-guard` currently reports `dependencies.workspace-range` as an error for every `workspace:` dependency range in a public package.

That is useful when a `workspace:` range would leak into a published manifest. But in pnpm workspaces, pnpm rewrites `workspace:` protocol dependencies during `pnpm pack` and `pnpm publish` when the dependency resolves to a workspace package. In that context, `workspace:*` can be intentional and publish-safe.

The current check creates noise for valid pnpm monorepos, especially after v0.3.0 made workspace adoption easier. However, the finding should not simply disappear for every pnpm project:

- `pkg-guard init-release` currently generates workflows that publish with `npm publish`, even when dependencies were installed with pnpm.
- npm publish does not apply pnpm workspace protocol rewriting.
- A `workspace:` dependency is still unsafe if it points to no local workspace package.
- A public package depending on a private workspace package may still be a release hazard.
- Package-local `pkg-guard check` does not always have enough workspace context to prove safety.

The product needs a more precise finding that distinguishes "will leak" from "pnpm is expected to rewrite this."

## Goals

- Reduce false positives for valid pnpm workspace dependencies.
- Preserve `dependencies.workspace-range` as an error when a `workspace:` range can plausibly leak into a published manifest.
- Use workspace graph context when available to verify dependency targets.
- Account for the publish path instead of relying only on package manager detection.
- Keep single-package behavior conservative when workspace context is unavailable.
- Preserve the existing check ID unless a new ID is clearly needed.
- Keep user-facing output actionable.
- Add focused tests that cover pnpm-safe and unsafe workspace dependency cases.

## Non-Goals

- Add direct publishing support.
- Generate pnpm release workflows.
- Implement Changesets, pnpm recursive publish, or release orchestration.
- Fully model pnpm's publish-time manifest rewriting for every protocol/range form.
- Resolve dependency graphs across non-workspace package managers.
- Support arbitrary workspace glob semantics beyond current workspace discovery.
- Change package-local config inheritance.
- Add lockfile parsing.

## Target Users

Primary:

- Maintainers of pnpm monorepos with multiple publishable packages.
- Package authors using `workspace:*` or `workspace:^` between internal packages.
- Teams adopting `pkg-guard check --workspaces` as a release gate.

Secondary:

- Maintainers using npm, Yarn, or Bun workspaces who need clear errors when workspace protocol ranges could leak.
- Maintainers using generated npm trusted-publishing workflows.

## Product Behavior

### Current Finding

`dependencies.workspace-range` should remain the stable finding ID for workspace protocol dependency risks.

It should continue to fail release readiness when the source manifest is likely to publish an unresolved `workspace:` range.

### Workspace Context

When running in workspace mode, `pkg-guard` should be able to determine whether a `workspace:` dependency name resolves to a local workspace package.

If no workspace context is available, the check should stay conservative. A single-package `pkg-guard check` should not assume pnpm will rewrite a range unless the implementation can prove the package is part of a pnpm workspace and can inspect the target package metadata.

### Package Manager and Publish Path

`packageManager: "pnpm@..."` or a `pnpm-lock.yaml` is relevant but not sufficient by itself.

The check should distinguish at least these cases:

| Scenario | Expected behavior |
| --- | --- |
| npm/Yarn/Bun/unknown package with `workspace:` range | `dependencies.workspace-range` error |
| pnpm package with `workspace:` range but no workspace graph context | warning or error, depending on technical design confidence |
| pnpm workspace package depends on a missing workspace package | error |
| public package depends on private workspace package in publish-relevant dependency section | error or warning, depending on dependency section |
| pnpm workspace package depends on publishable local workspace package and publish path is pnpm pack/publish | no error; optional info if useful |
| pnpm workspace package depends on publishable local workspace package but detected workflow publishes with `npm publish` | error |

The npm-publish case is important because `pkg-guard` generated workflows currently use `npm publish` for trusted publishing. A package that is otherwise pnpm-managed can still publish through npm CLI and bypass pnpm's workspace range rewriting.

### Dependency Sections

The check currently scans:

- `dependencies`
- `devDependencies`
- `peerDependencies`
- `optionalDependencies`

v0.3.2 should preserve section-aware reporting. Technical design should decide whether section affects severity:

- `dependencies` and `optionalDependencies` are likely publish hazards.
- `peerDependencies` can also leak into package metadata and should be guarded.
- `devDependencies` may be lower risk for consumers but still appears in the published manifest metadata and should be considered intentionally.

### User Output

Messages should explain why the range is or is not considered safe.

Unsafe examples should say what is missing:

- no matching workspace package
- target package is private
- publish workflow uses npm publish
- package manager or workspace context is unknown

Safe pnpm examples should not require users to suppress the check. If the implementation emits an `info`, it should explain that pnpm is expected to rewrite the range during pnpm pack/publish.

## Functional Requirements

- Detect `workspace:` ranges in dependency sections as today.
- In workspace checks, build enough workspace package metadata to match dependency names to local packages.
- Treat missing workspace targets as unsafe.
- Treat target package privacy as relevant when the dependent package is publishable.
- Keep npm-publish workflow detection conservative and local to obvious workflow commands.
- Avoid suppressing `dependencies.workspace-range` solely because the package manager is pnpm.
- Update documentation for the refined behavior.
- Add a `0.3.2` changelog entry.

## Open Product Questions

1. Should pnpm-safe `workspace:` ranges be fully suppressed or reported as `info`?
2. Should `devDependencies` use lower severity than runtime sections when target resolution fails?
3. Should package-local `pkg-guard check` attempt to discover the workspace root automatically, or should the refined behavior apply only to `--workspaces` and `--workspace` runs?
4. Should npm-publish workflow detection override pnpm-safe suppression only when the workflow belongs to the package being checked, or also when a root workflow publishes all packages?
5. Should v0.3.2 include a docs-only recommendation to use pnpm publish for pnpm workspace protocol packages, or should it wait until workflow generation supports pnpm publish?

## Acceptance Criteria

- Valid pnpm workspace dependency on a publishable local package no longer creates a release-blocking error when the publish path is pnpm-safe.
- `dependencies.workspace-range` remains an error for npm/Yarn/Bun/unknown publish paths.
- `dependencies.workspace-range` remains an error when the dependency name does not resolve to a local workspace package.
- Public packages depending on private workspace packages are flagged.
- npm-publish workflows keep the finding release-blocking even in pnpm-managed repos.
- Single-package behavior remains conservative unless workspace context is confidently available.
- Docs explain the pnpm nuance and the npm-publish caveat.
- Full verification passes:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `node dist/cli/index.js check`
  - `npm pack --dry-run --json --ignore-scripts`
