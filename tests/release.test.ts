import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, type CliIO } from "../src/cli/run.js";

describe("init-release", () => {
  it("generates an npm trusted-publishing release workflow", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        packageManager: "npm@10.8.2"
      }),
      lockfiles: {
        "package-lock.json": "{}\n"
      }
    });

    const result = await invoke(["init-release"], root);
    const workflow = await readWorkflow(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created .github/workflows/release.yml");
    expect(result.stdout).toContain("Publish command: npm publish");
    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("- run: npm ci");
    expect(workflow).toContain("- run: npm test --if-present");
    expect(workflow).toContain("- run: npm run build --if-present");
    expect(workflow).toContain("- run: npx pkg-guard check");
    expect(workflow).toContain("- run: npm publish");
  });

  it("uses public access when generating a scoped package release workflow", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        name: "@scope/release-fixture",
        packageManager: "npm@10.8.2"
      }),
      lockfiles: {
        "package-lock.json": "{}\n"
      }
    });

    const result = await invoke(["init-release"], root);
    const workflow = await readWorkflow(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Publish command: npm publish --access public");
    expect(workflow).toContain("- run: npm publish --access public");
  });

  it.each([
    ["public", "npm publish --access public"],
    ["restricted", "npm publish --access restricted"]
  ])("respects publishConfig.access %s", async (access, publishCommand) => {
    const root = await createFixture({
      packageJson: basePackage({
        name: "@scope/release-fixture",
        packageManager: "npm@10.8.2",
        publishConfig: {
          access
        }
      }),
      lockfiles: {
        "package-lock.json": "{}\n"
      }
    });

    await invoke(["init-release"], root);
    const workflow = await readWorkflow(root);

    expect(workflow).toContain(`- run: ${publishCommand}`);
  });

  it("refuses to create a release workflow for private packages", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        packageManager: "npm@10.8.2",
        private: true
      }),
      lockfiles: {
        "package-lock.json": "{}\n"
      }
    });

    const result = await invoke(["init-release"], root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("private: true");
    await expect(readWorkflow(root)).rejects.toThrow();
  });

  it("generates pnpm setup and install steps", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        packageManager: "pnpm@9.0.0"
      }),
      lockfiles: {
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n"
      }
    });

    await invoke(["init-release"], root);
    const workflow = await readWorkflow(root);

    expect(workflow).toContain("- run: corepack enable");
    expect(workflow).toContain("- run: pnpm install --frozen-lockfile");
    expect(workflow).toContain("- run: npm publish");
  });

  it("selects Yarn classic install command", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        packageManager: "yarn@1.22.22"
      }),
      lockfiles: {
        "yarn.lock": "# yarn lockfile\n"
      }
    });

    await invoke(["init-release"], root);
    const workflow = await readWorkflow(root);

    expect(workflow).toContain("- run: corepack enable");
    expect(workflow).toContain("- run: yarn install --frozen-lockfile");
  });

  it("selects Bun setup and install command", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        packageManager: "bun@1.2.0"
      }),
      lockfiles: {
        "bun.lock": "# bun lockfile\n"
      }
    });

    await invoke(["init-release"], root);
    const workflow = await readWorkflow(root);

    expect(workflow).toContain("- uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("- run: bun install --frozen-lockfile");
    expect(workflow).toContain("- run: npm publish");
  });

  it("refuses to overwrite an existing release workflow", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        packageManager: "npm@10.8.2"
      }),
      lockfiles: {
        "package-lock.json": "{}\n"
      },
      releaseWorkflow: "name: Existing\n"
    });

    const result = await invoke(["init-release"], root);
    const workflow = await readWorkflow(root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("already exists");
    expect(workflow).toBe("name: Existing\n");
  });

  it("prints JSON output", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        packageManager: "npm@10.8.2"
      }),
      lockfiles: {
        "package-lock.json": "{}\n"
      }
    });

    const result = await invoke(["init-release", "--json"], root);
    const json = JSON.parse(result.stdout) as {
      command: string;
      created: boolean;
      path: string;
      installCommand: string;
      publishCommand: string;
      trustedPublishing: { workflow: string; trigger: string };
    };

    expect(result.exitCode).toBe(0);
    expect(json.command).toBe("init-release");
    expect(json.created).toBe(true);
    expect(json.path).toBe(".github/workflows/release.yml");
    expect(json.installCommand).toBe("npm ci");
    expect(json.publishCommand).toBe("npm publish");
    expect(json.trustedPublishing).toEqual({
      provider: "GitHub Actions",
      workflow: "release.yml",
      trigger: "v* Git tags"
    });
  });
});

function basePackage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "release-fixture",
    version: "1.0.0",
    license: "MIT",
    files: ["README.md", "LICENSE"],
    ...overrides
  };
}

async function invoke(args: string[], cwd: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";

  const io: CliIO = {
    cwd,
    stdout: {
      write(value) {
        stdout += value;
      }
    },
    stderr: {
      write(value) {
        stderr += value;
      }
    }
  };

  const exitCode = await runCli(args, io);

  return { exitCode, stdout, stderr };
}

async function createFixture(options: {
  packageJson: Record<string, unknown>;
  lockfiles: Record<string, string>;
  releaseWorkflow?: string;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-release-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "LICENSE"), "MIT\n");

  for (const [relativePath, content] of Object.entries(options.lockfiles)) {
    await writeFile(join(root, relativePath), content);
  }

  if (options.releaseWorkflow !== undefined) {
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await writeFile(join(root, ".github", "workflows", "release.yml"), options.releaseWorkflow);
  }

  return root;
}

async function readWorkflow(root: string): Promise<string> {
  return await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
}
