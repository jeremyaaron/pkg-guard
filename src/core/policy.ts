import type { Finding } from "./findings.js";
import type { PkgGuardConfig } from "./context.js";

export interface FindingPolicyOptions {
  ignore: string[];
  strict: boolean;
}

export function applyFindingPolicy(
  findings: Finding[],
  config: PkgGuardConfig,
  options: FindingPolicyOptions
): Finding[] {
  const ignoredIds = new Set([...config.ignore, ...options.ignore]);
  const strictIds = new Set(config.strict);

  return findings
    .filter((finding) => !ignoredIds.has(finding.id))
    .map((finding) => {
      if (options.strict && finding.severity === "warning" && strictIds.has(finding.id)) {
        return {
          ...finding,
          severity: "error" as const
        };
      }

      return finding;
    });
}
