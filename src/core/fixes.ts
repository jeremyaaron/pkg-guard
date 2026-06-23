import { execFile } from "node:child_process";
import { access, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { PackageManifest, ProjectContext } from "./context.js";
import type { Finding } from "./findings.js";

const execFileAsync = promisify(execFile);

export interface FixPlan {
  id: string;
  findingId: string;
  description: string;
  operations: JsonSetOperation[];
}

export interface JsonSetOperation {
  kind: "json-set";
  file: "package.json";
  path: string;
  key: string;
  value: unknown;
}

export interface ApplyFixResult {
  changedFiles: string[];
}

export async function planFixes(context: ProjectContext, findings: readonly Finding[]): Promise<FixPlan[]> {
  const plans: FixPlan[] = [];
  const findingIds = new Set(findings.map((finding) => finding.id));

  if (findingIds.has("manifest.package-manager-missing")) {
    const packageManagerValue = await inferPackageManagerValue(context);

    if (packageManagerValue) {
      plans.push({
        id: "fix.package-manager",
        findingId: "manifest.package-manager-missing",
        description: `Add packageManager "${packageManagerValue}" to package.json.`,
        operations: [
          {
            kind: "json-set",
            file: "package.json",
            path: "$.packageManager",
            key: "packageManager",
            value: packageManagerValue
          }
        ]
      });
    }
  }

  const repositoryMetadata = inferGitHubRepositoryMetadata(context.git?.remoteUrl);

  if (repositoryMetadata) {
    const repositoryOperations = missingMetadataOperations(context.manifest.data, repositoryMetadata);

    if (repositoryOperations.length > 0) {
      plans.push({
        id: "fix.repository-metadata",
        findingId: findingIds.has("manifest.repository-missing")
          ? "manifest.repository-missing"
          : "manifest.metadata-missing",
        description: "Add missing repository, bugs, or homepage metadata from the GitHub remote.",
        operations: repositoryOperations
      });
    }
  }

  if (await canApplyTypesFix(context)) {
    const typesPlan = planTypesFix();
    plans.push(typesPlan);
  }

  const filesPlan = await planFilesFix(context, findingIds);

  if (filesPlan) {
    plans.push(filesPlan);
  }

  const publishAccessPlan = planPublishAccessFix(context, findingIds);

  if (publishAccessPlan) {
    plans.push(publishAccessPlan);
  }

  const enginesNodePlan = planEnginesNodeFix(context, findingIds);

  if (enginesNodePlan) {
    plans.push(enginesNodePlan);
  }

  const sideEffectsPlan = planSideEffectsFix(context, findingIds);

  if (sideEffectsPlan) {
    plans.push(sideEffectsPlan);
  }

  return plans.filter((plan) => plan.operations.length > 0);
}

export async function applyFixPlans(context: ProjectContext, plans: readonly FixPlan[]): Promise<ApplyFixResult> {
  const packageJsonOperations = plans.flatMap((plan) => plan.operations);

  if (packageJsonOperations.length === 0) {
    return { changedFiles: [] };
  }

  const updated = applyPackageJsonOperations(context.manifest.raw, packageJsonOperations);

  if (updated === context.manifest.raw) {
    return { changedFiles: [] };
  }

  await writeFile(context.manifest.path, updated, "utf8");

  return { changedFiles: ["package.json"] };
}

export function renderFixPlanHuman(plans: readonly FixPlan[], dryRun: boolean): string {
  if (plans.length === 0) {
    return "pkg-guard found no fixable issues\n";
  }

  const lines = [dryRun ? `pkg-guard planned ${formatFixCount(plans.length)}` : `pkg-guard applied ${formatFixCount(plans.length)}`, ""];

  for (const plan of plans) {
    lines.push(`${dryRun ? "plan" : "fix"} ${plan.id}`);
    lines.push(`  ${plan.description}`);

    for (const operation of plan.operations) {
      lines.push(`  ${operation.path} = ${JSON.stringify(operation.value)}`);
    }

    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderFixPlanJson(plans: readonly FixPlan[], dryRun: boolean, changedFiles: readonly string[] = []): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      command: "fix",
      dryRun,
      summary: {
        fixes: plans.length,
        changedFiles: changedFiles.length
      },
      changedFiles,
      fixes: plans
    },
    null,
    2
  )}\n`;
}

async function inferPackageManagerValue(context: ProjectContext): Promise<string | null> {
  const lockfileManagers = new Set(context.packageManager.lockfiles.map((lockfile) => lockfile.name));
  const [lockfile] = context.packageManager.lockfiles;

  if (!lockfile || lockfileManagers.size !== 1) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(lockfile.name, ["--version"], {
      cwd: context.root
    });
    const version = stdout.trim();

    return version ? `${lockfile.name}@${version}` : null;
  } catch {
    return null;
  }
}

function inferGitHubRepositoryMetadata(remoteUrl: string | null | undefined):
  | {
      repository: { type: "git"; url: string };
      bugs: { url: string };
      homepage: string;
    }
  | null {
  if (!remoteUrl) {
    return null;
  }

  const normalized = normalizeGitHubRemote(remoteUrl);

  if (!normalized) {
    return null;
  }

  const baseUrl = `https://github.com/${normalized.owner}/${normalized.repo}`;

  return {
    repository: {
      type: "git",
      url: `git+${baseUrl}.git`
    },
    bugs: {
      url: `${baseUrl}/issues`
    },
    homepage: `${baseUrl}#readme`
  };
}

function normalizeGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
    /^git\+https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    const owner = match?.groups?.owner;
    const repo = match?.groups?.repo;

    if (owner && repo) {
      return { owner, repo };
    }
  }

  return null;
}

function missingMetadataOperations(
  manifest: PackageManifest,
  metadata: {
    repository: { type: "git"; url: string };
    bugs: { url: string };
    homepage: string;
  }
): JsonSetOperation[] {
  const operations: JsonSetOperation[] = [];

  if (manifest.repository === undefined) {
    operations.push({
      kind: "json-set",
      file: "package.json",
      path: "$.repository",
      key: "repository",
      value: metadata.repository
    });
  }

  if (manifest.bugs === undefined) {
    operations.push({
      kind: "json-set",
      file: "package.json",
      path: "$.bugs",
      key: "bugs",
      value: metadata.bugs
    });
  }

  if (manifest.homepage === undefined) {
    operations.push({
      kind: "json-set",
      file: "package.json",
      path: "$.homepage",
      key: "homepage",
      value: metadata.homepage
    });
  }

  return operations;
}

function planTypesFix(): FixPlan {
  return {
    id: "fix.types",
    findingId: "manifest.types-missing",
    description: "Add top-level types metadata for dist/index.d.ts.",
    operations: [
      {
        kind: "json-set",
        file: "package.json",
        path: "$.types",
        key: "types",
        value: "./dist/index.d.ts"
      }
    ]
  };
}

export async function canApplyTypesFix(context: ProjectContext): Promise<boolean> {
  if (context.manifest.data.types !== undefined || context.manifest.data.typings !== undefined) {
    return false;
  }

  try {
    await access(path.join(context.root, "dist", "index.d.ts"));
    return true;
  } catch {
    return false;
  }
}

async function planFilesFix(context: ProjectContext, findingIds: ReadonlySet<string>): Promise<FixPlan | null> {
  if (!findingIds.has("manifest.files-missing") || context.manifest.data.files !== undefined) {
    return null;
  }

  if (!(await isDirectory(path.join(context.root, "dist")))) {
    return null;
  }

  const files = ["dist"];

  if (await fileExists(path.join(context.root, "README.md"))) {
    files.push("README.md");
  }

  if (await fileExists(path.join(context.root, "LICENSE"))) {
    files.push("LICENSE");
  }

  return {
    id: "fix.files",
    findingId: "manifest.files-missing",
    description: `Add package files ${formatJsonList(files)} to package.json.`,
    operations: [
      {
        kind: "json-set",
        file: "package.json",
        path: "$.files",
        key: "files",
        value: files
      }
    ]
  };
}

function planPublishAccessFix(context: ProjectContext, findingIds: ReadonlySet<string>): FixPlan | null {
  const manifest = context.manifest.data;

  if (!findingIds.has("manifest.publish-access-missing") || manifest.private === true || getPublishAccess(manifest.publishConfig)) {
    return null;
  }

  if (typeof manifest.name !== "string" || !manifest.name.startsWith("@")) {
    return null;
  }

  const publishConfig = isRecord(manifest.publishConfig) ? { ...manifest.publishConfig, access: "public" } : { access: "public" };

  return {
    id: "fix.publish-access",
    findingId: "manifest.publish-access-missing",
    description: 'Add publishConfig.access "public" for this scoped package.',
    operations: [
      {
        kind: "json-set",
        file: "package.json",
        path: "$.publishConfig.access",
        key: "publishConfig",
        value: publishConfig
      }
    ]
  };
}

function planEnginesNodeFix(context: ProjectContext, findingIds: ReadonlySet<string>): FixPlan | null {
  if (!findingIds.has("manifest.engines-node-missing") || hasNodeEngine(context.manifest.data.engines)) {
    return null;
  }

  const nodeRange = inferNodeEngineRange(context);

  if (!nodeRange || (context.manifest.data.engines !== undefined && !isRecord(context.manifest.data.engines))) {
    return null;
  }

  const engines = isRecord(context.manifest.data.engines) ? { ...context.manifest.data.engines, node: nodeRange } : { node: nodeRange };

  return {
    id: "fix.engines-node",
    findingId: "manifest.engines-node-missing",
    description: `Add engines.node "${nodeRange}" inferred from TypeScript target.`,
    operations: [
      {
        kind: "json-set",
        file: "package.json",
        path: "$.engines.node",
        key: "engines",
        value: engines
      }
    ]
  };
}

function planSideEffectsFix(context: ProjectContext, findingIds: ReadonlySet<string>): FixPlan | null {
  if (
    context.manifest.data.private === true ||
    context.manifest.data.sideEffects !== undefined ||
    context.preset.name !== "typescript-library" ||
    !appearsToHaveRuntimeEntrypoint(context.manifest.data) ||
    hasInstallLifecycleScript(context.manifest.data.scripts) ||
    hasKnownSideEffectFile(context)
  ) {
    return null;
  }

  return {
    id: "fix.side-effects",
    findingId: findingIds.has("manifest.files-missing") ? "manifest.files-missing" : "manifest.side-effects-missing",
    description: "Add sideEffects false for this package.",
    operations: [
      {
        kind: "json-set",
        file: "package.json",
        path: "$.sideEffects",
        key: "sideEffects",
        value: false
      }
    ]
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isDirectory();
  } catch {
    return false;
  }
}

function getPublishAccess(value: unknown): "public" | "restricted" | null {
  if (!isRecord(value)) {
    return null;
  }

  return value.access === "public" || value.access === "restricted" ? value.access : null;
}

function hasNodeEngine(value: unknown): boolean {
  return isRecord(value) && typeof value.node === "string" && value.node.trim() !== "";
}

function inferNodeEngineRange(context: ProjectContext): string | null {
  const tsconfig = context.tsconfig?.data;

  if (!isRecord(tsconfig) || !isRecord(tsconfig.compilerOptions)) {
    return null;
  }

  const target = tsconfig.compilerOptions.target;

  if (typeof target !== "string") {
    return null;
  }

  return nodeRangeForTsTarget(target);
}

function nodeRangeForTsTarget(target: string): string | null {
  const normalized = target.toLowerCase();

  if (normalized === "es2022" || normalized === "esnext") {
    return ">=18.0.0";
  }

  if (normalized === "es2021") {
    return ">=16.0.0";
  }

  if (normalized === "es2020") {
    return ">=14.0.0";
  }

  return null;
}

function appearsToHaveRuntimeEntrypoint(manifest: PackageManifest): boolean {
  return manifest.main !== undefined || manifest.module !== undefined || manifest.exports !== undefined;
}

function hasInstallLifecycleScript(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return ["preinstall", "install", "postinstall"].some((scriptName) => typeof value[scriptName] === "string");
}

function hasKnownSideEffectFile(context: ProjectContext): boolean {
  const files = context.pack?.files.map((file) => file.path.toLowerCase()) ?? [];

  return files.some((file) =>
    (
      file.endsWith(".css") ||
      file.endsWith(".scss") ||
      file.endsWith(".sass") ||
      file.endsWith(".less") ||
      /(?:^|\/)(?:polyfill|register|setup|global)\.[cm]?js$/.test(file)
    )
  );
}

function formatJsonList(values: string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyPackageJsonOperations(raw: string, operations: readonly JsonSetOperation[]): string {
  const manifest = JSON.parse(raw) as Record<string, unknown>;

  for (const operation of operations) {
    manifest[operation.key] = operation.value;
  }

  return `${JSON.stringify(manifest, null, detectIndent(raw))}${raw.endsWith("\n") ? "\n" : ""}`;
}

function detectIndent(raw: string): number {
  const match = /\n( +)"/.exec(raw);
  return match?.[1]?.length ?? 2;
}

function formatFixCount(count: number): string {
  return count === 1 ? "1 fix" : `${count} fixes`;
}
