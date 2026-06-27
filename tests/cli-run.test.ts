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
    expect(result.stdout).toContain("--consumer-smoke");
  });

  it("prints check help with consumer smoke", async () => {
    const result = await invoke(["check", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard check");
    expect(result.stdout).toContain("--consumer-smoke");
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

  it("runs consumer smoke for check", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["check", "--consumer-smoke"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no issues\n");
    expect(result.stderr).toBe("");
  });

  it("prints consumer smoke runtime findings in human output", async () => {
    const fixture = await createPackageFixture({
      main: "./dist/missing.js"
    });
    const result = await invoke(["check", "--consumer-smoke"], fixture);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("consumer.require-unresolved");
    expect(result.stdout).toContain('require.resolve("fixture") failed');
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

  it.each([
    ["fix"],
    ["init"],
    ["init-release"]
  ])("rejects consumer smoke for %s", async (command) => {
    const result = await invoke([command, "--consumer-smoke"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--consumer-smoke is only supported by check");
  });

  it("prints check SARIF output", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["check", "--format", "sarif"], fixture);
    const report = JSON.parse(result.stdout) as {
      version: string;
      runs: Array<{ tool: { driver: { name: string } }; results: unknown[] }>;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(report.version).toBe("2.1.0");
    expect(report.runs[0]?.tool.driver.name).toBe("pkg-guard");
    expect(report.runs[0]?.results).toEqual([]);
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
      main: "./dist/index.js",
      files: ["dist"]
    });
    await mkdir(join(fixture, "packages", "a", "dist"), { recursive: true });
    await writeFile(join(fixture, "packages", "a", "dist", "index.js"), "export {};\n");
    await writeFile(join(fixture, "packages", "a", "README.md"), "# A\n");
    await writeFile(join(fixture, "packages", "a", "LICENSE"), "MIT\n");
    const result = await invoke(["check", "--workspaces"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("pkg-guard checked 1 package and skipped 0 packages");
    expect(result.stdout).toContain("packages/a (a)");
    expect(result.stdout).toContain("no issues");
  });

  it("runs consumer smoke for workspace checks", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await writePackageJson(join(fixture, "packages", "a", "package.json"), {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      main: "./dist/index.js",
      files: ["dist"]
    });
    await mkdir(join(fixture, "packages", "a", "dist"), { recursive: true });
    await writeFile(join(fixture, "packages", "a", "dist", "index.js"), "export {};\n");
    await writeFile(join(fixture, "packages", "a", "README.md"), "# A\n");
    await writeFile(join(fixture, "packages", "a", "LICENSE"), "MIT\n");
    const result = await invoke(["check", "--workspaces", "--consumer-smoke"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("pkg-guard checked 1 package and skipped 0 packages");
    expect(result.stdout).toContain("packages/a (a)");
    expect(result.stdout).toContain("no issues");
  });

  it("does not report pnpm-safe workspace ranges in human workspace output", async () => {
    const fixture = await createPnpmWorkspaceRangeFixture();
    const result = await invoke(["check", "--workspaces"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("pkg-guard checked 2 packages and skipped 0 packages");
    expect(result.stdout).toContain("packages/a (@scope/a)");
    expect(result.stdout).toContain("no issues");
    expect(result.stdout).not.toContain("dependencies.workspace-range");
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

  it("prints workspace range findings inside package JSON reports", async () => {
    const fixture = await createPnpmWorkspaceRangeFixture({
      files: {
        ".github/workflows/release.yml": "name: release\non: workflow_dispatch\njobs:\n  publish:\n    steps:\n      - run: npm publish\n"
      }
    });
    const result = await invoke(["check", "--workspaces", "--format", "json"], fixture);
    const report = JSON.parse(result.stdout) as {
      summary: { errors: number; warnings: number; info: number };
      findings: unknown[];
      packages: Array<{
        relativePath: string;
        report: {
          findings: Array<{ id: string; severity: string; file?: string; path?: string }>;
        };
      }>;
    };
    const packageA = report.packages.find((packageReport) => packageReport.relativePath === "packages/a");
    const finding = packageA?.report.findings.find((item) => item.id === "dependencies.workspace-range");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(report.summary).toEqual({ packages: 2, skipped: 0, errors: 1, warnings: 0, info: 0 });
    expect(report.findings).toEqual([]);
    expect(finding).toMatchObject({
      severity: "error",
      file: "package.json",
      path: "$.dependencies.\"@scope/shared\""
    });
  });

  it("keeps consumer smoke findings inside workspace package JSON reports", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await createWorkspacePackage(fixture, "a", {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      main: "./dist/index.js",
      files: ["README.md", "LICENSE"]
    });
    const result = await invoke(["check", "--workspaces", "--consumer-smoke", "--format", "json"], fixture);
    const report = JSON.parse(result.stdout) as {
      schemaVersion: number;
      summary: { packages: number; skipped: number; errors: number; warnings: number; info: number };
      findings: unknown[];
      packages: Array<{
        relativePath: string;
        report: {
          findings: Array<{ id: string; severity: string; file?: string; path?: string }>;
        };
      }>;
    };
    const packageA = report.packages.find((packageReport) => packageReport.relativePath === "packages/a");
    const finding = packageA?.report.findings.find((item) => item.id === "consumer.require-unresolved");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(report.schemaVersion).toBe(1);
    expect(report.summary.packages).toBe(1);
    expect(report.findings).toEqual([]);
    expect(finding).toMatchObject({
      severity: "error",
      file: "package.json",
      path: "$.main"
    });
  });

  it("continues workspace consumer smoke after one package install failure", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await createWorkspacePackage(fixture, "a", {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      main: "./dist/index.js",
      files: ["dist"],
      dependencies: {
        "bad dep": "1.0.0"
      }
    });
    await createWorkspacePackage(fixture, "b", {
      name: "b",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      main: "./dist/index.js",
      files: ["dist"]
    });
    const result = await invoke(["check", "--workspaces", "--consumer-smoke", "--format", "json"], fixture);
    const report = JSON.parse(result.stdout) as {
      summary: { packages: number; errors: number };
      packages: Array<{
        relativePath: string;
        report: {
          findings: Array<{ id: string }>;
        };
      }>;
    };
    const packageA = report.packages.find((packageReport) => packageReport.relativePath === "packages/a");
    const packageB = report.packages.find((packageReport) => packageReport.relativePath === "packages/b");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(report.summary.packages).toBe(2);
    expect(report.summary.errors).toBe(1);
    expect(packageA?.report.findings.map((finding) => finding.id)).toContain("consumer.install-failed");
    expect(packageB?.report.findings).toEqual([]);
  });

  it("prints workspace SARIF output", async () => {
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
    await writeFile(join(fixture, "packages", "a", "README.md"), "# A\n");
    await writeFile(join(fixture, "packages", "a", "LICENSE"), "MIT\n");
    const result = await invoke(["check", "--workspaces", "--format", "sarif"], fixture);
    const report = JSON.parse(result.stdout) as {
      version: string;
      runs: Array<{ results: Array<{ ruleId: string; locations?: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }>;
    };

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(report.version).toBe("2.1.0");
    expect(report.runs[0]?.results[0]).toMatchObject({
      ruleId: "entrypoint.target-missing",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "packages/a/package.json"
            }
          }
        }
      ]
    });
  });

  it("prints workspace consumer smoke findings in SARIF with package-relative locations", async () => {
    const fixture = await createPackageFixture({
      workspaces: ["packages/*"]
    });
    await createWorkspacePackage(fixture, "a", {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      packageManager: "npm@10.8.2",
      main: "./dist/index.js",
      files: ["README.md", "LICENSE"]
    });
    const result = await invoke(["check", "--workspaces", "--consumer-smoke", "--format", "sarif"], fixture);
    const report = JSON.parse(result.stdout) as {
      version: string;
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string }> } };
        results: Array<{
          ruleId: string;
          locations?: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
          properties?: { jsonPath?: string };
        }>;
      }>;
    };
    const resultFinding = report.runs[0]?.results.find((item) => item.ruleId === "consumer.require-unresolved");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(report.version).toBe("2.1.0");
    expect(report.runs[0]?.tool.driver.rules.map((rule) => rule.id)).toContain("consumer.require-unresolved");
    expect(resultFinding).toMatchObject({
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "packages/a/package.json"
            }
          }
        }
      ],
      properties: {
        jsonPath: "$.main"
      }
    });
  });

  it("prints workspace range findings in SARIF without schema changes", async () => {
    const fixture = await createPnpmWorkspaceRangeFixture({
      dependencyName: "@scope/missing"
    });
    const result = await invoke(["check", "--workspaces", "--format", "sarif"], fixture);
    const report = JSON.parse(result.stdout) as {
      version: string;
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string }> } };
        results: Array<{
          ruleId: string;
          level: string;
          locations?: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
          properties?: { jsonPath?: string; suggestion?: string };
        }>;
      }>;
    };
    const resultFinding = report.runs[0]?.results.find((item) => item.ruleId === "dependencies.workspace-range");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(report.version).toBe("2.1.0");
    expect(report.runs[0]?.tool.driver.rules.map((rule) => rule.id)).toContain("dependencies.workspace-range");
    expect(resultFinding).toMatchObject({
      level: "error",
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: "packages/a/package.json"
            }
          }
        }
      ],
      properties: {
        jsonPath: "$.dependencies.\"@scope/missing\"",
        suggestion: "Add a matching workspace package or replace the workspace protocol range before publishing."
      }
    });
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

  it("runs init as a command shell", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["init", "--dry-run"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("pkg-guard planned 1 init change");
    expect(result.stdout).toContain("init.check-script");
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
    main: "./dist/index.js",
    files: ["dist"],
    ...overrides
  });
  await writeFile(join(root, "package-lock.json"), "{}\n");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "index.js"), "export {};\n");
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "LICENSE"), "MIT\n");

  return root;
}

async function createWorkspacePackage(root: string, relativeName: string, packageJson: Record<string, unknown>): Promise<void> {
  const packageRoot = join(root, "packages", relativeName);

  await writePackageJson(join(packageRoot, "package.json"), packageJson);
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(join(packageRoot, "dist", "index.js"), "export {};\n");
  await writeFile(join(packageRoot, "README.md"), `# ${relativeName}\n`);
  await writeFile(join(packageRoot, "LICENSE"), "MIT\n");
}

async function createPnpmWorkspaceRangeFixture(
  options: {
    dependencyName?: string;
    files?: Record<string, string>;
  } = {}
): Promise<string> {
  const dependencyName = options.dependencyName ?? "@scope/shared";
  const root = await createPackageFixture({
    packageManager: "pnpm@9.0.0",
    workspaces: ["packages/*"]
  });

  await writePackageJson(join(root, "packages", "a", "package.json"), {
    name: "@scope/a",
    version: "1.0.0",
    license: "MIT",
    packageManager: "pnpm@9.0.0",
    publishConfig: {
      access: "public"
    },
    files: ["dist"],
    dependencies: {
      [dependencyName]: "workspace:*"
    }
  });
  await writePackageJson(join(root, "packages", "shared", "package.json"), {
    name: "@scope/shared",
    version: "1.0.0",
    license: "MIT",
    packageManager: "pnpm@9.0.0",
    publishConfig: {
      access: "public"
    },
    files: ["dist"]
  });
  await writeFile(join(root, "packages", "a", "README.md"), "# A\n");
  await writeFile(join(root, "packages", "a", "LICENSE"), "MIT\n");
  await writeFile(join(root, "packages", "shared", "README.md"), "# Shared\n");
  await writeFile(join(root, "packages", "shared", "LICENSE"), "MIT\n");

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}

async function writePackageJson(filePath: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
