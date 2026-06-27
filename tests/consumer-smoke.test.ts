import { access, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runConsumerSmokeChecks } from "../src/core/consumer-smoke.js";
import { discoverProject } from "../src/core/discovery.js";

describe("runConsumerSmokeChecks", () => {
  it("packs and installs a package without findings", async () => {
    const root = await createPackageFixture({
      name: "consumer-smoke-fixture",
      version: "1.0.0",
      main: "./dist/index.js",
      files: ["dist"]
    });
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([]);
  });

  it("reports pack failures", async () => {
    const root = await createPackageFixture({
      version: "1.0.0",
      files: "nope"
    });
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([
      expect.objectContaining({
        id: "consumer.pack-failed",
        severity: "error",
        file: "package.json"
      })
    ]);
  });

  it("reports install failures", async () => {
    const root = await createPackageFixture({
      name: "consumer-smoke-install-failure",
      version: "1.0.0",
      dependencies: {
        "bad dep": "1.0.0"
      }
    });
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([
      expect.objectContaining({
        id: "consumer.install-failed",
        severity: "error",
        file: "package.json"
      })
    ]);
  });

  it("does not run package lifecycle scripts during pack or install", async () => {
    const markerRoot = await mkdtemp(join(tmpdir(), "pkg-guard-consumer-smoke-marker-"));
    const marker = join(markerRoot, "script-ran");
    const root = await createPackageFixture({
      name: "consumer-smoke-lifecycle-fixture",
      version: "1.0.0",
      main: "./dist/index.js",
      scripts: {
        prepack: markerScript(marker, "prepack"),
        install: markerScript(marker, "install")
      }
    });
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([]);
    await expect(access(marker)).rejects.toThrow();
  });

  it("cleans up temporary smoke directories", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "pkg-guard-consumer-smoke-root-"));
    const root = await createPackageFixture({
      name: "consumer-smoke-cleanup-fixture",
      version: "1.0.0",
      main: "./dist/index.js"
    });
    const context = await discoverContext(root);

    await runConsumerSmokeChecks(context, { tempRoot });

    await expect(readdir(tempRoot)).resolves.toEqual([]);
  });

  it("reports unresolved require targets from installed packages", async () => {
    const root = await createPackageFixture({
      name: "consumer-smoke-require-missing",
      version: "1.0.0",
      main: "./dist/missing.js",
      files: ["dist"]
    });
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([
      expect.objectContaining({
        id: "consumer.require-unresolved",
        severity: "error",
        file: "package.json",
        path: "$.main"
      })
    ]);
  });

  it("reports unresolved import targets from installed packages", async () => {
    const root = await createPackageFixture({
      name: "consumer-smoke-import-missing",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": {
          import: "./dist/missing.js"
        }
      },
      files: ["dist"]
    });
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([
      expect.objectContaining({
        id: "consumer.import-unresolved",
        severity: "error",
        file: "package.json",
        path: '$.exports.".".import'
      })
    ]);
  });

  it("passes valid import and require export targets", async () => {
    const root = await createPackageFixture(
      {
        name: "consumer-smoke-conditional-exports",
        version: "1.0.0",
        type: "module",
        exports: {
          ".": {
            import: "./dist/index.js",
            require: "./dist/index.cjs"
          }
        },
        files: ["dist"]
      },
      {
        "dist/index.cjs": "module.exports = {};\n"
      }
    );
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([]);
  });

  it("skips export pattern probes", async () => {
    const root = await createPackageFixture({
      name: "consumer-smoke-pattern-exports",
      version: "1.0.0",
      exports: {
        "./feature/*": "./dist/feature/*.js"
      },
      files: ["dist"]
    });
    const context = await discoverContext(root);

    const findings = await runConsumerSmokeChecks(context);

    expect(findings).toEqual([]);
  });
});

async function discoverContext(root: string) {
  const discovery = await discoverProject(root);

  if (!discovery.context) {
    throw new Error("Expected fixture to produce a project context.");
  }

  return discovery.context;
}

async function createPackageFixture(
  packageJson: Record<string, unknown>,
  files: Record<string, string> = {}
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-consumer-smoke-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "index.js"), "export {};\n");
  await mkdir(join(root, "dist", "feature"), { recursive: true });
  await writeFile(join(root, "dist", "feature", "alpha.js"), "export {};\n");
  await writeFile(join(root, "README.md"), "# Fixture\n");

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }

  return root;
}

function markerScript(marker: string, value: string): string {
  return `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(value)})"`;
}
