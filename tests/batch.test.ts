import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createWorkspaceCheckContext, runBatchChecks } from "../src/core/batch.js";
import { discoverWorkspaces, selectWorkspaceTargets } from "../src/core/workspaces.js";

describe("runBatchChecks", () => {
  it("checks every selected workspace package", async () => {
    const root = await createWorkspaceFixture({
      packages: {
        "packages/a": packageJson({ name: "a" }),
        "packages/b": packageJson({ name: "b" })
      }
    });
    const report = await runWorkspaceCheck(root);

    expect(report.summary.packages).toBe(2);
    expect(report.summary.errors).toBe(0);
    expect(report.packages.map((packageReport) => packageReport.target.relativePath)).toEqual(["packages/a", "packages/b"]);
  });

  it("continues checking packages after another package reports an error", async () => {
    const root = await createWorkspaceFixture({
      packages: {
        "packages/broken": packageJson({ name: "broken", main: "./missing.js" }),
        "packages/clean": packageJson({ name: "clean" })
      }
    });
    const report = await runWorkspaceCheck(root);

    expect(report.summary.packages).toBe(2);
    expect(report.summary.errors).toBeGreaterThan(0);
    expect(report.packages.map((packageReport) => packageReport.target.relativePath)).toEqual(["packages/broken", "packages/clean"]);
    expect(report.packages[1]?.report.findings).toEqual([]);
  });

  it("applies package-level ignore policy per package", async () => {
    const root = await createWorkspaceFixture({
      packages: {
        "packages/ignored": packageJson({
          name: "ignored",
          license: undefined,
          pkgGuard: {
            ignore: ["manifest.license-missing"]
          }
        }),
        "packages/warn": packageJson({
          name: "warn",
          license: undefined
        })
      }
    });
    const report = await runWorkspaceCheck(root);

    expect(report.packages[0]?.report.findings).toEqual([]);
    expect(report.packages[1]?.report.findings.map((finding) => finding.id)).toContain("manifest.license-missing");
  });

  it("applies CLI ignore policy across packages", async () => {
    const root = await createWorkspaceFixture({
      packages: {
        "packages/a": packageJson({ name: "a", license: undefined }),
        "packages/b": packageJson({ name: "b", license: undefined })
      }
    });
    const report = await runWorkspaceCheck(root, {
      ignore: ["manifest.license-missing"]
    });

    expect(report.summary.warnings).toBe(0);
    expect(report.packages.flatMap((packageReport) => packageReport.report.findings)).toEqual([]);
  });

  it("applies package-level strict policy per package when strict mode is enabled", async () => {
    const root = await createWorkspaceFixture({
      packages: {
        "packages/strict": packageJson({
          name: "strict",
          license: undefined,
          pkgGuard: {
            strict: ["manifest.license-missing"]
          }
        }),
        "packages/warn": packageJson({
          name: "warn",
          license: undefined
        })
      }
    });
    const report = await runWorkspaceCheck(root, {
      strict: true
    });

    expect(report.packages[0]?.report.findings[0]).toMatchObject({
      id: "manifest.license-missing",
      severity: "error"
    });
    expect(report.packages[1]?.report.findings[0]).toMatchObject({
      id: "manifest.license-missing",
      severity: "warning"
    });
  });

  it("builds workspace check context from named workspace package metadata", async () => {
    const root = await createWorkspaceFixture({
      rootPackageJson: {
        packageManager: "pnpm@9.0.0"
      },
      packages: {
        "packages/a": packageJson({ name: "@scope/a" }),
        "packages/private": packageJson({ name: "private-package", private: true }),
        "packages/unnamed": packageJson({ name: undefined })
      },
      files: {
        ".github/workflows/release.yml": "name: release\non: workflow_dispatch\njobs: {}\n"
      }
    });
    const discovery = await discoverWorkspaces(root);

    const context = createWorkspaceCheckContext(discovery);

    expect(context?.packageManager.detected).toBe("pnpm");
    expect(context?.publishPath.kind).toBe("unknown");
    expect(context?.rootWorkflows).toHaveLength(1);
    expect(Array.from(context?.packagesByName.keys() ?? [])).toEqual(["@scope/a", "private-package"]);
    expect(context?.packagesByName.get("private-package")).toMatchObject({
      relativePath: "packages/private",
      private: true
    });
  });
});

function packageJson(overrides: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name: "fixture",
    version: "1.0.0",
    license: "MIT",
    packageManager: "npm@10.8.2",
    files: ["dist"],
    ...overrides
  };

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      delete data[key];
    }
  }

  return data;
}

async function runWorkspaceCheck(
  root: string,
  options: { ignore?: string[]; strict?: boolean } = {}
): Promise<Awaited<ReturnType<typeof runBatchChecks>>> {
  const discovery = await discoverWorkspaces(root);
  const selection = selectWorkspaceTargets(discovery, {
    workspaces: true,
    selectors: [],
    includePrivate: false,
    includeRoot: false
  });
  const workspaceContext = createWorkspaceCheckContext(discovery);

  return await runBatchChecks({
    command: "check",
    cwd: root,
    root: discovery.root,
    targets: selection.targets,
    skipped: selection.skipped,
    findings: [...discovery.findings, ...selection.findings],
    ignore: options.ignore ?? [],
    strict: options.strict ?? false,
    ...(workspaceContext ? { workspaceContext } : {})
  });
}

async function createWorkspaceFixture(options: {
  packages: Record<string, Record<string, unknown>>;
  rootPackageJson?: Record<string, unknown>;
  files?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-batch-"));

  await writeJsonFile(join(root, "package.json"), {
    name: "root",
    version: "1.0.0",
    private: true,
    workspaces: ["packages/*"],
    ...options.rootPackageJson
  });

  for (const [relativePath, manifest] of Object.entries(options.packages)) {
    await writeJsonFile(join(root, relativePath, "package.json"), manifest);
    await writeFile(join(root, relativePath, "README.md"), "# Fixture\n");
    await writeFile(join(root, relativePath, "LICENSE"), "MIT\n");
  }

  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}

async function writeJsonFile(filePath: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
