import path from "node:path";
import { parse } from "yaml";

import type { Check } from "../core/checks.js";
import type { ProjectContext, WorkflowInfo } from "../core/context.js";
import type { Finding } from "../core/findings.js";

interface WorkflowAnalysis {
  workflow: WorkflowInfo;
  data: Record<string, unknown>;
  packageScripts: Record<string, string>;
  publishSteps: string[];
  scriptInvocations: string[];
  stepRuns: string[];
  validationCommands: string[];
}

const maxPackageScriptExpansions = 50;

export const workflowChecks: Check[] = [
  {
    id: "workflows",
    run: runWorkflowChecks
  }
];

function runWorkflowChecks(context: ProjectContext): Finding[] {
  const packageScripts = getPackageScripts(context.manifest.data.scripts);
  return context.workflows.flatMap((workflow) => analyzeWorkflow(workflow, packageScripts));
}

function analyzeWorkflow(workflow: WorkflowInfo, packageScripts: Record<string, string>): Finding[] {
  const parsed = parseWorkflow(workflow);

  if (!parsed.ok) {
    return [
      {
        id: "workflow.yaml-invalid",
        severity: "warning",
        title: "Workflow YAML could not be parsed",
        message: parsed.message,
        file: relativeWorkflowPath(workflow)
      }
    ];
  }

  const analysis = buildWorkflowAnalysis(workflow, parsed.data, packageScripts);

  if (analysis.publishSteps.length === 0) {
    return [];
  }

  return [
    ...checkLongLivedNpmToken(analysis),
    ...checkOidcPermission(analysis),
    ...checkRiskyTriggers(analysis),
    ...checkRequiredPublishSteps(analysis)
  ];
}

function parseWorkflow(workflow: WorkflowInfo): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const data = parse(workflow.raw) as unknown;

    if (!isRecord(data)) {
      return { ok: false, message: "Workflow YAML must parse to an object." };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Workflow YAML could not be parsed."
    };
  }
}

function buildWorkflowAnalysis(
  workflow: WorkflowInfo,
  data: Record<string, unknown>,
  packageScripts: Record<string, string>
): WorkflowAnalysis {
  const stepRuns = collectStepRuns(data);
  const scriptInvocations = stepRuns.flatMap(collectScriptInvocations);

  return {
    workflow,
    data,
    packageScripts,
    stepRuns,
    scriptInvocations,
    publishSteps: stepRuns.filter(isPublishCommand),
    validationCommands: expandPackageScripts(stepRuns, packageScripts, scriptInvocations)
  };
}

function checkLongLivedNpmToken(analysis: WorkflowAnalysis): Finding[] {
  if (!usesLongLivedNpmToken(analysis.workflow.raw)) {
    return [];
  }

  return [
    {
      id: "workflow.long-lived-npm-token",
      severity: "warning",
      title: "Publish workflow uses a long-lived npm token",
      message: "This workflow references NPM_TOKEN or NODE_AUTH_TOKEN while publishing to npm.",
      file: relativeWorkflowPath(analysis.workflow),
      suggestion: "Use npm trusted publishing with GitHub Actions OIDC instead of long-lived automation tokens."
    }
  ];
}

function checkOidcPermission(analysis: WorkflowAnalysis): Finding[] {
  if (hasIdTokenWrite(analysis.data)) {
    return [];
  }

  return [
    {
      id: "workflow.id-token-permission-missing",
      severity: "warning",
      title: "Publish workflow is missing OIDC token permission",
      message: "This npm publish workflow does not grant id-token: write.",
      file: relativeWorkflowPath(analysis.workflow),
      path: "$.permissions.id-token",
      suggestion: "Add id-token: write so npm trusted publishing can use GitHub Actions OIDC."
    }
  ];
}

function checkRiskyTriggers(analysis: WorkflowAnalysis): Finding[] {
  if (!publishesOnOrdinaryBranchPush(analysis.data)) {
    return [];
  }

  return [
    {
      id: "workflow.branch-push-publish",
      severity: "error",
      title: "Publish workflow can run on ordinary branch pushes",
      message: "This workflow publishes to npm from a push trigger that is not limited to tags.",
      file: relativeWorkflowPath(analysis.workflow),
      path: "$.on.push",
      suggestion: "Restrict npm publishing to version tags or another explicit release event."
    }
  ];
}

function checkRequiredPublishSteps(analysis: WorkflowAnalysis): Finding[] {
  const findings: Finding[] = [];

  if (!hasInstallStep(analysis.validationCommands)) {
    findings.push(missingStepFinding(analysis.workflow, "workflow.install-step-missing", "install dependencies", "Add an install step before publishing."));
  }

  if (!hasTestStep(analysis.validationCommands)) {
    findings.push(missingStepFinding(analysis.workflow, "workflow.test-step-missing", "run tests", "Run tests before publishing."));
  }

  if (!hasBuildStep(analysis.validationCommands)) {
    findings.push(missingStepFinding(analysis.workflow, "workflow.build-step-missing", "build the package", "Build the package before publishing."));
  }

  if (!hasPackageValidationStep(analysis.validationCommands)) {
    findings.push(
      missingStepFinding(
        analysis.workflow,
        "workflow.package-validation-missing",
        "validate package contents",
        "Run pkg-guard check or npm pack --dry-run before publishing."
      )
    );
  }

  return findings;
}

function missingStepFinding(workflow: WorkflowInfo, id: string, action: string, suggestion: string): Finding {
  return {
    id,
    severity: "warning",
    title: `Publish workflow does not ${action}`,
    message: `This npm publish workflow does not appear to ${action} before publishing.`,
    file: relativeWorkflowPath(workflow),
    suggestion
  };
}

function collectStepRuns(data: Record<string, unknown>): string[] {
  const jobs = data.jobs;

  if (!isRecord(jobs)) {
    return [];
  }

  const runs: string[] = [];

  for (const job of Object.values(jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      continue;
    }

    for (const step of job.steps) {
      if (isRecord(step) && typeof step.run === "string") {
        runs.push(step.run);
      }
    }
  }

  return runs;
}

function isPublishCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return /\bnpm\s+publish\b/.test(normalized) || /\bnpx\s+semantic-release\b/.test(normalized);
}

function usesLongLivedNpmToken(raw: string): boolean {
  return /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/.test(raw);
}

function hasIdTokenWrite(data: Record<string, unknown>): boolean {
  return hasPermission(data.permissions, "id-token") || hasJobPermission(data, "id-token");
}

function hasPermission(permissions: unknown, key: string): boolean {
  if (typeof permissions === "string") {
    return false;
  }

  if (!isRecord(permissions)) {
    return false;
  }

  const value = permissions[key];
  return typeof value === "string" && value.toLowerCase() === "write";
}

function hasJobPermission(data: Record<string, unknown>, key: string): boolean {
  if (!isRecord(data.jobs)) {
    return false;
  }

  return Object.values(data.jobs).some((job) => isRecord(job) && hasPermission(job.permissions, key));
}

function publishesOnOrdinaryBranchPush(data: Record<string, unknown>): boolean {
  const trigger = data.on;

  if (trigger === "push") {
    return true;
  }

  if (Array.isArray(trigger)) {
    return trigger.includes("push");
  }

  if (!isRecord(trigger) || !Object.hasOwn(trigger, "push")) {
    return false;
  }

  const push = trigger.push;

  if (push === null) {
    return true;
  }

  if (!isRecord(push)) {
    return true;
  }

  const tags = push.tags;
  const tagsIgnore = push["tags-ignore"];
  const branches = push.branches;
  const branchesIgnore = push["branches-ignore"];

  if (tags !== undefined && branches === undefined && branchesIgnore === undefined && tagsIgnore === undefined) {
    return false;
  }

  return true;
}

function hasInstallStep(commands: string[]): boolean {
  return commands.some((command) => {
    const normalized = normalizeCommand(command);
    return (
      /\bnpm\s+ci\b/.test(normalized) ||
      /\bnpm\s+install\b/.test(normalized) ||
      /\bpnpm\s+install\b/.test(normalized) ||
      /\byarn\s+install\b/.test(normalized) ||
      /\bbun\s+install\b/.test(normalized)
    );
  });
}

function hasTestStep(commands: string[]): boolean {
  return commands.some((command) => /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/.test(normalizeCommand(command)));
}

function hasBuildStep(commands: string[]): boolean {
  return commands.some((command) => /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/.test(normalizeCommand(command)));
}

function hasPackageValidationStep(commands: string[]): boolean {
  return commands.some((command) => {
    const normalized = normalizeCommand(command);
    return /\bpkg-guard\s+check\b/.test(normalized) || /\bnpm\s+pack\b.*(?:^|\s)--dry-run(?:\s|$)/.test(normalized);
  });
}

function normalizeCommand(command: string): string {
  return command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
}

function getPackageScripts(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function collectScriptInvocations(command: string): string[] {
  const normalized = normalizeCommand(command);
  const scriptNames: string[] = [];
  const explicitRunPattern = /\b(?:npm|pnpm|yarn|bun)\s+(?:run|run-script)\s+([^\s&|;()<>]+)/g;
  const directRunPattern = /\b(?:npm|pnpm|yarn)\s+([^\s&|;()<>]+)/g;

  for (const match of normalized.matchAll(explicitRunPattern)) {
    const scriptName = match[1];

    if (scriptName) {
      scriptNames.push(scriptName);
    }
  }

  for (const match of normalized.matchAll(directRunPattern)) {
    const scriptName = match[1];

    if (scriptName && scriptName !== "run" && scriptName !== "run-script") {
      scriptNames.push(scriptName);
    }
  }

  return scriptNames;
}

function expandPackageScripts(
  commands: string[],
  scripts: Record<string, string>,
  initialInvocations = commands.flatMap(collectScriptInvocations)
): string[] {
  const expanded = [...commands];
  const visited = new Set<string>();
  const queue = [...initialInvocations];
  let expansionCount = 0;

  while (queue.length > 0 && expansionCount < maxPackageScriptExpansions) {
    const scriptName = queue.shift();

    if (!scriptName || visited.has(scriptName)) {
      continue;
    }

    visited.add(scriptName);

    const scriptCommand = scripts[scriptName];

    if (!scriptCommand) {
      continue;
    }

    expanded.push(scriptCommand);
    expansionCount += 1;
    queue.push(...collectScriptInvocations(scriptCommand));
  }

  return expanded;
}

function relativeWorkflowPath(workflow: WorkflowInfo): string {
  const marker = `${path.sep}.github${path.sep}workflows${path.sep}`;
  const index = workflow.path.lastIndexOf(marker);

  if (index === -1) {
    return workflow.path;
  }

  return `.github/workflows/${workflow.path.slice(index + marker.length)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
