# Changelog

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
