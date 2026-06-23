import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runChecks } from "../src/core/checks.js";
import { discoverProject } from "../src/core/discovery.js";

describe("entrypoint checks", () => {
  it.each([
    ["main", { main: "./dist/missing.js" }],
    ["types", { types: "./dist/missing.d.ts" }],
    ["exports", { exports: "./dist/missing.js" }],
    ["bin", { bin: { fixture: "./dist/missing.js" } }]
  ])("reports missing %s targets", async (_name, entryFields) => {
    const root = await createFixture({
      packageJson: basePackage(entryFields)
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("entrypoint.target-missing");
  });

  it("reports targets that escape the package root", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "../outside.js",
        exports: {
          ".": "../outside.js"
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.filter((finding) => finding.id === "entrypoint.target-escapes-package")).toHaveLength(2);
  });

  it("reports bin targets without a shebang", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        bin: {
          fixture: "./dist/cli.js"
        }
      }),
      files: {
        "dist/cli.js": "console.log('hello');\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("entrypoint.bin-shebang-missing");
  });

  it("reports a missing bin target for the cli preset", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        pkgGuard: {
          preset: "cli"
        }
      })
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "entrypoint.target-missing" && item.path === "$.bin");

    expect(finding).toMatchObject({
      severity: "error",
      title: "CLI package is missing a bin entry point"
    });
  });

  it("warns on unsupported export shapes without crashing", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        exports: {
          ".": ["./dist/index.js"],
          "./feature/**": "./dist/feature/**/*.js"
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.filter((finding) => finding.id === "entrypoint.unsupported-target")).toHaveLength(2);
  });

  it("passes when an export pattern matches built files", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        exports: {
          "./feature/*": "./dist/feature/*.js"
        }
      }),
      files: {
        "dist/feature/alpha.js": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("entrypoint.target-missing");
    expect(findings.map((finding) => finding.id)).not.toContain("entrypoint.unsupported-target");
  });

  it("reports export patterns that do not match built files", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        exports: {
          "./feature/*": "./dist/feature/*.js"
        }
      }),
      files: {
        "dist/feature/alpha.d.ts": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "entrypoint.target-missing" && item.path === '$.exports."./feature/*"');

    expect(finding).toMatchObject({
      severity: "error",
      title: "Entry point pattern does not match files"
    });
  });

  it("reports export patterns that escape the package root", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        exports: {
          "./feature/*": "../dist/feature/*.js"
        }
      })
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "entrypoint.target-escapes-package" && item.path === '$.exports."./feature/*"');

    expect(finding).toMatchObject({
      severity: "error"
    });
  });

  it("passes a valid simple ESM TypeScript library fixture", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js"
          }
        },
        bin: {
          fixture: "./dist/cli.js"
        }
      }),
      files: {
        "dist/index.js": "export const value = 1;\n",
        "dist/index.d.ts": "export declare const value: number;\n",
        "dist/cli.js": "#!/usr/bin/env node\nconsole.log('hello');\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings).toEqual([]);
  });
});

function basePackage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "entrypoint-fixture",
    version: "1.0.0",
    license: "MIT",
    packageManager: "npm@10.8.2",
    files: ["dist"],
    ...overrides
  };
}

async function getCheckFindings(root: string) {
  const discovery = await discoverProject(root);

  if (!discovery.context) {
    throw new Error("Expected fixture context");
  }

  return [...discovery.findings, ...runChecks(discovery.context)];
}

async function createFixture(options: {
  packageJson: Record<string, unknown>;
  files?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-entrypoints-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}
