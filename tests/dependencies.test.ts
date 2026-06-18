import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runChecks } from "../src/core/checks.js";
import { discoverProject } from "../src/core/discovery.js";
import { applyFindingPolicy } from "../src/core/policy.js";

describe("dependency checks", () => {
  it("errors on unresolved workspace protocol ranges", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        dependencies: {
          "@scope/shared": "workspace:*"
        }
      })
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "dependencies.workspace-range");

    expect(finding?.severity).toBe("error");
  });

  it("warns when a known runtime package is only in devDependencies", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        devDependencies: {
          yaml: "^2.9.0"
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("dependencies.runtime-in-dev");
  });

  it("does not warn when a known runtime package is also a runtime dependency", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        dependencies: {
          yaml: "^2.9.0"
        },
        devDependencies: {
          yaml: "^2.9.0"
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("dependencies.runtime-in-dev");
  });

  it("warns when optional peer metadata is missing", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        peerDependencies: {
          react: "^19.0.0"
        },
        optionalDependencies: {
          react: "^19.0.0"
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("dependencies.optional-peer-metadata-missing");
  });

  it("does not warn when optional peer metadata is present", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        peerDependencies: {
          react: "^19.0.0"
        },
        optionalDependencies: {
          react: "^19.0.0"
        },
        peerDependenciesMeta: {
          react: {
            optional: true
          }
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("dependencies.optional-peer-metadata-missing");
  });

  it("warns on broad dependency ranges for libraries", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        dependencies: {
          leftpad: "*"
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("dependencies.range-too-broad");
  });

  it("does not warn on broad dependency ranges for bin-only packages", async () => {
    const root = await createFixture({
      packageJson: {
        ...basePackage({
          dependencies: {
            leftpad: "*"
          },
          bin: {
            fixture: "./dist/cli.js"
          }
        }),
        main: undefined,
        types: undefined
      },
      files: {
        "dist/cli.js": "#!/usr/bin/env node\nconsole.log('hello');\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("dependencies.range-too-broad");
  });

  it("allows heuristic dependency warnings to be ignored", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        devDependencies: {
          yaml: "^2.9.0"
        },
        pkgGuard: {
          ignore: ["dependencies.runtime-in-dev"]
        }
      })
    });
    const discovery = await discoverProject(root);

    if (!discovery.context) {
      throw new Error("Expected fixture context");
    }

    const findings = applyFindingPolicy([...discovery.findings, ...runChecks(discovery.context)], discovery.context.config, {
      ignore: [],
      strict: false
    });

    expect(findings.map((finding) => finding.id)).not.toContain("dependencies.runtime-in-dev");
  });
});

function basePackage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "dependency-fixture",
    version: "1.0.0",
    license: "MIT",
    packageManager: "npm@10.8.2",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
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
  files?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-dependencies-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(stripUndefined(options.packageJson), null, 2)}\n`);
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "LICENSE"), "MIT\n");

  const files = {
    "dist/index.js": "export {};\n",
    "dist/index.d.ts": "export {};\n",
    ...(options.files ?? {})
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}
