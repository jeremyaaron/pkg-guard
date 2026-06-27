import type { PackageManifest } from "./context.js";
import type { Finding } from "./findings.js";

export type PackageTargetSource = "main" | "module" | "types" | "typings" | "exports" | "bin";

export type PackageTarget =
  | {
      kind: "file";
      source: PackageTargetSource;
      target: string;
      jsonPath: string;
      conditions: string[];
    }
  | {
      kind: "pattern";
      source: "exports";
      targetPattern: string;
      jsonPath: string;
      conditions: string[];
    };

export interface PackageTargetCollection {
  targets: PackageTarget[];
  findings: Finding[];
}

export function collectPackageTargets(manifest: PackageManifest): PackageTargetCollection {
  const findings: Finding[] = [];
  const targets: PackageTarget[] = [];

  collectTopLevelTarget(targets, findings, "main", manifest.main);
  collectTopLevelTarget(targets, findings, "module", manifest.module);
  collectTopLevelTarget(targets, findings, "types", manifest.types);
  collectTopLevelTarget(targets, findings, "typings", manifest.typings, "$.typings");
  collectBinTargets(targets, findings, manifest.bin);
  collectExportTargets(targets, findings, manifest.exports);

  return { targets, findings };
}

function collectTopLevelTarget(
  targets: PackageTarget[],
  findings: Finding[],
  source: Exclude<PackageTargetSource, "exports" | "bin">,
  value: unknown,
  jsonPath = `$.${source}`
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "string") {
    targets.push({ kind: "file", source, target: value, jsonPath, conditions: [] });
    return;
  }

  findings.push(unsupportedTargetFinding(jsonPath));
}

function collectBinTargets(targets: PackageTarget[], findings: Finding[], value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "string") {
    targets.push({ kind: "file", source: "bin", target: value, jsonPath: "$.bin", conditions: [] });
    return;
  }

  if (isRecord(value)) {
    for (const [name, target] of Object.entries(value)) {
      const jsonPath = `$.bin.${formatJsonPathKey(name)}`;

      if (typeof target === "string") {
        targets.push({ kind: "file", source: "bin", target, jsonPath, conditions: [] });
      } else {
        findings.push(unsupportedTargetFinding(jsonPath));
      }
    }
    return;
  }

  findings.push(unsupportedTargetFinding("$.bin"));
}

function collectExportTargets(targets: PackageTarget[], findings: Finding[], value: unknown): void {
  if (value === undefined) {
    return;
  }

  collectExportValue(targets, findings, value, "$.exports", []);
}

function collectExportValue(
  targets: PackageTarget[],
  findings: Finding[],
  value: unknown,
  jsonPath: string,
  conditions: string[]
): void {
  if (typeof value === "string") {
    if (value.includes("*")) {
      if (isSimplePattern(value)) {
        targets.push({ kind: "pattern", source: "exports", targetPattern: value, jsonPath, conditions });
      } else {
        findings.push(unsupportedTargetFinding(jsonPath));
      }
    } else {
      targets.push({ kind: "file", source: "exports", target: value, jsonPath, conditions });
    }
    return;
  }

  if (isRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      collectExportValue(
        targets,
        findings,
        nestedValue,
        `${jsonPath}.${formatJsonPathKey(key)}`,
        isExportSubpathKey(key) ? conditions : [...conditions, key]
      );
    }
    return;
  }

  findings.push(unsupportedTargetFinding(jsonPath));
}

export function isSimpleTargetPattern(value: string): boolean {
  return value.split("*").length === 2;
}

function isSimplePattern(value: string): boolean {
  return isSimpleTargetPattern(value);
}

function isExportSubpathKey(key: string): boolean {
  return key === "." || key.startsWith("./");
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
