# pkg-guard v0.4.0 PRD

## Summary

`pkg-guard` v0.4.0 should move from package metadata hygiene toward published artifact contract verification.

The v0.3.x line made `pkg-guard` easier to adopt across real package publisher workflows: workspace mode, SARIF output, initialization, trusted publishing refreshes, and refined pnpm workspace dependency handling. The next minor should make the tool more serious as a release gate by validating what consumers actually receive after packing.

The v0.4.0 theme should be:

> Prove the package contract from the artifact users install.

## Recommendation

Start v0.4.0 directly from the v0.3.2 baseline.

No v0.3.x patch is currently justified unless a release-blocking regression appears after v0.3.2 validation or publication. v0.4.0 can be a minor release because it should add meaningful analysis capabilities and may introduce new check IDs, new opt-in command options, and new programmatic API surface.

v0.4.0 should not attempt to ship an IDE extension. It should make that future work easier by separating the analysis engine from CLI/reporting concerns and by producing diagnostics that can be mapped into editor problems later.

## Problems

### Manifest Checks Are Not Enough

`pkg-guard` already checks package metadata, declared entrypoints, pack contents, TypeScript settings, release workflows, dependency metadata, and workspace context. Those checks catch many release hazards, but they are still mostly static checks against the source tree and manifest.

Package consumers install the packed artifact, not the source repository. A package can look plausible in `package.json` while still failing once packed:

- declared entrypoints may point at files that are omitted from the tarball;
- export map branches may be structurally valid but unresolved for common consumers;
- TypeScript declarations may exist in the repo but not resolve from the packed package;
- CLI bins may be present but unusable after install;
- generated files may be stale or missing;
- packed contents may drift from the maintainer's intended contract.

To be taken seriously as publishing infrastructure, `pkg-guard` needs to reason closer to the consumer experience.

### Package Classes Have Different Contracts

Different package shapes fail in different ways:

- Type contract packages need declaration and schema outputs to resolve correctly.
- Runtime libraries need public imports and dependency metadata to work.
- CLI packages need executable `bin` targets, shebangs, runtime dependencies, and engine metadata.
- Plugin packages need peer dependency metadata and ecosystem-compatible exports.
- Workspace package families need local graph and private/public boundary checks.
- Generated packages need stale output and packlist drift checks.

Package manager behavior matters, but the more fundamental question is the package's published contract. v0.4.0 should lean into contract shape without fragmenting `pkg-guard` into many separate tools.

### IDE Adoption Needs Engine Boundaries First

The findings `pkg-guard` emits are useful before release time. Maintainers would benefit from seeing them in an IDE Problems panel while editing `package.json`, workflows, and package files.

However, shipping a VS Code extension or language server before the core engine is ready would create churn. The CLI currently owns too much of the execution shape: command parsing, report rendering, exit codes, and analysis orchestration are not a clean public integration surface.

v0.4.0 should prepare for IDE integration by making the analysis API more reusable, not by committing to an extension marketplace release.

## Goals

- Validate the package contract against the packed artifact, not only the source tree.
- Strengthen entrypoint, export map, type declaration, and bin validation using packed output.
- Add an opt-in consumer smoke mode that tests package resolution from a temporary install or extracted artifact.
- Keep default `pkg-guard check` deterministic, read-only, and reasonably fast.
- Avoid executing arbitrary package code by default.
- Preserve existing check IDs where behavior is the same, and add clear new IDs where artifact-level failures are distinct.
- Improve package intent modeling around published contract shape.
- Create a stable internal analysis API that future IDE extensions or language servers can call.
- Keep CLI human, JSON, and SARIF output compatible unless a schema change is explicitly justified.
- Document the difference between source-tree checks, packlist checks, and consumer smoke checks.

## Non-Goals

- Publishing packages directly.
- Replacing npm, pnpm, Yarn, Bun, Changesets, semantic-release, or release-please.
- Running arbitrary test suites or package scripts as part of default analysis.
- Full bundler simulation.
- Full Node resolver reimplementation for every edge case.
- Full TypeScript project build orchestration.
- Vulnerability scanning or lockfile audit replacement.
- Shipping a VS Code extension in v0.4.0.
- Shipping a full Language Server Protocol implementation in v0.4.0.
- Supporting non-npm registries as first-class publish targets.
- Breaking current `check`, `fix`, `init`, or `init-release` command behavior.

## Target Users

Primary:

- Maintainers of TypeScript libraries, runtime libraries, and CLI packages published to npm.
- Workspace maintainers using `pkg-guard check --workspaces` as a release gate.
- Package authors who want confidence that the packed artifact works for consumers.

Secondary:

- Maintainers of generated SDKs, schema packages, and contract packages.
- Plugin and framework package maintainers with peer dependency and export map constraints.
- Teams that want to surface package hygiene diagnostics in CI today and IDEs later.

## Product Behavior

### Artifact Contract Checks

`pkg-guard check` should continue using `npm pack --dry-run --json --ignore-scripts` to inspect the packed file list. v0.4.0 should expand what is checked against that packlist.

The tool should verify that packed output includes all files required by the published package contract:

- `main`
- `module`
- `types`
- `typings`
- `bin`
- string export targets
- simple conditional export targets
- simple export pattern targets where existing expansion support can validate them safely

When a source-tree target exists but is missing from the packlist, the finding should explain that consumers will not receive the file.

Potential finding IDs:

- `artifact.entrypoint-missing`
- `artifact.types-missing`
- `artifact.bin-missing`
- `artifact.export-missing`

Exact IDs should be finalized in the technical design. Existing `pack.entrypoint-missing` may be reused if the semantics already match.

### Consumer Smoke Mode

Add an opt-in consumer smoke check:

```sh
pkg-guard check --consumer-smoke
pkg-guard check --workspaces --consumer-smoke
```

The mode should simulate a consumer enough to catch resolution failures that static checks miss.

Minimum behavior:

- create a temporary isolated directory;
- use the package tarball or packed artifact metadata as input;
- install or extract the package without running package lifecycle scripts where feasible;
- test Node resolution for declared public runtime entrypoints;
- test TypeScript declaration resolution when TypeScript metadata is present and a safe local TypeScript check can be run;
- clean up temporary files after the run.

The mode should be opt-in because it is slower and touches the package manager more deeply than normal checks.

Consumer smoke should avoid executing package runtime code by default. Resolution checks are in scope; invoking exported functions is not.

Potential finding IDs:

- `consumer.import-unresolved`
- `consumer.require-unresolved`
- `consumer.types-unresolved`
- `consumer.bin-unresolved`

### Package Contract Presets

`pkgGuard.preset` currently supports broad package intent. v0.4.0 should define the next step for contract-aware analysis.

The release may add new preset values only if they are needed to control checks safely. A conservative approach is to keep existing preset names but document internal contract categories:

- Type contract package
- Runtime library
- CLI package
- Plugin package
- Generated artifact package
- Workspace package family

If new presets are added, they should be narrow and justified by checks that would otherwise be noisy.

Candidate preset additions:

- `runtime-library`
- `type-contract`
- `plugin`
- `generated-sdk`

Adding every candidate in v0.4.0 is not required. The technical design should decide whether new presets are necessary or whether artifact checks can infer intent from metadata.

### IDE-Ready Analysis API

v0.4.0 should introduce or formalize an internal API boundary that future editor integrations can use.

The API should support:

- analyze one package without invoking CLI parsing;
- analyze a workspace selection without rendering reports;
- return stable diagnostics with IDs, severity, message, file, JSON path, suggestion, and fixability;
- distinguish source-tree findings from artifact and consumer-smoke findings;
- avoid process exits and direct stdout/stderr writes;
- expose enough metadata for a VS Code extension or language server to convert findings into diagnostics.

This API does not need to be declared a stable public npm API in v0.4.0, but it should be designed as if it may become one.

### CLI Output

Existing `check` behavior should remain the default:

```sh
pkg-guard check
pkg-guard check --workspaces
```

Artifact contract checks that are deterministic and already based on pack metadata may run by default if performance remains acceptable.

Consumer smoke checks should require an explicit option:

```sh
pkg-guard check --consumer-smoke
```

Human output should make artifact and consumer-smoke findings understandable without adding noisy sections. JSON and SARIF should continue to use the existing finding schema unless a schema version bump is justified.

### Workspace Behavior

Workspace mode should support artifact contract checks per selected package.

Consumer smoke in workspace mode should be conservative:

- run per checked package;
- continue checking later packages if one smoke check fails;
- preserve package-scoped findings in JSON and SARIF;
- avoid installing or publishing the entire workspace unless the technical design proves it is necessary and safe.

## Functional Requirements

### Artifact Validation

- Validate declared public package targets against the packed file list.
- Reuse existing pack metadata where possible.
- Avoid reading or executing ignored files outside the package root.
- Preserve current single-package and workspace exit code semantics.
- Emit actionable suggestions when packed artifacts omit declared files.
- Keep `private: true` handling consistent with existing publishability checks.

### Consumer Smoke

- Add a CLI flag for opt-in smoke checks.
- Use temporary directories and clean them up.
- Avoid running arbitrary package lifecycle scripts by default.
- Report install, extraction, resolution, and type resolution failures separately enough to be actionable.
- Time out or fail gracefully when package manager operations hang or fail.
- Work for at least npm-managed single-package fixtures.
- Either support workspace packages in v0.4.0 or clearly mark workspace smoke support as experimental.

### Analysis API

- Add a core analysis function or module that both CLI and future integrations can use.
- Keep command parsing, rendering, and exit-code selection outside the analysis core.
- Return structured diagnostics compatible with current `Finding` output.
- Include enough file path information for editor diagnostics.
- Preserve policy application for ignore and strict behavior.

### Documentation

- Update check docs with new artifact and consumer-smoke findings.
- Update examples with `--consumer-smoke`.
- Add a short explanation of package contract classes and how they affect checks.
- Add a `0.4.0` changelog entry.
- Document that IDE integration is future-facing and enabled by analysis API cleanup, not shipped in v0.4.0.

## Open Product Questions

1. Should artifact contract checks run by default, or should all new artifact checks be behind `--artifact` for the first release?
2. Should consumer smoke install the generated tarball with `npm install <tarball> --ignore-scripts`, or should it inspect/extract the tarball without installing dependencies first?
3. How much TypeScript resolution should v0.4.0 attempt without becoming a TypeScript build tool?
4. Should new contract presets be user-facing in v0.4.0, or should the release only document contract classes while relying on inference?
5. Should the analysis API be exported from the package in v0.4.0, or kept internal until an IDE integration proves the shape?
6. Should future IDE work target a VS Code extension first, or a language server first?

## Acceptance Criteria

- `pkg-guard check` catches declared public targets that are present in the source tree but absent from the packed artifact.
- `pkg-guard check --consumer-smoke` catches at least one package resolution failure that static source-tree checks do not catch.
- Existing single-package and workspace checks continue to pass.
- Existing human, JSON, and SARIF report schemas remain compatible unless explicitly versioned.
- New artifact and consumer-smoke findings have stable IDs, clear messages, and actionable suggestions.
- The CLI uses a reusable analysis boundary rather than duplicating analysis orchestration.
- Docs explain artifact contract validation, consumer smoke mode, and future IDE-readiness.
- Full verification passes:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `node dist/cli/index.js check`
  - `npm pack --dry-run --json --ignore-scripts`
