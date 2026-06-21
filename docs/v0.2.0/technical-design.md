# pkg-guard v0.2.0 Technical Design

## Overview

v0.2.0 should introduce project intent as a first-class concept. Today every check reads the same `ProjectContext` and decides applicability independently. That is simple, but it will become noisy as pkg-guard adds CLI-specific, library-specific, and release-specific behavior.

The design adds a small preset layer, then uses it to route new checks and fixes without changing the CLI report schema.

## Design Goals

- Keep checks deterministic and testable.
- Keep discovery read-only and network-free.
- Preserve existing finding IDs and JSON report shape.
- Add new IDs only for new user-visible findings.
- Make preset behavior explicit enough to document.
- Avoid a plugin system or deep rule engine in v0.2.0.

## Preset Model

Add a resolved preset to `ProjectContext`.

```ts
export type PresetName = "generic" | "typescript-library" | "cli";

export interface ResolvedPreset {
  name: PresetName;
  source: "config" | "inferred" | "default";
}
```

Update `ProjectContext`:

```ts
export interface ProjectContext {
  // existing fields
  preset: ResolvedPreset;
}
```

Resolution order:

1. `pkgGuard.preset` if valid and supported.
2. Infer `cli` when `bin` exists.
3. Infer `typescript-library` when `tsconfig.json` exists and the manifest exposes runtime or type entrypoints.
4. Default to `generic`.

Unsupported configured presets should emit `config.invalid` in v0.2.0. The config parser currently accepts any non-empty string; v0.2.0 should validate against supported names.

## Check Applicability

Keep the existing `Check` interface simple, but allow checks to branch on `context.preset`.

Do not introduce separate rule files yet. The codebase is still small enough that a heavier rule engine would add more ceremony than clarity.

Expected routing:

- `manifest`, `pack`, and critical `entrypoint` checks run for all publishable packages.
- TypeScript declaration checks apply primarily to `typescript-library`.
- CLI bin checks apply strongly to `cli`.
- Lifecycle script checks apply to all publishable packages.
- Dependency checks continue to skip `private: true` packages unless a future private-package preset changes that.

## Lifecycle Checks

Add `src/checks/lifecycle.ts`.

New finding IDs:

- `lifecycle.install-script`
- `lifecycle.suspicious-install-script`

Detection:

- Read `manifest.scripts`.
- Warn when `preinstall`, `install`, or `postinstall` is a string.
- Escalate to error only for high-confidence suspicious fragments:
  - shell piping network output into a shell
  - direct references to credential-looking environment variables in install scripts
  - destructive filesystem commands outside obvious build output

Keep the suspicious matcher intentionally small. v0.2.0 should not become a malware scanner.

## Release Workflow Improvements

Extend existing helpers in `src/checks/workflows.ts`.

Package validation detection should recognize:

- `pkg-guard check`
- `npx pkg-guard check`
- `npm exec pkg-guard check`
- `pnpm dlx pkg-guard check`
- `yarn dlx pkg-guard check`
- `bunx pkg-guard check`
- `npm pack --dry-run`

Publish checks should recognize scoped package access expectations:

- If `manifest.name` is scoped and `publishConfig.access` is absent, warn when publish commands do not include `--access public` or `--access restricted`.
- If `publishConfig.access` exists, compare workflow command flags against it when obvious.

Trusted publishing checks should stay GitHub Actions-focused for generation, but validation can add caveat findings when:

- a GitHub publish job uses `runs-on: self-hosted`,
- a workflow grants `id-token: write` but still uses `NPM_TOKEN` for publish.

Do not classify workflows as publish workflows solely because a package script contains `npm publish`; preserve the v0.1.1 decision unless a user reports a concrete false negative.

## Release Workflow Generation

Update `src/core/release.ts`:

- Derive publish command from manifest name and `publishConfig.access`.
- Include the selected publish command in the result object.
- Keep GitHub Actions generation as the only generated provider.
- Keep Node `24`, `id-token: write`, and `package-manager-cache: false`; these remain aligned with current npm trusted publishing requirements.

Future provider generation belongs after v0.2.0.

## Entrypoint Pattern Support

Extend entrypoint collection to distinguish:

```ts
type DeclaredEntryPoint =
  | { kind: "file"; source: EntrySource; target: string; jsonPath: string; requiresShebang: boolean }
  | { kind: "pattern"; source: "exports"; keyPattern: string; targetPattern: string; jsonPath: string };
```

Pattern validation should be conservative:

- Validate that target patterns stay inside the package root.
- If the target prefix directory exists, ensure at least one file matches the pattern.
- Cross-check matched files against pack output when available.
- Emit `entrypoint.unsupported-target` for patterns that cannot be cheaply resolved.

Avoid implementing full Node conditional export resolution.

## Fixes

Add fix plans only when the source data is clear.

New or expanded fixes:

- `fix.engines-node`
- `fix.files`
- `fix.side-effects`
- `fix.publish-access`

Rules:

- `fix.files` should require clear build output such as `dist` plus README/LICENSE when present.
- `fix.side-effects` should require no CSS, polyfill, register, global, or lifecycle-looking files.
- `fix.publish-access` should apply only to scoped, non-private packages without `publishConfig.access`.
- `fix.engines-node` should not infer a minimum from the developer's installed Node version alone.

## Documentation

Update:

- `docs/checks.md`
- `docs/configuration.md`
- `docs/release-workflow.md`
- `docs/examples.md`
- `README.md` only for high-level v0.2.0 behavior

Document preset behavior with examples, not a large theory section.

## Compatibility

v0.2.0 may add warnings. It should not change exit-code semantics:

- warnings do not fail by default,
- errors fail,
- strict mode only upgrades configured warning IDs.

The JSON report schema remains `schemaVersion: 1`.
