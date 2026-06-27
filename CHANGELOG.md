# Changelog

## 0.4.0

- Adds opt-in consumer smoke checks with `pkg-guard check --consumer-smoke` for single packages and workspace packages.
- Consumer smoke creates an npm tarball with `npm pack --json --ignore-scripts --pack-destination`, installs it into an isolated temporary consumer project with lifecycle scripts disabled, and cleans up temporary files.
- Adds consumer smoke findings for tarball creation, install, runtime resolution, installed bin layout, and TypeScript declaration resolution failures.
- Expands artifact contract validation by sharing package target collection across pack checks and consumer smoke, including nested conditional exports and simple export pattern metadata.
- Keeps export pattern runtime smoke conservative by skipping representative subpath generation while existing packlist checks continue to validate whether simple patterns include matching files.
- Adds an internal analysis boundary for structured findings, separating CLI/report rendering from project analysis and creating a cleaner path toward future IDE integrations.
- Adds workspace/reporting coverage so consumer smoke findings stay package-scoped in workspace JSON and SARIF output without schema changes.

## 0.3.2

- Refines `dependencies.workspace-range` for issue #11 so pnpm workspace dependencies on publishable local workspace packages no longer fail when `pkg-guard check --workspaces` can prove pnpm will rewrite them during publish.
- Keeps `dependencies.workspace-range` release-blocking for unsafe workspace protocol ranges, including missing workspace targets, non-pnpm roots, unknown or npm publish paths, and public packages that depend on private workspace packages in published dependency metadata.
- Adds workspace publish-path inference from root and package-local GitHub Actions workflows, treating obvious `npm publish` and `npx semantic-release` commands as npm publish paths even in pnpm-managed workspaces.

## 0.3.1

- Fixes `typescript.types-source-file` so generated declaration targets such as `./dist/index.d.ts`, `.d.cts`, and `.d.mts` are not treated as TypeScript source files.
- Reduces TypeScript config noise when `tsconfig.json` uses unresolved `extends` by keeping `typescript.extends-unresolved` but suppressing inferred missing-declaration warnings from incomplete local compiler options.

## 0.3.0

- Adds workspace-aware `check`, `fix`, and `init` flows with `--workspaces`, `--workspace <selector>`, `--include-private`, and `--include-root`.
- Discovers workspace packages from `package.json` workspace fields and `pnpm-workspace.yaml`, with stable workspace discovery findings for invalid config, unsupported patterns, invalid package manifests, and unmatched selectors.
- Skips private workspace packages by default while allowing explicit audits with `--include-private`.
- Adds workspace human and JSON reports that show package labels, skipped packages, and package-local findings.
- Adds SARIF output for `pkg-guard check --format sarif`, including workspace SARIF paths suitable for CI upload.
- Adds `pkg-guard init` to create conservative `pkg:check` scripts and inferred package intent config, including workspace-root initialization.
- Adds workspace-aware fix planning, with `fix --workspaces --dry-run` for batch previews and `fix --workspace <selector>` for selected-package apply.
- Refreshes trusted publishing generation and checks for current npm requirements: generated workflows use Node `24` and install `npm@^11.5.1`, old static Node/npm versions warn, and self-hosted runner guidance reflects npm trusted publishing support.

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
