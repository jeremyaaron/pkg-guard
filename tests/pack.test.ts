import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runChecks } from "../src/core/checks.js";
import { discoverProject } from "../src/core/discovery.js";

describe("pack checks", () => {
  it("reports sensitive files included in npm pack output", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        files: ["dist", ".env"]
      }),
      files: {
        "dist/index.js": "export {};\n",
        ".env": "SECRET=value\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("pack.sensitive-file-included");
  });

  it("warns when README and license files are missing from npm pack output", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        files: ["dist"]
      }),
      files: {
        "dist/index.js": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);
    const ids = findings.map((finding) => finding.id);

    expect(ids).toContain("pack.readme-missing");
    expect(ids).toContain("pack.license-file-missing");
  });

  it("reports declared entrypoints missing from npm pack output", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js",
        files: ["README.md", "LICENSE"]
      }),
      files: {
        "dist/index.js": "export {};\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("pack.entrypoint-missing");
  });

  it("passes when export patterns match packed files", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        exports: {
          "./feature/*": "./dist/feature/*.js"
        },
        files: ["dist", "README.md", "LICENSE"]
      }),
      files: {
        "dist/feature/alpha.js": "export {};\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("pack.entrypoint-missing");
  });

  it("reports export patterns missing from npm pack output", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        exports: {
          "./feature/*": "./dist/feature/*.js"
        },
        files: ["README.md", "LICENSE"]
      }),
      files: {
        "dist/feature/alpha.js": "export {};\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n"
      }
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "pack.entrypoint-missing" && item.path === '$.exports."./feature/*"');

    expect(finding).toMatchObject({
      severity: "error",
      title: "Declared entry point pattern is missing from the package"
    });
  });

  it("warns on complex export patterns without crashing", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        exports: {
          "./feature/**": "./dist/feature/**/*.js"
        },
        files: ["dist", "README.md", "LICENSE"]
      }),
      files: {
        "dist/feature/alpha.js": "export {};\n",
        "README.md": "# Fixture\n",
        "LICENSE": "MIT\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("pack.unsupported-target");
  });

  it("passes when declared entrypoints and required docs are packed", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        files: ["dist", "README.md", "LICENSE"]
      }),
      files: {
        "dist/index.js": "export {};\n",
        "dist/index.d.ts": "export {};\n",
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
    name: "pack-fixture",
    version: "1.0.0",
    license: "MIT",
    packageManager: "npm@10.8.2",
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
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-pack-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}
