export type CommandName = "check" | "fix" | "init-release";

export interface ParsedOptions {
  command: CommandName;
  json: boolean;
  dryRun: boolean;
  cwd: string;
}

export type ParseResult =
  | { ok: true; options: ParsedOptions }
  | { ok: false; help: string; message?: string };

const commands = new Set<string>(["check", "fix", "init-release"]);

export function parseArgs(args: string[], cwd: string): ParseResult {
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { ok: false, help: "global" };
  }

  if (!commands.has(command)) {
    return {
      ok: false,
      help: "global",
      message: `Unknown command: ${command}`
    };
  }

  const options: ParsedOptions = {
    command: command as CommandName,
    json: false,
    dryRun: false,
    cwd
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--cwd") {
      const value = rest[index + 1];

      if (!value) {
        return {
          ok: false,
          help: command,
          message: "--cwd requires a path"
        };
      }

      options.cwd = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      return { ok: false, help: command };
    } else {
      return {
        ok: false,
        help: command,
        message: `Unknown option for ${command}: ${arg}`
      };
    }
  }

  if (options.command !== "fix" && options.dryRun) {
    return {
      ok: false,
      help: options.command,
      message: `--dry-run is only supported by fix`
    };
  }

  return { ok: true, options };
}
