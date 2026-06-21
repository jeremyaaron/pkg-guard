import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PackageManagerInfo, PackageManifest, ProjectContext } from "./context.js";

export interface InitReleaseResult {
  created: boolean;
  path: string;
  installCommand: string;
  publishCommand: string | null;
  packageManagerSetupSteps: string[];
  message: string;
}

export async function initReleaseWorkflow(context: ProjectContext): Promise<InitReleaseResult> {
  const workflowPath = path.join(context.root, ".github", "workflows", "release.yml");
  const relativePath = ".github/workflows/release.yml";
  const installCommand = getInstallCommand(context.packageManager);
  const packageManagerSetupSteps = getPackageManagerSetupSteps(context.packageManager);

  if (context.manifest.data.private === true) {
    return {
      created: false,
      path: relativePath,
      installCommand,
      publishCommand: null,
      packageManagerSetupSteps,
      message: "package.json has private: true; pkg-guard did not create a publish workflow."
    };
  }

  const publishCommand = getPublishCommand(context.manifest.data);

  if (await fileExists(workflowPath)) {
    return {
      created: false,
      path: relativePath,
      installCommand,
      publishCommand,
      packageManagerSetupSteps,
      message: `${relativePath} already exists; pkg-guard did not overwrite it.`
    };
  }

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(
    workflowPath,
    renderReleaseWorkflow({
      installCommand,
      publishCommand,
      packageManagerSetupSteps
    }),
    "utf8"
  );

  return {
    created: true,
    path: relativePath,
    installCommand,
    publishCommand,
    packageManagerSetupSteps,
    message: `Created ${relativePath}. Configure npm trusted publishing for this package using workflow release.yml.`
  };
}

export function renderInitReleaseHuman(result: InitReleaseResult): string {
  const lines = [result.message];

  if (result.publishCommand) {
    lines.push("", `Publish command: ${result.publishCommand}`);
  }

  if (result.created || result.publishCommand) {
    lines.push("", "npm trusted publishing setup:", "  Provider: GitHub Actions", "  Workflow: release.yml", "  Trigger: v* Git tags");
  }

  if (result.created) {
    lines.push("", `Generated workflow uses ${result.publishCommand} with id-token: write.`);
  }

  return `${lines.join("\n")}\n`;
}

export function renderInitReleaseJson(result: InitReleaseResult): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      command: "init-release",
      ...result,
      trustedPublishing: {
        provider: "GitHub Actions",
        workflow: "release.yml",
        trigger: "v* Git tags"
      }
    },
    null,
    2
  )}\n`;
}

function renderReleaseWorkflow(options: {
  installCommand: string;
  publishCommand: string;
  packageManagerSetupSteps: string[];
}): string {
  const setupSteps = options.packageManagerSetupSteps.map((step) => `      - ${step}\n`).join("");

  return `name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"
          package-manager-cache: false
${setupSteps}      - run: ${options.installCommand}
      - run: npm test --if-present
      - run: npm run build --if-present
      - run: npx pkg-guard check
      # Configure npm trusted publishing for this package on npmjs.com using this workflow filename.
      - run: ${options.publishCommand}
`;
}

function getInstallCommand(packageManager: PackageManagerInfo): string {
  if (packageManager.detected === "pnpm") {
    return "pnpm install --frozen-lockfile";
  }

  if (packageManager.detected === "yarn") {
    const version = packageManager.packageManagerField?.version;
    return version?.startsWith("1.") ? "yarn install --frozen-lockfile" : "yarn install --immutable";
  }

  if (packageManager.detected === "bun") {
    return "bun install --frozen-lockfile";
  }

  return "npm ci";
}

function getPackageManagerSetupSteps(packageManager: PackageManagerInfo): string[] {
  if (packageManager.detected === "pnpm" || packageManager.detected === "yarn") {
    return ["run: corepack enable"];
  }

  if (packageManager.detected === "bun") {
    return ["uses: oven-sh/setup-bun@v2"];
  }

  return [];
}

function getPublishCommand(manifest: PackageManifest): string {
  const access = getPublishAccess(manifest.publishConfig);

  if (access) {
    return `npm publish --access ${access}`;
  }

  if (typeof manifest.name === "string" && manifest.name.startsWith("@")) {
    return "npm publish --access public";
  }

  return "npm publish";
}

function getPublishAccess(value: unknown): "public" | "restricted" | null {
  if (!isRecord(value)) {
    return null;
  }

  return value.access === "public" || value.access === "restricted" ? value.access : null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
