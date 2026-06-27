import type { Check } from "../core/checks.js";
import type { PackageManifest, ProjectContext } from "../core/context.js";
import type { Finding } from "../core/findings.js";

const knownRuntimePackages = new Set(["yaml", "semver", "spdx-expression-parse", "commander", "cac", "clipanion"]);

export const dependencyChecks: Check[] = [
  {
    id: "dependencies",
    run: runDependencyChecks
  }
];

function runDependencyChecks(context: ProjectContext): Finding[] {
  const manifest = context.manifest.data;

  if (manifest.private === true) {
    return [];
  }

  return [
    ...checkWorkspaceRanges(context),
    ...checkKnownRuntimeDevDependencies(manifest),
    ...checkOptionalPeerMetadata(manifest),
    ...checkBroadLibraryRanges(manifest)
  ];
}

function checkWorkspaceRanges(context: ProjectContext): Finding[] {
  return dependencySections(context.manifest.data).flatMap(({ section, dependencies }) =>
    Object.entries(dependencies)
      .filter(([, range]) => range.startsWith("workspace:"))
      .flatMap(([name, range]) => evaluateWorkspaceRange(context, section, name, range))
  );
}

function evaluateWorkspaceRange(
  context: ProjectContext,
  section: DependencySectionName,
  name: string,
  range: string
): Finding[] {
  const base = { section, name, range };

  if (!context.workspace) {
    return [
      workspaceRangeFinding(base, {
        severity: "error",
        suggestion: "Replace workspace protocol ranges before publishing this package."
      })
    ];
  }

  if (context.workspace.packageManager.detected !== "pnpm") {
    return [
      workspaceRangeFinding(base, {
        severity: "error",
        messageSuffix: ` Root package manager is ${context.workspace.packageManager.detected}, so pkg-guard cannot prove this range will be rewritten.`,
        suggestion: "Replace workspace protocol ranges before publishing with this package manager."
      })
    ];
  }

  if (context.workspace.publishPath.kind === "npm") {
    return [
      workspaceRangeFinding(base, {
        severity: "error",
        messageSuffix: ` ${context.workspace.publishPath.reason}`,
        suggestion: "Use a pnpm publish path that rewrites workspace protocol ranges, or replace the range before npm publishing."
      })
    ];
  }

  if (context.workspace.publishPath.kind !== "pnpm") {
    return [
      workspaceRangeFinding(base, {
        severity: "error",
        messageSuffix: ` ${context.workspace.publishPath.reason}`,
        suggestion: "Replace workspace protocol ranges before publishing with this package manager."
      })
    ];
  }

  const target = context.workspace.packagesByName[name];

  if (!target) {
    return [
      workspaceRangeFinding(base, {
        severity: "error",
        messageSuffix: " No matching workspace package was found.",
        suggestion: "Add a matching workspace package or replace the workspace protocol range before publishing."
      })
    ];
  }

  if (target.private) {
    return [
      workspaceRangeFinding(base, {
        severity: section === "devDependencies" ? "warning" : "error",
        messageSuffix: ` It resolves to private workspace package ${target.relativePath}.`,
        suggestion:
          "Do not publish a public package that depends on a private workspace package unless the dependency is removed from published metadata."
      })
    ];
  }

  return [];
}

interface WorkspaceRangeFindingInput {
  section: DependencySectionName;
  name: string;
  range: string;
}

function workspaceRangeFinding(
  input: WorkspaceRangeFindingInput,
  options: {
    severity: Finding["severity"];
    messageSuffix?: string;
    suggestion: string;
  }
): Finding {
  return {
    id: "dependencies.workspace-range",
    severity: options.severity,
    title: "Workspace dependency range would be published",
    message: `${input.section}.${input.name} uses ${JSON.stringify(input.range)}.${options.messageSuffix ?? ""}`,
    file: "package.json",
    path: `$.${input.section}.${formatJsonPathKey(input.name)}`,
    suggestion: options.suggestion
  };
}

function checkKnownRuntimeDevDependencies(manifest: PackageManifest): Finding[] {
  const devDependencies = readDependencyRecord(manifest.devDependencies);

  return Object.entries(devDependencies)
    .filter(([name]) => knownRuntimePackages.has(name) && !isDeclaredRuntimeDependency(manifest, name))
    .map(([name]) => ({
      id: "dependencies.runtime-in-dev",
      severity: "warning" as const,
      title: "Runtime package is declared only as a dev dependency",
      message: `${name} is a known runtime library but is only declared in devDependencies.`,
      file: "package.json",
      path: `$.devDependencies.${formatJsonPathKey(name)}`,
      suggestion: "Move runtime imports to dependencies if published code imports this package."
    }));
}

function checkOptionalPeerMetadata(manifest: PackageManifest): Finding[] {
  const peerDependencies = readDependencyRecord(manifest.peerDependencies);
  const optionalDependencies = readDependencyRecord(manifest.optionalDependencies);
  const peerDependenciesMeta = readPeerDependencyMeta(manifest.peerDependenciesMeta);

  return Object.keys(peerDependencies)
    .filter((name) => Object.hasOwn(optionalDependencies, name))
    .filter((name) => peerDependenciesMeta[name]?.optional !== true)
    .map((name) => ({
      id: "dependencies.optional-peer-metadata-missing",
      severity: "warning" as const,
      title: "Optional peer dependency metadata is missing",
      message: `${name} appears in both peerDependencies and optionalDependencies but is not marked optional in peerDependenciesMeta.`,
      file: "package.json",
      path: `$.peerDependencies.${formatJsonPathKey(name)}`,
      suggestion: `Add peerDependenciesMeta.${JSON.stringify(name)}.optional: true when this peer is optional.`
    }));
}

function checkBroadLibraryRanges(manifest: PackageManifest): Finding[] {
  if (!appearsToBeLibrary(manifest)) {
    return [];
  }

  return ["dependencies", "peerDependencies"].flatMap((section) => {
    const dependencies = readDependencyRecord(manifest[section]);

    return Object.entries(dependencies)
      .filter(([, range]) => isBroadRange(range))
      .map(([name, range]) => ({
        id: "dependencies.range-too-broad",
        severity: "warning" as const,
        title: "Dependency range is broad for a library",
        message: `${section}.${name} uses ${JSON.stringify(range)}.`,
        file: "package.json",
        path: `$.${section}.${formatJsonPathKey(name)}`,
        suggestion: "Use a narrower semver range for published libraries."
      }));
  });
}

type DependencySectionName = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";

function dependencySections(manifest: PackageManifest): Array<{
  section: DependencySectionName;
  dependencies: Record<string, string>;
}> {
  return [
    { section: "dependencies", dependencies: readDependencyRecord(manifest.dependencies) },
    { section: "devDependencies", dependencies: readDependencyRecord(manifest.devDependencies) },
    { section: "peerDependencies", dependencies: readDependencyRecord(manifest.peerDependencies) },
    { section: "optionalDependencies", dependencies: readDependencyRecord(manifest.optionalDependencies) }
  ];
}

function readDependencyRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function readPeerDependencyMeta(value: unknown): Record<string, { optional?: boolean }> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      .map(([name, meta]) => [name, { optional: meta.optional === true }])
  );
}

function isDeclaredRuntimeDependency(manifest: PackageManifest, name: string): boolean {
  return (
    Object.hasOwn(readDependencyRecord(manifest.dependencies), name) ||
    Object.hasOwn(readDependencyRecord(manifest.peerDependencies), name) ||
    Object.hasOwn(readDependencyRecord(manifest.optionalDependencies), name)
  );
}

function appearsToBeLibrary(manifest: PackageManifest): boolean {
  return manifest.main !== undefined || manifest.module !== undefined || manifest.exports !== undefined || manifest.types !== undefined;
}

function isBroadRange(range: string): boolean {
  const normalized = range.trim();

  return (
    normalized === "*" ||
    normalized === "latest" ||
    normalized === "x" ||
    normalized === "X" ||
    /^>=\s*\d/.test(normalized) ||
    /^\d+\.x$/i.test(normalized) ||
    /^\d+$/.test(normalized)
  );
}

function formatJsonPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
