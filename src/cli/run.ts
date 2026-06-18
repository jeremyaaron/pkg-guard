import { createReport, getExitCode, type Finding } from "../core/findings.js";
import { renderHumanReport } from "../reporters/human.js";
import { renderJsonReport } from "../reporters/json.js";
import { getCommandHelpText, getHelpText } from "./help.js";
import { parseArgs, type ParsedOptions } from "./options.js";

export interface CliIO {
  cwd: string;
  stdout: {
    write(value: string): void;
  };
  stderr: {
    write(value: string): void;
  };
}

export async function runCli(args: string[], io: CliIO): Promise<number> {
  try {
    const parsed = parseArgs(args, io.cwd);

    if (!parsed.ok) {
      if (parsed.message) {
        io.stderr.write(`${parsed.message}\n\n`);
        io.stderr.write(parsed.help === "global" ? getHelpText() : getCommandHelpText(parsed.help));
      } else {
        io.stdout.write(parsed.help === "global" ? getHelpText() : getCommandHelpText(parsed.help));
      }

      return parsed.message ? 2 : 0;
    }

    return runCommand(parsed.options, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected internal failure";
    io.stderr.write(`pkg-guard failed: ${message}\n`);
    return 3;
  }
}

function runCommand(options: ParsedOptions, io: CliIO): number {
  const findings = getCommandFindings();
  const report = createReport(options.command, options.cwd, findings);
  const output = options.json ? renderJsonReport(report) : renderHumanReport(report);

  io.stdout.write(output);
  return getExitCode(findings);
}

function getCommandFindings(): Finding[] {
  return [];
}
