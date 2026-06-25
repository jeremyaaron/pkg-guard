import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { discoverWorkspaces, selectWorkspaceTargets } from "../src/core/workspaces.js";

describe("discoverWorkspaces", () => {
  it("discovers package.json workspace arrays", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/a": { name: "@scope/a", version: "1.0.0" },
        "packages/b": { name: "pkg-b", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.findings).toEqual([]);
    expect(result.patterns.map((pattern) => pattern.pattern)).toEqual(["packages/*"]);
    expect(result.packages.map((workspacePackage) => workspacePackage.relativePath)).toEqual(["packages/a", "packages/b"]);
    expect(result.packages.map((workspacePackage) => workspacePackage.name)).toEqual(["@scope/a", "pkg-b"]);
  });

  it("discovers package.json workspaces.packages", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: ["modules/*"]
        }
      },
      packages: {
        "modules/a": { name: "module-a", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.findings).toEqual([]);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.relativePath).toBe("modules/a");
  });

  it("discovers pnpm workspace packages", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0"
      },
      files: {
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n"
      },
      packages: {
        "packages/a": { name: "pnpm-a", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.findings).toEqual([]);
    expect(result.patterns.map((pattern) => pattern.source)).toEqual(["pnpm-workspace"]);
    expect(result.packages[0]?.name).toBe("pnpm-a");
  });

  it("reads private package metadata", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/private": { name: "private-package", version: "1.0.0", private: true }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages[0]).toMatchObject({
      relativePath: "packages/private",
      name: "private-package",
      private: true
    });
  });

  it("supports scoped package layouts", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/@scope/*"]
      },
      packages: {
        "packages/@scope/a": { name: "@scope/a", version: "1.0.0" },
        "packages/other": { name: "other", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages.map((workspacePackage) => workspacePackage.relativePath)).toEqual(["packages/@scope/a"]);
  });

  it("applies negated patterns", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*", "!packages/private"]
      },
      packages: {
        "packages/a": { name: "a", version: "1.0.0" },
        "packages/private": { name: "private", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages.map((workspacePackage) => workspacePackage.relativePath)).toEqual(["packages/a"]);
  });

  it("deduplicates and sorts package roots", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/b", "packages/*", "packages/a"]
      },
      packages: {
        "packages/b": { name: "b", version: "1.0.0" },
        "packages/a": { name: "a", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages.map((workspacePackage) => workspacePackage.relativePath)).toEqual(["packages/a", "packages/b"]);
  });

  it("does not traverse outside the workspace root", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["../outside"]
      },
      packages: {}
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages).toEqual([]);
    expect(result.findings.map((finding) => finding.id)).toContain("workspace.pattern-unsupported");
  });

  it("reports unsupported recursive patterns", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/**"]
      },
      packages: {
        "packages/a": { name: "a", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "workspace.pattern-unsupported",
        severity: "warning"
      })
    ]);
  });

  it("reports invalid workspace package manifests without crashing", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      files: {
        "packages/broken/package.json": "{ nope\n"
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "workspace.package-json-invalid",
        file: "packages/broken/package.json"
      })
    ]);
  });

  it("reports invalid workspace configuration", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: {
          packages: [123]
        }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "workspace.config-invalid",
        severity: "error",
        file: "package.json",
        path: "$.workspaces"
      })
    ]);
  });

  it("ignores package roots inside ignored directories", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["*"]
      },
      packages: {
        package: { name: "package", version: "1.0.0" },
        "node_modules/leaked": { name: "leaked", version: "1.0.0" },
        ".hidden/leaked": { name: "hidden", version: "1.0.0" }
      }
    });

    const result = await discoverWorkspaces(root);

    expect(result.packages.map((workspacePackage) => workspacePackage.relativePath)).toEqual(["package"]);
  });

  it("selects workspace children and skips private packages by default", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/a": { name: "a", version: "1.0.0" },
        "packages/private": { name: "private", version: "1.0.0", private: true }
      }
    });
    const discovery = await discoverWorkspaces(root);

    const selection = selectWorkspaceTargets(discovery, {
      workspaces: true,
      selectors: [],
      includePrivate: false,
      includeRoot: false
    });

    expect(selection.findings).toEqual([]);
    expect(selection.targets.map((target) => target.relativePath)).toEqual(["packages/a"]);
    expect(selection.skipped.map((target) => target.relativePath)).toEqual(["packages/private"]);
  });

  it("includes private packages when requested", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/private": { name: "private", version: "1.0.0", private: true }
      }
    });
    const discovery = await discoverWorkspaces(root);

    const selection = selectWorkspaceTargets(discovery, {
      workspaces: true,
      selectors: [],
      includePrivate: true,
      includeRoot: false
    });

    expect(selection.targets.map((target) => target.relativePath)).toEqual(["packages/private"]);
    expect(selection.skipped).toEqual([]);
  });

  it("includes the root package when requested", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/a": { name: "a", version: "1.0.0" }
      }
    });
    const discovery = await discoverWorkspaces(root);

    const selection = selectWorkspaceTargets(discovery, {
      workspaces: true,
      selectors: [],
      includePrivate: false,
      includeRoot: true
    });

    expect(selection.targets.map((target) => `${target.source}:${target.relativePath}`)).toEqual(["root:.", "workspace:packages/a"]);
  });

  it("skips a private root unless private packages are included", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/a": { name: "a", version: "1.0.0" }
      }
    });
    const discovery = await discoverWorkspaces(root);

    const selection = selectWorkspaceTargets(discovery, {
      workspaces: true,
      selectors: [],
      includePrivate: false,
      includeRoot: true
    });

    expect(selection.targets.map((target) => target.relativePath)).toEqual(["packages/a"]);
    expect(selection.skipped.map((target) => target.relativePath)).toEqual(["."]);
  });

  it("selects workspace packages by package name", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/a": { name: "@scope/a", version: "1.0.0" },
        "packages/b": { name: "b", version: "1.0.0" }
      }
    });
    const discovery = await discoverWorkspaces(root);

    const selection = selectWorkspaceTargets(discovery, {
      workspaces: false,
      selectors: ["@scope/a"],
      includePrivate: false,
      includeRoot: false
    });

    expect(selection.targets.map((target) => target.relativePath)).toEqual(["packages/a"]);
  });

  it("selects workspace packages by relative path", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/a": { name: "a", version: "1.0.0" },
        "packages/b": { name: "b", version: "1.0.0" }
      }
    });
    const discovery = await discoverWorkspaces(root);

    const selection = selectWorkspaceTargets(discovery, {
      workspaces: false,
      selectors: ["./packages/b/"],
      includePrivate: false,
      includeRoot: false
    });

    expect(selection.targets.map((target) => target.relativePath)).toEqual(["packages/b"]);
  });

  it("reports missing workspace selectors", async () => {
    const root = await createWorkspaceFixture({
      packageJson: {
        name: "root",
        version: "1.0.0",
        workspaces: ["packages/*"]
      },
      packages: {
        "packages/a": { name: "a", version: "1.0.0" }
      }
    });
    const discovery = await discoverWorkspaces(root);

    const selection = selectWorkspaceTargets(discovery, {
      workspaces: false,
      selectors: ["missing"],
      includePrivate: false,
      includeRoot: false
    });

    expect(selection.targets).toEqual([]);
    expect(selection.findings).toEqual([
      expect.objectContaining({
        id: "workspace.selector-not-found",
        severity: "error"
      })
    ]);
  });
});

async function createWorkspaceFixture(options: {
  packageJson: Record<string, unknown>;
  packages?: Record<string, Record<string, unknown>>;
  files?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-workspaces-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);

  for (const [relativePath, manifest] of Object.entries(options.packages ?? {})) {
    await writeJsonFile(join(root, relativePath, "package.json"), manifest);
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
