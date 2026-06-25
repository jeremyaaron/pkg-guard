# pkg-guard v0.3.0 Technical Design

## Overview

v0.3.0 should make `pkg-guard` workspace-aware without changing the core identity of the tool. The current architecture already has clear seams between CLI parsing, project discovery, checks, policy, reporters, and fixes. The design should extend those layers to operate on one package or many packages while keeping single-package behavior stable.

The main design change is introducing a batch layer above the existing `ProjectContext`. Workspace commands discover multiple package roots, build one `ProjectContext` per package, run the existing checks for each context, and aggregate the reports.

The supporting changes are:

- a CI-native reporter, preferably SARIF;
- a conservative `init` command for first-time adoption;
- trusted publishing workflow checks aligned with current npm requirements.

## Design Goals

- Preserve v0.2.0 single-package command behavior.
- Reuse existing checks instead of creating separate workspace-specific checks.
- Keep package discovery deterministic and filesystem-only.
- Keep `check` read-only and keep pack inspection passive with `--ignore-scripts`.
- Make workspace output explicit about package name and package path.
- Keep JSON output schema-versioned and compatible for single-package use.
- Avoid a rule engine or plugin system in v0.3.0.
- Add dependencies only when they remove meaningful parsing or format risk.

## CLI Surface

Extend the command set:

```text
pkg-guard check [options]
pkg-guard fix [options]
pkg-guard init [options]
pkg-guard init-release [options]
```

Extend global command options:

```text
--workspace <selector>   Check or initialize one workspace package by name or relative path.
--workspaces             Check or initialize all publishable workspace packages.
--include-private        Include private workspace packages in batch mode.
--include-root           Include the root package in workspace batch mode.
--format <format>        Output format: human, json, sarif.
```

Keep `--json` as a compatibility alias for `--format json`.

Initial option applicability:

| Option | check | fix | init | init-release |
| --- | --- | --- | --- | --- |
| `--workspaces` | yes | dry-run yes, apply deferred unless safe | yes | no |
| `--workspace` | yes | yes | yes | no |
| `--include-private` | yes | yes | yes | no |
| `--include-root` | yes | yes | yes | no |
| `--format sarif` | yes | no | no | no |

If `fix --workspaces` apply proves too risky during implementation, v0.3.0 should support only `fix --workspaces --dry-run` and return a usage error for batch apply. Single-workspace `fix --workspace <selector>` may apply normally because it still mutates one package.

## Data Model

Keep `ProjectContext` package-scoped. Do not add workspace arrays to every check input.

Add a batch model in a new core module, likely `src/core/workspaces.ts` or `src/core/batch.ts`.

```ts
export interface WorkspaceRoot {
  root: string;
  manifest: PackageManifestFile;
  packageManager: PackageManagerInfo;
  workspacePatterns: WorkspacePattern[];
}

export interface WorkspacePackage {
  root: string;
  relativePath: string;
  name: string | null;
  private: boolean;
  manifestPath: string;
}

export interface PackageRunTarget {
  root: string;
  relativePath: string;
  name: string | null;
  source: "root" | "workspace";
}

export interface PackageReport {
  target: PackageRunTarget;
  report: Report;
}

export interface BatchReport {
  schemaVersion: 1;
  command: CommandName;
  cwd: string;
  root: string;
  packages: PackageReport[];
}
```

`ProjectContext` remains the input to checks. Batch execution builds one `ProjectContext` for each `PackageRunTarget` by calling existing discovery on that package root, or by extracting a shared helper from `discoverProject`.

## Workspace Discovery

Workspace discovery starts at the normal discovered project root. For `--workspaces` or `--workspace`, the first discovery pass finds the root package, then reads workspace metadata from that root.

Supported metadata:

- `package.json` `workspaces: string[]`
- `package.json` `workspaces.packages: string[]`
- `pnpm-workspace.yaml` `packages: string[]`

Package manager lockfile detection remains package-scoped for checks, but workspace discovery should use root metadata. This keeps commands predictable when run from a workspace child.

### Pattern Expansion

Implement a narrow workspace glob expander instead of full shell globbing.

Required support:

- literal relative paths such as `packages/foo`
- one-segment stars such as `packages/*`
- scoped package layouts such as `packages/@scope/*`
- negated patterns beginning with `!`

Optional support:

- `**` recursive matching, if it can be implemented safely and tested without much complexity.

Rules:

- Normalize all paths to repository-relative POSIX paths for matching and output.
- Ignore `node_modules`, `.git`, coverage directories, package manager stores, and hidden directories by default.
- Reject or ignore matches outside the workspace root.
- Treat a match as a package only when it contains a readable `package.json`.
- Deduplicate by real package root.
- Sort by relative path for stable output.

If a workspace pattern cannot be understood, emit a workspace discovery warning rather than crashing the command.

New finding IDs:

- `workspace.config-invalid`
- `workspace.pattern-unsupported`
- `workspace.package-json-invalid`
- `workspace.selector-not-found`

These findings should be reported at the batch level when they prevent target selection or package parsing.

### Target Selection

`--workspaces` selects workspace child packages by default.

Private package behavior:

- Skip packages with `private: true` unless `--include-private` is set.
- Count skipped private packages in summary output.

Root package behavior:

- Do not include the root package by default in `--workspaces`.
- Include the root package when `--include-root` is set.
- `--include-root` should still respect `private: true` unless `--include-private` is also set.

`--workspace <selector>` selects one or more workspace packages by:

- exact package name;
- exact relative path;
- relative path without leading `./`.

If multiple packages match a selector, check all matching packages and make the output explicit. If no packages match, return exit code `2` with `workspace.selector-not-found`.

## Batch Execution

Add a coordinator for package runs:

```ts
export async function runPackageChecks(target: PackageRunTarget, options: CheckRunOptions): Promise<PackageReport>;

export async function runBatchChecks(targets: PackageRunTarget[], options: CheckRunOptions): Promise<BatchReport>;
```

Execution may be sequential in v0.3.0. `npm pack --dry-run` is relatively expensive and can put pressure on the filesystem; predictable output is more important than parallel speed in the first workspace release.

If parallelism is later added, it should use a small concurrency limit and preserve stable report ordering.

Policy application remains package-local:

1. Discover package context.
2. Run checks.
3. Apply that package's `pkgGuard.ignore` and `pkgGuard.strict`.
4. Apply CLI `--ignore` and `--strict`.
5. Build package report.

Root-level policy inheritance is out of scope for v0.3.0 unless explicitly configured in the technical follow-up. Silent inheritance would make workspace findings harder to explain.

## Reporting

### Human Workspace Report

Human output should group by package:

```text
pkg-guard checked 3 packages

packages/a (@scope/a)
  error entrypoint.target-missing
    exports target "./dist/index.js" does not exist.

packages/b (pkg-b)
  no issues

summary: 3 packages checked, 1 skipped, 1 error, 0 warnings
```

Single-package human output should remain unchanged.

### JSON Report

Keep existing single-package JSON as `schemaVersion: 1`.

For workspace reports, use a batch wrapper with `schemaVersion: 1` and embed each package's existing report shape:

```json
{
  "schemaVersion": 1,
  "command": "check",
  "cwd": "/repo",
  "root": "/repo",
  "summary": {
    "packages": 2,
    "skipped": 1,
    "errors": 1,
    "warnings": 2
  },
  "packages": [
    {
      "name": "@scope/a",
      "relativePath": "packages/a",
      "private": false,
      "report": {
        "schemaVersion": 1,
        "command": "check",
        "cwd": "/repo/packages/a",
        "summary": { "errors": 1, "warnings": 0 },
        "findings": []
      }
    }
  ],
  "findings": []
}
```

Top-level `findings` are for workspace discovery or selector findings. Package findings stay inside package reports.

### SARIF

Add `src/reporters/sarif.ts`.

Use SARIF 2.1.0. Findings map to SARIF results:

- `finding.id` -> `ruleId`
- `finding.title` -> rule short description
- `finding.message` -> result message
- `finding.file` plus package relative path -> artifact location URI
- `finding.path` -> include in properties
- severity -> SARIF level:
  - `error` -> `error`
  - `warning` -> `warning`
  - future `info` -> `note`

The SARIF run should include a stable tool driver:

```json
{
  "tool": {
    "driver": {
      "name": "pkg-guard",
      "informationUri": "https://github.com/jeremyaaron/pkg-guard",
      "rules": []
    }
  }
}
```

SARIF does not need a new dependency if the project writes the JSON object directly. The schema is large, but v0.3.0 only needs the subset needed for code scanning ingestion.

If SARIF support becomes too large during implementation, ship `--format github` instead and record SARIF as a follow-up. The PRD preference remains SARIF.

## Fix Behavior

Single-package `fix` remains unchanged.

`fix --workspace <selector>` should:

- resolve exactly the selected package or packages;
- run the existing fix planner per package;
- apply fixes package by package;
- report changed files relative to each package root and to the workspace root.

`fix --workspaces --dry-run` should:

- resolve all publishable workspace packages;
- run fix planning per package;
- aggregate planned fixes without writing.

Batch apply for `fix --workspaces` should be deferred unless the implementation can guarantee clear output and no cross-package ambiguity. If deferred, the CLI should return exit code `2` with a direct message telling users to run `--dry-run` or select one workspace package.

## Adoption Init

Add `src/core/init.ts` for a new `init` command. Reuse the fix-plan pattern rather than inventing a second mutation model.

```ts
export interface InitPlan {
  id: string;
  description: string;
  operations: InitOperation[];
}

export type InitOperation =
  | JsonSetOperation
  | { kind: "json-set-nested"; file: "package.json"; path: string; value: unknown };
```

Initial single-package behavior:

- Infer preset using the same resolver as discovery.
- Add `pkgGuard.preset` only when the preset is `cli` or `typescript-library` and not already configured.
- Add `scripts["pkg:check"] = "pkg-guard check"` when absent.
- Do not overwrite an existing `pkg:check`.
- If another script already runs `pkg-guard check`, report no script change.
- In dry-run mode, print the plan without writing.

Workspace behavior:

- At the root, add a script such as `pkg:check = "pkg-guard check --workspaces"`.
- For workspace packages, prefer package-level `pkgGuard.preset` updates only when `--workspace` selects one package or when `--workspaces` is used with `--dry-run`.
- Do not write many package manifests in the first implementation unless the plan output is clear and reviewed.

`init` should not call `init-release`. It may print a recommendation when no release workflow is found.

## Trusted Publishing Refresh

Update GitHub release workflow generation:

- Use Node `24`, which satisfies the current Node minimum for npm trusted publishing.
- Ensure the workflow installs npm `>=11.5.1` before publishing, or otherwise uses a Node image/action setup known to provide a compatible npm version.
- Keep `id-token: write`.
- Keep `contents: read`.
- Keep `package-manager-cache: false`.
- Continue publishing with the npm CLI.

Extend workflow checks:

- `workflow.node-version-too-old`: warn when an obvious GitHub publish workflow uses Node below `22.14.0`.
- `workflow.npm-version-too-old`: warn when an obvious publish workflow pins npm below `11.5.1` or uses an old setup likely to provide an incompatible npm version.
- `workflow.self-hosted-trusted-publishing`: keep or strengthen existing warning because npm trusted publishing does not support self-hosted runners.
- `workflow.long-lived-npm-token`: keep existing warning.

Detection should be conservative:

- Only warn on clear static evidence.
- Do not warn when version cannot be determined.
- Do not require every workflow to install npm manually if the Node setup clearly satisfies requirements.

Provider generation remains GitHub-only in v0.3.0. Documentation should describe GitLab and CircleCI trusted publishing support and make clear that `init-release` only generates GitHub Actions workflows.

## Compatibility

Single-package compatibility:

- `pkg-guard check` output remains unchanged.
- `pkg-guard check --json` remains an alias for JSON output.
- Existing check IDs remain stable.
- Existing exit-code semantics remain stable.

Workspace mode compatibility:

- New workspace findings use new IDs.
- Batch JSON uses a wrapper rather than changing single-package JSON.
- SARIF is opt-in through `--format sarif`.

Config compatibility:

- Existing `pkgGuard.ignore`, `pkgGuard.strict`, and `pkgGuard.preset` semantics remain package-local.
- No root-level inheritance in v0.3.0.

## Documentation

Update:

- `README.md` with brief workspace usage.
- `docs/checks.md` with workspace and trusted publishing IDs.
- `docs/configuration.md` to clarify package-local config in workspaces.
- `docs/examples.md` with workspace CI examples.
- `docs/release-workflow.md` with current trusted publishing requirements and provider notes.

Add:

- `docs/v0.3.0/implementation-plan.md` after this technical design is reviewed.

## Test Strategy

Add focused tests before broad fixtures.

Workspace tests:

- package.json `workspaces` array discovery;
- package.json `workspaces.packages` discovery;
- pnpm workspace YAML discovery;
- private package skipping;
- selector by name and path;
- invalid selector;
- path escape prevention;
- deterministic sorting and deduplication.

Batch command tests:

- `check --workspaces` aggregates package reports and exit codes;
- package-level ignores and strict settings apply per package;
- CLI ignores and strict settings apply across packages;
- JSON batch output shape is stable.

Reporter tests:

- SARIF includes expected tool metadata, rules, results, levels, and artifact URIs;
- SARIF works for workspace package paths.

Init tests:

- dry-run does not write;
- single-package init adds only missing conservative fields;
- existing scripts are not overwritten;
- workspace root script is planned correctly.

Trusted publishing tests:

- generated workflow uses compatible Node and npm behavior;
- old obvious Node versions warn;
- old obvious npm versions warn;
- unknown versions do not warn.

Full verification remains:

```sh
npm test
npm run typecheck
npm run lint
npm run build
node dist/cli/index.js check
```
