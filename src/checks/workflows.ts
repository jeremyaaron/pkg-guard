import path from "node:path";
import { lt as semverLt, parse as parseSemver, type SemVer } from "semver";
import { parse } from "yaml";

import type { Check } from "../core/checks.js";
import type { PackageManifest, ProjectContext, WorkflowInfo } from "../core/context.js";
import type { Finding } from "../core/findings.js";

interface WorkflowAnalysis {
  workflow: WorkflowInfo;
  data: Record<string, unknown>;
  manifest: PackageManifest;
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
  return context.workflows.flatMap((workflow) => analyzeWorkflow(workflow, context.manifest.data, packageScripts));
}

function analyzeWorkflow(workflow: WorkflowInfo, manifest: PackageManifest, packageScripts: Record<string, string>): Finding[] {
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

  const analysis = buildWorkflowAnalysis(workflow, parsed.data, manifest, packageScripts);

  if (analysis.publishSteps.length === 0) {
    return [];
  }

  return [
    ...checkLongLivedNpmToken(analysis),
    ...checkOidcPermission(analysis),
    ...checkRiskyTriggers(analysis),
    ...checkSelfHostedTrustedPublishing(analysis),
    ...checkTrustedPublishingRuntimeVersions(analysis),
    ...checkPublishAccess(analysis),
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
  manifest: PackageManifest,
  packageScripts: Record<string, string>
): WorkflowAnalysis {
  const stepRuns = collectStepRuns(data);
  const scriptInvocations = stepRuns.flatMap(collectScriptInvocations);

  return {
    workflow,
    data,
    manifest,
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

function checkSelfHostedTrustedPublishing(analysis: WorkflowAnalysis): Finding[] {
  if (!hasIdTokenWrite(analysis.data) || !usesSelfHostedRunnerForPublishJob(analysis.data, analysis.publishSteps)) {
    return [];
  }

  return [
    {
      id: "workflow.self-hosted-trusted-publishing",
      severity: "warning",
      title: "Trusted publishing workflow uses a self-hosted runner",
      message: "This npm publish workflow grants id-token: write and runs a publish job on a self-hosted runner.",
      file: relativeWorkflowPath(analysis.workflow),
      suggestion: "Use GitHub-hosted runners for npm trusted publishing; npm trusted publishing does not currently support self-hosted runners."
    }
  ];
}

function checkTrustedPublishingRuntimeVersions(analysis: WorkflowAnalysis): Finding[] {
  return [
    ...checkNodeVersionForTrustedPublishing(analysis),
    ...checkNpmVersionForTrustedPublishing(analysis)
  ];
}

function checkNodeVersionForTrustedPublishing(analysis: WorkflowAnalysis): Finding[] {
  const oldVersions = collectPublishJobSetupNodeVersions(analysis.data, analysis.publishSteps).filter(isOldTrustedPublishingNodeVersion);

  if (oldVersions.length === 0) {
    return [];
  }

  return [
    {
      id: "workflow.node-version-too-old",
      severity: "warning",
      title: "Publish workflow uses an old Node version for trusted publishing",
      message: `This npm publish workflow configures Node ${JSON.stringify(oldVersions[0])}, but npm trusted publishing requires Node 22.14.0 or higher.`,
      file: relativeWorkflowPath(analysis.workflow),
      suggestion: 'Use Node "24" or another Node version that satisfies npm trusted publishing requirements.'
    }
  ];
}

function checkNpmVersionForTrustedPublishing(analysis: WorkflowAnalysis): Finding[] {
  const oldVersions = analysis.stepRuns.flatMap(collectPinnedNpmCliVersions).filter(isOldTrustedPublishingNpmVersion);

  if (oldVersions.length === 0) {
    return [];
  }

  return [
    {
      id: "workflow.npm-version-too-old",
      severity: "warning",
      title: "Publish workflow uses an old npm CLI for trusted publishing",
      message: `This npm publish workflow pins npm ${JSON.stringify(oldVersions[0])}, but npm trusted publishing requires npm CLI 11.5.1 or later.`,
      file: relativeWorkflowPath(analysis.workflow),
      suggestion: "Install npm@^11.5.1 or a newer npm CLI before publishing."
    }
  ];
}

function checkPublishAccess(analysis: WorkflowAnalysis): Finding[] {
  const expectedAccess = getExpectedPublishAccess(analysis.manifest);

  if (!expectedAccess) {
    return [];
  }

  return analysis.publishSteps.flatMap((publishStep) => {
    if (!/\bnpm\s+publish\b/.test(normalizeCommand(publishStep))) {
      return [];
    }

    const actualAccess = getPublishAccess(publishStep);

    if (actualAccess === expectedAccess) {
      return [];
    }

    const id = actualAccess ? "workflow.publish-access-mismatch" : "workflow.publish-access-missing";

    return [
      {
        id,
        severity: "warning" as const,
        title: actualAccess ? "Publish workflow uses unexpected npm access" : "Publish workflow is missing npm access",
        message: actualAccess
          ? `This npm publish workflow uses --access ${actualAccess}, but package metadata expects ${expectedAccess}.`
          : `This npm publish workflow should use --access ${expectedAccess}.`,
        file: relativeWorkflowPath(analysis.workflow),
        suggestion: `Publish with npm publish --access ${expectedAccess}, or update package.json publishConfig.access if that is not intended.`
      }
    ];
  });
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

function usesSelfHostedRunnerForPublishJob(data: Record<string, unknown>, publishSteps: string[]): boolean {
  if (!isRecord(data.jobs)) {
    return false;
  }

  return Object.values(data.jobs).some((job) => {
    if (!isRecord(job) || !runsOnSelfHosted(job["runs-on"]) || !Array.isArray(job.steps)) {
      return false;
    }

    return job.steps.some((step) => isRecord(step) && typeof step.run === "string" && publishSteps.includes(step.run));
  });
}

function collectPublishJobSetupNodeVersions(data: Record<string, unknown>, publishSteps: string[]): string[] {
  if (!isRecord(data.jobs)) {
    return [];
  }

  return Object.values(data.jobs).flatMap((job) => {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      return [];
    }

    const hasPublishStep = job.steps.some((step) => isRecord(step) && typeof step.run === "string" && publishSteps.includes(step.run));

    if (!hasPublishStep) {
      return [];
    }

    return job.steps.flatMap((step) => {
      if (!isRecord(step) || typeof step.uses !== "string" || !/actions\/setup-node@/i.test(step.uses) || !isRecord(step.with)) {
        return [];
      }

      const version = step.with["node-version"];
      return typeof version === "string" ? [version] : [];
    });
  });
}

function isOldTrustedPublishingNodeVersion(value: string): boolean {
  const version = parseStaticVersion(value);

  if (!version) {
    return false;
  }

  if (version.major < 22) {
    return true;
  }

  return semverLt(version, "22.14.0");
}

function collectPinnedNpmCliVersions(command: string): string[] {
  const normalized = normalizeCommand(command);
  const versions: string[] = [];
  const patterns = [
    /\bnpm\s+(?:install|i)\s+(?:-[^\s]+\s+)*-g\s+npm@([^\s&|;()<>]+)/g,
    /\bnpm\s+(?:install|i)\s+(?:-[^\s]+\s+)*--global\s+npm@([^\s&|;()<>]+)/g,
    /\bnpm\s+exec\s+npm@([^\s&|;()<>]+)/g,
    /\bnpx\s+npm@([^\s&|;()<>]+)/g
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      if (match[1]) {
        versions.push(match[1]);
      }
    }
  }

  return versions;
}

function isOldTrustedPublishingNpmVersion(value: string): boolean {
  const version = parseStaticVersion(value);

  return version ? semverLt(version, "11.5.1") : false;
}

function parseStaticVersion(value: string): SemVer | null {
  const trimmed = value.trim().replace(/^v/, "");

  if (!/^\d+(?:\.\d+){0,2}$/.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split(".");
  const normalized = [parts[0], parts[1] ?? "999", parts[2] ?? "999"].join(".");

  return parseSemver(normalized);
}

function runsOnSelfHosted(value: unknown): boolean {
  if (typeof value === "string") {
    return value === "self-hosted";
  }

  return Array.isArray(value) && value.some((item) => item === "self-hosted");
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

function getExpectedPublishAccess(manifest: PackageManifest): "public" | "restricted" | null {
  const configuredAccess = getPublishConfigAccess(manifest.publishConfig);

  if (configuredAccess) {
    return configuredAccess;
  }

  return typeof manifest.name === "string" && manifest.name.startsWith("@") ? "public" : null;
}

function getPublishConfigAccess(value: unknown): "public" | "restricted" | null {
  if (!isRecord(value)) {
    return null;
  }

  return value.access === "public" || value.access === "restricted" ? value.access : null;
}

function getPublishAccess(command: string): "public" | "restricted" | null {
  const normalized = normalizeCommand(command);
  const match = /\bnpm\s+publish\b.*(?:^|\s)--access(?:=|\s+)(public|restricted)(?:\s|$)/.exec(normalized);
  const access = match?.[1];

  return access === "public" || access === "restricted" ? access : null;
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
