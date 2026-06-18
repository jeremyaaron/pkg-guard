#!/usr/bin/env node

import { getHelpText } from "./help.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  process.stdout.write(getHelpText());
  process.exitCode = 0;
} else {
  process.stderr.write(`Unknown argument: ${args[0]}\n\n`);
  process.stderr.write(getHelpText());
  process.exitCode = 2;
}
