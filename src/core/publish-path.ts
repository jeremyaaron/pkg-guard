import { parse } from "yaml";

import type { PackageManagerInfo, WorkflowInfo, WorkspacePublishPath } from "./context.js";

export interface PublishPathInput {
  packageManager: PackageManagerInfo;
  rootWorkflows: WorkflowInfo[];
  packageWorkflows: WorkflowInfo[];
}

export function inferWorkspacePublishPath(input: PublishPathInput): WorkspacePublishPath {
  const workflows = [...input.rootWorkflows, ...input.packageWorkflows];
  const npmPublishWorkflow = workflows.find(hasNpmPublishCommand);

  if (npmPublishWorkflow) {
    return {
      kind: "npm",
      reason: `${relativeWorkflowPath(npmPublishWorkflow)} contains npm publish or npx semantic-release.`
    };
  }

  if (input.packageManager.detected !== "pnpm") {
    return {
      kind: "unknown",
      reason: `Root package manager is ${input.packageManager.detected}, not pnpm.`
    };
  }

  const unreadableWorkflow = workflows.find((workflow) => collectWorkflowRunCommands(workflow) === null);

  if (unreadableWorkflow) {
    return {
      kind: "unknown",
      reason: `${relativeWorkflowPath(unreadableWorkflow)} could not be parsed for publish commands.`
    };
  }

  return {
    kind: "pnpm",
    reason: "Root package manager is pnpm and no npm publish workflow was detected."
  };
}

function hasNpmPublishCommand(workflow: WorkflowInfo): boolean {
  const commands = collectWorkflowRunCommands(workflow);
  return commands?.some(isNpmPublishCommand) ?? false;
}

function collectWorkflowRunCommands(workflow: WorkflowInfo): string[] | null {
  let data: unknown;

  try {
    data = parse(workflow.raw);
  } catch {
    return null;
  }

  if (!isRecord(data)) {
    return [];
  }

  const jobs = data.jobs;

  if (!isRecord(jobs)) {
    return [];
  }

  const commands: string[] = [];

  for (const job of Object.values(jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      continue;
    }

    for (const step of job.steps) {
      if (isRecord(step) && typeof step.run === "string") {
        commands.push(step.run);
      }
    }
  }

  return commands;
}

function isNpmPublishCommand(command: string): boolean {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
  return /\bnpm\s+publish\b/.test(normalized) || /\bnpx\s+semantic-release\b/.test(normalized);
}

function relativeWorkflowPath(workflow: WorkflowInfo): string {
  const marker = "/.github/workflows/";
  const normalized = workflow.path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf(marker);

  if (index === -1) {
    return normalized;
  }

  return `.github/workflows/${normalized.slice(index + marker.length)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
