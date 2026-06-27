import { createWorkspaceCheckContext, getBatchExitCode, getBatchFixExitCode, runBatchChecks, runBatchFixes } from "../core/batch.js";
import type { ProjectContext } from "../core/context.js";
import { discoverProject } from "../core/discovery.js";
import { runChecks } from "../core/checks.js";
import { applyFixPlans, planFixes, renderFixPlanHuman, renderFixPlanJson } from "../core/fixes.js";
import { createReport, getExitCode, type Finding } from "../core/findings.js";
import { applyInitPlans, planInit, renderInitHuman, renderInitJson, type InitPlan } from "../core/init.js";
import { applyFindingPolicy } from "../core/policy.js";
import { initReleaseWorkflow, renderInitReleaseHuman, renderInitReleaseJson } from "../core/release.js";
import { discoverWorkspaces, selectWorkspaceTargets } from "../core/workspaces.js";
import { renderBatchFixHumanReport, renderBatchFixJsonReport, renderBatchHumanReport, renderBatchJsonReport } from "../reporters/batch.js";
import { renderHumanReport } from "../reporters/human.js";
import { renderJsonReport } from "../reporters/json.js";
import { renderBatchSarifReport, renderSarifReport } from "../reporters/sarif.js";
import { getCommandHelpText, getHelpText } from "./help.js";
import { parseArgs, type ParsedOptions } from "./options.js";

export interface CliIO {
  cwd: string;
  stdout: {
    write(value: string): void;
  };
  stderr: {
    write(value: string): void;
  };
}

export async function runCli(args: string[], io: CliIO): Promise<number> {
  try {
    const parsed = parseArgs(args, io.cwd);

    if (!parsed.ok) {
      if (parsed.message) {
        io.stderr.write(`${parsed.message}\n\n`);
        io.stderr.write(parsed.help === "global" ? getHelpText() : getCommandHelpText(parsed.help));
      } else {
        io.stdout.write(parsed.help === "global" ? getHelpText() : getCommandHelpText(parsed.help));
      }

      return parsed.message ? 2 : 0;
    }

    return await runCommand(parsed.options, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected internal failure";
    io.stderr.write(`pkg-guard failed: ${message}\n`);
    return 3;
  }
}

async function runCommand(options: ParsedOptions, io: CliIO): Promise<number> {
  if (options.command === "init") {
    return await runInitCommand(options, io);
  }

  if (hasWorkspaceOption(options)) {
    return await runWorkspaceCommand(options, io);
  }

  if (options.command === "fix") {
    return await runFixCommand(options, io);
  }

  if (options.command === "init-release") {
    return await runInitReleaseCommand(options, io);
  }

  const findings = await getCommandFindings(options);
  const report = createReport(options.command, options.cwd, findings);
  const output =
    options.format === "json" ? renderJsonReport(report) : options.format === "sarif" ? renderSarifReport(report) : renderHumanReport(report);

  io.stdout.write(output);
  return getExitCode(findings);
}

interface PackageInitReport {
  label: string;
  plans: InitPlan[];
  changedFiles: string[];
}

async function runInitCommand(options: ParsedOptions, io: CliIO): Promise<number> {
  if (hasWorkspaceOption(options)) {
    return await runWorkspaceInitCommand(options, io);
  }

  const discovery = await discoverProject(options.cwd);

  if (!discovery.context) {
    const report = createReport(options.command, options.cwd, discovery.findings);
    io.stdout.write(options.format === "json" ? renderJsonReport(report) : renderHumanReport(report));
    return getExitCode(discovery.findings);
  }

  const plans = planInit(discovery.context, { checkScript: "pkg-guard check" });
  const result = options.dryRun ? { changedFiles: [] } : await applyInitPlans(discovery.context, plans);
  const recommendation = shouldRecommendInitRelease(discovery.context)
    ? "\nNext: run pkg-guard init-release to create a trusted publishing workflow.\n"
    : "";

  io.stdout.write(
    options.format === "json"
      ? renderInitJson(plans, options.dryRun, result.changedFiles)
      : `${renderInitHuman(plans, options.dryRun, result.changedFiles)}${recommendation}`
  );
  return 0;
}

async function runWorkspaceInitCommand(options: ParsedOptions, io: CliIO): Promise<number> {
  if (options.workspaces && !options.dryRun) {
    const discovery = await discoverWorkspaces(options.cwd);
    const blockingFindings = discovery.findings.filter((finding) => finding.severity === "error");

    if (blockingFindings.length > 0) {
      for (const finding of blockingFindings) {
        io.stderr.write(`${finding.id}: ${finding.message}\n`);
      }

      return 2;
    }

    const rootDiscovery = await discoverProject(discovery.root);

    if (!rootDiscovery.context) {
      const report = createReport(options.command, discovery.root, rootDiscovery.findings);
      io.stdout.write(options.format === "json" ? renderJsonReport(report) : renderHumanReport(report));
      return getExitCode(rootDiscovery.findings);
    }

    const plans = planInit(rootDiscovery.context, { checkScript: "pkg-guard check --workspaces" });
    const result = await applyInitPlans(rootDiscovery.context, plans);
    const packageReports = [
      {
        label: ".",
        plans,
        changedFiles: result.changedFiles
      }
    ];

    io.stdout.write(renderWorkspaceInitReports(packageReports, options.dryRun, options.format === "json"));
    return 0;
  }

  const discovery = await discoverWorkspaces(options.cwd);
  const selection = selectWorkspaceTargets(discovery, {
    workspaces: options.workspaces,
    selectors: options.workspace,
    includePrivate: options.includePrivate,
    includeRoot: options.includeRoot
  });
  const blockingFindings = [...discovery.findings, ...selection.findings].filter((finding) => finding.severity === "error");

  if (blockingFindings.length > 0) {
    for (const finding of blockingFindings) {
      io.stderr.write(`${finding.id}: ${finding.message}\n`);
    }

    return 2;
  }

  const reports: PackageInitReport[] = [];

  if (options.workspaces) {
    const rootDiscovery = await discoverProject(discovery.root);

    if (rootDiscovery.context) {
      const plans = planInit(rootDiscovery.context, { checkScript: "pkg-guard check --workspaces" });
      reports.push({
        label: ".",
        plans,
        changedFiles: []
      });
    }
  } else {
    for (const target of selection.targets) {
      const packageDiscovery = await discoverProject(target.root);

      if (!packageDiscovery.context) {
        continue;
      }

      const plans = planInit(packageDiscovery.context, { checkScript: "pkg-guard check" });
      const result = options.dryRun ? { changedFiles: [] } : await applyInitPlans(packageDiscovery.context, plans);

      reports.push({
        label: formatWorkspaceLabel(target.relativePath, target.name),
        plans,
        changedFiles: result.changedFiles
      });
    }
  }

  io.stdout.write(renderWorkspaceInitReports(reports, options.dryRun, options.format === "json"));
  return 0;
}

function renderWorkspaceInitReports(reports: readonly PackageInitReport[], dryRun: boolean, json: boolean): string {
  if (json) {
    return `${JSON.stringify(
      {
        schemaVersion: 1,
        command: "init",
        dryRun,
        summary: {
          packages: reports.length,
          plans: reports.reduce((count, report) => count + report.plans.length, 0),
          changedFiles: reports.reduce((count, report) => count + report.changedFiles.length, 0)
        },
        packages: reports.map((report) => ({
          label: report.label,
          changedFiles: report.changedFiles,
          plans: report.plans
        }))
      },
      null,
      2
    )}\n`;
  }

  const planCount = reports.reduce((count, report) => count + report.plans.length, 0);

  if (planCount === 0) {
    return "pkg-guard found no workspace init changes\n";
  }

  const lines = [
    dryRun
      ? `pkg-guard planned ${formatCount(planCount, "init change")} across ${formatCount(reports.length, "package")}`
      : `pkg-guard applied ${formatCount(planCount, "init change")} across ${formatCount(reports.length, "package")}`
  ];

  for (const report of reports.filter((item) => item.plans.length > 0 || item.changedFiles.length > 0)) {
    lines.push("", report.label);

    for (const plan of report.plans) {
      lines.push(`${dryRun ? "  plan" : "  init"} ${plan.id}`);
      lines.push(`    ${plan.description}`);

      for (const operation of plan.operations) {
        lines.push(`    ${operation.path} = ${JSON.stringify(operation.value)}`);
      }
    }

    for (const changedFile of report.changedFiles) {
      lines.push(`  changed ${changedFile}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function shouldRecommendInitRelease(context: ProjectContext): boolean {
  return context.workflows.length === 0;
}

function formatWorkspaceLabel(relativePath: string, name: string | null): string {
  return name ? `${relativePath} (${name})` : relativePath;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

async function runInitReleaseCommand(options: ParsedOptions, io: CliIO): Promise<number> {
  const discovery = await discoverProject(options.cwd);

  if (!discovery.context) {
    const report = createReport(options.command, options.cwd, discovery.findings);
    io.stdout.write(options.format === "json" ? renderJsonReport(report) : renderHumanReport(report));
    return getExitCode(discovery.findings);
  }

  const result = await initReleaseWorkflow(discovery.context);

  io.stdout.write(options.format === "json" ? renderInitReleaseJson(result) : renderInitReleaseHuman(result));

  return result.created ? 0 : 1;
}

async function runFixCommand(options: ParsedOptions, io: CliIO): Promise<number> {
  const discovery = await discoverProject(options.cwd);

  if (!discovery.context) {
    const report = createReport(options.command, options.cwd, discovery.findings);
    io.stdout.write(options.format === "json" ? renderJsonReport(report) : renderHumanReport(report));
    return getExitCode(discovery.findings);
  }

  const findings = applyFindingPolicy([...discovery.findings, ...runChecks(discovery.context)], discovery.context.config, {
    ignore: options.ignore,
    strict: options.strict
  });
  const plans = await planFixes(discovery.context, findings);

  if (plans.length === 0) {
    io.stdout.write(options.format === "json" ? renderFixPlanJson(plans, options.dryRun) : renderFixPlanHuman(plans, options.dryRun));
    return getExitCode(findings);
  }

  if (options.dryRun) {
    io.stdout.write(options.format === "json" ? renderFixPlanJson(plans, true) : renderFixPlanHuman(plans, true));
    return getExitCode(findings);
  }

  const result = await applyFixPlans(discovery.context, plans);

  io.stdout.write(options.format === "json" ? renderFixPlanJson(plans, false, result.changedFiles) : renderFixPlanHuman(plans, false));

  return getExitCode(findings);
}

async function runWorkspaceCommand(options: ParsedOptions, io: CliIO): Promise<number> {
  if (options.command !== "check" && options.command !== "fix") {
    io.stderr.write("Workspace execution is only implemented for check and fix in this phase.\n");
    return 2;
  }

  if (options.command === "fix" && options.workspaces && !options.dryRun) {
    io.stderr.write("fix --workspaces requires --dry-run; use --workspace <selector> to apply fixes to selected packages.\n");
    return 2;
  }

  const discovery = await discoverWorkspaces(options.cwd);
  const selection = selectWorkspaceTargets(discovery, {
    workspaces: options.workspaces,
    selectors: options.workspace,
    includePrivate: options.includePrivate,
    includeRoot: options.includeRoot
  });
  const blockingFindings = [...discovery.findings, ...selection.findings].filter((finding) => finding.severity === "error");

  if (blockingFindings.length > 0) {
    for (const finding of blockingFindings) {
      io.stderr.write(`${finding.id}: ${finding.message}\n`);
    }

    return 2;
  }

  if (options.command === "fix") {
    const report = await runBatchFixes({
      cwd: options.cwd,
      root: discovery.root,
      targets: selection.targets,
      skipped: selection.skipped,
      findings: discovery.findings,
      ignore: options.ignore,
      strict: options.strict,
      dryRun: options.dryRun
    });

    io.stdout.write(options.format === "json" ? renderBatchFixJsonReport(report) : renderBatchFixHumanReport(report));
    return getBatchFixExitCode(report);
  }

  const workspaceContext = createWorkspaceCheckContext(discovery);
  const report = await runBatchChecks({
    command: "check",
    cwd: options.cwd,
    root: discovery.root,
    targets: selection.targets,
    skipped: selection.skipped,
    findings: discovery.findings,
    ignore: options.ignore,
    strict: options.strict,
    ...(workspaceContext ? { workspaceContext } : {})
  });

  io.stdout.write(
    options.format === "json"
      ? renderBatchJsonReport(report)
      : options.format === "sarif"
        ? renderBatchSarifReport(report)
        : renderBatchHumanReport(report)
  );
  return getBatchExitCode(report);
}

function hasWorkspaceOption(options: ParsedOptions): boolean {
  return options.workspaces || options.workspace.length > 0 || options.includePrivate || options.includeRoot;
}

async function getCommandFindings(options: ParsedOptions): Promise<Finding[]> {
  const discovery = await discoverProject(options.cwd);

  if (!discovery.context) {
    return discovery.findings;
  }

  return applyFindingPolicy([...discovery.findings, ...runChecks(discovery.context)], discovery.context.config, {
    ignore: options.ignore,
    strict: options.strict
  });
}
