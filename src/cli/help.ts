export function getHelpText(): string {
  return `pkg-guard

Guard npm package manifests, entry points, and release workflows before publishing.

Usage:
  pkg-guard <command> [options]

Commands:
  check          Audit the current package.
  fix            Apply conservative automatic fixes.
  init           Add pkg-guard package scripts and config.
  init-release   Create a GitHub Actions npm release workflow.

Options:
  --format <name>         Print human, json, or sarif output.
  --json                  Alias for --format json.
  --strict                Upgrade configured strict warnings to errors.
  --consumer-smoke        Run opt-in consumer resolution checks.
  --ignore <id>           Ignore a check ID for this run.
  --workspaces            Run against workspace packages.
  --workspace <selector>  Run against one workspace package by name or path.
  --include-private       Include private packages in workspace mode.
  --include-root          Include the root package in workspace mode.
  --cwd <path>            Run against a different project directory.
  -h, --help              Show help.
`;
}

export function getCommandHelpText(command: string): string {
  if (command === "check") {
    return `pkg-guard check

Audit the current package.

Usage:
  pkg-guard check [--format human|json|sarif] [--json] [--strict] [--consumer-smoke] [--ignore <id>] [--workspaces] [--workspace <selector>] [--include-private] [--include-root] [--cwd <path>]
`;
  }

  if (command === "fix") {
    return `pkg-guard fix

Apply conservative automatic fixes.

Usage:
  pkg-guard fix [--dry-run] [--format human|json] [--json] [--strict] [--ignore <id>] [--workspaces] [--workspace <selector>] [--include-private] [--include-root] [--cwd <path>]
`;
  }

  if (command === "init") {
    return `pkg-guard init

Add pkg-guard package scripts and config.

Usage:
  pkg-guard init [--dry-run] [--format human|json] [--json] [--workspaces] [--workspace <selector>] [--include-private] [--include-root] [--cwd <path>]
`;
  }

  if (command === "init-release") {
    return `pkg-guard init-release

Create a GitHub Actions npm release workflow.

Usage:
  pkg-guard init-release [--format human|json] [--json] [--strict] [--ignore <id>] [--cwd <path>]
`;
  }

  return getHelpText();
}
