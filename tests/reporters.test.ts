import { describe, expect, it } from "vitest";

import type { BatchCheckReport } from "../src/core/batch.js";
import { createReport, getExitCode } from "../src/core/findings.js";
import { renderBatchHumanReport, renderBatchJsonReport } from "../src/reporters/batch.js";
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

  it("renders batch human output grouped by package", () => {
    const report = createBatchReport();
    const output = renderBatchHumanReport(report);

    expect(output).toContain("pkg-guard checked 2 packages and skipped 1 package");
    expect(output).toContain("workspace");
    expect(output).toContain("warning workspace.pattern-unsupported");
    expect(output).toContain("packages/a (@scope/a)");
    expect(output).toContain("error entrypoint.target-missing");
    expect(output).toContain("packages/b (pkg-b)");
    expect(output).toContain("no issues");
    expect(output).toContain("summary: 1 errors, 1 warnings, 0 info");
  });

  it("renders batch JSON output", () => {
    const report = createBatchReport();
    const parsed = JSON.parse(renderBatchJsonReport(report)) as {
      schemaVersion: number;
      summary: { packages: number; skipped: number; errors: number; warnings: number; info: number };
      findings: Array<{ id: string }>;
      packages: Array<{ name: string | null; relativePath: string; private: boolean; source: string; report: unknown }>;
      skipped: Array<{ name: string | null; relativePath: string; private: boolean; source: string }>;
    };

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.summary).toEqual({ packages: 2, skipped: 1, errors: 1, warnings: 1, info: 0 });
    expect(parsed.findings).toEqual([expect.objectContaining({ id: "workspace.pattern-unsupported" })]);
    expect(parsed.packages[0]).toMatchObject({
      name: "@scope/a",
      relativePath: "packages/a",
      private: false,
      source: "workspace"
    });
    expect(parsed.skipped[0]).toMatchObject({
      name: "private",
      relativePath: "packages/private",
      private: true,
      source: "workspace"
    });
  });
});

function createBatchReport(): BatchCheckReport {
  const packageAFinding = {
    id: "entrypoint.target-missing",
    severity: "error" as const,
    title: "Entry point target does not exist",
    message: "main target does not exist."
  };
  const workspaceFinding = {
    id: "workspace.pattern-unsupported",
    severity: "warning" as const,
    title: "Workspace pattern is not supported",
    message: "packages/**: Recursive ** workspace patterns are not supported yet."
  };

  return {
    schemaVersion: 1,
    command: "check",
    cwd: "/repo",
    root: "/repo",
    summary: {
      packages: 2,
      skipped: 1,
      errors: 1,
      warnings: 1,
      info: 0
    },
    findings: [workspaceFinding],
    packages: [
      {
        target: {
          root: "/repo/packages/a",
          relativePath: "packages/a",
          name: "@scope/a",
          private: false,
          manifestPath: "/repo/packages/a/package.json",
          source: "workspace"
        },
        report: createReport("check", "/repo/packages/a", [packageAFinding])
      },
      {
        target: {
          root: "/repo/packages/b",
          relativePath: "packages/b",
          name: "pkg-b",
          private: false,
          manifestPath: "/repo/packages/b/package.json",
          source: "workspace"
        },
        report: createReport("check", "/repo/packages/b", [])
      }
    ],
    skipped: [
      {
        root: "/repo/packages/private",
        relativePath: "packages/private",
        name: "private",
        private: true,
        manifestPath: "/repo/packages/private/package.json",
        source: "workspace"
      }
    ]
  };
}
