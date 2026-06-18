import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { discoverProject } from "../src/core/discovery.js";

const execFileAsync = promisify(execFile);

describe("discoverProject", () => {
  it("discovers the project root from nested directories", async () => {
    const root = await createFixture({
      packageJson: {
        name: "nested-fixture",
        version: "1.0.0",
        packageManager: "npm@10.8.2"
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });
    const nested = join(root, "packages", "nested");
    await mkdir(nested, { recursive: true });

    const result = await discoverProject(nested);

    expect(result.context?.root).toBe(root);
    expect(result.context?.manifest.data.name).toBe("nested-fixture");
    expect(result.context?.packageManager.detected).toBe("npm");
    expect(result.findings).toEqual([]);
  });

  it("detects pnpm from lockfiles", async () => {
    const root = await createFixture({
      packageJson: { name: "pnpm-fixture", version: "1.0.0" },
      files: {
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n"
      }
    });

    const result = await discoverProject(root);

    expect(result.context?.packageManager.detected).toBe("pnpm");
    expect(result.context?.packageManager.lockfiles).toHaveLength(1);
  });

  it.each([
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"]
  ])("detects %s lockfiles", async (lockfile, manager) => {
    const root = await createFixture({
      packageJson: { name: `${manager}-fixture`, version: "1.0.0" },
      files: {
        [lockfile]: "# lockfile\n"
      }
    });

    const result = await discoverProject(root);

    expect(result.context?.packageManager.detected).toBe(manager);
    expect(result.findings).toEqual([]);
  });

  it("exposes package manager conflict data in context", async () => {
    const root = await createFixture({
      packageJson: {
        name: "conflict-fixture",
        version: "1.0.0",
        packageManager: "pnpm@9.0.0"
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });

    const result = await discoverProject(root);

    expect(result.context?.packageManager.packageManagerField?.name).toBe("pnpm");
    expect(result.context?.packageManager.lockfiles[0]?.name).toBe("npm");
  });

  it("reports multiple lockfiles", async () => {
    const root = await createFixture({
      packageJson: { name: "multi-lock-fixture", version: "1.0.0" },
      files: {
        "package-lock.json": "{}\n",
        "yarn.lock": "# yarn lockfile\n"
      }
    });

    const result = await discoverProject(root);

    expect(result.findings.map((finding) => finding.id)).toContain("project.multiple-lockfiles");
  });

  it("reads direct tsconfig and GitHub workflow files", async () => {
    const root = await createFixture({
      packageJson: {
        name: "workflow-fixture",
        version: "1.0.0",
        packageManager: "npm@10.8.2"
      },
      files: {
        "package-lock.json": "{}\n",
        "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`,
        ".github/workflows/ci.yml": "name: CI\n"
      }
    });

    const result = await discoverProject(root);

    expect(result.context?.tsconfig?.path).toBe(join(root, "tsconfig.json"));
    expect(result.context?.workflows).toHaveLength(1);
    expect(result.context?.workflows[0]?.path).toBe(join(root, ".github", "workflows", "ci.yml"));
  });

  it("reads Git remote metadata when available", async () => {
    const root = await createFixture({
      packageJson: { name: "git-fixture", version: "1.0.0" }
    });
    await execFileAsync("git", ["-C", root, "init"]);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "https://github.com/example/pkg-guard.git"]);

    const result = await discoverProject(root);

    expect(result.context?.git?.remoteUrl).toBe("https://github.com/example/pkg-guard.git");
  });

  it("returns a structured finding when package.json is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "pkg-guard-missing-"));

    const result = await discoverProject(root);

    expect(result.context).toBeNull();
    expect(result.findings[0]?.id).toBe("project.package-json-missing");
  });

  it("returns a structured finding when package.json is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "pkg-guard-invalid-"));
    await writeFile(join(root, "package.json"), "{ nope\n");

    const result = await discoverProject(root);

    expect(result.context).toBeNull();
    expect(result.findings[0]?.id).toBe("project.package-json-invalid");
  });
});

async function createFixture(options: {
  packageJson: Record<string, unknown>;
  files?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-fixture-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}
