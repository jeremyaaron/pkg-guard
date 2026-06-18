import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCli, type CliIO } from "../src/cli/run.js";

describe("runCli", () => {
  it("prints global help", async () => {
    const result = await invoke(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pkg-guard <command>");
    expect(result.stdout).toContain("check");
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

  it("runs fix as a command shell", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["fix", "--dry-run"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no issues\n");
  });

  it("runs init-release as a command shell", async () => {
    const fixture = await createPackageFixture();
    const result = await invoke(["init-release"], fixture);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no issues\n");
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
    expect(result.stderr).toContain("--dry-run is only supported by fix");
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

async function createPackageFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-package-"));

  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      null,
      2
    )}\n`
  );
  await writeFile(join(root, "package-lock.json"), "{}\n");

  return root;
}
