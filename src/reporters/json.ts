import type { Report } from "../core/findings.js";

export function renderJsonReport(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
