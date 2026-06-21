# pkg-guard v0.2.0 PRD

## Summary

`pkg-guard` v0.2.0 should make the CLI meaningfully smarter without changing its identity. The tool already covers the v0.1.x MVP surface: manifest hygiene, entrypoint existence, pack contents, TypeScript declaration settings, GitHub Actions release workflow checks, conservative fixes, and release workflow generation.

The next minor should focus on reducing false positives as pkg-guard moves beyond a single default package shape. The central product move is to make package intent explicit through presets, then use that intent to improve lifecycle, entrypoint, release, and dependency checks.

## Recommendation

After v0.1.2, move to v0.2.0.

The v0.2.0 theme should be:

> Better project intent, better release safety, fewer noisy guesses.

## Problems

### Preset Is Parsed But Not Used

`pkgGuard.preset` is accepted by config, but it does not affect checks. This is acceptable in v0.1.x, but it becomes a liability as the check set grows. A CLI package, TypeScript library, React library, and private package do not need identical advice.

### Release Workflow Coverage Is GitHub-Only

The generated workflow targets GitHub Actions, which is still the right default. However, npm trusted publishing now supports GitHub Actions, GitLab CI/CD, and CircleCI. pkg-guard does not need to generate all providers in v0.2.0, but its checks and docs should clearly model provider limits and avoid assuming every OIDC publish workflow is GitHub-shaped.

### Lifecycle Scripts Are Still Unchecked

The original MVP called out install-time lifecycle scripts as a supply-chain risk. v0.1.x does not warn on `preinstall`, `install`, or `postinstall`.

### Entry Point Checks Are Useful But Shallow

v0.1.x validates simple targets and warns on unsupported patterns. That catches many broken packages, but common modern packages use export patterns, conditional export objects, and CLI-specific package shapes.

### Fixes Are Conservative But Sparse

`pkg-guard fix` currently adds a few safe metadata fields. The v0.2.0 opportunity is not aggressive rewriting; it is adding narrowly provable fixes that fit the detected preset.

## Goals

- Make `pkgGuard.preset` operational.
- Add a default preset selection model with clear override behavior.
- Add a `cli` preset alongside the existing TypeScript library assumptions.
- Add lifecycle script checks.
- Improve release workflow checks and generation where behavior is already knowable.
- Expand package validation command recognition beyond the v0.1.1 script expansion patch.
- Improve entrypoint and pack validation for common export patterns.
- Add a small set of new conservative fixes.
- Keep `check` read-only and network-free.
- Preserve stable JSON report shape.

## Non-Goals

- Full monorepo support.
- Full import graph dependency analysis.
- SARIF output.
- Editor integration.
- A GitHub Action wrapper.
- Executing package scripts during analysis.
- Rewriting complex `exports` maps.
- Supporting arbitrary registries.
- Replacing release tools such as Changesets or semantic-release.

## Target Users

Primary:

- TypeScript library maintainers publishing to npm from CI.
- CLI package maintainers publishing Node-based binaries.

Secondary:

- Maintainers of scoped public packages.
- Maintainers migrating from token-based publishing to trusted publishing.
- Template authors who want a stricter publish-readiness gate.

## Product Behavior

### Presets

Supported presets in v0.2.0:

- `typescript-library`
- `cli`

Preset selection:

- `pkgGuard.preset` wins when configured.
- Otherwise infer `cli` when `bin` exists and package entrypoints look command-oriented.
- Otherwise infer `typescript-library` when `tsconfig.json` exists and the package has `main`, `module`, `exports`, `types`, or `typings`.
- Otherwise use a conservative generic package policy.

Preset effects:

- Change applicability and severity, not finding identity.
- Avoid warning about library-specific metadata for CLI-only packages when it is not relevant.
- Make `bin` checks stricter for CLI packages.
- Keep critical safety checks such as sensitive packed files enabled for all publishable packages.

### Lifecycle Script Checks

Add checks for:

- `preinstall`
- `install`
- `postinstall`
- suspicious install-time command fragments when confidence is high

Default behavior:

- Warn on install-time lifecycle scripts.
- Explain consumer impact.
- Error only for clearly dangerous patterns.
- Allow suppression through existing `ignore` config.

### Release Workflow Improvements

Improve checks for:

- `npm exec pkg-guard check`
- `pnpm dlx pkg-guard check`
- `yarn dlx pkg-guard check`
- `bunx pkg-guard check`
- `npm publish --access public` for scoped packages
- self-hosted runner trusted-publishing caveats
- GitHub workflow environment names when present

Keep generation GitHub-only in v0.2.0, but make docs explicit that npm also supports other trusted publishing providers.

### Entrypoint and Pack Improvements

Improve support for:

- `exports` pattern targets such as `./feature/*`
- conditional exports that distinguish runtime and types
- `typesVersions` warning-only validation
- CLI packages whose only public interface is `bin`
- packlist matching for expanded export patterns where files can be resolved cheaply

### Fix Improvements

Add conservative fixes for:

- `engines.node` when a safe minimum can be inferred from TypeScript target, package syntax, or current project config.
- `files` when build output and required docs are unambiguous.
- `sideEffects: false` only when the preset and file set make that low risk.
- `publishConfig.access` for scoped public packages when missing and the package is not private.

Every new fix must be idempotent and covered by dry-run tests.

## Acceptance Criteria

- `pkgGuard.preset` changes check applicability in tests.
- `cli` preset catches missing bin shebangs and avoids irrelevant library warnings.
- Lifecycle script warnings are documented and suppressible.
- Package validation command recognition covers `npm exec`, package-manager dlx forms, and existing direct/scripted forms.
- Scoped package release behavior is tested across check, fix, and init-release paths.
- Export pattern support validates common pattern targets without crashing on unsupported shapes.
- New fixes are idempotent and visible in JSON dry-run output.
- Full verification passes:
  - `npm test`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `node dist/cli/index.js check`

## Release Notes Draft

`pkg-guard` v0.2.0 adds real preset behavior, a CLI package preset, lifecycle script checks, stronger release workflow validation, broader package-validation command recognition, and improved entrypoint/package checks for common modern package shapes.
