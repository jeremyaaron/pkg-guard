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
    return await runWorkspaceSelectionStub(options, io);
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

async function runWorkspaceSelectionStub(options: ParsedOptions, io: CliIO): Promise<number> {
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

  io.stderr.write(
    `Workspace target selection matched ${selection.targets.length} package(s) and skipped ${selection.skipped.length} package(s); batch execution is not implemented yet.\n`
  );
  return 2;
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
