import type { Finding } from "./findings.js";
import type { PkgGuardConfig } from "./context.js";

export interface ConfigLoadResult {
  config: PkgGuardConfig;
  findings: Finding[];
}

export function loadPkgGuardConfig(value: unknown): ConfigLoadResult {
  const config: PkgGuardConfig = {
    preset: null,
    ignore: [],
    strict: []
  };
  const findings: Finding[] = [];

  if (value === undefined) {
    return { config, findings };
  }

  if (!isRecord(value)) {
    return {
      config,
      findings: [invalidConfigFinding("pkgGuard must be an object.")]
    };
  }

  if (value.preset !== undefined) {
    if (typeof value.preset === "string" && value.preset.trim() !== "") {
      config.preset = value.preset;
    } else {
      findings.push(invalidConfigFinding("pkgGuard.preset must be a non-empty string."));
    }
  }

  const ignore = readStringArray(value.ignore, "pkgGuard.ignore");
  const strict = readStringArray(value.strict, "pkgGuard.strict");

  if (ignore.finding) {
    findings.push(ignore.finding);
  } else {
    config.ignore = ignore.value;
  }

  if (strict.finding) {
    findings.push(strict.finding);
  } else {
    config.strict = strict.value;
  }

  return { config, findings };
}

function readStringArray(
  value: unknown,
  path: string
): { value: string[]; finding?: Finding } {
  if (value === undefined) {
    return { value: [] };
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    return {
      value: [],
      finding: invalidConfigFinding(`${path} must be an array of non-empty strings.`)
    };
  }

  return {
    value: [...new Set(value.map((item) => item.trim()))]
  };
}

function invalidConfigFinding(message: string): Finding {
  return {
    id: "config.invalid",
    severity: "error",
    title: "pkg-guard configuration is invalid",
    message,
    file: "package.json",
    path: "$.pkgGuard"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
