import path from "node:path";

import type { BatchCheckReport } from "../core/batch.js";
import type { Finding, Report, Severity } from "../core/findings.js";

type SarifLevel = "error" | "warning" | "note";

interface SarifRule {
  id: string;
  shortDescription: {
    text: string;
  };
}

interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: {
    text: string;
  };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
      };
    };
  }>;
  properties?: Record<string, unknown>;
}

export function renderSarifReport(report: Report): string {
  return renderSarif(findingsToSarifInputs(report.findings));
}

export function renderBatchSarifReport(report: BatchCheckReport): string {
  return renderSarif([
    ...findingsToSarifInputs(report.findings),
    ...report.packages.flatMap((packageReport) =>
      findingsToSarifInputs(packageReport.report.findings, packageReport.target.relativePath)
    )
  ]);
}

function renderSarif(inputs: Array<{ finding: Finding; uriPrefix?: string }>): string {
  const rules = collectRules(inputs.map((input) => input.finding));
  const results = inputs.map(({ finding, uriPrefix }) => findingToResult(finding, uriPrefix));

  return `${JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "pkg-guard",
              informationUri: "https://github.com/jeremyaaron/pkg-guard",
              rules
            }
          },
          results
        }
      ]
    },
    null,
    2
  )}\n`;
}

function findingsToSarifInputs(findings: readonly Finding[], uriPrefix?: string): Array<{ finding: Finding; uriPrefix?: string }> {
  return findings.map((finding) => ({
    finding,
    ...(uriPrefix ? { uriPrefix } : {})
  }));
}

function collectRules(findings: readonly Finding[]): SarifRule[] {
  const rules = new Map<string, SarifRule>();

  for (const finding of findings) {
    if (!rules.has(finding.id)) {
      rules.set(finding.id, {
        id: finding.id,
        shortDescription: {
          text: finding.title
        }
      });
    }
  }

  return [...rules.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function findingToResult(finding: Finding, uriPrefix: string | undefined): SarifResult {
  const result: SarifResult = {
    ruleId: finding.id,
    level: severityToSarifLevel(finding.severity),
    message: {
      text: finding.message
    }
  };
  const uri = finding.file ? formatArtifactUri(finding.file, uriPrefix) : null;
  const properties: Record<string, unknown> = {};

  if (uri) {
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: {
            uri
          }
        }
      }
    ];
  }

  if (finding.path) {
    properties.jsonPath = finding.path;
  }

  if (finding.suggestion) {
    properties.suggestion = finding.suggestion;
  }

  if (finding.fixable === true) {
    properties.fixable = true;
  }

  if (Object.keys(properties).length > 0) {
    result.properties = properties;
  }

  return result;
}

function severityToSarifLevel(severity: Severity): SarifLevel {
  if (severity === "error") {
    return "error";
  }

  if (severity === "warning") {
    return "warning";
  }

  return "note";
}

function formatArtifactUri(file: string, uriPrefix: string | undefined): string {
  const normalizedFile = toPosixPath(file).replace(/^\.\//, "");

  if (!uriPrefix || uriPrefix === ".") {
    return normalizedFile;
  }

  return path.posix.join(toPosixPath(uriPrefix), normalizedFile);
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/").replaceAll("\\", "/");
}
