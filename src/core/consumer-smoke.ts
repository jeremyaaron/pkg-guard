import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ProjectContext } from "./context.js";
import type { Finding } from "./findings.js";

const execFileAsync = promisify(execFile);

export const defaultConsumerSmokeTimeoutMs = 30_000;

export interface ConsumerSmokeOptions {
  timeoutMs?: number;
  tempRoot?: string;
}

export async function runConsumerSmokeChecks(context: ProjectContext, options: ConsumerSmokeOptions = {}): Promise<Finding[]> {
  const timeoutMs = options.timeoutMs ?? defaultConsumerSmokeTimeoutMs;
  const tempRoot = await mkdtemp(path.join(options.tempRoot ?? tmpdir(), "pkg-guard-consumer-smoke-"));

  try {
    const packResult = await packPackage(context, tempRoot, timeoutMs);

    if (!packResult.ok) {
      return [packFailedFinding(packResult.message)];
    }

    const consumerRoot = path.join(tempRoot, "consumer");
    await mkdir(consumerRoot, { recursive: true });
    await writeFile(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`
    );

    const installResult = await installPackage(consumerRoot, packResult.tarballPath, timeoutMs);

    if (!installResult.ok) {
      return [installFailedFinding(installResult.message)];
    }

    return [];
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function packPackage(
  context: ProjectContext,
  destination: string,
  timeoutMs: number
): Promise<{ ok: true; tarballPath: string } | { ok: false; message: string }> {
  const result = await runNpm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    context.root,
    timeoutMs
  );

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const filename = getPackedFilename(result.stdout);

  if (!filename) {
    return { ok: false, message: "npm pack returned an unexpected JSON shape." };
  }

  return { ok: true, tarballPath: path.join(destination, filename) };
}

async function installPackage(
  consumerRoot: string,
  tarballPath: string,
  timeoutMs: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], consumerRoot, timeoutMs);

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return { ok: true };
}

async function runNpm(
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ ok: true; stdout: string } | { ok: false; message: string }> {
  try {
    const { stdout } = await execFileAsync("npm", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    });

    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, message: commandFailureMessage(error) };
  }
}

function getPackedFilename(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : null;

    if (isRecord(first) && typeof first.filename === "string" && first.filename.trim() !== "") {
      return first.filename;
    }
  } catch {
    return null;
  }

  return null;
}

function packFailedFinding(message: string): Finding {
  return {
    id: "consumer.pack-failed",
    severity: "error",
    title: "Consumer smoke package creation failed",
    message,
    suggestion: "Run the package build if needed, then run pkg-guard check --consumer-smoke again.",
    file: "package.json"
  };
}

function installFailedFinding(message: string): Finding {
  return {
    id: "consumer.install-failed",
    severity: "error",
    title: "Consumer smoke package install failed",
    message,
    suggestion:
      "Ensure the packed package can be installed by an npm registry consumer, including publishable dependency versions.",
    file: "package.json"
  };
}

function commandFailureMessage(error: unknown): string {
  if (!isRecord(error)) {
    return "npm command failed.";
  }

  if (error.killed === true || error.signal === "SIGTERM") {
    return "npm command timed out.";
  }

  if (typeof error.stderr === "string" && error.stderr.trim() !== "") {
    return firstMeaningfulLine(error.stderr);
  }

  if (typeof error.message === "string" && error.message.trim() !== "") {
    return error.message;
  }

  return "npm command failed.";
}

function firstMeaningfulLine(value: string): string {
  const line = value
    .split(/\r?\n/)
    .map((line) => normalizeNpmErrorLine(line))
    .find((line) => line !== "" && !line.startsWith("code ") && !line.startsWith("A complete log of this run"));

  return line ?? "npm command failed.";
}

function normalizeNpmErrorLine(value: string): string {
  return value.trim().replace(/^npm error\s+/i, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
