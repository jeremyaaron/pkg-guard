import type { BatchCheckReport, PackageCheckReport } from "../core/batch.js";
import type { Finding, Severity } from "../core/findings.js";

const severityOrder: Severity[] = ["error", "warning", "info"];

export function renderBatchHumanReport(report: BatchCheckReport): string {
  const lines = [
    `pkg-guard checked ${formatCount(report.summary.packages, "package")} and skipped ${formatCount(report.summary.skipped, "package")}`
  ];

  if (report.findings.length > 0) {
    lines.push("", "workspace");
    lines.push(...formatFindings(report.findings));
  }

  for (const packageReport of report.packages) {
    lines.push("", formatPackageLabel(packageReport));

    if (packageReport.report.findings.length === 0) {
      lines.push("  no issues");
      continue;
    }

    lines.push(...formatFindings(packageReport.report.findings));
  }

  lines.push("", `summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info`);

  return `${lines.join("\n")}\n`;
}

export function renderBatchJsonReport(report: BatchCheckReport): string {
  return `${JSON.stringify(
    {
      schemaVersion: report.schemaVersion,
      command: report.command,
      cwd: report.cwd,
      root: report.root,
      summary: report.summary,
      findings: report.findings,
      packages: report.packages.map((packageReport) => ({
        name: packageReport.target.name,
        relativePath: packageReport.target.relativePath,
        private: packageReport.target.private,
        source: packageReport.target.source,
        report: packageReport.report
      })),
      skipped: report.skipped.map((target) => ({
        name: target.name,
        relativePath: target.relativePath,
        private: target.private,
        source: target.source
      }))
    },
    null,
    2
  )}\n`;
}

function formatPackageLabel(packageReport: PackageCheckReport): string {
  return packageReport.target.name
    ? `${packageReport.target.relativePath} (${packageReport.target.name})`
    : packageReport.target.relativePath;
}

function formatFindings(findings: readonly Finding[]): string[] {
  const lines: string[] = [];

  for (const severity of severityOrder) {
    for (const finding of findings.filter((item) => item.severity === severity)) {
      lines.push(`  ${finding.severity} ${finding.id}: ${finding.message}`);
    }
  }

  return lines;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
