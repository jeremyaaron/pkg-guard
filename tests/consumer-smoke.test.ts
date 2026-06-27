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
      version: "1.0.0"
    });
    const context = await discoverContext(root);

    await runConsumerSmokeChecks(context, { tempRoot });

    await expect(readdir(tempRoot)).resolves.toEqual([]);
  });
});

async function discoverContext(root: string) {
  const discovery = await discoverProject(root);

  if (!discovery.context) {
    throw new Error("Expected fixture to produce a project context.");
  }

  return discovery.context;
}

async function createPackageFixture(packageJson: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-consumer-smoke-"));

  await writeFile(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "index.js"), "export {};\n");
  await writeFile(join(root, "README.md"), "# Fixture\n");

  return root;
}

function markerScript(marker: string, value: string): string {
  return `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(value)})"`;
}
