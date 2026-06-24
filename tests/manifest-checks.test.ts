import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { discoverProject } from "../src/core/discovery.js";
import { runChecks } from "../src/core/checks.js";
import { applyFindingPolicy } from "../src/core/policy.js";

const execFileAsync = promisify(execFile);

describe("manifest checks", () => {
  it("reports missing manifest metadata with stable IDs", async () => {
    const root = await createFixture({
      packageJson: {}
    });

    const findings = await getCheckFindings(root);
    const ids = findings.map((finding) => finding.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "manifest.name-missing",
        "manifest.version-missing",
        "manifest.package-manager-missing",
        "manifest.license-missing",
        "manifest.files-missing"
      ])
    );
  });

  it("reports invalid name, version, and license", async () => {
    const root = await createFixture({
      packageJson: {
        name: "Bad Name",
        version: "nope",
        license: "not-a-license",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });

    const findings = await getCheckFindings(root);
    const ids = findings.map((finding) => finding.id);

    expect(ids).toContain("manifest.name-invalid");
    expect(ids).toContain("manifest.version-invalid");
    expect(ids).toContain("manifest.license-invalid");
  });

  it("reports package manager conflicts", async () => {
    const root = await createFixture({
      packageJson: {
        name: "conflict-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "pnpm@9.0.0",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("manifest.package-manager-conflict");
  });

  it("reports missing repository when a Git remote is available", async () => {
    const root = await createFixture({
      packageJson: {
        name: "repo-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });
    await execFileAsync("git", ["-C", root, "init"]);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", "https://github.com/example/repo-fixture.git"]);

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("manifest.repository-missing");
  });

  it("reports private packages with publish-oriented metadata", async () => {
    const root = await createFixture({
      packageJson: {
        name: "private-fixture",
        version: "1.0.0",
        private: true,
        license: "MIT",
        packageManager: "npm@10.8.2"
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).toContain("manifest.private-publishable");
  });

  it("reports missing types metadata when dist declarations are present", async () => {
    const root = await createFixture({
      packageJson: {
        name: "types-missing-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.d.ts": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "manifest.types-missing");

    expect(finding).toMatchObject({
      severity: "warning",
      file: "package.json",
      path: "$.types",
      fixable: true
    });
  });

  it("reports missing publish access for scoped packages", async () => {
    const root = await createFixture({
      packageJson: {
        name: "@scope/publish-access-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n"
      }
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "manifest.publish-access-missing");

    expect(finding).toMatchObject({
      severity: "warning",
      file: "package.json",
      path: "$.publishConfig.access",
      fixable: true
    });
  });

  it("reports missing Node engines when TypeScript target implies a runtime floor", async () => {
    const root = await createFixture({
      packageJson: {
        name: "engines-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      },
      files: {
        "package-lock.json": "{}\n",
        "tsconfig.json": `${JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2)}\n`
      }
    });

    const findings = await getCheckFindings(root);
    const finding = findings.find((item) => item.id === "manifest.engines-node-missing");

    expect(finding).toMatchObject({
      severity: "warning",
      file: "package.json",
      path: "$.engines.node",
      fixable: true
    });
  });

  it("does not report missing types metadata when types already exists", async () => {
    const root = await createFixture({
      packageJson: {
        name: "types-existing-fixture",
        version: "1.0.0",
        license: "MIT",
        packageManager: "npm@10.8.2",
        files: ["dist"],
        types: "./dist/index.d.ts"
      },
      files: {
        "package-lock.json": "{}\n",
        "dist/index.d.ts": "export {};\n"
      }
    });

    const findings = await getCheckFindings(root);

    expect(findings.map((finding) => finding.id)).not.toContain("manifest.types-missing");
  });

  it("applies configured ignores and strict warnings", async () => {
    const root = await createFixture({
      packageJson: {
        name: "policy-fixture",
        version: "1.0.0",
        license: "MIT",
        pkgGuard: {
          ignore: ["manifest.files-missing"],
          strict: ["manifest.package-manager-missing"]
        }
      }
    });
    const discovery = await discoverProject(root);

    if (!discovery.context) {
      throw new Error("Expected fixture context");
    }

    const findings = applyFindingPolicy([...discovery.findings, ...runChecks(discovery.context)], discovery.context.config, {
      ignore: [],
      strict: true
    });

    expect(findings.map((finding) => finding.id)).not.toContain("manifest.files-missing");
    expect(
      applyFindingPolicy(
        [
          {
            id: "manifest.package-manager-missing",
            severity: "warning",
            title: "Package manager is missing",
            message: "package.json does not define packageManager."
          }
        ],
        discovery.context.config,
        { ignore: [], strict: true }
      )[0]?.severity
    ).toBe("error");
  });
});

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
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-manifest-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}
