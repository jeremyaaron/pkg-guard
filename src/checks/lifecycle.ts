import type { Check } from "../core/checks.js";
import type { PackageManifest, ProjectContext } from "../core/context.js";
import type { Finding } from "../core/findings.js";

const installLifecycleScripts = new Set(["preinstall", "install", "postinstall"]);

export const lifecycleChecks: Check[] = [
  {
    id: "lifecycle",
    run: runLifecycleChecks
  }
];

function runLifecycleChecks(context: ProjectContext): Finding[] {
  const manifest = context.manifest.data;

  if (manifest.private === true) {
    return [];
  }

  return Object.entries(readScripts(manifest))
    .filter(([name]) => installLifecycleScripts.has(name))
    .map(([name, command]) => {
      if (isSuspiciousInstallScript(command)) {
        return suspiciousInstallScriptFinding(name, command);
      }

      return installScriptFinding(name, command);
    });
}

function readScripts(manifest: PackageManifest): Record<string, string> {
  if (!isRecord(manifest.scripts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(manifest.scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function isSuspiciousInstallScript(command: string): boolean {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();

  return (
    hasNetworkToShellPipe(normalized) ||
    hasCredentialReference(normalized) ||
    hasDestructiveRootOrHomeCommand(normalized)
  );
}

function hasNetworkToShellPipe(command: string): boolean {
  return /\b(?:curl|wget)\b[^|;&]*(?:\|\s*(?:sh|bash|zsh|node|python|python3)\b)/i.test(command);
}

function hasCredentialReference(command: string): boolean {
  return /\$(?:\{)?(?:NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|SECRET|TOKEN)(?:\})?\b/i.test(command);
}

function hasDestructiveRootOrHomeCommand(command: string): boolean {
  return /\brm\s+(?:-[A-Za-z]*r[A-Za-z]*f|-f[A-Za-z]*r[A-Za-z]*)\s+(?:\/|~(?:\/|\s|$)|\$HOME(?:\/|\s|$))/i.test(command);
}

function installScriptFinding(name: string, command: string): Finding {
  return {
    id: "lifecycle.install-script",
    severity: "warning",
    title: "Install-time lifecycle script is present",
    message: `package.json scripts.${name} runs ${JSON.stringify(command)} during package installation.`,
    file: "package.json",
    path: `$.scripts.${name}`,
    suggestion: "Avoid install-time lifecycle scripts unless consumers need this package to run setup code during installation."
  };
}

function suspiciousInstallScriptFinding(name: string, command: string): Finding {
  return {
    id: "lifecycle.suspicious-install-script",
    severity: "error",
    title: "Install-time lifecycle script looks suspicious",
    message: `package.json scripts.${name} runs ${JSON.stringify(command)} during package installation.`,
    file: "package.json",
    path: `$.scripts.${name}`,
    suggestion: "Remove install-time network, credential, or destructive shell behavior before publishing."
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
