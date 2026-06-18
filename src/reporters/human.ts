import type { Finding, Report, Severity } from "../core/findings.js";

const severityOrder: Severity[] = ["error", "warning", "info"];

export function renderHumanReport(report: Report): string {
  if (report.findings.length === 0) {
    return "pkg-guard found no issues\n";
  }

  const lines = [`pkg-guard found ${formatIssueCount(report.findings.length)}`, ""];

  for (const severity of severityOrder) {
    const findings = report.findings.filter((finding) => finding.severity === severity);

    for (const finding of findings) {
      lines.push(...formatFinding(finding), "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatIssueCount(count: number): string {
  return count === 1 ? "1 issue" : `${count} issues`;
}

function formatFinding(finding: Finding): string[] {
  const heading = `${finding.severity} ${finding.id}`;
  const location = formatLocation(finding);
  const lines = [location ? `${heading} ${location}` : heading, `  ${finding.title}`];

  if (finding.message) {
    lines.push("", `  ${finding.message}`);
  }

  if (finding.impact) {
    lines.push("", "  Impact:", `    ${finding.impact}`);
  }

  if (finding.suggestion) {
    lines.push("", "  Fix:", `    ${finding.suggestion}`);
  }

  if (finding.fixable === true) {
    lines.push("", "  Fixable with pkg-guard fix.");
  }

  return lines;
}

function formatLocation(finding: Finding): string {
  if (finding.file && finding.path) {
    return `(${finding.file} ${finding.path})`;
  }

  if (finding.file) {
    return `(${finding.file})`;
  }

  return "";
}
