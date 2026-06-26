import path from "node:path";

import type { Check } from "../core/checks.js";
import type { PackageManifest, ProjectContext } from "../core/context.js";
import type { Finding } from "../core/findings.js";

interface DeclaredRuntimeTarget {
  target: string;
  jsonPath: string;
}

export const typescriptChecks: Check[] = [
  {
    id: "typescript",
    run: runTypeScriptChecks
  }
];

function runTypeScriptChecks(context: ProjectContext): Finding[] {
  if (!context.tsconfig) {
    return [];
  }

  if (!isRecord(context.tsconfig.data)) {
    return [
      {
        id: "typescript.tsconfig-invalid",
        severity: "warning",
        title: "TypeScript config could not be parsed",
        message: "tsconfig.json exists but could not be parsed as a JSON object.",
        file: "tsconfig.json"
      }
    ];
  }

  const tsconfig = context.tsconfig.data;
  const compilerOptions = isRecord(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {};
  const findings: Finding[] = [];

  if (tsconfig.extends !== undefined) {
    findings.push({
      id: "typescript.extends-unresolved",
      severity: "warning",
      title: "TypeScript config extends another config",
      message: "pkg-guard only inspects direct tsconfig.json compilerOptions in this phase.",
      file: "tsconfig.json",
      path: "$.extends",
      suggestion: "Treat TypeScript findings as conservative until extended config resolution is supported."
    });
  }

  findings.push(...checkSourceTypes(context.manifest.data));

  if (!appearsToBeTypeScriptLibrary(context)) {
    return findings;
  }

  if (tsconfig.extends === undefined) {
    findings.push(...checkDeclarationOutput(compilerOptions));
  }

  findings.push(...checkDeclarationMap(compilerOptions));
  findings.push(...checkOutDirConsistency(context.manifest.data, compilerOptions));

  return findings;
}

function checkSourceTypes(manifest: PackageManifest): Finding[] {
  const typeTargets = [
    { value: manifest.types, path: "$.types" },
    { value: manifest.typings, path: "$.typings" }
  ];

  return typeTargets.flatMap(({ value, path: jsonPath }) => {
    if (typeof value !== "string" || !isTypeScriptSourceTarget(value)) {
      return [];
    }

    return [
      {
        id: "typescript.types-source-file",
        severity: "warning" as const,
        title: "Types field points to TypeScript source",
        message: `${jsonPath} points to ${JSON.stringify(value)} instead of generated declaration output.`,
        file: "package.json",
        path: jsonPath,
        suggestion: "Point types metadata at generated .d.ts files."
      }
    ];
  });
}

function isTypeScriptSourceTarget(value: string): boolean {
  return /\.(?:tsx|[cm]?ts)$/.test(value) && !/\.d\.[cm]?ts$/.test(value);
}

function checkDeclarationOutput(compilerOptions: Record<string, unknown>): Finding[] {
  if (compilerOptions.declaration === true || compilerOptions.emitDeclarationOnly === true) {
    return [];
  }

  return [
    {
      id: "typescript.declaration-missing",
      severity: "warning",
      title: "Declaration output is not enabled",
      message: "This package appears to publish a TypeScript library, but tsconfig.json does not enable declaration output.",
      file: "tsconfig.json",
      path: "$.compilerOptions.declaration",
      suggestion: "Enable compilerOptions.declaration or use a build config that emits .d.ts files."
    }
  ];
}

function checkDeclarationMap(compilerOptions: Record<string, unknown>): Finding[] {
  if (compilerOptions.declarationMap !== true) {
    return [];
  }

  return [
    {
      id: "typescript.declaration-map-enabled",
      severity: "warning",
      title: "Declaration maps are enabled",
      message: "Declaration maps can expose local source paths or source layout in published packages.",
      file: "tsconfig.json",
      path: "$.compilerOptions.declarationMap",
      suggestion: "Publish declaration maps only when consumers need source navigation into the package."
    }
  ];
}

function checkOutDirConsistency(manifest: PackageManifest, compilerOptions: Record<string, unknown>): Finding[] {
  if (typeof compilerOptions.outDir !== "string" || compilerOptions.outDir.trim() === "") {
    return [];
  }

  const outDir = normalizeTarget(compilerOptions.outDir);

  if (!outDir) {
    return [];
  }

  return collectRuntimeTargets(manifest).flatMap((target) => {
    const normalizedTarget = normalizeTarget(target.target);

    if (!normalizedTarget || normalizedTarget.startsWith(`${outDir}/`)) {
      return [];
    }

    return [
      {
        id: "typescript.outdir-mismatch",
        severity: "warning" as const,
        title: "Runtime entry point does not match TypeScript outDir",
        message: `${target.jsonPath} points to ${JSON.stringify(target.target)}, which is outside compilerOptions.outDir ${JSON.stringify(compilerOptions.outDir)}.`,
        file: "package.json",
        path: target.jsonPath,
        suggestion: "Point runtime entrypoints at generated JavaScript output."
      }
    ];
  });
}

function appearsToBeTypeScriptLibrary(context: ProjectContext): boolean {
  const manifest = context.manifest.data;

  if (manifest.private === true) {
    return false;
  }

  return context.preset.name === "typescript-library";
}

function collectRuntimeTargets(manifest: PackageManifest): DeclaredRuntimeTarget[] {
  const targets: DeclaredRuntimeTarget[] = [];

  collectStringTarget(targets, manifest.main, "$.main");
  collectStringTarget(targets, manifest.module, "$.module");
  collectExportTargets(targets, manifest.exports, "$.exports");

  return targets;
}

function collectStringTarget(targets: DeclaredRuntimeTarget[], value: unknown, jsonPath: string): void {
  if (typeof value === "string") {
    targets.push({ target: value, jsonPath });
  }
}

function collectExportTargets(targets: DeclaredRuntimeTarget[], value: unknown, jsonPath: string): void {
  if (typeof value === "string") {
    targets.push({ target: value, jsonPath });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "types") {
      continue;
    }

    collectExportTargets(targets, nestedValue, `${jsonPath}.${formatJsonPathKey(key)}`);
  }
}

function normalizeTarget(value: string): string | null {
  if (value.trim() === "" || path.isAbsolute(value)) {
    return null;
  }

  const normalized = path.normalize(value).replaceAll("\\", "/").replace(/^\.\//, "");

  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }

  return normalized.replace(/\/$/, "");
}

function formatJsonPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
