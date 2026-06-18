import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PackageManagerInfo, ProjectContext } from "./context.js";

export interface InitReleaseResult {
  created: boolean;
  path: string;
  installCommand: string;
  packageManagerSetupSteps: string[];
  message: string;
}

export async function initReleaseWorkflow(context: ProjectContext): Promise<InitReleaseResult> {
  const workflowPath = path.join(context.root, ".github", "workflows", "release.yml");
  const relativePath = ".github/workflows/release.yml";
  const installCommand = getInstallCommand(context.packageManager);
  const packageManagerSetupSteps = getPackageManagerSetupSteps(context.packageManager);

  if (await fileExists(workflowPath)) {
    return {
      created: false,
      path: relativePath,
      installCommand,
      packageManagerSetupSteps,
      message: `${relativePath} already exists; pkg-guard did not overwrite it.`
    };
  }

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(
    workflowPath,
    renderReleaseWorkflow({
      installCommand,
      packageManagerSetupSteps
    }),
    "utf8"
  );

  return {
    created: true,
    path: relativePath,
    installCommand,
    packageManagerSetupSteps,
    message: `Created ${relativePath}. Configure npm trusted publishing for this package using workflow release.yml.`
  };
}

export function renderInitReleaseHuman(result: InitReleaseResult): string {
  const lines = [result.message, "", "npm trusted publishing setup:", "  Provider: GitHub Actions", "  Workflow: release.yml", "  Trigger: v* Git tags"];

  if (result.created) {
    lines.push("", "Generated workflow uses npm publish with id-token: write.");
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

function renderReleaseWorkflow(options: { installCommand: string; packageManagerSetupSteps: string[] }): string {
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
      - run: npm publish
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
