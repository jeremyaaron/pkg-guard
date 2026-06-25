import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCli, type CliIO } from "../src/cli/run.js";

describe("runCli", () => {
  it("prints global help", async () => {
    const result = await invoke(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard <command>");
    expect(result.stdout).toContain("check");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("--format <name>");
  });

  it("prints init help", async () => {
    const result = await invoke(["init", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard init");
    expect(result.stdout).toContain("--workspaces");
  });

  it("returns usage errors for unknown commands", async () => {
    const result = await invoke(["wat"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: wat");
    expect(result.stderr).toContain("Usage:");
  });

  it("runs check with an empty finding set", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["check"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no issues\n");
    expect(result.stderr).toBe("");
  });

  it("prints check JSON with schema metadata", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["check", "--json"], fixture);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      summary: { errors: number; warnings: number; info: number };
      findings: unknown[];
    };

    expect(result.exitCode).toBe(0);
    expect(report.schemaVersion).toBe(1);
    expect(report.command).toBe("check");
    expect(report.summary).toEqual({ errors: 0, warnings: 0, info: 0 });
    expect(report.findings).toEqual([]);
  });

  it("prints check JSON through the format option", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["check", "--format", "json"], fixture);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
    };

    expect(result.exitCode).toBe(0);
    expect(report.schemaVersion).toBe(1);
    expect(report.command).toBe("check");
  });

  it("runs fix as a command shell", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["fix", "--dry-run"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no fixable issues\n");
  });

  it("prints fix JSON for an empty fix set", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["fix", "--json"], fixture);
    const report = JSON.parse(result.stdout) as {
      command: string;
      dryRun: boolean;
      summary: { fixes: number; changedFiles: number };
    };

    expect(result.exitCode).toBe(0);
    expect(report.command).toBe("fix");
    expect(report.dryRun).toBe(false);
    expect(report.summary).toEqual({ fixes: 0, changedFiles: 0 });
  });

  it("runs init-release as a command shell", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["init-release"], fixture);
    const workflow = await readFile(join(fixture, ".github", "workflows", "release.yml"), "utf8");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created .github/workflows/release.yml");
    expect(workflow).toContain("npm publish");
  });

  it("returns discovery errors for missing package.json", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "pkg-guard-empty-"));
    const result = await invoke(["check", "--json"], fixture);
    const report = JSON.parse(result.stdout) as {
      summary: { errors: number };
      findings: Array<{ id: string }>;
    };

    expect(result.exitCode).toBe(1);
    expect(report.summary.errors).toBe(1);
    expect(report.findings[0]?.id).toBe("project.package-json-missing");
  });

  it("rejects unsupported command options", async () => {
    const result = await invoke(["check", "--dry-run"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--dry-run is only supported by fix and init");
  });

  it("rejects unsupported output formats", async () => {
    const result = await invoke(["check", "--format", "xml"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unsupported output format: xml");
  });

  it("rejects sarif output for commands other than check", async () => {
    const result = await invoke(["fix", "--format", "sarif"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--format sarif is only supported by check");
  });

  it("parses sarif output for check but reports the later phase stub", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["check", "--format", "sarif"], fixture);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("SARIF output is not implemented yet.\n");
  });

  it("rejects workspace options for init-release", async () => {
    const result = await invoke(["init-release", "--workspaces"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Workspace options are not supported by init-release");
  });

  it("rejects include flags without a workspace selector", async () => {
    const result = await invoke(["check", "--include-private"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--include-private and --include-root require --workspaces or --workspace");
  });

  it("rejects conflicting workspace selection options", async () => {
    const result = await invoke(["check", "--workspaces", "--workspace", "packages/a"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--workspaces and --workspace cannot be used together");
  });

  it("runs workspace checks with a temporary batch summary", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await writePackageJson(join(fixture, "packages", "a", "package.json"), {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      files: ["dist"]
    });
    await writeFile(join(fixture, "packages", "a", "README.md"), "# A\n");
    await writeFile(join(fixture, "packages", "a", "LICENSE"), "MIT\n");
    const result = await invoke(["check", "--workspaces"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("pkg-guard checked 1 package and skipped 0 packages");
    expect(result.stdout).toContain("packages/a (a)");
    expect(result.stdout).toContain("no issues");
  });

  it("returns a failing workspace exit code when any package has an error", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await writePackageJson(join(fixture, "packages", "a", "package.json"), {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      files: ["dist"],
      main: "./missing.js"
    });
    await writePackageJson(join(fixture, "packages", "b", "package.json"), {
      name: "b",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      files: ["dist"]
    });
    await writeFile(join(fixture, "packages", "a", "README.md"), "# A\n");
    await writeFile(join(fixture, "packages", "a", "LICENSE"), "MIT\n");
    await writeFile(join(fixture, "packages", "b", "README.md"), "# B\n");
    await writeFile(join(fixture, "packages", "b", "LICENSE"), "MIT\n");
    const result = await invoke(["check", "--workspaces"], fixture);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("packages/a (a)");
    expect(result.stdout).toContain("entrypoint.target-missing");
    expect(result.stdout).toContain("packages/b (b)");
    expect(result.stdout).toContain("no issues");
  });

  it("prints workspace JSON output", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await writePackageJson(join(fixture, "packages", "a", "package.json"), {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      files: ["dist"]
    });
    await writeFile(join(fixture, "packages", "a", "README.md"), "# A\n");
    await writeFile(join(fixture, "packages", "a", "LICENSE"), "MIT\n");
    const result = await invoke(["check", "--workspaces", "--format", "json"], fixture);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: number;
      summary: { packages: number; skipped: number; errors: number; warnings: number; info: number };
      packages: Array<{ name: string | null; relativePath: string; private: boolean; report: unknown }>;
      findings: unknown[];
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(report.schemaVersion).toBe(1);
    expect(report.summary).toEqual({ packages: 1, skipped: 0, errors: 0, warnings: 0, info: 0 });
    expect(report.packages[0]).toMatchObject({
      name: "a",
      relativePath: "packages/a",
      private: false
    });
    expect(report.findings).toEqual([]);
  });

  it("reports missing workspace selectors before batch execution", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await writePackageJson(join(fixture, "packages", "a", "package.json"), {
      name: "a",
      version: "1.0.0"
    });
    const result = await invoke(["check", "--workspace", "missing"], fixture);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("workspace.selector-not-found");
    expect(result.stderr).toContain('No workspace package matched "missing".');
  });

  it("parses init but reports the later phase stub", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["init", "--dry-run"], fixture);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("pkg-guard init is not implemented yet.\n");
  });
});

async function invoke(args: string[], cwd = "/repo"): Promise<{
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

async function createPackageFixture(overrides: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-package-"));

  await writePackageJson(join(root, "package.json"), {
    name: "fixture",
    version: "1.0.0",
    license: "MIT",
    packageManager: "npm@10.8.2",
    files: ["dist"],
    ...overrides
  });
  await writeFile(join(root, "package-lock.json"), "{}\n");
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "LICENSE"), "MIT\n");

  return root;
}

async function writePackageJson(filePath: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
