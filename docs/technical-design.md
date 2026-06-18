# pkg-guard Technical Design

## Overview

`pkg-guard` is a TypeScript CLI that audits npm package publishing readiness. It discovers project metadata, builds a normalized project context, runs composable checks, reports structured findings, and applies conservative manifest or workflow fixes when explicitly requested.

The MVP targets single-package TypeScript libraries published to npm from GitHub Actions. The design keeps the core check engine independent from the CLI so the project can later support a GitHub Action, editor integration, or programmatic API without duplicating logic.

## Design Goals

- Keep checks deterministic and testable.
- Avoid network access for `check` and `fix`.
- Use structured parsers for JSON, JSONC, YAML, and TypeScript config.
- Preserve existing file formatting where practical.
- Make every finding stable enough to reference in config, CI output, and docs.
- Separate discovery, checking, reporting, and mutation.
- Keep dependencies modest and defensible.

## Runtime and Packaging

The package is published as `pkg-guard` and exposes one CLI binary:

```json
{
  "name": "pkg-guard",
  "bin": {
    "pkg-guard": "./dist/cli/index.js"
  },
  "type": "module"
}
```

Initial implementation targets active Node.js LTS versions for local checks. Generated trusted-publishing workflows should use a Node and npm combination compatible with npm's current OIDC requirements. As of the current npm docs, trusted publishing requires npm CLI 11.5.1 or later and Node 22.14.0 or later.

## Commands

### `pkg-guard check`

Read-only audit command.

Flow:

1. Parse CLI options.
2. Discover project root.
3. Build `ProjectContext`.
4. Select preset and enabled checks.
5. Run checks.
6. Apply ignore and strictness policy.
7. Report findings.
8. Exit with the correct status code.

Options:

```text
--json              Print JSON instead of human output.
--strict            Treat configured warnings as errors.
--preset <name>     Override detected/default preset.
--ignore <id...>    Ignore check IDs for this run.
--cwd <path>        Run against a different project directory.
```

### `pkg-guard fix`

Applies deterministic fixes.

Flow:

1. Build the same context used by `check`.
2. Run checks that can emit fix plans.
3. Filter to safe automatic fixes.
4. Print planned changes.
5. Write changes unless `--dry-run` is set.
6. Re-run affected checks when cheap.
7. Report changed files and remaining findings.

Options:

```text
--dry-run           Show planned changes without writing.
--json              Print machine-readable result.
--preset <name>     Override detected/default preset.
--cwd <path>        Run against a different project directory.
```

Fixes must be idempotent. Running `pkg-guard fix` twice without intervening changes should produce no second diff.

### `pkg-guard init-release`

Creates or updates a GitHub Actions workflow for npm publishing.

Flow:

1. Detect package manager and scripts.
2. Detect existing release workflows.
3. Generate `.github/workflows/release.yml` when absent.
4. Refuse risky overwrites unless a future `--force` option is introduced.
5. Print the npm-side trusted publisher configuration required outside the repo.

MVP defaults:

- Trigger: Git tags matching `v*`.
- Provider: GitHub Actions.
- Registry: npm.
- Publishing command: npm CLI, even when project dependencies are installed with pnpm, Yarn, or Bun.
- Permissions: include `id-token: write` and minimal repository content permissions.
- Node version: a trusted-publishing-compatible version.

## Core Data Model

### `ProjectContext`

`ProjectContext` is the immutable input passed to checks.

```ts
export interface ProjectContext {
  cwd: string;
  root: string;
  manifest: PackageManifestFile;
  packageManager: PackageManagerInfo;
  git: GitInfo | null;
  tsconfig: TsconfigInfo | null;
  workflows: WorkflowInfo[];
  pack: PackInfo | null;
  files: ProjectFileIndex;
  config: PkgGuardConfig;
}
```

Context construction may perform filesystem reads and subprocess calls. Checks should not perform additional discovery unless explicitly designed as expensive checks.

### `Finding`

Findings are stable, structured, and reporter-neutral.

```ts
export type Severity = "error" | "warning" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  impact?: string;
  suggestion?: string;
  file?: string;
  path?: string;
  fix?: FixPlan;
  docsUrl?: string;
}
```

IDs use dotted namespaces:

```text
manifest.package-manager-missing
exports.target-missing
types.declaration-missing
pack.env-file-included
release.trusted-publishing-missing
```

### `Check`

Checks are pure functions over `ProjectContext`.

```ts
export interface Check {
  id: string;
  category: CheckCategory;
  defaultSeverity: Severity;
  appliesTo(context: ProjectContext): boolean;
  run(context: ProjectContext): Promise<Finding[]>;
}
```

Checks may emit multiple findings. A check's top-level `id` identifies the check implementation; finding IDs identify specific outcomes.

### `FixPlan`

Fix plans describe intended mutations without applying them.

```ts
export interface FixPlan {
  kind: "json-edit" | "yaml-edit" | "file-create";
  description: string;
  operations: FixOperation[];
}
```

The fix runner owns writes. Checks suggest fixes; they do not mutate files directly.

## Project Discovery

Discovery starts at `--cwd` or `process.cwd()` and walks upward until it finds `package.json`.

The MVP should read:

- `package.json`
- Lockfiles: `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`
- `tsconfig.json`
- `.github/workflows/*.yml`
- `.github/workflows/*.yaml`
- Git remote information when available

Discovery should avoid traversing `node_modules`, `.git`, build output, coverage output, and package manager stores.

## Package Manager Detection

Package manager detection uses this precedence:

1. `packageManager` field in `package.json`.
2. Lockfile with an unambiguous manager.
3. Known workspace manager files.
4. Fallback to npm.

If `packageManager` conflicts with the lockfile, emit a warning. If multiple lockfiles are present, emit a warning unless the combination is known and intentional.

Install command selection:

```text
npm  -> npm ci
pnpm -> pnpm install --frozen-lockfile
yarn -> yarn install --immutable when modern Yarn is detected, otherwise yarn install --frozen-lockfile
bun  -> bun install --frozen-lockfile
```

Publishing should use `npm publish` in the generated npm workflow because npm trusted publishing is implemented through the npm CLI.

## Pack Inspection

`pkg-guard check` should inspect publish contents through the npm packlist behavior rather than approximating `.npmignore` and `files` logic manually.

Preferred strategy:

```sh
npm pack --dry-run --json --ignore-scripts
```

The command should run in the target package root and parse the returned JSON. The `--ignore-scripts` flag is intentional: package inspection should not run `prepack`, `prepare`, or other lifecycle scripts. Generated workflows may run explicit `test` and `build` scripts before `pkg-guard check`, but inspection itself should stay passive.

If `npm pack --dry-run --json --ignore-scripts` fails because the project is not built, emit a finding that explains the package could not be inspected and suggests running the build first.

Pack inspection produces:

```ts
export interface PackInfo {
  files: PackFile[];
  entryCount: number;
  unpackedSize: number;
  raw: unknown;
}
```

Pack checks should verify both unwanted inclusions and required inclusions.

## Manifest Analysis

Manifest checks read the parsed `package.json` and inspect:

- identity: `name`, `version`, `private`
- metadata: `description`, `license`, `repository`, `bugs`, `homepage`
- runtime shape: `type`, `main`, `module`, `types`, `exports`, `bin`
- publishing shape: `files`, `publishConfig`
- dependency shape: `dependencies`, `peerDependencies`, `optionalDependencies`, `devDependencies`
- package manager shape: `packageManager`, `engines`

JSON edits should preserve indentation and trailing newline. Use an AST-aware JSON editing library instead of string concatenation.

## Entry Point Resolution

Entry point checks normalize all declared runtime and type targets into a common list:

```ts
export interface DeclaredEntryPoint {
  source: "main" | "module" | "types" | "exports" | "bin";
  subpath?: string;
  condition?: string;
  target: string;
  file: "package.json";
  jsonPath: string;
}
```

Resolution rules:

- Support string, object, and conditional `exports`.
- Treat `import`, `require`, `default`, `types`, `node`, and `browser` as known conditions.
- Follow nested condition objects recursively.
- Ignore unsupported target types with a warning rather than crashing.
- Reject targets that escape the package root.
- Check existence against the filesystem and packed file list when available.

For type declarations, prefer explicit `types` conditions or top-level `types`. When runtime exports exist without corresponding declaration exposure, emit a warning or error depending on confidence.

## TypeScript Analysis

The MVP should parse `tsconfig.json` without requiring a full TypeScript program.

Initial fields:

- `compilerOptions.declaration`
- `compilerOptions.declarationMap`
- `compilerOptions.emitDeclarationOnly`
- `compilerOptions.outDir`
- `compilerOptions.rootDir`
- `compilerOptions.module`
- `compilerOptions.moduleResolution`
- `compilerOptions.composite`

If TypeScript is installed, future versions may use the TypeScript compiler API to resolve extended configs. MVP support can start with direct config parsing and clear warnings when `extends` prevents confident analysis.

## Workflow Analysis

Workflow analysis parses YAML files under `.github/workflows`.

Release workflow detection should look for:

- `npm publish`
- `npm stage publish`
- Changesets publish actions
- semantic-release npm publishing
- references to `NODE_AUTH_TOKEN` or `NPM_TOKEN`
- `id-token: write`
- tag or release triggers
- `actions/setup-node` registry configuration

MVP release findings:

- Warn when a publish workflow uses long-lived npm tokens.
- Warn when a publish workflow lacks `id-token: write`.
- Warn when a publish workflow lacks an install, test, build, or package validation step.
- Warn when a publish workflow can run on ordinary branch pushes.
- Inform when trusted publishing requires npm-side configuration that cannot be verified locally.

The tool should not claim trusted publishing is fully configured unless it can verify both workflow shape and npm-side configuration. The MVP has no network requirement, so it should phrase npm-side state as guidance rather than fact.

## Generated Release Workflow

The generated workflow should be simple and reviewable:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"
          package-manager-cache: false
      - run: npm ci
      - run: npm test --if-present
      - run: npm run build --if-present
      - run: npx pkg-guard check
      - run: npm publish
```

The generator should substitute the install command based on detected package manager. The final publish command remains `npm publish`.

The generated file should include a concise comment near the publish step stating that npm trusted publishing must be configured for the package on npmjs.com, using the workflow filename `release.yml`.

## Configuration

The MVP reads optional configuration from `package.json`:

```json
{
  "pkgGuard": {
    "preset": "typescript-library",
    "ignore": ["release.trusted-publishing-missing"],
    "strict": ["package.files-missing"]
  }
}
```

Configuration merge order:

1. Built-in defaults.
2. Preset defaults.
3. `package.json` `pkgGuard`.
4. CLI flags.

Invalid config should produce exit code `2`.

## Reporters

### Human Reporter

The default reporter groups findings by severity and prints:

- severity
- finding ID
- title
- file/path
- message
- impact
- suggested fix
- fixability

Use color only when stdout is a TTY and color is not disabled.

### JSON Reporter

The JSON reporter is the stable integration surface for the MVP.

It should include:

- schema version
- package name
- project root
- summary counts
- findings
- command metadata

Future reporters:

- SARIF
- GitHub Actions annotations
- Markdown summary

## Error Handling

Expected project problems should become findings, not thrown errors.

Examples:

- missing build output
- malformed `exports`
- conflicting lockfiles
- unreadable workflow YAML

Unexpected tool failures should return exit code `3` with a concise message. JSON mode should return a structured error envelope where possible.

## Testing Strategy

Use fixture projects for behavior-level coverage.

Fixture categories:

- valid TypeScript library
- missing `types`
- broken `exports`
- package includes `.env`
- missing `packageManager`
- conflicting package manager metadata
- long-lived npm token workflow
- trusted-publishing-shaped workflow
- CLI package with `bin`

Test layers:

- unit tests for pure checks
- fixture integration tests for `check`
- fixture mutation tests for `fix`
- snapshot tests for generated release workflow
- reporter tests for human and JSON output

The test suite should avoid network access.

## Dependency Choices

Recommended initial dependencies:

- CLI parser: `commander` or `cac`
- terminal colors: `picocolors`
- JSON edits: `jsonc-parser`
- YAML parsing/editing: `yaml`
- semver validation: `semver`
- test runner: `vitest`
- TypeScript execution/build: `tsx` for development, `tsup` or `rollup` for packaging

The implementation should avoid large dependency graphs for security and startup-time reasons.

## Security Considerations

- Do not execute project lifecycle scripts as part of package inspection.
- Do not read or print secret values.
- Redact detected token values in workflow findings.
- Treat `.env` and similar files as sensitive if included in pack output.
- Keep `check` and `fix` network-free.
- Avoid destructive edits.
- Never remove authentication secrets automatically.

## Known Limitations

- npm-side trusted publisher configuration cannot be verified without network/API access.
- TypeScript config inheritance may be incomplete in the first implementation.
- Import-based dependency analysis can produce false positives and should start conservative.
- Monorepo support is deferred.
- Non-npm registries are deferred.
- SARIF is deferred until finding locations stabilize.

## Implementation Plan

Implementation is tracked in [implementation-plan.md](implementation-plan.md). That document breaks this design into reviewable phases sized around one code-review-commit cycle.

## References

- npm trusted publishing docs: https://docs.npmjs.com/trusted-publishers/
- npm provenance docs: https://docs.npmjs.com/generating-provenance-statements/
