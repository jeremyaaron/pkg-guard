# Changelog

## 0.2.0

- Makes package intent operational with `generic`, `typescript-library`, and `cli` presets. `pkg-guard` infers a preset by default and allows `pkgGuard.preset` overrides.
- Reduces noisy TypeScript-library findings for CLI and generic packages while strengthening CLI `bin` validation.
- Adds lifecycle script checks for install-time scripts and high-confidence suspicious install behavior.
- Improves release workflow validation with broader package-validation command recognition, scoped package publish access checks, and self-hosted trusted publishing warnings.
- Adds conservative support for simple single-star export target patterns in entrypoint and pack checks.
- Expands `pkg-guard fix` with safe metadata fixes for `files`, scoped package access, inferred Node engines, and low-risk `sideEffects`.

## 0.1.2

- Updates `pkg-guard init-release` so scoped packages publish with the correct npm access flag.
- Refuses to generate a publish workflow for packages marked `private: true`.
- Adds `manifest.types-missing` so the existing `fix.types` plan references a documented check ID.

## 0.1.1

- Improves release workflow checks so validation commands reached through package scripts are recognized.
- Reduces false positives for workflows that run aggregate scripts such as `npm run verify:release`, `pnpm run verify:release`, `yarn verify:release`, or `bun run verify:release` before publishing.

## 0.1.0

Initial public release.

- Adds `pkg-guard check` for npm package metadata, entrypoint, pack contents, TypeScript, workflow, and dependency hygiene.
- Adds `pkg-guard fix` for conservative manifest metadata repairs.
- Adds `pkg-guard init-release` for a tag-driven npm trusted publishing workflow.
- Adds human and JSON output for CLI and CI use.
