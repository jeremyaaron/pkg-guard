import { runChecks } from "./checks.js";
import { discoverProject } from "./discovery.js";
import { applyFixPlans, planFixes, type FixPlan } from "./fixes.js";
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

export interface BatchFixOptions {
  cwd: string;
  root: string;
  targets: WorkspaceRunTarget[];
  skipped: WorkspaceRunTarget[];
  findings: Finding[];
  ignore: string[];
  strict: boolean;
  dryRun: boolean;
}

export interface PackageFixReport {
  target: WorkspaceRunTarget;
  findings: Finding[];
  fixes: FixPlan[];
  changedFiles: string[];
}

export interface BatchFixReport {
  schemaVersion: 1;
  command: "fix";
  dryRun: boolean;
  cwd: string;
  root: string;
  summary: FindingSummary & {
    packages: number;
    skipped: number;
    fixes: number;
    changedFiles: number;
  };
  findings: Finding[];
  packages: PackageFixReport[];
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

export async function runBatchFixes(options: BatchFixOptions): Promise<BatchFixReport> {
  const packages: PackageFixReport[] = [];

  for (const target of options.targets) {
    packages.push(await runPackageFixes(target, options));
  }

  const packageFindings = packages.flatMap((packageReport) => packageReport.findings);
  const summary = summarizeFindings([...options.findings, ...packageFindings]);
  const fixes = packages.reduce((count, packageReport) => count + packageReport.fixes.length, 0);
  const changedFiles = packages.reduce((count, packageReport) => count + packageReport.changedFiles.length, 0);

  return {
    schemaVersion: 1,
    command: "fix",
    dryRun: options.dryRun,
    cwd: options.cwd,
    root: options.root,
    summary: {
      ...summary,
      packages: packages.length,
      skipped: options.skipped.length,
      fixes,
      changedFiles
    },
    findings: options.findings,
    packages,
    skipped: options.skipped
  };
}

export function getBatchFixExitCode(report: BatchFixReport): number {
  return getExitCode([...report.findings, ...report.packages.flatMap((packageReport) => packageReport.findings)]);
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

async function runPackageFixes(target: WorkspaceRunTarget, options: BatchFixOptions): Promise<PackageFixReport> {
  const discovery = await discoverProject(target.root);

  if (!discovery.context) {
    return {
      target,
      findings: discovery.findings,
      fixes: [],
      changedFiles: []
    };
  }

  const findings = applyFindingPolicy([...discovery.findings, ...runChecks(discovery.context)], discovery.context.config, {
    ignore: options.ignore,
    strict: options.strict
  });
  const fixes = await planFixes(discovery.context, findings);
  const result = options.dryRun ? { changedFiles: [] } : await applyFixPlans(discovery.context, fixes);

  return {
    target,
    findings,
    fixes,
    changedFiles: result.changedFiles
  };
}
