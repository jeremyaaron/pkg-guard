# pkg-guard v0.4.0 Technical Design

## Overview

v0.4.0 should make `pkg-guard` more artifact-aware while keeping the CLI stable.

The current implementation already has valuable building blocks:

- `discoverProject` builds a package-scoped `ProjectContext`.
- `readPackInfo` runs `npm pack --dry-run --json --ignore-scripts` and stores packed file metadata.
- `pack.entrypoint-missing` checks declared `main`, `module`, `types`, `typings`, `exports`, and `bin` targets against the packlist.
- workspace batch execution already runs package checks independently and preserves package-scoped reports.

The v0.4.0 design should build on those seams rather than replacing them. The core changes are:

1. Add a reusable analysis orchestration layer between discovery/check execution and CLI rendering.
2. Make packed artifact target validation more explicit and contract-shaped.
3. Add opt-in consumer smoke checks that exercise package resolution from a packed artifact without executing package runtime code.
4. Keep future IDE integration in mind by returning stable diagnostics from the core analysis layer.

## Design Goals

- Preserve existing CLI behavior for `pkg-guard check`.
- Keep deterministic artifact checks in the default check path when they are cheap and based on existing `PackInfo`.
- Keep consumer smoke checks opt-in through `--consumer-smoke`.
- Avoid running package lifecycle scripts during smoke checks.
- Reuse existing `Finding` and reporter schemas.
- Avoid adding a public plugin system or rule engine in v0.4.0.
- Avoid exporting a stable npm API until the internal shape has proved itself.
- Keep workspace smoke behavior conservative and sequential.

## CLI Surface

Add one option for `check`:

```text
--consumer-smoke       Run opt-in consumer resolution checks against a packed artifact.
```

Supported command forms:

```sh
pkg-guard check --consumer-smoke
pkg-guard check --workspaces --consumer-smoke
pkg-guard check --workspace packages/pkg --consumer-smoke
```

Option applicability:

| Option | check | fix | init | init-release |
| --- | --- | --- | --- | --- |
| `--consumer-smoke` | yes | no | no | no |

Using `--consumer-smoke` with `fix`, `init`, or `init-release` should return a usage error.

No `--artifact` flag is recommended for v0.4.0. Artifact contract checks that rely only on existing `PackInfo` should continue to run by default because `discoverProject` already performs pack inspection today. If a new artifact check requires additional package-manager work, it belongs in consumer smoke mode instead.

## Analysis Layer

Today the CLI directly performs discovery, runs checks, applies policy, builds reports, renders output, and chooses exit codes. v0.4.0 should introduce a core analysis module that owns discovery, check execution, optional smoke execution, and policy application.

Proposed module:

```text
src/core/analysis.ts
```

Proposed types:

```ts
export interface AnalyzeOptions {
  command: "check";
  cwd: string;
  ignore: string[];
  strict: boolean;
  consumerSmoke: boolean;
}

export interface PackageAnalysis {
  cwd: string;
  root: string;
  context: ProjectContext | null;
  findings: Finding[];
}

export async function analyzePackage(options: AnalyzeOptions): Promise<PackageAnalysis>;
```

`analyzePackage` should:

1. Call `discoverProject(options.cwd)`.
2. Return discovery findings if no context exists.
3. Run source and artifact checks with `runChecks(context)`.
4. If `consumerSmoke` is true, run smoke checks and append their findings.
5. Apply package config and CLI policy.
6. Return structured findings without rendering or deciding an exit code.

The CLI can then create reports and output exactly as it does today:

```ts
const analysis = await analyzePackage(options);
const report = createReport("check", analysis.root, analysis.findings);
```

Workspace analysis can either:

- add `analyzeWorkspaceChecks(...)` in `analysis.ts`, or
- update `runBatchChecks` to call `analyzePackage` internally.

The second path is smaller, but the first path is cleaner for future IDE integrations. Recommended v0.4.0 direction:

```ts
export interface WorkspaceAnalyzeOptions extends AnalyzeOptions {
  workspaceContext?: WorkspaceCheckContext;
  target: WorkspaceRunTarget;
}

export async function analyzeWorkspacePackage(options: WorkspaceAnalyzeOptions): Promise<PackageCheckReport>;
```

The existing batch report types can remain unchanged.

### Diagnostic Shape

Keep `Finding` as the diagnostic shape in v0.4.0:

```ts
export interface Finding {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  impact?: string;
  suggestion?: string;
  file?: string;
  path?: string;
  fixable?: boolean;
}
```

Do not add file ranges yet. Most current findings point at `package.json` JSON paths or workflow files, and the repo has no JSON/YAML range mapper. Future IDE work can map JSON paths to ranges in a separate layer.

For future editor use, preserve these invariants:

- `file` is package-relative for package findings.
- `path` is a JSON path when applicable.
- `id` is stable and documented.
- `message` is concise enough for Problems panels.
- `suggestion` provides the longer remediation.

## Artifact Contract Checks

The existing `src/checks/pack.ts` already validates declared targets against npm pack output under `pack.entrypoint-missing`. v0.4.0 should refine this rather than introduce overlapping artifact IDs immediately.

Recommended ID strategy:

- Keep `pack.entrypoint-missing` for declared public targets missing from packed output.
- Keep `pack.unsupported-target` for export/bin shapes that cannot be validated.
- Do not add `artifact.*` IDs in v0.4.0 unless a check is not packlist-specific.

Rationale:

- `pack.entrypoint-missing` is already documented and tested.
- The failure mode is specifically "this declared target is missing from npm pack output."
- A new `artifact.*` family would create migration noise without adding user value yet.

### Declared Target Model

Extract the declared target collector from `pack.ts` into a shared helper so consumer smoke checks can use the same public contract.

Proposed module:

```text
src/core/package-targets.ts
```

Proposed types:

```ts
export type PackageTargetSource = "main" | "module" | "types" | "typings" | "exports" | "bin";

export type PackageTarget =
  | {
      kind: "file";
      source: PackageTargetSource;
      target: string;
      jsonPath: string;
      conditions: string[];
    }
  | {
      kind: "pattern";
      source: "exports";
      targetPattern: string;
      jsonPath: string;
      conditions: string[];
    };

export interface PackageTargetCollection {
  targets: PackageTarget[];
  findings: Finding[];
}

export function collectPackageTargets(manifest: PackageManifest): PackageTargetCollection;
```

`conditions` should record export condition names encountered while walking nested export objects. This lets consumer smoke prioritize common runtime/type conditions without implementing a full resolver.

Initial condition support:

- `import`
- `require`
- `default`
- `types`
- `node`

Unknown conditions should not fail collection. They should remain part of the target path and may still be packlist-checked if they resolve to string targets.

### Packlist Validation Improvements

Update `pack.ts` to consume `collectPackageTargets`.

Behavior:

- File targets are checked by normalized exact packlist path.
- Simple pattern targets are checked by packlist pattern match.
- Targets that escape the package root remain ignored by pack checks because `entrypoint.target-escapes-package` already handles source-tree path safety.
- Unsupported shapes emit `pack.unsupported-target`.

Messages should be slightly more contract-oriented:

```text
exports.import target "./dist/index.js" is declared in package.json but is not included in npm pack output.
```

Existing tests should be updated only where wording changes.

## Consumer Smoke Checks

Consumer smoke checks should live outside normal `Check[]` because they are async, slower, and require temporary filesystem work.

Proposed module:

```text
src/core/consumer-smoke.ts
```

Proposed entrypoint:

```ts
export interface ConsumerSmokeOptions {
  timeoutMs: number;
}

export async function runConsumerSmokeChecks(
  context: ProjectContext,
  options: ConsumerSmokeOptions
): Promise<Finding[]>;
```

Default timeout:

```ts
const defaultConsumerSmokeTimeoutMs = 30_000;
```

The timeout should apply per package.

### Smoke Strategy

Use a generated tarball rather than source files. `npm pack --dry-run` is not enough for consumer smoke because resolution should operate on the actual package layout.

Recommended flow:

1. Create a temp directory.
2. Run `npm pack --json --ignore-scripts --pack-destination <temp>` from the package root.
3. Create a temp consumer project:
   - `package.json` with `"type": "module"` for ESM import probes where needed.
4. Install the tarball:
   - `npm install --ignore-scripts --no-audit --no-fund <tarball>`
5. Run resolution probes from the consumer directory.
6. Remove the temp directory.

This uses npm even for pnpm/Yarn/Bun packages because npm tarball install is the common npm registry consumer path and keeps v0.4.0 scope manageable.

If `npm pack` or `npm install` fails, emit a smoke finding and skip resolution probes for that package.

Potential finding IDs:

- `consumer.pack-failed`
- `consumer.install-failed`
- `consumer.import-unresolved`
- `consumer.require-unresolved`
- `consumer.types-unresolved`
- `consumer.bin-unresolved`

### Runtime Resolution Probes

Smoke checks should not import and execute package modules. They should test resolution only.

For CommonJS:

```sh
node -e "require.resolve('package-name')"
node -e "require.resolve('package-name/subpath')"
```

For ESM:

```sh
node --input-type=module -e "await import.meta.resolve('package-name')"
node --input-type=module -e "await import.meta.resolve('package-name/subpath')"
```

Use package metadata to choose probes:

- If the package has `exports`, derive public subpaths from explicit export keys.
- If the package has no `exports`, probe the bare package name.
- For string or object exports:
  - run an ESM probe when an `import` or `default` condition exists;
  - run a CJS probe when a `require` condition exists;
  - if only a string target exists, run an ESM probe when `type: "module"` and a CJS probe otherwise.

Do not probe export patterns in v0.4.0 consumer smoke. Packlist checks already validate simple pattern existence. Pattern consumer resolution would require generating representative subpaths and risks false confidence.

### Type Resolution Probe

Type smoke should be conservative.

If `typescript` is available in `pkg-guard`'s own dependencies or dev environment, create a temporary TypeScript file:

```ts
import type * as pkg from "package-name";
void pkg;
```

Then run:

```sh
npx tsc --noEmit --moduleResolution nodenext --module nodenext --target es2022 index.ts
```

However, relying on `npx` may pull from the network. v0.4.0 should avoid network access during checks.

Recommended v0.4.0 approach:

- Use the local TypeScript dependency when resolvable from `pkg-guard`'s installation.
- If TypeScript is not available, skip type smoke with no finding.
- Treat type smoke as best-effort in v0.4.0.

Emit `consumer.types-unresolved` only when TypeScript is available and resolution fails.

### Bin Probe

For `bin` targets:

- Verify installed package metadata exposes the expected bin entries.
- Verify installed bin target files exist.
- Verify bin files start with a shebang.

Do not execute the bin in v0.4.0. Existing entrypoint checks already validate source-tree shebangs; smoke bin checks confirm installed layout.

### Workspace Smoke

Workspace smoke should run per selected package using the package's root.

Do not install the entire workspace in v0.4.0. That would turn smoke checks into release orchestration and introduce package-manager-specific behavior.

Known limitation:

- A workspace package with unpublished local dependencies may fail npm tarball install if those dependencies are not available from the registry.

Behavior:

- If install fails because dependencies cannot be resolved, report `consumer.install-failed`.
- Keep this opt-in and document that workspaces with unpublished local dependencies may need registry-published dependency versions before consumer smoke can pass.

## Options and Parsing

Extend `ParsedOptions`:

```ts
export interface ParsedOptions {
  // existing fields
  consumerSmoke: boolean;
}
```

Parse `--consumer-smoke`.

Validation:

- Allowed only with `check`.
- Compatible with `--workspaces`, `--workspace`, `--include-private`, `--include-root`, `--format`, `--json`, `--ignore`, and `--strict`.
- Incompatible with `fix`, `init`, and `init-release`.

Update help text for `check`.

## Reporters

No reporter schema changes are required.

Consumer smoke findings should use ordinary `Finding` objects:

- `file: "package.json"` for manifest-derived resolution failures.
- `path` set to the JSON path of the target when known.
- `suggestion` should explain whether to update package metadata, include files, publish dependencies, or run without consumer smoke if the scenario is intentionally unsupported.

SARIF can render these findings with existing logic.

Human output should not create a separate "consumer smoke" section in v0.4.0. The finding IDs and messages should carry enough context.

## Fixes

No new automatic fixes are recommended in v0.4.0.

Rationale:

- Artifact contract failures can be fixed by changing `files`, `.npmignore`, build output, export maps, or package layout.
- The correct fix depends on maintainer intent.
- Automatic edits would be too speculative.

Existing fixes should continue to work and should not run consumer smoke.

## Documentation

Update:

- `docs/checks.md`
  - document consumer smoke IDs;
  - clarify `pack.entrypoint-missing` as artifact contract validation.
- `docs/examples.md`
  - add `pkg-guard check --consumer-smoke`;
  - include workspace caveat for consumer smoke.
- `docs/configuration.md`
  - document any preset changes if added.
- `CHANGELOG.md`
  - add `0.4.0`.

Add a short explanation of package contract classes in docs, but do not make users choose a class unless a preset is actually implemented.

## Testing Strategy

### Unit Tests

- Target collection:
  - top-level `main`, `module`, `types`, `typings`;
  - bin string and object forms;
  - export strings;
  - nested condition objects;
  - unsupported shapes;
  - simple patterns.
- Pack checks:
  - existing tests updated to use shared target collection;
  - missing packed target still emits `pack.entrypoint-missing`;
  - source-tree-present but packlist-missing target is covered.

### Consumer Smoke Tests

Use temp fixtures and local tarballs.

Cover:

- install failure emits `consumer.install-failed`;
- missing runtime export emits `consumer.import-unresolved` or `consumer.require-unresolved`;
- missing type declaration emits `consumer.types-unresolved` when TypeScript is available;
- bin target missing from installed layout emits `consumer.bin-unresolved`;
- smoke mode does not run package lifecycle scripts.

Tests should avoid network access.

### CLI Tests

- `check --consumer-smoke` enables smoke findings.
- `check --workspaces --consumer-smoke` preserves package-scoped output.
- `--consumer-smoke` is rejected for non-check commands.
- JSON and SARIF render smoke findings without schema changes.

### Regression Tests

- Existing `npm test` suite.
- Existing workspace checks.
- Existing `npm run typecheck`.
- Existing `npm run lint`.
- Build and self-check.
- Pack dry run.

## Risks and Mitigations

### Smoke Checks Become Slow or Flaky

Mitigation:

- Keep them opt-in.
- Use per-package timeouts.
- Avoid lifecycle scripts.
- Keep workspace smoke sequential.

### npm Install Behavior Differs From pnpm/Yarn/Bun Consumers

Mitigation:

- Frame consumer smoke as npm registry consumer smoke.
- Keep package-manager-specific consumer simulation out of v0.4.0.
- Continue using static checks for package-manager-specific hazards.

### False Positives From Complex Export Maps

Mitigation:

- Probe only explicit export keys.
- Skip export patterns in smoke mode.
- Keep unsupported shapes as warnings rather than errors when confidence is low.

### IDE API Freezes Too Early

Mitigation:

- Keep the API internal or documented as experimental in v0.4.0.
- Use it from CLI internally to prove the boundary before exporting it as public.

## Open Design Questions

1. Should `analyzePackage` live in `src/core/analysis.ts` and be used by CLI immediately, or should v0.4.0 first add it alongside the existing path and migrate in phases?
2. Should consumer smoke create tarballs with `npm pack --pack-destination`, or should discovery also store a tarball path when smoke is enabled?
3. Should type smoke be included in the first implementation phase or deferred behind runtime/bin smoke?
4. Should `pack.unsupported-target` remain the only unsupported artifact-shape warning, or should consumer smoke add separate unsupported smoke warnings?
5. Should the package expose experimental analysis API types through `exports` in v0.4.0, or keep all API work internal?

## Acceptance Criteria

- `pkg-guard check` still behaves as it does in v0.3.2 without `--consumer-smoke`.
- Default artifact contract checks continue using `PackInfo` and validate declared targets against packed output.
- Shared package target collection is used by pack checks and consumer smoke.
- `pkg-guard check --consumer-smoke` runs an isolated tarball-based smoke check without lifecycle scripts.
- Consumer smoke emits stable findings for pack, install, runtime resolution, type resolution when available, and bin layout failures.
- Workspace smoke preserves package-scoped reports.
- CLI parsing, help, JSON, human, and SARIF outputs cover `--consumer-smoke`.
- A reusable analysis boundary exists between CLI rendering and core analysis.
- Full verification passes:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `node dist/cli/index.js check`
  - `npm pack --dry-run --json --ignore-scripts`
