import { getBatchExitCode, runBatchChecks, type BatchCheckReport } from "../core/batch.js";
import { discoverProject } from "../core/discovery.js";
import { runChecks } from "../core/checks.js";
import { applyFixPlans, planFixes, renderFixPlanHuman, renderFixPlanJson } from "../core/fixes.js";
import { createReport, getExitCode, type Finding } from "../core/findings.js";
import { applyFindingPolicy } from "../core/policy.js";
import { initReleaseWorkflow, renderInitReleaseHuman, renderInitReleaseJson } from "../core/release.js";
import { discoverWorkspaces, selectWorkspaceTargets } from "../core/workspaces.js";
import { renderHumanReport } from "../reporters/human.js";
import { renderJsonReport } from "../reporters/json.js";
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
  if (hasWorkspaceOption(options)) {
    return await runWorkspaceCommand(options, io);
  }

  if (options.command === "init") {
    io.stderr.write("pkg-guard init is not implemented yet.\n");
    return 2;
  }

  if (options.format === "sarif") {
    io.stderr.write("SARIF output is not implemented yet.\n");
    return 2;
  }

  if (options.command === "fix") {
    return await runFixCommand(options, io);
  }

  if (options.command === "init-release") {
    return await runInitReleaseCommand(options, io);
  }

  const findings = await getCommandFindings(options);
  const report = createReport(options.command, options.cwd, findings);
  const output = options.format === "json" ? renderJsonReport(report) : renderHumanReport(report);

  io.stdout.write(output);
  return getExitCode(findings);
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
  if (options.command !== "check") {
    io.stderr.write("Workspace execution is only implemented for check in this phase.\n");
    return 2;
  }

  if (options.format === "json") {
    io.stderr.write("Workspace JSON output is not implemented yet.\n");
    return 2;
  }

  if (options.format === "sarif") {
    io.stderr.write("SARIF output is not implemented yet.\n");
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

  const report = await runBatchChecks({
    command: "check",
    cwd: options.cwd,
    root: discovery.root,
    targets: selection.targets,
    skipped: selection.skipped,
    findings: discovery.findings,
    ignore: options.ignore,
    strict: options.strict
  });

  io.stdout.write(renderWorkspaceCheckSummary(report));
  return getBatchExitCode(report);
}

function renderWorkspaceCheckSummary(report: BatchCheckReport): string {
  const lines = [
    `pkg-guard checked ${formatCount(report.summary.packages, "package")} and skipped ${formatCount(report.summary.skipped, "package")}`
  ];

  for (const packageReport of report.packages) {
    const findings = packageReport.report.findings;
    const label = packageReport.target.name
      ? `${packageReport.target.relativePath} (${packageReport.target.name})`
      : packageReport.target.relativePath;

    lines.push("", label);

    if (findings.length === 0) {
      lines.push("  no issues");
      continue;
    }

    for (const finding of findings) {
      lines.push(`  ${finding.severity} ${finding.id}: ${finding.message}`);
    }
  }

  lines.push("", `summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info`);

  return `${lines.join("\n")}\n`;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
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
