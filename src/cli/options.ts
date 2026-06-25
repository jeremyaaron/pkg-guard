export type CommandName = "check" | "fix" | "init" | "init-release";
export type OutputFormat = "human" | "json" | "sarif";

export interface ParsedOptions {
  command: CommandName;
  format: OutputFormat;
  json: boolean;
  dryRun: boolean;
  cwd: string;
  ignore: string[];
  strict: boolean;
  workspaces: boolean;
  workspace: string[];
  includePrivate: boolean;
  includeRoot: boolean;
}

export type ParseResult =
  | { ok: true; options: ParsedOptions }
  | { ok: false; help: string; message?: string };

const commands = new Set<string>(["check", "fix", "init", "init-release"]);
const outputFormats = new Set<string>(["human", "json", "sarif"]);

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
    format: "human",
    json: false,
    dryRun: false,
    cwd,
    ignore: [],
    strict: false,
    workspaces: false,
    workspace: [],
    includePrivate: false,
    includeRoot: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (arg === "--json") {
      options.format = "json";
      options.json = true;
    } else if (arg === "--format") {
      const value = rest[index + 1];

      if (!value) {
        return {
          ok: false,
          help: command,
          message: "--format requires one of human, json, or sarif"
        };
      }

      if (!outputFormats.has(value)) {
        return {
          ok: false,
          help: command,
          message: `Unsupported output format: ${value}`
        };
      }

      options.format = value as OutputFormat;
      options.json = options.format === "json";
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--workspaces") {
      options.workspaces = true;
    } else if (arg === "--workspace") {
      const value = rest[index + 1];

      if (!value) {
        return {
          ok: false,
          help: command,
          message: "--workspace requires a selector"
        };
      }

      options.workspace.push(value);
      index += 1;
    } else if (arg === "--include-private") {
      options.includePrivate = true;
    } else if (arg === "--include-root") {
      options.includeRoot = true;
    } else if (arg === "--ignore") {
      const value = rest[index + 1];

      if (!value) {
        return {
          ok: false,
          help: command,
          message: "--ignore requires a check ID"
        };
      }

      options.ignore.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
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

  if (options.command !== "fix" && options.command !== "init" && options.dryRun) {
    return {
      ok: false,
      help: options.command,
      message: `--dry-run is only supported by fix and init`
    };
  }

  if (options.command !== "check" && options.format === "sarif") {
    return {
      ok: false,
      help: options.command,
      message: "--format sarif is only supported by check"
    };
  }

  if (options.command === "init-release" && hasWorkspaceOption(options)) {
    return {
      ok: false,
      help: options.command,
      message: "Workspace options are not supported by init-release"
    };
  }

  if (!options.workspaces && options.workspace.length === 0 && (options.includePrivate || options.includeRoot)) {
    return {
      ok: false,
      help: options.command,
      message: "--include-private and --include-root require --workspaces or --workspace"
    };
  }

  if (options.workspaces && options.workspace.length > 0) {
    return {
      ok: false,
      help: options.command,
      message: "--workspaces and --workspace cannot be used together"
    };
  }

  return { ok: true, options };
}

function hasWorkspaceOption(options: ParsedOptions): boolean {
  return options.workspaces || options.workspace.length > 0 || options.includePrivate || options.includeRoot;
}
