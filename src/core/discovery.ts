import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { loadPkgGuardConfig } from "./config.js";
import type { Finding } from "./findings.js";
import type {
  GitInfo,
  LockfileInfo,
  PackageManagerField,
  PackageManagerInfo,
  PackageManagerName,
  ProjectContext,
  TsconfigInfo,
  WorkflowInfo
} from "./context.js";

const execFileAsync = promisify(execFile);

const lockfileManagers: Record<string, PackageManagerName> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun"
};

export interface ProjectDiscovery {
  context: ProjectContext | null;
  findings: Finding[];
}

export async function discoverProject(cwdInput: string): Promise<ProjectDiscovery> {
  const cwd = path.resolve(cwdInput);
  const root = await findProjectRoot(cwd);

  if (!root) {
    return {
      context: null,
      findings: [
        {
          id: "project.package-json-missing",
          severity: "error",
          title: "package.json was not found",
          message: `No package.json was found from ${cwd} or its parent directories.`,
          suggestion: "Run pkg-guard from a JavaScript or TypeScript package directory."
        }
      ]
    };
  }

  const manifestPath = path.join(root, "package.json");
  const manifest = await readJsonFile(manifestPath).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "package.json could not be parsed.";

    return {
      error: {
        id: "project.package-json-invalid",
        severity: "error" as const,
        title: "package.json is invalid",
        message,
        file: "package.json"
      }
    };
  });

  if ("error" in manifest) {
    return {
      context: null,
      findings: [manifest.error]
    };
  }
  const lockfiles = await discoverLockfiles(root);
  const packageManagerField = parsePackageManagerField(manifest.data.packageManager);
  const packageManager = detectPackageManager(packageManagerField, lockfiles);
  const config = loadPkgGuardConfig(manifest.data.pkgGuard);
  const findings = [...getDiscoveryFindings(packageManagerField, lockfiles), ...config.findings];

  return {
    context: {
      cwd,
      root,
      manifest,
      packageManager,
      git: await readGitInfo(root),
      tsconfig: await readTsconfig(root),
      workflows: await readWorkflows(root),
      config: config.config
    },
    findings
  };
}

async function findProjectRoot(start: string): Promise<string | null> {
  const startStat = await stat(start).catch(() => null);
  let current = startStat?.isFile() ? path.dirname(start) : start;

  while (true) {
    if (await isReadableFile(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

async function readJsonFile(filePath: string): Promise<{
  path: string;
  data: Record<string, unknown>;
  raw: string;
}> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }

  return {
    path: filePath,
    data: parsed as Record<string, unknown>,
    raw
  };
}

async function discoverLockfiles(root: string): Promise<LockfileInfo[]> {
  const lockfiles = await Promise.all(
    Object.entries(lockfileManagers).map(async ([filename, manager]) => {
      const filePath = path.join(root, filename);
      return (await isReadableFile(filePath)) ? { name: manager, path: filePath } : null;
    })
  );

  return lockfiles.filter((lockfile): lockfile is LockfileInfo => lockfile !== null);
}

function parsePackageManagerField(value: unknown): PackageManagerField | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const raw = value.trim();
  const atIndex = raw.lastIndexOf("@");

  if (atIndex <= 0) {
    return {
      name: raw,
      version: null,
      raw
    };
  }

  return {
    name: raw.slice(0, atIndex),
    version: raw.slice(atIndex + 1) || null,
    raw
  };
}

function detectPackageManager(
  packageManagerField: PackageManagerField | null,
  lockfiles: LockfileInfo[]
): PackageManagerInfo {
  const knownFieldName = toKnownPackageManager(packageManagerField?.name);

  return {
    detected: knownFieldName ?? lockfiles[0]?.name ?? "npm",
    packageManagerField,
    lockfiles
  };
}

function getDiscoveryFindings(
  packageManagerField: PackageManagerField | null,
  lockfiles: LockfileInfo[]
): Finding[] {
  const findings: Finding[] = [];
  const knownFieldName = toKnownPackageManager(packageManagerField?.name);
  const lockfileNames = new Set(lockfiles.map((lockfile) => lockfile.name));

  if (packageManagerField && !knownFieldName) {
    findings.push({
      id: "project.package-manager-unknown",
      severity: "warning",
      title: "Unknown package manager",
      message: `package.json declares packageManager as ${packageManagerField.raw}, which pkg-guard does not recognize yet.`,
      file: "package.json",
      path: "$.packageManager"
    });
  }

  if (lockfileNames.size > 1) {
    findings.push({
      id: "project.multiple-lockfiles",
      severity: "warning",
      title: "Multiple package manager lockfiles were found",
      message: `Found lockfiles for ${formatList([...lockfileNames])}.`,
      suggestion: "Keep one package manager lockfile unless this combination is intentional."
    });
  }

  return findings;
}

function toKnownPackageManager(value: string | undefined): PackageManagerName | null {
  if (value === "npm" || value === "pnpm" || value === "yarn" || value === "bun") {
    return value;
  }

  return null;
}

async function readGitInfo(root: string): Promise<GitInfo | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "config", "--get", "remote.origin.url"]);
    const remoteUrl = stdout.trim();
    return { remoteUrl: remoteUrl || null };
  } catch {
    return null;
  }
}

async function readTsconfig(root: string): Promise<TsconfigInfo | null> {
  const filePath = path.join(root, "tsconfig.json");

  if (!(await isReadableFile(filePath))) {
    return null;
  }

  const raw = await readFile(filePath, "utf8");
  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  return { path: filePath, data, raw };
}

async function readWorkflows(root: string): Promise<WorkflowInfo[]> {
  const workflowRoot = path.join(root, ".github", "workflows");

  if (!(await isReadableDirectory(workflowRoot))) {
    return [];
  }

  const entries = await readdir(workflowRoot, { withFileTypes: true });
  const workflowFiles = entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")))
    .map((entry) => path.join(workflowRoot, entry.name));

  return Promise.all(
    workflowFiles.map(async (filePath) => ({
      path: filePath,
      raw: await readFile(filePath, "utf8")
    }))
  );
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

async function isReadableDirectory(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    await access(filePath, constants.R_OK);
    return fileStat.isDirectory();
  } catch {
    return false;
  }
}

function formatList(values: string[]): string {
  return values.sort().join(", ");
}
