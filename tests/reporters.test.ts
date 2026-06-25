import { describe, expect, it } from "vitest";

import type { BatchCheckReport } from "../src/core/batch.js";
import { createReport, getExitCode } from "../src/core/findings.js";
import { renderBatchHumanReport, renderBatchJsonReport } from "../src/reporters/batch.js";
import { renderHumanReport } from "../src/reporters/human.js";
import { renderJsonReport } from "../src/reporters/json.js";
import { renderBatchSarifReport, renderSarifReport } from "../src/reporters/sarif.js";

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

  it("renders SARIF output", () => {
    const report = createReport("check", "/repo", findings);
    const parsed = JSON.parse(renderSarifReport(report)) as {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; informationUri: string; rules: Array<{ id: string }> } };
        results: Array<{
          ruleId: string;
          level: string;
          locations?: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
          properties?: Record<string, unknown>;
        }>;
      }>;
    };

    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs[0]?.tool.driver).toMatchObject({
      name: "pkg-guard",
      informationUri: "https://github.com/jeremyaaron/pkg-guard"
    });
    expect(parsed.runs[0]?.tool.driver.rules.map((rule) => rule.id)).toEqual([
      "manifest.name-missing",
      "package.package-manager-missing",
      "project.package-manager-detected"
    ]);
    expect(parsed.runs[0]?.results[0]).toMatchObject({
      ruleId: "manifest.name-missing",
      level: "error",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "package.json"
            }
          }
        }
      ],
      properties: {
        jsonPath: "$.name",
        suggestion: "Add a valid package name.",
        fixable: true
      }
    });
    expect(parsed.runs[0]?.results[1]).toMatchObject({
      ruleId: "package.package-manager-missing",
      level: "warning"
    });
    expect(parsed.runs[0]?.results[2]).toMatchObject({
      ruleId: "project.package-manager-detected",
      level: "note"
    });
  });

  it("renders batch SARIF output with workspace package paths", () => {
    const report = createBatchReport();
    const parsed = JSON.parse(renderBatchSarifReport(report)) as {
      runs: Array<{
        results: Array<{
          ruleId: string;
          locations?: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
        }>;
      }>;
    };

    expect(parsed.runs[0]?.results).toEqual([
      expect.objectContaining({
        ruleId: "workspace.pattern-unsupported"
      }),
      expect.objectContaining({
        ruleId: "entrypoint.target-missing",
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: "packages/a/package.json"
              }
            }
          }
        ]
      })
    ]);
  });
});

function createBatchReport(): BatchCheckReport {
  const packageAFinding = {
    id: "entrypoint.target-missing",
    severity: "error" as const,
    title: "Entry point target does not exist",
    message: "main target does not exist.",
    file: "package.json",
    path: "$.main"
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
