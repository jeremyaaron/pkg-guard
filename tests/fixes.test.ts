import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { runCli, type CliIO } from "../src/cli/run.js";

const execFileAsync = promisify(execFile);

describe("pkg-guard fix", () => {
  it("previews packageManager changes without writing", async () => {
    const root = await createFixture({
      packageJson: {
        name: "dry-run-fixture",
        version: "1.0.0",
        license: "MIT",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });

    const result = await invoke(["fix", "--dry-run"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard planned 1 fix");
    expect(result.stdout).toContain("$.packageManager");
    expect(manifest.packageManager).toBeUndefined();
  });

  it("writes packageManager and is idempotent", async () => {
    const root = await createFixture({
      packageJson: {
        name: "package-manager-fixture",
        version: "1.0.0",
        license: "MIT",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });
    const npmVersion = (await execFileAsync("npm", ["--version"])).stdout.trim();

    const first = await invoke(["fix"], root);
    const manifestAfterFirst = await readManifest(root);
    const second = await invoke(["fix"], root);

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("pkg-guard applied 1 fix");
    expect(manifestAfterFirst.packageManager).toBe(`npm@${npmVersion}`);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe("pkg-guard found no fixable issues\n");
  });

  it("does not write packageManager when multiple lockfile managers are present", async () => {
    const root = await createFixture({
      packageJson: {
        name: "ambiguous-manager-fixture",
        version: "1.0.0",
        license: "MIT",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n",
        "yarn.lock": "# yarn lockfile\n"
      }
    });

    const result = await invoke(["fix"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no fixable issues\n");
    expect(manifest.packageManager).toBeUndefined();
  });

  it("writes repository, bugs, and homepage metadata from a GitHub remote", async () => {
    const root = await createFixture({
      packageJson: {
        name: "repo-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });
    await execFileAsync("git", ["-C", root, "init"]);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "git@github.com:example/repo-fixture.git"]);

    const result = await invoke(["fix"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/example/repo-fixture.git"
    });
    expect(manifest.bugs).toEqual({
      url: "https://github.com/example/repo-fixture/issues"
    });
    expect(manifest.homepage).toBe("https://github.com/example/repo-fixture#readme");
  });

  it("does not overwrite existing bugs or homepage metadata", async () => {
    const root = await createFixture({
      packageJson: {
        name: "repo-existing-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"],
        bugs: { url: "https://example.com/issues" },
        homepage: "https://example.com"
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });
    await execFileAsync("git", ["-C", root, "init"]);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "https://github.com/example/repo-existing-fixture.git"]);

    await invoke(["fix"], root);
    const manifest = await readManifest(root);

    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/example/repo-existing-fixture.git"
    });
    expect(manifest.bugs).toEqual({ url: "https://example.com/issues" });
    expect(manifest.homepage).toBe("https://example.com");
  });

  it("fills missing bugs and homepage when repository already exists", async () => {
    const root = await createFixture({
      packageJson: {
        name: "partial-repo-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"],
        repository: {
          type: "git",
          url: "git+https://github.com/example/partial-repo-fixture.git"
        }
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });
    await execFileAsync("git", ["-C", root, "init"]);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "https://github.com/example/partial-repo-fixture.git"]);

    await invoke(["fix"], root);
    const manifest = await readManifest(root);

    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/example/partial-repo-fixture.git"
    });
    expect(manifest.bugs).toEqual({ url: "https://github.com/example/partial-repo-fixture/issues" });
    expect(manifest.homepage).toBe("https://github.com/example/partial-repo-fixture#readme");
  });

  it("writes top-level types when dist/index.d.ts exists", async () => {
    const root = await createFixture({
      packageJson: {
        name: "types-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.d.ts": "export {};\n"
      }
    });

    const result = await invoke(["fix"], root);
    const manifest = await readManifest(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("fix.types");
    expect(manifest.types).toBe("./dist/index.d.ts");
  });

  it("reports a real finding ID for the types fix in JSON output", async () => {
    const root = await createFixture({
      packageJson: {
        name: "types-json-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.d.ts": "export {};\n"
      }
    });

    const result = await invoke(["fix", "--dry-run", "--json"], root);
    const json = JSON.parse(result.stdout) as {
      fixes: Array<{
        id: string;
        findingId: string;
      }>;
    };

    expect(result.exitCode).toBe(0);
    expect(json.fixes).toContainEqual(
      expect.objectContaining({
        id: "fix.types",
        findingId: "manifest.types-missing"
      })
    );
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
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-fix-"));

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
