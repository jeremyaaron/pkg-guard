import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { Check } from "../core/checks.js";
import type { ProjectContext } from "../core/context.js";
import type { Finding } from "../core/findings.js";

type EntrySource = "main" | "module" | "types" | "exports" | "bin";

type DeclaredEntryPoint =
  | {
      kind: "file";
      source: EntrySource;
      target: string;
      jsonPath: string;
      requiresShebang: boolean;
    }
  | {
      kind: "pattern";
      source: "exports";
      targetPattern: string;
      jsonPath: string;
    };

export const entrypointChecks: Check[] = [
  {
    id: "entrypoints",
    run: runEntrypointChecks
  }
];

function runEntrypointChecks(context: ProjectContext): Finding[] {
  const findings: Finding[] = [];
  const declared = collectDeclaredEntryPoints(context, findings);

  if (context.preset.name === "cli" && !hasUsableBinTarget(context.manifest.data.bin)) {
    findings.push(missingCliBinFinding());
  }

  for (const entrypoint of declared) {
    findings.push(...validateEntryPoint(context, entrypoint));
  }

  return findings;
}

function collectDeclaredEntryPoints(context: ProjectContext, findings: Finding[]): DeclaredEntryPoint[] {
  const manifest = context.manifest.data;
  const declared: DeclaredEntryPoint[] = [];

  collectTopLevelString(declared, findings, "main", manifest.main);
  collectTopLevelString(declared, findings, "module", manifest.module);
  collectTopLevelString(declared, findings, "types", manifest.types);
  collectTopLevelString(declared, findings, "types", manifest.typings, "$.typings");
  collectBinTargets(declared, findings, manifest.bin);
  collectExportTargets(declared, findings, manifest.exports);

  return declared;
}

function collectTopLevelString(
  declared: DeclaredEntryPoint[],
  findings: Finding[],
  source: Exclude<EntrySource, "exports" | "bin">,
  value: unknown,
  jsonPath = `$.${source}`
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || value.trim() === "") {
    findings.push(unsupportedTargetFinding(source, jsonPath, `${source} must be a non-empty string.`));
    return;
  }

  declared.push({
    kind: "file",
    source,
    target: value,
    jsonPath,
    requiresShebang: false
  });
}

function collectBinTargets(declared: DeclaredEntryPoint[], findings: Finding[], value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "string" && value.trim() !== "") {
    declared.push({
      kind: "file",
      source: "bin",
      target: value,
      jsonPath: "$.bin",
      requiresShebang: true
    });
    return;
  }

  if (isRecord(value)) {
    for (const [name, target] of Object.entries(value)) {
      const jsonPath = `$.bin.${formatJsonPathKey(name)}`;

      if (typeof target !== "string" || target.trim() === "") {
        findings.push(unsupportedTargetFinding("bin", jsonPath, "bin targets must be non-empty strings."));
        continue;
      }

      declared.push({
        kind: "file",
        source: "bin",
        target,
        jsonPath,
        requiresShebang: true
      });
    }

    return;
  }

  findings.push(unsupportedTargetFinding("bin", "$.bin", "bin must be a string or an object of command targets."));
}

function hasUsableBinTarget(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim() !== "";
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).some((target) => typeof target === "string" && target.trim() !== "");
}

function missingCliBinFinding(): Finding {
  return {
    id: "entrypoint.target-missing",
    severity: "error",
    title: "CLI package is missing a bin entry point",
    message: "The cli preset requires package.json to define at least one bin target.",
    file: "package.json",
    path: "$.bin",
    suggestion: "Add a bin entry that points at the built CLI file."
  };
}

function collectExportTargets(declared: DeclaredEntryPoint[], findings: Finding[], value: unknown): void {
  if (value === undefined) {
    return;
  }

  collectExportValue(declared, findings, value, "$.exports");
}

function collectExportValue(
  declared: DeclaredEntryPoint[],
  findings: Finding[],
  value: unknown,
  jsonPath: string
): void {
  if (typeof value === "string") {
    if (value.includes("*")) {
      if (!isSimplePattern(value)) {
        findings.push(unsupportedTargetFinding("exports", jsonPath, "export target patterns must contain exactly one * to be validated."));
        return;
      }

      declared.push({
        kind: "pattern",
        source: "exports",
        targetPattern: value,
        jsonPath
      });
      return;
    }

    declared.push({
      kind: "file",
      source: "exports",
      target: value,
      jsonPath,
      requiresShebang: false
    });
    return;
  }

  if (isRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      collectExportValue(declared, findings, nestedValue, `${jsonPath}.${formatJsonPathKey(key)}`);
    }
    return;
  }

  findings.push(unsupportedTargetFinding("exports", jsonPath, "exports entries must resolve to strings or condition objects."));
}

function validateEntryPoint(context: ProjectContext, entrypoint: DeclaredEntryPoint): Finding[] {
  if (entrypoint.kind === "pattern") {
    return validateEntryPointPattern(context, entrypoint);
  }

  const findings: Finding[] = [];
  const normalizedTarget = normalizePackageTarget(entrypoint.target);

  if (!normalizedTarget) {
    return [
      {
        id: "entrypoint.target-escapes-package",
        severity: "error",
        title: "Entry point target escapes the package",
        message: `${entrypoint.source} target ${JSON.stringify(entrypoint.target)} is absolute or escapes the package root.`,
        file: "package.json",
        path: entrypoint.jsonPath
      }
    ];
  }

  const absoluteTarget = path.resolve(context.root, normalizedTarget);

  if (!isInsidePackage(context.root, absoluteTarget)) {
    return [
      {
        id: "entrypoint.target-escapes-package",
        severity: "error",
        title: "Entry point target escapes the package",
        message: `${entrypoint.source} target ${JSON.stringify(entrypoint.target)} resolves outside the package root.`,
        file: "package.json",
        path: entrypoint.jsonPath
      }
    ];
  }

  if (!existsSync(absoluteTarget)) {
    findings.push({
      id: "entrypoint.target-missing",
      severity: "error",
      title: "Entry point target does not exist",
      message: `${entrypoint.source} target ${JSON.stringify(entrypoint.target)} does not exist.`,
      file: "package.json",
      path: entrypoint.jsonPath,
      suggestion: "Run the package build or update package.json to point at an existing file."
    });
    return findings;
  }

  if (entrypoint.requiresShebang && !hasShebang(absoluteTarget)) {
    findings.push({
      id: "entrypoint.bin-shebang-missing",
      severity: "error",
      title: "Binary entry point is missing a shebang",
      message: `bin target ${JSON.stringify(entrypoint.target)} exists but does not start with #!.`,
      file: "package.json",
      path: entrypoint.jsonPath,
      suggestion: "Add a Node shebang such as #!/usr/bin/env node to the binary entry file."
    });
  }

  return findings;
}

function validateEntryPointPattern(
  context: ProjectContext,
  entrypoint: Extract<DeclaredEntryPoint, { kind: "pattern" }>
): Finding[] {
  const normalizedPattern = normalizePackagePattern(entrypoint.targetPattern);

  if (!normalizedPattern) {
    return [
      {
        id: "entrypoint.target-escapes-package",
        severity: "error",
        title: "Entry point target escapes the package",
        message: `exports target pattern ${JSON.stringify(entrypoint.targetPattern)} is absolute or escapes the package root.`,
        file: "package.json",
        path: entrypoint.jsonPath
      }
    ];
  }

  const prefix = normalizedPattern.slice(0, normalizedPattern.indexOf("*"));
  const absolutePrefix = path.resolve(context.root, prefix);

  if (!isInsidePackage(context.root, absolutePrefix)) {
    return [
      {
        id: "entrypoint.target-escapes-package",
        severity: "error",
        title: "Entry point target escapes the package",
        message: `exports target pattern ${JSON.stringify(entrypoint.targetPattern)} resolves outside the package root.`,
        file: "package.json",
        path: entrypoint.jsonPath
      }
    ];
  }

  if (!hasMatchingFile(context.root, normalizedPattern)) {
    return [
      {
        id: "entrypoint.target-missing",
        severity: "error",
        title: "Entry point pattern does not match files",
        message: `exports target pattern ${JSON.stringify(entrypoint.targetPattern)} does not match any files.`,
        file: "package.json",
        path: entrypoint.jsonPath,
        suggestion: "Run the package build or update package.json to point at existing exported files."
      }
    ];
  }

  return [];
}

function normalizePackageTarget(target: string): string | null {
  if (target.trim() === "" || path.isAbsolute(target)) {
    return null;
  }

  const normalized = path.normalize(target);

  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return null;
  }

  return normalized;
}

function normalizePackagePattern(target: string): string | null {
  if (!isSimplePattern(target) || target.trim() === "" || path.isAbsolute(target)) {
    return null;
  }

  const normalized = path.normalize(target);

  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return null;
  }

  return normalized;
}

function isSimplePattern(value: string): boolean {
  return value.split("*").length === 2;
}

function hasMatchingFile(root: string, normalizedPattern: string): boolean {
  const starIndex = normalizedPattern.indexOf("*");
  const prefix = normalizedPattern.slice(0, starIndex);
  const suffix = normalizedPattern.slice(starIndex + 1);
  const searchRoot = path.resolve(root, prefix);

  if (!isInsidePackage(root, searchRoot) || !isReadableDirectory(searchRoot)) {
    return false;
  }

  return collectFiles(searchRoot).some((filePath) => {
    const normalizedFile = path.relative(root, filePath);
    return normalizedFile.startsWith(prefix) && normalizedFile.endsWith(suffix);
  });
}

function collectFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function isReadableDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isInsidePackage(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasShebang(filePath: string): boolean {
  return readFileSync(filePath, "utf8").startsWith("#!");
}

function unsupportedTargetFinding(source: EntrySource, jsonPath: string, message: string): Finding {
  return {
    id: "entrypoint.unsupported-target",
    severity: "warning",
    title: "Entry point target is not supported",
    message,
    file: "package.json",
    path: jsonPath,
    suggestion: `Simplify the ${source} entry or suppress this finding until pkg-guard supports this shape.`
  };
}

function formatJsonPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
