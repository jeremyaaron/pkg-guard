# pkg-guard v0.1.1 PRD

## Summary

`pkg-guard` v0.1.1 improves GitHub Actions release workflow analysis so validation steps hidden behind npm scripts are recognized correctly.

The v0.1.0 workflow checks inspect direct workflow `run:` commands for install, test, build, and package validation steps before npm publishing. That works for workflows that spell out each command in YAML, but it creates false positives when a release workflow delegates to an aggregate package script such as `npm run verify:release`.

This release should keep the existing CLI and check IDs intact while making static workflow analysis match how maintainers commonly organize release validation.

Reference issue: <https://github.com/jeremyaaron/pkg-guard/issues/2>

## Problem

Many npm packages centralize release verification in `package.json` scripts so the same validation can run locally and in CI:

```json
{
  "scripts": {
    "verify:release": "npm run lint && npm run typecheck && npm test && npm run build && npm run pack:check",
    "pack:check": "pkg-guard check && npm pack --dry-run --ignore-scripts"
  }
}
```

A release workflow may then run:

```yaml
- run: npm run verify:release
- run: npm publish
```

In v0.1.0, `pkg-guard` only checks the literal workflow command string. It sees `npm run verify:release`, but it does not inspect the corresponding package script. As a result, it can report:

- `workflow.test-step-missing`
- `workflow.build-step-missing`
- `workflow.package-validation-missing`

Those findings are false positives when the referenced script chain actually runs the required validation.

## Goals

- Recognize package scripts invoked from GitHub Actions workflow `run:` steps through npm, pnpm, Yarn, and Bun commands.
- Expand referenced scripts recursively enough to detect known validation commands.
- Treat test, build, and package validation as present when they appear inside a reachable package script chain.
- Preserve the existing workflow check IDs, severities, CLI behavior, and reporter output shape.
- Keep analysis static and deterministic.
- Prevent infinite recursion or excessive work when scripts reference each other cyclically.
- Cover the behavior with focused automated tests.

## Non-Goals

- Execute package scripts.
- Fully parse shell syntax.
- Add new CLI options.
- Add new check IDs.
- Change workflow generation from `pkg-guard init-release`.
- Support arbitrary external task runners in this release.
- Add new package validation command forms beyond the existing direct command patterns.
- Guarantee that every command inside every possible shell expression is understood.
- Change SemVer policy beyond releasing this fix as v0.1.1.

## Target Users

The primary user is an npm package maintainer who publishes from GitHub Actions and keeps release validation in reusable npm scripts.

This is especially relevant for maintainers who want one command, such as `npm run verify:release`, to be usable both locally and in CI.

## Product Behavior

When analyzing a publish workflow, `pkg-guard` should continue collecting direct workflow `run:` commands. Before checking for required validation steps, it should augment those commands with package script commands referenced by package-manager script invocations.

For example, given:

```yaml
steps:
  - run: npm ci
  - run: npm run verify:release
  - run: npm publish
```

and:

```json
{
  "scripts": {
    "verify:release": "npm run lint && npm run typecheck && npm test && npm run build && npm run pack:check",
    "pack:check": "pkg-guard check && npm pack --dry-run --ignore-scripts"
  }
}
```

`pkg-guard` should recognize:

- test validation from `npm test`
- build validation from `npm run build`
- package validation from `pkg-guard check`
- package validation from `npm pack --dry-run --ignore-scripts`

The workflow should not receive `workflow.test-step-missing`, `workflow.build-step-missing`, or `workflow.package-validation-missing` for that script chain.

## Functional Requirements

### Script Discovery

- Read npm scripts from `context.manifest.data.scripts`.
- Treat `scripts` as unavailable when it is missing, null, an array, or another non-object value.
- Only consider script entries whose values are strings.

### Script Invocation Detection

- Detect script invocations in workflow commands using common package-manager forms:
  - `npm run <script>`
  - `npm run-script <script>`
  - `npm <script>` for built-in lifecycle-like commands that are already recognized by existing checks, such as `npm test`
  - `pnpm run <script>`
  - `pnpm <script>` for common script commands such as `pnpm test` and `pnpm build`
  - `yarn run <script>`
  - `yarn <script>`
  - `bun run <script>`
- Script names may include characters commonly used in npm scripts, including `:`, `-`, `_`, and `.`.
- Flags after the script name should not prevent script detection.
- The implementation may handle these forms with conservative token or regular-expression matching. It does not need to become a full shell parser.

Package-manager equivalents are in scope for v0.1.1 because the existing required-step detectors already recognize direct `pnpm`, `yarn`, and `bun` install/test/build commands. Expanding scripts for those managers keeps behavior consistent without adding new check categories or CLI surface area.

### Recursive Expansion

- When a workflow command invokes an npm script, include that script command in the command list used by workflow checks.
- When a package script invokes another package script, include the nested script command as well.
- Expansion must be recursive but bounded.
- Expansion must avoid infinite loops when scripts reference themselves directly or indirectly.
- Unknown script names should be ignored without producing a new finding.

### Validation Detection

- Existing required-step detectors should work against the expanded command list.
- `workflow.test-step-missing` should not be emitted when a reachable script chain includes a recognized test command.
- `workflow.build-step-missing` should not be emitted when a reachable script chain includes a recognized build command.
- `workflow.package-validation-missing` should not be emitted when a reachable script chain includes `pkg-guard check` or `npm pack --dry-run`.
- Existing direct workflow command behavior must continue to work.
- `npx pkg-guard check` remains covered because the existing direct package-validation pattern matches `pkg-guard check` inside the command.
- `npm exec pkg-guard check` is not required for v0.1.1. That form is less central to the reported issue and should be considered later as part of a broader package-validation command coverage pass.

### Static Analysis and Safety

- Do not execute workflow commands or package scripts.
- Do not read files beyond the discovered project context needed for this check.
- Do not mutate project files.
- Do not add network access.

## Acceptance Criteria

- A release workflow that runs `npm run verify:release`, where `verify:release` eventually runs `npm test`, `npm run build`, and `npm run pack:check`, does not report missing test, build, or package validation steps.
- A nested script such as `pack:check` containing `pkg-guard check && npm pack --dry-run --ignore-scripts` satisfies package validation.
- Equivalent aggregate script usage through `pnpm run`, `yarn run`, `yarn <script>`, or `bun run` is recognized when the referenced package script contains known validation commands.
- A workflow with direct validation commands still passes as it did in v0.1.0.
- A workflow that truly lacks test, build, or package validation still reports the existing missing-step findings.
- Cyclic scripts such as `a -> b -> a` do not hang and do not crash.
- Missing or malformed `scripts` data does not crash workflow analysis.
- Existing workflow tests continue passing.

## Release Notes Draft

`pkg-guard` now recognizes validation commands reached through package scripts in GitHub Actions release workflows. This reduces false positives when projects centralize release checks behind commands such as `npm run verify:release`, `pnpm run verify:release`, `yarn verify:release`, or `bun run verify:release`.
