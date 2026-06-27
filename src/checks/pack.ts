import path from "node:path";

import type { Check } from "../core/checks.js";
import type { ProjectContext } from "../core/context.js";
import type { Finding } from "../core/findings.js";
import { collectPackageTargets, isSimpleTargetPattern, type PackageTarget } from "../core/package-targets.js";

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
  const targetCollection = collectPackageTargets(context.manifest.data);
  const findings: Finding[] = [...targetCollection.findings];

  for (const target of targetCollection.targets) {
    if (target.kind === "pattern") {
      findings.push(...checkDeclaredPatternPacked(target, files));
      continue;
    }

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

function checkDeclaredPatternPacked(target: Extract<PackageTarget, { kind: "pattern" }>, files: Set<string>): Finding[] {
  const normalizedPattern = normalizeManifestPattern(target.targetPattern);

  if (!normalizedPattern) {
    return [];
  }

  if (matchesPackPattern(files, normalizedPattern)) {
    return [];
  }

  return [
    {
      id: "pack.entrypoint-missing",
      severity: "error",
      title: "Declared entry point pattern is missing from the package",
      message: `${target.source} target pattern ${JSON.stringify(target.targetPattern)} does not match any files in npm pack output.`,
      file: "package.json",
      path: target.jsonPath,
      suggestion: "Update package files configuration or entrypoint metadata so the published package includes these files."
    }
  ];
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

function normalizeManifestPattern(target: string): string | null {
  if (!isSimpleTargetPattern(target) || target.trim() === "" || path.isAbsolute(target)) {
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

function matchesPackPattern(files: Set<string>, normalizedPattern: string): boolean {
  const starIndex = normalizedPattern.indexOf("*");
  const prefix = normalizedPattern.slice(0, starIndex);
  const suffix = normalizedPattern.slice(starIndex + 1);

  return [...files].some((file) => file.startsWith(prefix) && file.endsWith(suffix));
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
