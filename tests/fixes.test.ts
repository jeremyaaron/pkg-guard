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

  it("writes files when dist output is present and files is missing", async () => {
    const root = await createFixture({
      packageJson: {
        name: "files-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2"
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.js": "export {};\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n"
      }
    });

    const first = await invoke(["fix"], root);
    const manifestAfterFirst = await readManifest(root);
    const second = await invoke(["fix"], root);

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("fix.files");
    expect(manifestAfterFirst.files).toEqual(["dist", "README.md", "LICENSE"]);
    expect(second.stdout).toBe("pkg-guard found no fixable issues\n");
  });

  it("writes publishConfig access for scoped packages", async () => {
    const root = await createFixture({
      packageJson: {
        name: "@scope/publish-access-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.js": "export {};\n"
      }
    });

    const first = await invoke(["fix"], root);
    const manifestAfterFirst = await readManifest(root);
    const second = await invoke(["fix"], root);

    expect(first.stdout).toContain("fix.publish-access");
    expect(manifestAfterFirst.publishConfig).toEqual({ access: "public" });
    expect(second.stdout).toBe("pkg-guard found no fixable issues\n");
  });

  it("writes engines.node inferred from TypeScript target", async () => {
    const root = await createFixture({
      packageJson: {
        name: "engines-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"],
        engines: {
          npm: ">=10"
        }
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.js": "export {};\n",
        "tsconfig.json": `${JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)}\n`
      }
    });

    const first = await invoke(["fix"], root);
    const manifestAfterFirst = await readManifest(root);
    const second = await invoke(["fix"], root);

    expect(first.stdout).toContain("fix.engines-node");
    expect(manifestAfterFirst.engines).toEqual({
      npm: ">=10",
      node: ">=18.0.0"
    });
    expect(second.stdout).toBe("pkg-guard found no fixable issues\n");
  });

  it("writes sideEffects false for a simple TypeScript library", async () => {
    const root = await createFixture({
      packageJson: {
        name: "side-effects-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        main: "./dist/index.js",
        files: ["dist", "README.md", "LICENSE"]
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.js": "export const value = 1;\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n",
        "tsconfig.json": `${JSON.stringify({ compilerOptions: { target: "ES2019" } }, null, 2)}\n`
      }
    });

    const first = await invoke(["fix"], root);
    const manifestAfterFirst = await readManifest(root);
    const second = await invoke(["fix"], root);

    expect(first.stdout).toContain("fix.side-effects");
    expect(manifestAfterFirst.sideEffects).toBe(false);
    expect(second.stdout).toBe("pkg-guard found no fixable issues\n");
  });

  it("keeps fix JSON schema compatible for expanded fixes", async () => {
    const root = await createFixture({
      packageJson: {
        name: "@scope/json-fix-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        main: "./dist/index.js"
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.js": "export {};\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n",
        "tsconfig.json": `${JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)}\n`
      }
    });

    const result = await invoke(["fix", "--dry-run", "--json"], root);
    const json = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      dryRun: boolean;
      fixes: Array<{ id: string; findingId: string }>;
    };

    expect(json.schemaVersion).toBe(1);
    expect(json.command).toBe("fix");
    expect(json.dryRun).toBe(true);
    expect(json.fixes.map((fix) => fix.id)).toEqual(
      expect.arrayContaining(["fix.files", "fix.publish-access", "fix.engines-node", "fix.side-effects"])
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
