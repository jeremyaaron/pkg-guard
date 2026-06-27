import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { PackageManifest, ProjectContext } from "./context.js";
import type { Finding } from "./findings.js";
import { collectPackageTargets, type PackageTarget } from "./package-targets.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

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

    return [
      ...(await runRuntimeResolutionProbes(context, consumerRoot, timeoutMs)),
      ...(await runBinSmokeChecks(context, consumerRoot)),
      ...(await runTypeResolutionProbe(context, consumerRoot, timeoutMs))
    ];
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

async function runRuntimeResolutionProbes(context: ProjectContext, consumerRoot: string, timeoutMs: number): Promise<Finding[]> {
  const probes = getRuntimeResolutionProbes(context);
  const findings: Finding[] = [];

  for (const probe of probes) {
    const result = await runNode(probe.kind, probe.specifier, consumerRoot, timeoutMs);

    if (!result.ok) {
      findings.push(runtimeUnresolvedFinding(probe, result.message));
    }
  }

  return findings;
}

async function runBinSmokeChecks(context: ProjectContext, consumerRoot: string): Promise<Finding[]> {
  const packageName = getPackageName(context);

  if (!packageName) {
    return [];
  }

  const installedManifest = await readInstalledManifest(consumerRoot, packageName);

  if (!installedManifest) {
    return [];
  }

  const packageRoot = getInstalledPackageRoot(consumerRoot, packageName);
  const findings: Finding[] = [];

  for (const entry of getBinEntries(installedManifest)) {
    const binPath = path.join(packageRoot, entry.target);
    const content = await readFile(binPath, "utf8").catch(() => null);

    if (content === null) {
      findings.push(binUnresolvedFinding(entry, `${entry.command} points to ${entry.target}, but that file is not installed.`));
      continue;
    }

    if (!content.startsWith("#!")) {
      findings.push(binUnresolvedFinding(entry, `${entry.command} points to ${entry.target}, but the installed file has no shebang.`));
    }
  }

  return findings;
}

async function runTypeResolutionProbe(context: ProjectContext, consumerRoot: string, timeoutMs: number): Promise<Finding[]> {
  const packageName = getPackageName(context);
  const typePath = getTypeProbeJsonPath(context.manifest.data);

  if (!packageName || !typePath) {
    return [];
  }

  const tscPath = resolveTypeScriptCompiler();

  if (!tscPath) {
    return [];
  }

  await writeFile(
    path.join(consumerRoot, "index.ts"),
    `import type * as pkg from ${JSON.stringify(packageName)};\ntype PackageNamespace = typeof pkg;\nexport type { PackageNamespace };\n`
  );

  try {
    await execFileAsync(
      process.execPath,
      [
        tscPath,
        "--noEmit",
        "--moduleResolution",
        "nodenext",
        "--module",
        "nodenext",
        "--target",
        "es2022",
        "--strict",
        "--skipLibCheck",
        "index.ts"
      ],
      {
        cwd: consumerRoot,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024
      }
    );

    return [];
  } catch (error) {
    return [typesUnresolvedFinding(typePath, commandFailureMessage(error))];
  }
}

interface RuntimeResolutionProbe {
  kind: "import" | "require";
  specifier: string;
  jsonPath: string;
}

function getRuntimeResolutionProbes(context: ProjectContext): RuntimeResolutionProbe[] {
  const packageName = getPackageName(context);

  if (!packageName) {
    return [];
  }

  if (context.manifest.data.exports === undefined) {
    return [
      {
        kind: isModulePackage(context) ? "import" : "require",
        specifier: packageName,
        jsonPath: getBarePackageJsonPath(context)
      }
    ];
  }

  const targets = collectPackageTargets(context.manifest.data).targets;
  const probes: RuntimeResolutionProbe[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    if (target.source !== "exports" || target.kind !== "file" || isPatternExportTarget(target)) {
      continue;
    }

    for (const kind of getProbeKinds(target, context)) {
      const specifier = toPackageSpecifier(packageName, target.exportSubpath ?? ".");
      const key = `${kind}:${specifier}`;

      if (!seen.has(key)) {
        seen.add(key);
        probes.push({ kind, specifier, jsonPath: target.jsonPath });
      }
    }
  }

  return probes;
}

interface BinEntry {
  command: string;
  target: string;
  jsonPath: string;
}

function getBinEntries(manifest: PackageManifest): BinEntry[] {
  if (typeof manifest.bin === "string") {
    return [{ command: getBinCommandFromName(manifest.name), target: manifest.bin, jsonPath: "$.bin" }];
  }

  if (!isRecord(manifest.bin)) {
    return [];
  }

  return Object.entries(manifest.bin)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([command, target]) => ({
      command,
      target,
      jsonPath: `$.bin.${formatJsonPathKey(command)}`
    }));
}

function getBinCommandFromName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return "<package>";
  }

  return value.split("/").at(-1) ?? value;
}

async function readInstalledManifest(consumerRoot: string, packageName: string): Promise<PackageManifest | null> {
  const manifestPath = path.join(getInstalledPackageRoot(consumerRoot, packageName), "package.json");
  const raw = await readFile(manifestPath, "utf8").catch(() => null);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getInstalledPackageRoot(consumerRoot: string, packageName: string): string {
  return path.join(consumerRoot, "node_modules", ...packageName.split("/"));
}

function getTypeProbeJsonPath(manifest: PackageManifest): string | null {
  if (typeof manifest.types === "string") {
    return "$.types";
  }

  if (typeof manifest.typings === "string") {
    return "$.typings";
  }

  return (
    collectPackageTargets(manifest).targets.find(
      (target) => target.source === "exports" && target.kind === "file" && target.conditions.includes("types")
    )?.jsonPath ?? null
  );
}

function resolveTypeScriptCompiler(): string | null {
  try {
    return require.resolve("typescript/bin/tsc");
  } catch {
    return null;
  }
}

function getPackageName(context: ProjectContext): string | null {
  return typeof context.manifest.data.name === "string" && context.manifest.data.name.trim() !== ""
    ? context.manifest.data.name
    : null;
}

function getBarePackageJsonPath(context: ProjectContext): string {
  return typeof context.manifest.data.main === "string" ? "$.main" : "$.name";
}

function getProbeKinds(target: PackageTarget, context: ProjectContext): Array<"import" | "require"> {
  if (target.kind !== "file") {
    return [];
  }

  const conditions = new Set(target.conditions);
  const kinds: Array<"import" | "require"> = [];

  if (conditions.has("require")) {
    kinds.push("require");
  }

  if (conditions.has("import") || conditions.has("default")) {
    kinds.push("import");
  }

  if (kinds.length === 0 && !conditions.has("types")) {
    kinds.push(isModulePackage(context) ? "import" : "require");
  }

  return kinds;
}

function isPatternExportTarget(target: PackageTarget): boolean {
  return target.source === "exports" && (target.kind === "pattern" || target.exportSubpath?.includes("*") === true);
}

function toPackageSpecifier(packageName: string, exportSubpath: string): string {
  if (exportSubpath === ".") {
    return packageName;
  }

  return `${packageName}/${exportSubpath.replace(/^\.\//, "")}`;
}

function isModulePackage(context: ProjectContext): boolean {
  return context.manifest.data.type === "module";
}

async function runNode(
  kind: "import" | "require",
  specifier: string,
  cwd: string,
  timeoutMs: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  const args =
    kind === "import"
      ? [
          "--input-type=module",
          "-e",
          "import { access } from 'node:fs/promises'; const resolved = await import.meta.resolve(process.argv[1]); if (resolved.startsWith('file:')) await access(new URL(resolved));",
          specifier
        ]
      : ["-e", "require.resolve(process.argv[1])", specifier];

  try {
    await execFileAsync("node", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    });

    return { ok: true };
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

function runtimeUnresolvedFinding(probe: RuntimeResolutionProbe, message: string): Finding {
  const isImport = probe.kind === "import";

  return {
    id: isImport ? "consumer.import-unresolved" : "consumer.require-unresolved",
    severity: "error",
    title: isImport ? "Consumer import resolution failed" : "Consumer require resolution failed",
    message: `${isImport ? "import.meta.resolve" : "require.resolve"}(${JSON.stringify(probe.specifier)}) failed: ${message}`,
    suggestion: "Update package exports or files so the packed package can be resolved from an installed consumer project.",
    file: "package.json",
    path: probe.jsonPath
  };
}

function binUnresolvedFinding(entry: BinEntry, message: string): Finding {
  return {
    id: "consumer.bin-unresolved",
    severity: "error",
    title: "Consumer bin target is not installed correctly",
    message,
    suggestion: "Update package bin metadata or files so installed CLI entry points resolve to executable scripts.",
    file: "package.json",
    path: entry.jsonPath
  };
}

function typesUnresolvedFinding(jsonPath: string, message: string): Finding {
  return {
    id: "consumer.types-unresolved",
    severity: "error",
    title: "Consumer type resolution failed",
    message: `TypeScript could not resolve this package from an installed consumer project: ${message}`,
    suggestion: "Update package type metadata, exports, or files so TypeScript consumers can resolve declarations.",
    file: "package.json",
    path: jsonPath
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

function formatJsonPathKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
