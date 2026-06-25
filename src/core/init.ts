import { writeFile } from "node:fs/promises";

import type { ProjectContext } from "./context.js";

export interface InitPlan {
  id: string;
  description: string;
  operations: InitOperation[];
}

export interface InitOperation {
  kind: "json-set";
  file: "package.json";
  path: string;
  key: string;
  value: unknown;
}

export interface ApplyInitResult {
  changedFiles: string[];
}

export function planInit(context: ProjectContext, options: { checkScript: string }): InitPlan[] {
  const plans: InitPlan[] = [];
  const presetPlan = planPresetInit(context);

  if (presetPlan) {
    plans.push(presetPlan);
  }

  const scriptPlan = planCheckScriptInit(context, options.checkScript);

  if (scriptPlan) {
    plans.push(scriptPlan);
  }

  return plans;
}

export async function applyInitPlans(context: ProjectContext, plans: readonly InitPlan[]): Promise<ApplyInitResult> {
  const operations = plans.flatMap((plan) => plan.operations);

  if (operations.length === 0) {
    return { changedFiles: [] };
  }

  const updated = applyPackageJsonOperations(context.manifest.raw, operations);

  if (updated === context.manifest.raw) {
    return { changedFiles: [] };
  }

  await writeFile(context.manifest.path, updated, "utf8");

  return { changedFiles: ["package.json"] };
}

export function renderInitHuman(plans: readonly InitPlan[], dryRun: boolean, changedFiles: readonly string[] = []): string {
  if (plans.length === 0) {
    return "pkg-guard found no init changes\n";
  }

  const lines = [dryRun ? `pkg-guard planned ${formatPlanCount(plans.length)}` : `pkg-guard applied ${formatPlanCount(plans.length)}`, ""];

  for (const plan of plans) {
    lines.push(`${dryRun ? "plan" : "init"} ${plan.id}`);
    lines.push(`  ${plan.description}`);

    for (const operation of plan.operations) {
      lines.push(`  ${operation.path} = ${JSON.stringify(operation.value)}`);
    }

    lines.push("");
  }

  for (const changedFile of changedFiles) {
    lines.push(`changed ${changedFile}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderInitJson(plans: readonly InitPlan[], dryRun: boolean, changedFiles: readonly string[] = []): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      command: "init",
      dryRun,
      summary: {
        plans: plans.length,
        changedFiles: changedFiles.length
      },
      changedFiles,
      plans
    },
    null,
    2
  )}\n`;
}

function planPresetInit(context: ProjectContext): InitPlan | null {
  const preset = context.preset;

  if (preset.source !== "inferred" || preset.name === "generic" || hasConfiguredPreset(context.manifest.data.pkgGuard)) {
    return null;
  }

  const pkgGuard = isRecord(context.manifest.data.pkgGuard) ? { ...context.manifest.data.pkgGuard, preset: preset.name } : { preset: preset.name };

  return {
    id: "init.preset",
    description: `Set pkgGuard.preset to "${preset.name}".`,
    operations: [
      {
        kind: "json-set",
        file: "package.json",
        path: "$.pkgGuard.preset",
        key: "pkgGuard",
        value: pkgGuard
      }
    ]
  };
}

function planCheckScriptInit(context: ProjectContext, checkScript: string): InitPlan | null {
  const scripts = readScripts(context.manifest.data.scripts);

  if (Object.values(scripts).some((script) => /\bpkg-guard\s+check\b/.test(script))) {
    return null;
  }

  if (Object.hasOwn(scripts, "pkg:check")) {
    return null;
  }

  return {
    id: "init.check-script",
    description: `Add scripts.pkg:check "${checkScript}".`,
    operations: [
      {
        kind: "json-set",
        file: "package.json",
        path: "$.scripts.pkg:check",
        key: "scripts",
        value: {
          ...scripts,
          "pkg:check": checkScript
        }
      }
    ]
  };
}

function hasConfiguredPreset(value: unknown): boolean {
  return isRecord(value) && typeof value.preset === "string" && value.preset.trim() !== "";
}

function readScripts(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function applyPackageJsonOperations(raw: string, operations: readonly InitOperation[]): string {
  const manifest = JSON.parse(raw) as Record<string, unknown>;

  for (const operation of operations) {
    manifest[operation.key] = operation.value;
  }

  return `${JSON.stringify(manifest, null, detectIndent(raw))}${raw.endsWith("\n") ? "\n" : ""}`;
}

function detectIndent(raw: string): number {
  const match = /\n( +)"/.exec(raw);
  return match?.[1]?.length ?? 2;
}

function formatPlanCount(count: number): string {
  return count === 1 ? "1 init change" : `${count} init changes`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
