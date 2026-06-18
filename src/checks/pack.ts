import path from "node:path";

import type { Check } from "../core/checks.js";
import type { PackageManifest, ProjectContext } from "../core/context.js";
import type { Finding } from "../core/findings.js";

interface DeclaredTarget {
  source: "main" | "module" | "types" | "exports" | "bin";
  target: string;
  jsonPath: string;
}

export const packChecks: Check[] = [
  {
    id: "pack",
    run: runPackChecks
  }
];

function runPackChecks(context: ProjectContext): Finding[] {
  if (!context.pack) {
    return [];
  }

  const files = new Set(context.pack.files.map((file) => normalizePackPath(file.path)));

  return [
    ...checkSensitiveFiles(files),
    ...checkJunkFiles(files),
    ...checkRequiredFiles(context, files),
    ...checkDeclaredTargetsPacked(context, files)
  ];
}

function checkSensitiveFiles(files: Set<string>): Finding[] {
  const sensitiveFiles = [...files].filter((file) => isSensitiveFile(file));

  return sensitiveFiles.map((file) => ({
    id: "pack.sensitive-file-included",
    severity: "error" as const,
    title: "Sensitive file is included in the package",
    message: `${file} is included in npm pack output.`,
    suggestion: "Remove the file from the published package using files or .npmignore."
  }));
}

function checkJunkFiles(files: Set<string>): Finding[] {
  const junkFiles = [...files].filter((file) => isJunkFile(file));

  return junkFiles.map((file) => ({
    id: "pack.junk-file-included",
    severity: "warning" as const,
    title: "Non-runtime file is included in the package",
    message: `${file} is included in npm pack output.`,
    suggestion: "Exclude generated caches, coverage, snapshots, and local tooling output from the published package."
  }));
}

function checkRequiredFiles(context: ProjectContext, files: Set<string>): Finding[] {
  const findings: Finding[] = [];

  if (!hasReadme(files)) {
    findings.push({
      id: "pack.readme-missing",
      severity: "warning",
      title: "README is missing from the package",
      message: "npm pack output does not include a README file.",
      suggestion: "Include README.md so npm consumers can inspect package documentation."
    });
  }

  if (typeof context.manifest.data.license === "string" && !hasLicenseFile(files)) {
    findings.push({
      id: "pack.license-file-missing",
      severity: "warning",
      title: "License file is missing from the package",
      message: "package.json declares a license, but npm pack output does not include a license file.",
      suggestion: "Add a LICENSE file so consumers receive the license text."
    });
  }

  return findings;
}

function checkDeclaredTargetsPacked(context: ProjectContext, files: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const targets = collectDeclaredTargets(context.manifest.data, findings);

  for (const target of targets) {
    const normalizedTarget = normalizeManifestTarget(target.target);

    if (!normalizedTarget) {
      continue;
    }

    if (!files.has(normalizedTarget)) {
      findings.push({
        id: "pack.entrypoint-missing",
        severity: "error",
        title: "Declared entry point is missing from the package",
        message: `${target.source} target ${JSON.stringify(target.target)} is not included in npm pack output.`,
        file: "package.json",
        path: target.jsonPath,
        suggestion: "Update package files configuration or entrypoint metadata so the published package includes this file."
      });
    }
  }

  return findings;
}

function collectDeclaredTargets(manifest: PackageManifest, findings: Finding[]): DeclaredTarget[] {
  const targets: DeclaredTarget[] = [];

  collectTopLevelTarget(targets, findings, "main", manifest.main);
  collectTopLevelTarget(targets, findings, "module", manifest.module);
  collectTopLevelTarget(targets, findings, "types", manifest.types);
  collectTopLevelTarget(targets, findings, "types", manifest.typings, "$.typings");
  collectBinTargets(targets, findings, manifest.bin);
  collectExportTargets(targets, findings, manifest.exports);

  return targets;
}

function collectTopLevelTarget(
  targets: DeclaredTarget[],
  findings: Finding[],
  source: "main" | "module" | "types",
  value: unknown,
  jsonPath = `$.${source}`
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "string") {
    targets.push({ source, target: value, jsonPath });
    return;
  }

  findings.push(unsupportedTargetFinding(jsonPath));
}

function collectBinTargets(targets: DeclaredTarget[], findings: Finding[], value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "string") {
    targets.push({ source: "bin", target: value, jsonPath: "$.bin" });
    return;
  }

  if (isRecord(value)) {
    for (const [name, target] of Object.entries(value)) {
      if (typeof target === "string") {
        targets.push({ source: "bin", target, jsonPath: `$.bin.${formatJsonPathKey(name)}` });
      } else {
        findings.push(unsupportedTargetFinding(`$.bin.${formatJsonPathKey(name)}`));
      }
    }
    return;
  }

  findings.push(unsupportedTargetFinding("$.bin"));
}

function collectExportTargets(targets: DeclaredTarget[], findings: Finding[], value: unknown): void {
  if (value === undefined) {
    return;
  }

  collectExportValue(targets, findings, value, "$.exports");
}

function collectExportValue(targets: DeclaredTarget[], findings: Finding[], value: unknown, jsonPath: string): void {
  if (typeof value === "string") {
    if (!value.includes("*")) {
      targets.push({ source: "exports", target: value, jsonPath });
    }
    return;
  }

  if (isRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      collectExportValue(targets, findings, nestedValue, `${jsonPath}.${formatJsonPathKey(key)}`);
    }
    return;
  }

  findings.push(unsupportedTargetFinding(jsonPath));
}

function normalizeManifestTarget(target: string): string | null {
  if (target.trim() === "" || path.isAbsolute(target)) {
    return null;
  }

  const normalized = normalizePackPath(path.normalize(target));

  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }

  return normalized;
}

function normalizePackPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isSensitiveFile(file: string): boolean {
  const basename = path.posix.basename(file).toLowerCase();

  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename.endsWith(".pem") ||
    basename.endsWith(".key") ||
    basename === "npmrc" ||
    basename === ".npmrc"
  );
}

function isJunkFile(file: string): boolean {
  const normalized = file.toLowerCase();

  return (
    normalized.startsWith("coverage/") ||
    normalized.startsWith(".cache/") ||
    normalized.startsWith(".turbo/") ||
    normalized.startsWith(".next/") ||
    normalized.endsWith(".tsbuildinfo") ||
    normalized.includes("__snapshots__/")
  );
}

function hasReadme(files: Set<string>): boolean {
  return [...files].some((file) => /^readme(?:\..+)?$/i.test(path.posix.basename(file)));
}

function hasLicenseFile(files: Set<string>): boolean {
  return [...files].some((file) => /^(?:licen[cs]e|copying)(?:\..+)?$/i.test(path.posix.basename(file)));
}

function unsupportedTargetFinding(jsonPath: string): Finding {
  return {
    id: "pack.unsupported-target",
    severity: "warning",
    title: "Pack target shape is not supported",
    message: "This entrypoint shape could not be checked against npm pack output.",
    file: "package.json",
    path: jsonPath
  };
}

function formatJsonPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
