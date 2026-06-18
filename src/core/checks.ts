import type { ProjectContext } from "./context.js";
import type { Finding } from "./findings.js";
import { manifestChecks } from "../checks/manifest.js";

export interface Check {
  id: string;
  run(context: ProjectContext): Finding[];
}

const checks: Check[] = [...manifestChecks];

export function runChecks(context: ProjectContext): Finding[] {
  return checks.flatMap((check) => check.run(context));
}
