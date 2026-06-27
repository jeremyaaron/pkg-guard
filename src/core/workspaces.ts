import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import type { PackageManagerInfo, PackageManifestFile, WorkflowInfo } from "./context.js";
import { detectPackageManager, discoverLockfiles, parsePackageManagerField, readWorkflows } from "./discovery.js";
import type { Finding } from "./findings.js";

export interface WorkspacePattern {
  pattern: string;
  negated: boolean;
  source: "package-json" | "pnpm-workspace";
  file: string;
}

export interface WorkspacePackage {
  root: string;
  relativePath: string;
  name: string | null;
  private: boolean;
  manifestPath: string;
}

export interface WorkspaceRunTarget {
  root: string;
  relativePath: string;
  name: string | null;
  private: boolean;
  manifestPath: string;
  source: "root" | "workspace";
}

export interface WorkspaceTargetSelectionOptions {
  workspaces: boolean;
  selectors: string[];
  includePrivate: boolean;
  includeRoot: boolean;
}

export interface WorkspaceTargetSelection {
  targets: WorkspaceRunTarget[];
  skipped: WorkspaceRunTarget[];
  findings: Finding[];
}

export interface WorkspaceDiscovery {
  root: string;
  manifest: PackageManifestFile | null;
  packageManager: PackageManagerInfo | null;
  rootWorkflows: WorkflowInfo[];
  patterns: WorkspacePattern[];
  packages: WorkspacePackage[];
  findings: Finding[];
}

const ignoredDirectoryNames = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".pnpm-store",
  ".yarn",
  "coverage",
  "node_modules"
]);

export async function discoverWorkspaces(rootInput: string): Promise<WorkspaceDiscovery> {
  const root = path.resolve(rootInput);
  const manifest = await readRootManifest(root);
  const findings: Finding[] = [];

  if (!manifest.ok) {
    return {
      root,
      manifest: null,
      packageManager: null,
      rootWorkflows: [],
      patterns: [],
      packages: [],
      findings: [workspaceConfigInvalidFinding(manifest.message, "package.json")]
    };
  }

  const lockfiles = await discoverLockfiles(root);
  const packageManagerField = parsePackageManagerField(manifest.manifest.data.packageManager);
  const packageManager = detectPackageManager(packageManagerField, lockfiles);
  const rootWorkflows = await readWorkflows(root);
  const patternResult = await readWorkspacePatterns(root, manifest.manifest);
  findings.push(...patternResult.findings);

  const included = new Map<string, WorkspacePackage>();

  for (const workspacePattern of patternResult.patterns) {
    const expansion = await expandWorkspacePattern(root, workspacePattern);
    findings.push(...expansion.findings);

    for (const packageRoot of expansion.packageRoots) {
      const workspacePackage = await readWorkspacePackage(root, packageRoot);

      if ("finding" in workspacePackage) {
        findings.push(workspacePackage.finding);
        continue;
      }

      if (workspacePattern.negated) {
        included.delete(workspacePackage.root);
      } else {
        included.set(workspacePackage.root, workspacePackage);
      }
    }
  }

  return {
    root,
    manifest: manifest.manifest,
    packageManager,
    rootWorkflows,
    patterns: patternResult.patterns,
    packages: [...included.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    findings
  };
}

export function selectWorkspaceTargets(
  discovery: WorkspaceDiscovery,
  options: WorkspaceTargetSelectionOptions
): WorkspaceTargetSelection {
  const targets = new Map<string, WorkspaceRunTarget>();
  const skipped = new Map<string, WorkspaceRunTarget>();
  const findings: Finding[] = [];
  const workspaceTargets = discovery.packages.map(workspacePackageToTarget);

  if (options.workspaces) {
    for (const target of workspaceTargets) {
      addSelectedTarget(targets, skipped, target, options.includePrivate);
    }

    if (options.includeRoot) {
      const rootTarget = rootManifestToTarget(discovery);

      if (rootTarget) {
        addSelectedTarget(targets, skipped, rootTarget, options.includePrivate);
      }
    }
  }

  for (const selector of options.selectors) {
    const normalizedSelector = normalizeSelector(selector);
    const matches = workspaceTargets.filter((target) => matchesWorkspaceSelector(target, normalizedSelector));

    if (matches.length === 0) {
      findings.push(workspaceSelectorNotFoundFinding(selector));
      continue;
    }

    for (const target of matches) {
      addSelectedTarget(targets, skipped, target, options.includePrivate);
    }
  }

  return {
    targets: [...targets.values()].sort(compareTargets),
    skipped: [...skipped.values()].sort(compareTargets),
    findings
  };
}

async function readRootManifest(
  root: string
): Promise<{ ok: true; manifest: PackageManifestFile } | { ok: false; message: string }> {
  try {
    const manifestPath = path.join(root, "package.json");
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed)) {
      return { ok: false, message: "Workspace root package.json must contain a JSON object." };
    }

    return {
      ok: true,
      manifest: {
        path: manifestPath,
        data: parsed,
        raw
      }
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Workspace root package.json could not be read."
    };
  }
}

async function readWorkspacePatterns(
  root: string,
  manifest: PackageManifestFile
): Promise<{ patterns: WorkspacePattern[]; findings: Finding[] }> {
  const findings: Finding[] = [];
  const patterns: WorkspacePattern[] = [];

  const packageJsonPatterns = readPackageJsonWorkspacePatterns(manifest.data.workspaces);

  if (packageJsonPatterns.ok) {
    patterns.push(
      ...packageJsonPatterns.patterns.map((pattern) => createWorkspacePattern(pattern, "package-json", "package.json"))
    );
  } else {
    findings.push(workspaceConfigInvalidFinding(packageJsonPatterns.message, "package.json", "$.workspaces"));
  }

  const pnpmWorkspacePath = path.join(root, "pnpm-workspace.yaml");

  if (await isReadableFile(pnpmWorkspacePath)) {
    const pnpmPatterns = await readPnpmWorkspacePatterns(pnpmWorkspacePath);

    if (pnpmPatterns.ok) {
      patterns.push(
        ...pnpmPatterns.patterns.map((pattern) => createWorkspacePattern(pattern, "pnpm-workspace", "pnpm-workspace.yaml"))
      );
    } else {
      findings.push(workspaceConfigInvalidFinding(pnpmPatterns.message, "pnpm-workspace.yaml", "$.packages"));
    }
  }

  return { patterns, findings };
}

function readPackageJsonWorkspacePatterns(value: unknown): { ok: true; patterns: string[] } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, patterns: [] };
  }

  if (Array.isArray(value)) {
    return readStringPatterns(value, "package.json workspaces must be an array of strings.");
  }

  if (isRecord(value) && Array.isArray(value.packages)) {
    return readStringPatterns(value.packages, "package.json workspaces.packages must be an array of strings.");
  }

  return { ok: false, message: "package.json workspaces must be an array or an object with packages." };
}

async function readPnpmWorkspacePatterns(filePath: string): Promise<{ ok: true; patterns: string[] } | { ok: false; message: string }> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = parse(raw) as unknown;

    if (!isRecord(parsed) || parsed.packages === undefined) {
      return { ok: true, patterns: [] };
    }

    if (!Array.isArray(parsed.packages)) {
      return { ok: false, message: "pnpm-workspace.yaml packages must be an array of strings." };
    }

    return readStringPatterns(parsed.packages, "pnpm-workspace.yaml packages must be an array of strings.");
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "pnpm-workspace.yaml could not be parsed."
    };
  }
}

function readStringPatterns(value: unknown[], message: string): { ok: true; patterns: string[] } | { ok: false; message: string } {
  if (value.some((item) => typeof item !== "string" || item.trim() === "")) {
    return { ok: false, message };
  }

  return {
    ok: true,
    patterns: value.map((item) => String(item).trim())
  };
}

function createWorkspacePattern(pattern: string, source: WorkspacePattern["source"], file: string): WorkspacePattern {
  const negated = pattern.startsWith("!");
  const rawPattern = negated ? pattern.slice(1) : pattern;

  return {
    pattern: normalizePatternText(rawPattern),
    negated,
    source,
    file
  };
}

async function expandWorkspacePattern(
  root: string,
  workspacePattern: WorkspacePattern
): Promise<{ packageRoots: string[]; findings: Finding[] }> {
  const validation = validateWorkspacePattern(workspacePattern);

  if (!validation.ok) {
    return {
      packageRoots: [],
      findings: [workspacePatternUnsupportedFinding(workspacePattern, validation.message)]
    };
  }

  const segments = workspacePattern.pattern.split("/").filter(Boolean);
  const packageRoots = await expandSegments(root, root, segments);

  return {
    packageRoots: packageRoots.filter((packageRoot) => isInsideRoot(root, packageRoot)),
    findings: []
  };
}

function validateWorkspacePattern(pattern: WorkspacePattern): { ok: true } | { ok: false; message: string } {
  if (pattern.pattern === "") {
    return { ok: false, message: "Workspace patterns must not be empty." };
  }

  if (path.isAbsolute(pattern.pattern)) {
    return { ok: false, message: "Workspace patterns must be relative paths." };
  }

  const normalized = path.posix.normalize(pattern.pattern);

  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return { ok: false, message: "Workspace patterns must stay inside the workspace root." };
  }

  const segments = pattern.pattern.split("/").filter(Boolean);

  for (const segment of segments) {
    if (segment === "**") {
      return { ok: false, message: "Recursive ** workspace patterns are not supported yet." };
    }

    if (segment.includes("*") && segment !== "*") {
      return { ok: false, message: "Workspace patterns only support * as a complete path segment." };
    }
  }

  return { ok: true };
}

async function expandSegments(root: string, current: string, segments: string[]): Promise<string[]> {
  if (!isInsideRoot(root, current)) {
    return [];
  }

  const [segment, ...rest] = segments;

  if (!segment) {
    return (await isReadableFile(path.join(current, "package.json"))) ? [current] : [];
  }

  if (segment === "*") {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    const directories = entries
      .filter((entry) => entry.isDirectory() && !isIgnoredDirectory(entry.name))
      .map((entry) => path.join(current, entry.name));
    const nested = await Promise.all(directories.map((directory) => expandSegments(root, directory, rest)));

    return nested.flat();
  }

  const next = path.join(current, segment);
  const nextStat = await stat(next).catch(() => null);

  if (!nextStat?.isDirectory() || isIgnoredDirectory(path.basename(next))) {
    return [];
  }

  return await expandSegments(root, next, rest);
}

async function readWorkspacePackage(
  workspaceRoot: string,
  packageRoot: string
): Promise<WorkspacePackage | { finding: Finding }> {
  const manifestPath = path.join(packageRoot, "package.json");

  try {
    const raw = await readFile(manifestPath, "utf8");
    const data = JSON.parse(raw) as unknown;

    if (!isRecord(data)) {
      return { finding: workspacePackageJsonInvalidFinding(workspaceRoot, packageRoot, "package.json must contain a JSON object.") };
    }

    return {
      root: packageRoot,
      relativePath: toPosixPath(path.relative(workspaceRoot, packageRoot)),
      name: typeof data.name === "string" ? data.name : null,
      private: data.private === true,
      manifestPath
    };
  } catch (error) {
    return {
      finding: workspacePackageJsonInvalidFinding(
        workspaceRoot,
        packageRoot,
        error instanceof Error ? error.message : "package.json could not be parsed."
      )
    };
  }
}

function normalizePatternText(value: string): string {
  return toPosixPath(value.trim()).replace(/^\.\//, "").replace(/\/$/, "");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isIgnoredDirectory(name: string): boolean {
  return ignoredDirectoryNames.has(name) || (name.startsWith(".") && name !== ".");
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    await access(filePath, constants.R_OK);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function workspaceConfigInvalidFinding(message: string, file: string, jsonPath?: string): Finding {
  return {
    id: "workspace.config-invalid",
    severity: "error",
    title: "Workspace configuration is invalid",
    message,
    file,
    ...(jsonPath ? { path: jsonPath } : {})
  };
}

function workspacePatternUnsupportedFinding(pattern: WorkspacePattern, message: string): Finding {
  return {
    id: "workspace.pattern-unsupported",
    severity: "warning",
    title: "Workspace pattern is not supported",
    message: `${pattern.negated ? "!" : ""}${pattern.pattern}: ${message}`,
    file: pattern.file
  };
}

function workspacePackageJsonInvalidFinding(workspaceRoot: string, packageRoot: string, message: string): Finding {
  const relativePath = toPosixPath(path.relative(workspaceRoot, packageRoot));

  return {
    id: "workspace.package-json-invalid",
    severity: "warning",
    title: "Workspace package.json is invalid",
    message,
    file: path.posix.join(relativePath, "package.json")
  };
}

function workspacePackageToTarget(workspacePackage: WorkspacePackage): WorkspaceRunTarget {
  return {
    ...workspacePackage,
    source: "workspace"
  };
}

function rootManifestToTarget(discovery: WorkspaceDiscovery): WorkspaceRunTarget | null {
  if (!discovery.manifest) {
    return null;
  }

  return {
    root: discovery.root,
    relativePath: ".",
    name: typeof discovery.manifest.data.name === "string" ? discovery.manifest.data.name : null,
    private: discovery.manifest.data.private === true,
    manifestPath: discovery.manifest.path,
    source: "root"
  };
}

function addSelectedTarget(
  targets: Map<string, WorkspaceRunTarget>,
  skipped: Map<string, WorkspaceRunTarget>,
  target: WorkspaceRunTarget,
  includePrivate: boolean
): void {
  if (target.private && !includePrivate) {
    if (!targets.has(target.root)) {
      skipped.set(target.root, target);
    }
    return;
  }

  skipped.delete(target.root);
  targets.set(target.root, target);
}

function matchesWorkspaceSelector(target: WorkspaceRunTarget, selector: string): boolean {
  return target.name === selector || normalizeSelector(target.relativePath) === selector;
}

function normalizeSelector(value: string): string {
  return normalizePatternText(value).replace(/\/$/, "");
}

function compareTargets(left: WorkspaceRunTarget, right: WorkspaceRunTarget): number {
  if (left.relativePath === "." && right.relativePath !== ".") {
    return -1;
  }

  if (right.relativePath === "." && left.relativePath !== ".") {
    return 1;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function workspaceSelectorNotFoundFinding(selector: string): Finding {
  return {
    id: "workspace.selector-not-found",
    severity: "error",
    title: "Workspace selector did not match any packages",
    message: `No workspace package matched ${JSON.stringify(selector)}.`,
    suggestion: "Use a workspace package name or repository-relative package path."
  };
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/").replaceAll("\\", "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
