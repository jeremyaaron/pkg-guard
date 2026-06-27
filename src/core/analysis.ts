import { runChecks } from "./checks.js";
import { runConsumerSmokeChecks } from "./consumer-smoke.js";
import type { ProjectContext } from "./context.js";
import { discoverProject } from "./discovery.js";
import type { Finding } from "./findings.js";
import { applyFindingPolicy } from "./policy.js";
import { inferWorkspacePublishPath } from "./publish-path.js";
import type { WorkspaceCheckContext } from "./batch.js";
import type { WorkspaceRunTarget } from "./workspaces.js";

export interface AnalyzeOptions {
  command: "check";
  cwd: string;
  ignore: string[];
  strict: boolean;
  consumerSmoke?: boolean;
}

export interface PackageAnalysis {
  cwd: string;
  root: string;
  context: ProjectContext | null;
  findings: Finding[];
}

export interface WorkspaceAnalyzeOptions extends AnalyzeOptions {
  target: WorkspaceRunTarget;
  workspaceContext?: WorkspaceCheckContext;
}

export interface WorkspacePackageAnalysis extends PackageAnalysis {
  target: WorkspaceRunTarget;
}

export async function analyzePackage(options: AnalyzeOptions): Promise<PackageAnalysis> {
  const discovery = await discoverProject(options.cwd);

  if (!discovery.context) {
    return {
      cwd: options.cwd,
      root: options.cwd,
      context: null,
      findings: discovery.findings
    };
  }

  return {
    cwd: options.cwd,
    root: discovery.context.root,
    context: discovery.context,
    findings: await analyzeContext(discovery.context, discovery.findings, options)
  };
}

export async function analyzeWorkspacePackage(options: WorkspaceAnalyzeOptions): Promise<WorkspacePackageAnalysis> {
  const discovery = await discoverProject(options.target.root);
  const context = discovery.context ? withWorkspaceContext(discovery.context, options.target, options.workspaceContext) : null;

  return {
    cwd: options.target.root,
    root: context?.root ?? options.target.root,
    context,
    target: options.target,
    findings: context ? await analyzeContext(context, discovery.findings, options) : discovery.findings
  };
}

async function analyzeContext(
  context: ProjectContext,
  discoveryFindings: Finding[],
  options: AnalyzeOptions
): Promise<Finding[]> {
  const smokeFindings = options.consumerSmoke ? await runConsumerSmokeChecks(context) : [];

  return applyFindingPolicy([...discoveryFindings, ...runChecks(context), ...smokeFindings], context.config, {
    ignore: options.ignore,
    strict: options.strict
  });
}

function withWorkspaceContext(
  context: ProjectContext,
  target: WorkspaceRunTarget,
  workspaceContext: WorkspaceCheckContext | undefined
): ProjectContext {
  if (!workspaceContext) {
    return context;
  }

  return {
    ...context,
    workspace: {
      root: workspaceContext.root,
      packageRoot: target.root,
      packageRelativePath: target.relativePath,
      packageName: target.name,
      packageManager: workspaceContext.packageManager,
      packagesByName: Object.fromEntries(workspaceContext.packagesByName),
      publishPath: inferWorkspacePublishPath({
        packageManager: workspaceContext.packageManager,
        rootWorkflows: workspaceContext.rootWorkflows,
        packageWorkflows: context.workflows
      }),
      rootWorkflows: workspaceContext.rootWorkflows
    }
  };
}
