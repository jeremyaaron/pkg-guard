import { describe, expect, it } from "vitest";

import { createReport, getExitCode } from "../src/core/findings.js";
import { renderHumanReport } from "../src/reporters/human.js";
import { renderJsonReport } from "../src/reporters/json.js";

describe("reporters", () => {
  const findings = [
    {
      id: "manifest.name-missing",
      severity: "error" as const,
      title: "Package name is missing",
      message: "package.json does not define a name.",
      file: "package.json",
      path: "$.name",
      suggestion: "Add a valid package name.",
      fixable: true
    },
    {
      id: "package.package-manager-missing",
      severity: "warning" as const,
      title: "Package manager is missing",
      message: "package.json does not define packageManager."
    },
    {
      id: "project.package-manager-detected",
      severity: "info" as const,
      title: "Detected npm",
      message: "npm was detected from package-lock.json."
    }
  ];

  it("summarizes findings and exit code", () => {
    const report = createReport("check", "/repo", findings);

    expect(report.summary).toEqual({ errors: 1, warnings: 1, info: 1 });
    expect(getExitCode(findings)).toBe(1);
  });

  it("renders human output grouped by severity", () => {
    const report = createReport("check", "/repo", findings);
    const output = renderHumanReport(report);

    expect(output).toContain("pkg-guard found 3 issues");
    expect(output.indexOf("error manifest.name-missing")).toBeLessThan(
      output.indexOf("warning package.package-manager-missing")
    );
    expect(output).toContain("Fixable with pkg-guard fix.");
  });

  it("renders JSON output", () => {
    const report = createReport("check", "/repo", findings);
    const parsed = JSON.parse(renderJsonReport(report)) as typeof report;

    expect(parsed).toEqual(report);
  });
});
