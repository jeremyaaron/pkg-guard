import { describe, expect, it } from "vitest";

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
    const result = await invoke(["check"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no issues\n");
    expect(result.stderr).toBe("");
  });

  it("prints check JSON with schema metadata", async () => {
    const result = await invoke(["check", "--json"]);
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
    const result = await invoke(["fix", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no issues\n");
  });

  it("runs init-release as a command shell", async () => {
    const result = await invoke(["init-release"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("pkg-guard found no issues\n");
  });

  it("rejects unsupported command options", async () => {
    const result = await invoke(["check", "--dry-run"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--dry-run is only supported by fix");
  });
});

async function invoke(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = "";
  let stderr = "";

  const io: CliIO = {
    cwd: "/repo",
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
