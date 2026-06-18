export function getHelpText(): string {
  return `pkg-guard

Guard npm package manifests, entry points, and release workflows before publishing.

Usage:
  pkg-guard <command> [options]

Commands:
  check          Audit the current package.
  fix            Apply conservative automatic fixes.
  init-release   Create a GitHub Actions npm release workflow.

Options:
  --json         Print machine-readable JSON.
  --cwd <path>   Run against a different project directory.
  -h, --help     Show help.
`;
}

export function getCommandHelpText(command: string): string {
  if (command === "check") {
    return `pkg-guard check

Audit the current package.

Usage:
  pkg-guard check [--json] [--cwd <path>]
`;
  }

  if (command === "fix") {
    return `pkg-guard fix

Apply conservative automatic fixes.

Usage:
  pkg-guard fix [--dry-run] [--json] [--cwd <path>]
`;
  }

  if (command === "init-release") {
    return `pkg-guard init-release

Create a GitHub Actions npm release workflow.

Usage:
  pkg-guard init-release [--json] [--cwd <path>]
`;
  }

  return getHelpText();
}
