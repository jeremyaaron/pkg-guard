import { existsSync } from "node:fs";
import path from "node:path";

import spdxExpressionParse from "spdx-expression-parse";
import { valid as validSemver } from "semver";

import type { Check } from "../core/checks.js";
import type { PackageManifest, ProjectContext } from "../core/context.js";
import type { Finding } from "../core/findings.js";

export const manifestChecks: Check[] = [
  {
    id: "manifest",
    run: runManifestChecks
  }
];

function runManifestChecks(context: ProjectContext): Finding[] {
  const manifest = context.manifest.data;
  const findings: Finding[] = [];

  findings.push(...checkName(manifest));
  findings.push(...checkVersion(manifest));
  findings.push(...checkPackageManager(context));
  findings.push(...checkLicense(manifest));
  findings.push(...checkRepository(context));
  findings.push(...checkFiles(manifest));
  findings.push(...checkTypesMetadata(context));
  findings.push(...checkPublishAccess(manifest));
  findings.push(...checkEnginesNode(context));
  findings.push(...checkPrivatePublishable(manifest));

  return findings;
}

function checkName(manifest: PackageManifest): Finding[] {
  if (manifest.name === undefined) {
    return [
      {
        id: "manifest.name-missing",
        severity: "error",
        title: "Package name is missing",
        message: "package.json does not define a name.",
        file: "package.json",
        path: "$.name",
        suggestion: "Add a valid npm package name."
      }
    ];
  }

  if (typeof manifest.name !== "string" || !isValidPackageName(manifest.name)) {
    return [
      {
        id: "manifest.name-invalid",
        severity: "error",
        title: "Package name is invalid",
        message: "package.json name must be a valid npm package name.",
        file: "package.json",
        path: "$.name",
        suggestion: "Use a lowercase unscoped name such as pkg-guard, or a valid scoped package name."
      }
    ];
  }

  return [];
}

function checkVersion(manifest: PackageManifest): Finding[] {
  if (manifest.version === undefined) {
    return [
      {
        id: "manifest.version-missing",
        severity: "error",
        title: "Package version is missing",
        message: "package.json does not define a version.",
        file: "package.json",
        path: "$.version",
        suggestion: "Add a semver-valid version."
      }
    ];
  }

  if (typeof manifest.version !== "string" || !validSemver(manifest.version)) {
    return [
      {
        id: "manifest.version-invalid",
        severity: "error",
        title: "Package version is invalid",
        message: "package.json version must be a valid semantic version.",
        file: "package.json",
        path: "$.version",
        suggestion: "Use a version such as 0.1.0."
      }
    ];
  }

  return [];
}

function checkPackageManager(context: ProjectContext): Finding[] {
  if (!context.packageManager.packageManagerField) {
    return [
      {
        id: "manifest.package-manager-missing",
        severity: "warning",
        title: "Package manager is missing",
        message: "package.json does not define packageManager.",
        file: "package.json",
        path: "$.packageManager",
        suggestion: `Add packageManager, for example "${context.packageManager.detected}@<version>".`,
        fixable: true
      }
    ];
  }

  const lockfileManagers = new Set(context.packageManager.lockfiles.map((lockfile) => lockfile.name));

  if (lockfileManagers.size > 0 && !lockfileManagers.has(context.packageManager.detected)) {
    return [
      {
        id: "manifest.package-manager-conflict",
        severity: "warning",
        title: "Package manager conflicts with lockfile",
        message: `package.json declares ${context.packageManager.packageManagerField.raw}, but the lockfile belongs to ${[...lockfileManagers].sort().join(", ")}.`,
        file: "package.json",
        path: "$.packageManager"
      }
    ];
  }

  return [];
}

function checkLicense(manifest: PackageManifest): Finding[] {
  if (manifest.license === undefined) {
    return [
      {
        id: "manifest.license-missing",
        severity: "warning",
        title: "Package license is missing",
        message: "package.json does not define a license.",
        file: "package.json",
        path: "$.license",
        suggestion: "Add an SPDX license expression, or UNLICENSED for packages that should not be reused."
      }
    ];
  }

  if (typeof manifest.license !== "string" || !isValidSpdxExpression(manifest.license)) {
    return [
      {
        id: "manifest.license-invalid",
        severity: "warning",
        title: "Package license is invalid",
        message: "package.json license should be a valid SPDX expression.",
        file: "package.json",
        path: "$.license"
      }
    ];
  }

  return [];
}

function checkRepository(context: ProjectContext): Finding[] {
  if (!context.git?.remoteUrl || context.manifest.data.repository !== undefined) {
    return [];
  }

  return [
    {
      id: "manifest.repository-missing",
      severity: "warning",
      title: "Package repository is missing",
      message: "A Git remote is configured, but package.json does not define repository.",
      file: "package.json",
      path: "$.repository",
      suggestion: "Add repository metadata that points to this package's source repository.",
      fixable: true
    }
  ];
}

function checkFiles(manifest: PackageManifest): Finding[] {
  if (manifest.private === true || manifest.files !== undefined) {
    return [];
  }

  return [
    {
      id: "manifest.files-missing",
      severity: "warning",
      title: "Published files are not constrained",
      message: "package.json does not define files, so npm will use default packlist behavior.",
      file: "package.json",
      path: "$.files",
      suggestion: "Add a files array once build output is known.",
      fixable: true
    }
  ];
}

function checkTypesMetadata(context: ProjectContext): Finding[] {
  const manifest = context.manifest.data;

  if (
    manifest.private === true ||
    manifest.types !== undefined ||
    manifest.typings !== undefined ||
    !existsSync(path.join(context.root, "dist", "index.d.ts"))
  ) {
    return [];
  }

  return [
    {
      id: "manifest.types-missing",
      severity: "warning",
      title: "Types metadata is missing",
      message: "dist/index.d.ts exists, but package.json does not define types or typings.",
      file: "package.json",
      path: "$.types",
      suggestion: "Add top-level types metadata that points at ./dist/index.d.ts.",
      fixable: true
    }
  ];
}

function checkPrivatePublishable(manifest: PackageManifest): Finding[] {
  if (manifest.private !== true) {
    return [];
  }

  if (hasPublishMetadata(manifest)) {
    return [
      {
        id: "manifest.private-publishable",
        severity: "warning",
        title: "Package is private but has publish metadata",
        message: "package.json has private: true alongside fields that suggest this package is intended to be published.",
        file: "package.json",
        path: "$.private",
        suggestion: "Remove private: true before publishing, or remove publish-oriented metadata."
      }
    ];
  }

  return [];
}

function checkPublishAccess(manifest: PackageManifest): Finding[] {
  if (
    manifest.private === true ||
    typeof manifest.name !== "string" ||
    !manifest.name.startsWith("@") ||
    getPublishAccess(manifest.publishConfig)
  ) {
    return [];
  }

  return [
    {
      id: "manifest.publish-access-missing",
      severity: "warning",
      title: "Scoped package publish access is missing",
      message: "This scoped package does not define publishConfig.access.",
      file: "package.json",
      path: "$.publishConfig.access",
      suggestion: 'Add publishConfig.access: "public" for a scoped public package.',
      fixable: true
    }
  ];
}

function checkEnginesNode(context: ProjectContext): Finding[] {
  const manifest = context.manifest.data;
  const inferredRange = inferNodeEngineRange(context);

  if (manifest.private === true || !inferredRange || hasNodeEngine(manifest.engines)) {
    return [];
  }

  return [
    {
      id: "manifest.engines-node-missing",
      severity: "warning",
      title: "Node engine metadata is missing",
      message: `TypeScript target settings imply Node ${inferredRange}, but package.json does not define engines.node.`,
      file: "package.json",
      path: "$.engines.node",
      suggestion: `Add engines.node: "${inferredRange}" so consumers see the supported Node runtime.`,
      fixable: true
    }
  ];
}

function isValidPackageName(value: string): boolean {
  if (value.length === 0 || value.length > 214) {
    return false;
  }

  if (value === "." || value === ".." || value.startsWith(".") || value.startsWith("_")) {
    return false;
  }

  if (value !== value.toLowerCase() || value.includes(" ") || value.includes("\n") || value.includes("\t")) {
    return false;
  }

  return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(value);
}

function isValidSpdxExpression(value: string): boolean {
  if (value === "UNLICENSED") {
    return true;
  }

  try {
    spdxExpressionParse(value);
    return true;
  } catch {
    return false;
  }
}

function hasPublishMetadata(manifest: PackageManifest): boolean {
  return (
    manifest.files !== undefined ||
    manifest.repository !== undefined ||
    manifest.license !== undefined ||
    typeof manifest.name === "string" ||
    typeof manifest.version === "string"
  );
}

function getPublishAccess(value: unknown): "public" | "restricted" | null {
  if (!isRecord(value)) {
    return null;
  }

  return value.access === "public" || value.access === "restricted" ? value.access : null;
}

function hasNodeEngine(value: unknown): boolean {
  return isRecord(value) && typeof value.node === "string" && value.node.trim() !== "";
}

function inferNodeEngineRange(context: ProjectContext): string | null {
  const tsconfig = context.tsconfig?.data;

  if (!isRecord(tsconfig) || !isRecord(tsconfig.compilerOptions)) {
    return null;
  }

  const target = tsconfig.compilerOptions.target;

  if (typeof target !== "string") {
    return null;
  }

  return nodeRangeForTsTarget(target);
}

function nodeRangeForTsTarget(target: string): string | null {
  const normalized = target.toLowerCase();

  if (normalized === "es2022" || normalized === "esnext") {
    return ">=18.0.0";
  }

  if (normalized === "es2021") {
    return ">=16.0.0";
  }

  if (normalized === "es2020") {
    return ">=14.0.0";
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
