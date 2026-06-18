export type Severity = "error" | "warning" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  impact?: string;
  suggestion?: string;
  file?: string;
  path?: string;
  fixable?: boolean;
}

export interface FindingSummary {
  errors: number;
  warnings: number;
  info: number;
}

export interface Report {
  schemaVersion: 1;
  command: string;
  cwd: string;
  summary: FindingSummary;
  findings: Finding[];
}

export function summarizeFindings(findings: readonly Finding[]): FindingSummary {
  return findings.reduce<FindingSummary>(
    (summary, finding) => {
      if (finding.severity === "error") {
        summary.errors += 1;
      } else if (finding.severity === "warning") {
        summary.warnings += 1;
      } else {
        summary.info += 1;
      }

      return summary;
    },
    { errors: 0, warnings: 0, info: 0 }
  );
}

export function createReport(command: string, cwd: string, findings: Finding[]): Report {
  return {
    schemaVersion: 1,
    command,
    cwd,
    summary: summarizeFindings(findings),
    findings
  };
}

export function getExitCode(findings: readonly Finding[]): number {
  return findings.some((finding) => finding.severity === "error") ? 1 : 0;
}
