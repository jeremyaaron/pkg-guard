import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, type CliIO } from "../src/cli/run.js";

describe("pkg-guard init", () => {
  it("previews single-package init changes without writing", async () => {
    const root = await createFixture({
      packageJson: {
        name: "init-fixture",
        version: "1.0.0"
      }
    });

    const result = await invoke(["init", "--dry-run"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard planned 1 init change");
    expect(result.stdout).toContain("init.check-script");
    expect(result.stdout).toContain("Next: run pkg-guard init-release");
    expect(manifest.scripts).toBeUndefined();
  });

  it("writes single-package init changes", async () => {
    const root = await createFixture({
      packageJson: {
        name: "init-write-fixture",
        version: "1.0.0",
        bin: {
          fixture: "./dist/cli.js"
        }
      }
    });

    const result = await invoke(["init"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard applied 2 init changes");
    expect(manifest.pkgGuard).toEqual({ preset: "cli" });
    expect(manifest.scripts).toEqual({ "pkg:check": "pkg-guard check" });
  });

  it("does not overwrite existing scripts or configured presets", async () => {
    const root = await createFixture({
      packageJson: {
        name: "init-existing-fixture",
        version: "1.0.0",
        bin: {
          fixture: "./dist/cli.js"
        },
        pkgGuard: {
          preset: "generic"
        },
        scripts: {
          "pkg:check": "custom check"
        }
      }
    });

    const result = await invoke(["init"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard found no init changes");
    expect(manifest.pkgGuard).toEqual({ preset: "generic" });
    expect(manifest.scripts).toEqual({ "pkg:check": "custom check" });
  });

  it("does not add a duplicate script when another script already runs pkg-guard check", async () => {
    const root = await createFixture({
      packageJson: {
        name: "init-existing-script-fixture",
        version: "1.0.0",
        scripts: {
          verify: "npm test && pkg-guard check"
        }
      }
    });

    const result = await invoke(["init"], root);
    const manifest = await readManifest(root);

    expect(result.stdout).toContain("pkg-guard found no init changes");
    expect(manifest.scripts).toEqual({ verify: "npm test && pkg-guard check" });
  });

  it("prints JSON init output", async () => {
    const root = await createFixture({
      packageJson: {
        name: "init-json-fixture",
        version: "1.0.0"
      }
    });

    const result = await invoke(["init", "--dry-run", "--format", "json"], root);
    const json = JSON.parse(result.stdout) as {
      command: string;
      dryRun: boolean;
      summary: { plans: number; changedFiles: number };
      plans: Array<{ id: string }>;
    };

    expect(result.exitCode).toBe(0);
    expect(json.command).toBe("init");
    expect(json.dryRun).toBe(true);
    expect(json.summary).toEqual({ plans: 1, changedFiles: 0 });
    expect(json.plans).toEqual([expect.objectContaining({ id: "init.check-script" })]);
  });

  it("plans workspace root init changes", async () => {
    const root = await createFixture({
      packageJson: {
        name: "workspace-root",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"]
      },
      files: {
        "packages/a/package.json": `${JSON.stringify({ name: "a", version: "1.0.0" }, null, 2)}\n`
      }
    });

    const result = await invoke(["init", "--workspaces", "--dry-run"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard planned 1 init change across 1 package");
    expect(result.stdout).toContain("$.scripts.pkg:check");
    expect(result.stdout).toContain("pkg-guard check --workspaces");
    expect(manifest.scripts).toBeUndefined();
  });

  it("writes workspace root init changes", async () => {
    const root = await createFixture({
      packageJson: {
        name: "workspace-root-write",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"]
      }
    });

    const result = await invoke(["init", "--workspaces"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(manifest.scripts).toEqual({ "pkg:check": "pkg-guard check --workspaces" });
  });

  it("applies init to selected workspace packages", async () => {
    const root = await createFixture({
      packageJson: {
        name: "workspace-selected-root",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"]
      },
      files: {
        "packages/a/package.json": `${JSON.stringify({ name: "a", version: "1.0.0" }, null, 2)}\n`,
        "packages/b/package.json": `${JSON.stringify({ name: "b", version: "1.0.0" }, null, 2)}\n`
      }
    });

    const result = await invoke(["init", "--workspace", "packages/a"], root);
    const manifestA = await readManifest(join(root, "packages", "a"));
    const manifestB = await readManifest(join(root, "packages", "b"));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("packages/a (a)");
    expect(manifestA.scripts).toEqual({ "pkg:check": "pkg-guard check" });
    expect(manifestB.scripts).toBeUndefined();
  });
});

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
  files?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-init-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}

async function readManifest(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
}
