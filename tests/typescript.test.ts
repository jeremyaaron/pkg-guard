import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runChecks } from "../src/core/checks.js";
import { discoverProject } from "../src/core/discovery.js";

describe("TypeScript checks", () => {
  it("warns when a TypeScript library does not enable declaration output", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js"
      }),
      tsconfig: {
        compilerOptions: {
          outDir: "dist"
        }
      },
      files: {
        "dist/index.js": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("typescript.declaration-missing");
  });

  it("warns when types metadata points to source TypeScript", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js",
        types: "./src/index.ts",
        files: ["dist", "src", "README.md", "LICENSE"]
      }),
      tsconfig: {
        compilerOptions: {
          declaration: true,
          outDir: "dist"
        }
      },
      files: {
        "dist/index.js": "export {};\n",
        "src/index.ts": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("typescript.types-source-file");
  });

  it.each([
    ["types", "./dist/index.d.ts"],
    ["typings", "./dist/index.d.cts"],
    ["types", "./dist/index.d.mts"]
  ])("does not warn when %s metadata points to generated declarations", async (field, declarationTarget) => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js",
        [field]: declarationTarget
      }),
      tsconfig: {
        compilerOptions: {
          declaration: true,
          outDir: "dist"
        }
      },
      files: {
        "dist/index.js": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("typescript.types-source-file");
  });

  it.each([
    ["./src/index.ts"],
    ["./src/index.tsx"],
    ["./src/index.mts"],
    ["./src/index.cts"]
  ])("warns when types metadata points to implementation source %s", async (typesTarget) => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js",
        types: typesTarget,
        files: ["dist", "src", "README.md", "LICENSE"]
      }),
      tsconfig: {
        compilerOptions: {
          declaration: true,
          outDir: "dist"
        }
      },
      files: {
        "dist/index.js": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("typescript.types-source-file");
  });

  it("warns when declaration maps are enabled", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js"
      }),
      tsconfig: {
        compilerOptions: {
          declaration: true,
          declarationMap: true,
          outDir: "dist"
        }
      },
      files: {
        "dist/index.js": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("typescript.declaration-map-enabled");
  });

  it("warns when runtime entrypoints do not match outDir", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js"
      }),
      tsconfig: {
        compilerOptions: {
          declaration: true,
          outDir: "lib"
        }
      },
      files: {
        "dist/index.js": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("typescript.outdir-mismatch");
  });

  it("warns when tsconfig extends another config", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js"
      }),
      tsconfig: {
        extends: "./tsconfig.base.json",
        compilerOptions: {
          declaration: true,
          outDir: "dist"
        }
      },
      files: {
        "dist/index.js": "export {};\n",
        "tsconfig.base.json": "{}\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("typescript.extends-unresolved");
  });

  it("does not require declarations for a bin-only TypeScript package", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        bin: {
          fixture: "./dist/cli.js"
        }
      }),
      tsconfig: {
        compilerOptions: {
          outDir: "dist"
        }
      },
      files: {
        "dist/cli.js": "#!/usr/bin/env node\nconsole.log('hello');\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("typescript.declaration-missing");
  });

  it("does not apply library declaration checks to the cli preset", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js",
        bin: {
          fixture: "./dist/cli.js"
        },
        pkgGuard: {
          preset: "cli"
        }
      }),
      tsconfig: {
        compilerOptions: {
          declarationMap: true,
          outDir: "lib"
        }
      },
      files: {
        "dist/index.js": "export {};\n",
        "dist/cli.js": "#!/usr/bin/env node\nconsole.log('hello');\n"
      }
    });

    const findings = await getCheckFindings(root);
    const ids = findings.map((finding) => finding.id);

    expect(ids).not.toContain("typescript.declaration-missing");
    expect(ids).not.toContain("typescript.declaration-map-enabled");
    expect(ids).not.toContain("typescript.outdir-mismatch");
  });
});

function basePackage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "typescript-fixture",
    version: "1.0.0",
    license: "MIT",
    packageManager: "npm@10.8.2",
    files: ["dist", "README.md", "LICENSE"],
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
  tsconfig: Record<string, unknown>;
  files?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-typescript-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify(options.tsconfig, null, 2)}\n`);
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "LICENSE"), "MIT\n");

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}
