# pkg-guard v0.3.2 Technical Design

## Overview

v0.3.2 should make `dependencies.workspace-range` precise enough for pnpm workspaces without weakening publish safety.

The design keeps the existing package-scoped `ProjectContext` model, but allows batch workspace execution to pass a small amount of workspace publish context into checks. Single-package checks remain conservative unless they can be extended later with confident workspace context.

The core product decisions are:

- Do not suppress `workspace:` findings solely because the package manager is pnpm.
- Do suppress the release-blocking error for pnpm workspace dependencies only when `pkg-guard` can prove the dependency points to a publishable local workspace package and the package's publish path is pnpm-safe.
- Emit no finding for proven pnpm-safe ranges in v0.3.2. Extra `info` output would add noise after the tool already proved safety.
- Keep missing workspace targets and npm-publish paths as errors.
- Keep `devDependencies` in scope, but allow lower severity when a dev-only workspace target is missing and the rest of the publish path is pnpm-safe.

## Data Model

Add optional workspace context to `ProjectContext`:

```ts
export interface ProjectContext {
  // existing fields
  workspace?: WorkspacePackageContext;
}

export interface WorkspacePackageContext {
  root: string;
  packageRoot: string;
  packageRelativePath: string;
  packageName: string | null;
  packageManager: PackageManagerInfo;
  packagesByName: Record<string, WorkspacePackageMetadata>;
  publishPath: WorkspacePublishPath;
}

export interface WorkspacePackageMetadata {
  name: string;
  relativePath: string;
  private: boolean;
}

export type WorkspacePublishPath =
  | { kind: "pnpm"; reason: string }
  | { kind: "npm"; reason: string }
  | { kind: "unknown"; reason: string };
```

Keep this context deliberately narrow. It exists for checks that need workspace graph and publish-path awareness. It should not become root policy inheritance or a general monorepo object.

## Workspace Context Construction

Build workspace context in the batch layer, not in every package discovery.

Current flow:

1. `discoverWorkspaces(root)` reads workspace packages.
2. `selectWorkspaceTargets(...)` selects targets.
3. `runBatchChecks(...)` calls `discoverProject(target.root)` for each package.
4. `runChecks(context)` runs package-local checks.

v0.3.2 flow:

1. Keep steps 1-3.
2. Build a `WorkspaceCheckContext` once in `runBatchChecks` from `WorkspaceDiscovery` and selected targets.
3. After `discoverProject(target.root)`, attach package-specific workspace context to the discovered `ProjectContext`.
4. Run existing checks.

Proposed batch option addition:

```ts
export interface BatchCheckOptions {
  // existing fields
  workspaceContext?: WorkspaceCheckContext;
}

export interface WorkspaceCheckContext {
  root: string;
  packageManager: PackageManagerInfo;
  packagesByName: Map<string, WorkspacePackageMetadata>;
  publishPath: WorkspacePublishPath;
}
```

`runWorkspaceCommand` already has `WorkspaceDiscovery`. It should pass enough root metadata into `runBatchChecks` for context construction.

## Package Manager Detection

Use root package-manager context for workspace protocol decisions.

Detection priority:

1. Root `packageManager` field if it names a known manager.
2. Root lockfiles discovered by existing project discovery.
3. Existing fallback behavior.

For v0.3.2, pnpm-safe suppression requires root manager detection to be pnpm. A child package's own `packageManager` field is not enough because workspace publish behavior is a root-level workflow concern.

## Publish Path Detection

Workspace protocol rewriting is only safe when the package is packed or published by pnpm. v0.3.2 should infer a conservative publish path from obvious local signals.

Publish path states:

- `pnpm`: root package manager is pnpm and no npm publish workflow is detected for the package or root.
- `npm`: an obvious workflow command runs `npm publish` or `npx semantic-release` for the package or root release path.
- `unknown`: root package manager is not pnpm, or publish path cannot be proven pnpm-safe.

Rules:

- If any relevant workflow contains a direct `npm publish` command, publish path is `npm`.
- If any relevant workflow contains `npx semantic-release`, publish path is `npm` for v0.3.2 because semantic-release npm publishing uses npm semantics unless configured otherwise.
- If root manager is pnpm and no npm publish workflow is detected, publish path is `pnpm`.
- Do not try to parse package scripts for publish commands in v0.3.2. Workflow checks already intentionally avoid classifying scripts as publish workflows for similar false-positive reasons.

Relevant workflows:

- Package-local `.github/workflows/*.yml` discovered by `discoverProject(target.root)`.
- Root `.github/workflows/*.yml` when running workspace mode.

Root workflows are considered relevant because many monorepos publish all packages from root workflows.

## Dependency Check Behavior

Extend `checkWorkspaceRanges` to use optional `context.workspace`.

Current signature:

```ts
function checkWorkspaceRanges(manifest: PackageManifest): Finding[]
```

New signature:

```ts
function checkWorkspaceRanges(context: ProjectContext): Finding[]
```

Behavior matrix:

| Condition | Severity | Finding |
| --- | --- | --- |
| No workspace context | error | Existing conservative `dependencies.workspace-range` |
| Workspace context exists but root manager is not pnpm | error | `workspace:` range may leak |
| Publish path is `npm` | error | npm publish will not rewrite pnpm workspace protocol ranges |
| Dependency name does not match a workspace package | error | Missing workspace target |
| Dependency target is private and dependent package is public | error for `dependencies`, `peerDependencies`, `optionalDependencies`; warning for `devDependencies` |
| Target is publishable, root manager is pnpm, publish path is pnpm | no finding | pnpm is expected to rewrite during pnpm pack/publish |

Use the existing check ID for all emitted cases:

```text
dependencies.workspace-range
```

Keep `devDependencies` scanned. A dev-only missing/private target is still relevant because the source manifest includes it, but it should not block publish when the risky metadata is not consumer-facing and pnpm path is otherwise safe. Technical implementation should use warning for dev-only private target and error for missing target unless proven irrelevant.

## Finding Messages

The current message says:

```text
dependencies.@scope/shared uses "workspace:*".
```

v0.3.2 should keep the concise base but improve suggestions based on reason:

- Missing target:
  - Suggestion: "Add a matching workspace package or replace the workspace protocol range before publishing."
- npm publish path:
  - Suggestion: "Use a pnpm publish path that rewrites workspace protocol ranges, or replace the range before npm publishing."
- Non-pnpm/unknown:
  - Suggestion: "Replace workspace protocol ranges before publishing with this package manager."
- Private target:
  - Suggestion: "Do not publish a public package that depends on a private workspace package unless the dependency is removed from published metadata."

Do not add a new `reason` field to `Finding`; encode the reason in message/suggestion for now.

## Single-Package Behavior

Keep `pkg-guard check` conservative for v0.3.2.

Rationale:

- Automatically walking upward to discover workspaces would change single-package command behavior.
- Root config inheritance is intentionally not implicit.
- The highest-value issue appears in workspace adoption flows, where context is already available.

The docs should recommend `pkg-guard check --workspaces` or `pkg-guard check --workspace <selector>` for pnpm workspace protocol packages.

## Reporter Impact

No reporter schema changes are required.

The existing finding ID and severity model are sufficient:

- Human output already includes package grouping in workspace mode.
- JSON output already includes findings inside package reports.
- SARIF output already maps finding IDs and severity.

If pnpm-safe ranges produce no finding, there is no reporter impact.

## Tests

Add or update tests in focused areas:

### Dependency Unit Tests

Keep existing single-package test:

- single package with `workspace:*` remains `dependencies.workspace-range` error

Add helper-level or batch-backed tests for:

- pnpm workspace package depends on publishable workspace package -> no `dependencies.workspace-range`
- pnpm workspace package depends on missing package -> error
- pnpm public package depends on private workspace package in `dependencies` -> error
- pnpm public package depends on private workspace package in `devDependencies` -> warning
- npm workspace package depends on local workspace package -> error
- pnpm workspace package with root npm-publish workflow -> error

### Batch Tests

Prefer exercising the behavior through `runBatchChecks` or CLI workspace tests so the workspace context path is covered.

### Workflow Tests

No new workflow check ID is required. Reuse existing workflow parsing helpers where practical; otherwise use a small local publish-path detector with focused tests.

## Docs

Update:

- `docs/checks.md`
  - Explain that `dependencies.workspace-range` is release-blocking unless pkg-guard can prove pnpm will rewrite it safely.
- `docs/examples.md`
  - Add a short pnpm workspace note showing `pkg-guard check --workspaces`.
- `CHANGELOG.md`
  - Add `0.3.2`.
- `docs/v0.3.2/implementation-plan.md`
  - Add after this design is approved.

## Migration and Compatibility

Backward-compatible behavior:

- Single-package `pkg-guard check` remains conservative.
- Existing check ID remains stable.
- Existing JSON and SARIF schemas remain unchanged.

Behavioral change:

- Some pnpm workspace runs will no longer fail on valid local publishable workspace dependencies.
- Some findings will have more specific suggestions.

## Risks

- False negatives if `publishPath: pnpm` is inferred too broadly.
  - Mitigation: any obvious npm publish workflow forces npm path.
- False positives if users publish with pnpm through scripts not visible to pkg-guard.
  - Mitigation: workspace mode with pnpm root and no npm workflow suppresses valid local publishable targets.
- Scope creep into release orchestration.
  - Mitigation: no new publish command generation in v0.3.2.

## Acceptance Criteria

- `dependencies.workspace-range` is still emitted for single-package `workspace:*` dependencies.
- In workspace mode, pnpm local publishable targets do not emit `dependencies.workspace-range` when no npm publish path is detected.
- Missing workspace targets emit `dependencies.workspace-range` error.
- Public package -> private workspace target emits `dependencies.workspace-range` with section-appropriate severity.
- npm publish workflow forces `dependencies.workspace-range` error even in a pnpm workspace.
- Full verification passes:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `node dist/cli/index.js check`
  - `npm pack --dry-run --json --ignore-scripts`
