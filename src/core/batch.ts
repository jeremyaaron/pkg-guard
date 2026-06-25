import { runChecks } from "./checks.js";
import { discoverProject } from "./discovery.js";
import { createReport, getExitCode, summarizeFindings, type Finding, type FindingSummary, type Report } from "./findings.js";
import { applyFindingPolicy } from "./policy.js";
import type { WorkspaceRunTarget } from "./workspaces.js";

export interface BatchCheckOptions {
  command: "check";
  cwd: string;
  root: string;
  targets: WorkspaceRunTarget[];
  skipped: WorkspaceRunTarget[];
  findings: Finding[];
  ignore: string[];
  strict: boolean;
}

export interface PackageCheckReport {
  target: WorkspaceRunTarget;
  report: Report;
}

export interface BatchCheckReport {
  schemaVersion: 1;
  command: "check";
  cwd: string;
  root: string;
  summary: FindingSummary & {
    packages: number;
    skipped: number;
  };
  findings: Finding[];
  packages: PackageCheckReport[];
  skipped: WorkspaceRunTarget[];
}

export async function runBatchChecks(options: BatchCheckOptions): Promise<BatchCheckReport> {
  const packages: PackageCheckReport[] = [];

  for (const target of options.targets) {
    packages.push(await runPackageChecks(target, options));
  }

  const packageFindings = packages.flatMap((packageReport) => packageReport.report.findings);
  const summary = summarizeFindings([...options.findings, ...packageFindings]);

  return {
    schemaVersion: 1,
    command: options.command,
    cwd: options.cwd,
    root: options.root,
    summary: {
      ...summary,
      packages: packages.length,
      skipped: options.skipped.length
    },
    findings: options.findings,
    packages,
    skipped: options.skipped
  };
}

export function getBatchExitCode(report: BatchCheckReport): number {
  return getExitCode([...report.findings, ...report.packages.flatMap((packageReport) => packageReport.report.findings)]);
}

async function runPackageChecks(target: WorkspaceRunTarget, options: BatchCheckOptions): Promise<PackageCheckReport> {
  const discovery = await discoverProject(target.root);
  const findings = discovery.context
    ? applyFindingPolicy([...discovery.findings, ...runChecks(discovery.context)], discovery.context.config, {
        ignore: options.ignore,
        strict: options.strict
      })
    : discovery.findings;

  return {
    target,
    report: createReport(options.command, target.root, findings)
  };
}
