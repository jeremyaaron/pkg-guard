import type { ProjectContext } from "./context.js";
import type { Finding } from "./findings.js";
import { entrypointChecks } from "../checks/entrypoints.js";
import { manifestChecks } from "../checks/manifest.js";
import { packChecks } from "../checks/pack.js";
import { typescriptChecks } from "../checks/typescript.js";

export interface Check {
  id: string;
  run(context: ProjectContext): Finding[];
}

const checks: Check[] = [...manifestChecks, ...entrypointChecks, ...packChecks, ...typescriptChecks];

export function runChecks(context: ProjectContext): Finding[] {
  return checks.flatMap((check) => check.run(context));
}
