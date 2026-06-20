# pkg-guard v0.1.1 Technical Design

## Overview

`pkg-guard` v0.1.1 improves workflow validation by expanding package scripts referenced from GitHub Actions `run:` steps before required publish-step checks run.

The change is intentionally narrow. It does not change CLI options, check IDs, report shape, workflow generation, package discovery, or fix behavior. It only gives the existing workflow checks a richer static command list for test, build, and package-validation detection.

Reference PRD: [prd.md](prd.md)

## Current Behavior

The v0.1.0 workflow check flow is:

1. Parse each workflow YAML file.
2. Collect direct `run:` strings from job steps.
3. Treat the workflow as publish-related when a direct `run:` command contains `npm publish` or `npx semantic-release`.
4. Run required-step checks against the direct `run:` strings.

This misses validation hidden behind scripts:

```yaml
- run: npm run verify:release
- run: npm publish
```

```json
{
  "scripts": {
    "verify:release": "npm test && npm run build && npm run pack:check",
    "pack:check": "pkg-guard check && npm pack --dry-run --ignore-scripts"
  }
}
```

The direct workflow command list contains `npm run verify:release`, but not the commands reachable from `verify:release`.

## Design Goals

- Keep workflow analysis deterministic and read-only.
- Reuse the parsed package manifest already available in `ProjectContext`.
- Avoid a full shell parser.
- Keep publish workflow detection stable for v0.1.1.
- Expand only enough command text for existing required-step detectors to work.
- Bound recursion so malformed or cyclic script graphs cannot hang analysis.
- Keep all behavior covered through workflow check tests.

## Non-Goals

- Execute scripts.
- Add a package script parser dependency.
- Interpret shell conditionals, variable expansion, command substitution, or npm config behavior.
- Detect publish workflows solely because a package script contains `npm publish`.
- Add support for new validation command forms such as `npm exec pkg-guard check`.
- Modify reporter output or finding IDs.

## Data Flow

### Existing Types

No public or cross-module type changes are required. The implementation can keep the change inside `src/checks/workflows.ts`.

`ProjectContext` already exposes:

```ts
context.manifest.data.scripts
context.workflows
```

The workflow check currently receives the whole context at the top level but passes only `WorkflowInfo` into workflow analysis. v0.1.1 should pass package scripts into the analysis step.

### Proposed Internal Shape

Update `WorkflowAnalysis` to distinguish direct workflow commands from expanded validation commands:

```ts
interface WorkflowAnalysis {
  workflow: WorkflowInfo;
  data: Record<string, unknown>;
  publishSteps: string[];
  stepRuns: string[];
  validationCommands: string[];
}
```

Where:

- `stepRuns` is the direct workflow `run:` command list.
- `publishSteps` is derived from `stepRuns`, preserving v0.1.0 publish workflow detection.
- `validationCommands` is `stepRuns` plus package scripts reachable from script invocations.

Required-step checks should use `validationCommands`. Other checks should continue using the data they use today:

- Long-lived token detection: workflow raw text.
- OIDC permission detection: parsed workflow data.
- risky trigger detection: parsed workflow data.
- publish workflow detection: direct `stepRuns`.

This avoids changing the scope of what counts as a publish workflow in a patch release.

## Package Script Extraction

Add a helper that extracts string-valued package scripts:

```ts
function getPackageScripts(value: unknown): Record<string, string>
```

Behavior:

- Return an empty object unless `value` is a non-array object.
- Include only entries whose values are strings.
- Preserve script names exactly as written.
- Do not normalize or validate script bodies.

This keeps malformed `scripts` data non-fatal.

## Script Invocation Detection

Add a helper that finds package script names referenced in a command string:

```ts
function collectScriptInvocations(command: string): string[]
```

The helper should normalize line continuations and whitespace before matching. It should use conservative global matching rather than trying to split shell syntax perfectly.

Supported forms:

```text
npm run <script>
npm run-script <script>
npm <script>
pnpm run <script>
pnpm <script>
yarn run <script>
yarn <script>
bun run <script>
```

Matching rules:

- Script names end at whitespace or a common shell operator boundary.
- Script names may include `:`, `-`, `_`, `.`, and other non-whitespace characters used in normal npm script names.
- Flags after the script name are allowed and ignored.
- Unknown script names are harmless because expansion only follows names present in `package.json` scripts.

The direct forms `npm <script>`, `pnpm <script>`, and `yarn <script>` can over-match built-in commands such as `install` or `publish`. That is acceptable because the expansion step only follows a match when the project actually defines a script with that name. The existing direct command detectors still handle install, test, and build commands independently.

## Recursive Expansion

Add a helper that expands script references:

```ts
function expandPackageScripts(commands: string[], scripts: Record<string, string>): string[]
```

Output should include:

1. Every original workflow command.
2. Every reachable package script command body.

Expansion algorithm:

```text
expanded = copy of workflow commands
visited = empty set
queue = script names found in workflow commands

while queue is not empty and expansion limit is not exceeded:
  scriptName = queue.shift()
  if scriptName was visited:
    continue
  mark scriptName visited
  scriptCommand = scripts[scriptName]
  if scriptCommand is not a string:
    continue
  add scriptCommand to expanded
  add script names found in scriptCommand to queue
```

Use both protections:

- A `visited` set keyed by script name to handle direct and indirect cycles.
- A maximum expansion count, such as `50`, to avoid excessive work in unusual script graphs.

The max count should be large enough for realistic script chains and small enough that analysis stays cheap. Hitting the limit should silently stop expansion for v0.1.1; it should not emit a new finding because the PRD preserves check IDs and reporter shape.

## Required-Step Checks

Change required-step checks from:

```ts
hasTestStep(analysis.stepRuns)
hasBuildStep(analysis.stepRuns)
hasPackageValidationStep(analysis.stepRuns)
```

to:

```ts
hasTestStep(analysis.validationCommands)
hasBuildStep(analysis.validationCommands)
hasPackageValidationStep(analysis.validationCommands)
```

`hasInstallStep` can also use `validationCommands` for consistency, but it is not the main target of the release. If this broadens recognition of scripted install steps, that is acceptable because the command still has to be statically reachable from the workflow.

Existing detectors should remain mostly unchanged:

- `hasTestStep` already recognizes `npm test`, `npm run test`, and package-manager equivalents.
- `hasBuildStep` already recognizes `npm run build` and equivalents.
- `hasPackageValidationStep` already recognizes `pkg-guard check` and `npm pack --dry-run`.

Because `hasPackageValidationStep` matches `pkg-guard check` anywhere in the normalized command, `npx pkg-guard check` remains covered without adding a new pattern.

## Edge Cases

### Cycles

Given:

```json
{
  "scripts": {
    "a": "npm run b",
    "b": "npm run a"
  }
}
```

Expansion should terminate after visiting each script once.

### Multiple Invocations in One Command

Given:

```json
{
  "scripts": {
    "verify": "npm run test && npm run build && npm run pack:check"
  }
}
```

All three nested invocations should be discovered.

### Missing Scripts

Given:

```yaml
- run: npm run verify:release
```

and no `verify:release` script in `package.json`, expansion should leave the command list unchanged and existing missing-step findings should still apply.

### Malformed Scripts Object

If `scripts` is missing, null, an array, or contains non-string values, workflow analysis should not crash.

### Publish Script Detection

Given:

```yaml
- run: npm run release
```

and:

```json
{
  "scripts": {
    "release": "npm publish"
  }
}
```

v0.1.1 does not need to classify this as a publish workflow. That broader behavior can be evaluated in a later release.

## Testing Strategy

Extend `tests/workflows.test.ts`.

Update the fixture helper to accept optional scripts:

```ts
async function createFixture(options: {
  workflow: string;
  scripts?: Record<string, unknown>;
}): Promise<string>
```

The helper should write those scripts into `package.json` when provided.

Add tests for:

- `npm run verify:release` satisfies test, build, and package-validation checks through nested scripts.
- `pack:check` satisfies package validation when it contains `pkg-guard check && npm pack --dry-run --ignore-scripts`.
- `pnpm run verify:release`, `yarn verify:release`, and `bun run verify:release` expand package scripts.
- cyclic scripts terminate without throwing or hanging.
- missing script names still produce the existing missing-step findings.
- malformed or non-string scripts do not crash and do not create false confidence.

Keep existing tests unchanged unless the fixture helper signature changes.

## Verification

Run:

```sh
npm test -- tests/workflows.test.ts
npm test
npm run typecheck
```

Because the change is isolated to workflow checks, the focused workflow test should catch most regressions. The full test suite and typecheck should still run before release.

## Implementation Notes

- Keep helpers private to `src/checks/workflows.ts` unless reuse becomes necessary.
- Prefer small pure helpers so unit coverage can come through existing workflow check tests.
- Do not add dependencies.
- Preserve current finding IDs and wording.
- Keep expansion silent; do not add debug output or informational findings in v0.1.1.
