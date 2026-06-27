import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzePackage, analyzeWorkspacePackage } from "../src/core/analysis.js";

describe("analyzePackage", () => {
  it("returns structured findings without rendering a report", async () => {
    const root = await createFixture({
      packageJson: {
        name: "analysis-fixture",
        version: "1.0.0",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      }
    });

    const result = await analyzePackage({
      command: "check",
      cwd: root,
      ignore: [],
      strict: false
    });

    expect(result.root).toBe(root);
    expect(result.context?.root).toBe(root);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manifest.license-missing",
          severity: "warning",
          file: "package.json"
        })
      ])
    );
  });

  it("applies package and CLI finding policy", async () => {
    const root = await createFixture({
      packageJson: {
        name: "analysis-ignore-fixture",
        version: "1.0.0",
        packageManager: "npm@10.8.2",
        files: ["dist"],
        pkgGuard: {
          ignore: ["manifest.repository-missing"]
        }
      }
    });

    const result = await analyzePackage({
      command: "check",
      cwd: root,
      ignore: ["manifest.license-missing"],
      strict: false
    });
    const ids = result.findings.map((finding) => finding.id);

    expect(ids).not.toContain("manifest.repository-missing");
    expect(ids).not.toContain("manifest.license-missing");
  });

  it("returns workspace package findings without rendering a report", async () => {
    const root = await createFixture({
      packageJson: {
        name: "analysis-workspace-fixture",
        version: "1.0.0",
        packageManager: "npm@10.8.2",
        files: ["dist"]
      }
    });
    const target = {
      root,
      relativePath: "packages/fixture",
      name: "analysis-workspace-fixture",
      private: false,
      manifestPath: join(root, "package.json"),
      source: "workspace" as const
    };

    const result = await analyzeWorkspacePackage({
      command: "check",
      cwd: root,
      ignore: [],
      strict: false,
      target
    });

    expect(result.target).toBe(target);
    expect("report" in result).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manifest.license-missing",
          severity: "warning"
        })
      ])
    );
  });

  it("returns discovery findings when no package context exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "pkg-guard-analysis-empty-"));

    const result = await analyzePackage({
      command: "check",
      cwd: root,
      ignore: [],
      strict: false
    });

    expect(result.context).toBeNull();
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "project.package-json-missing",
        severity: "error"
      })
    ]);
  });
});

async function createFixture(options: { packageJson: Record<string, unknown> }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-analysis-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "index.js"), "export {};\n");
  await writeFile(join(root, "README.md"), "# Fixture\n");

  return root;
}
