import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runChecks } from "../src/core/checks.js";
import { discoverProject } from "../src/core/discovery.js";

describe("workflow checks", () => {
  it("warns on long-lived npm token usage", async () => {
    const root = await createFixture({
      workflow: `
name: Release
on:
  push:
    tags:
      - "v*"
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npm pack --dry-run
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`
    });

    const ids = (await getCheckFindings(root)).map((finding) => finding.id);

    expect(ids).toContain("workflow.long-lived-npm-token");
    expect(ids).toContain("workflow.id-token-permission-missing");
    expect(ids).not.toContain("workflow.package-validation-missing");
  });

  it("recognizes npm pack dry-run as package validation", async () => {
    const root = await createFixture({
      workflow: `
name: Release
on:
  push:
    tags:
      - "v*"
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npm pack --dry-run --ignore-scripts
      - run: npm publish
`
    });

    const ids = (await getCheckFindings(root)).map((finding) => finding.id);

    expect(ids).not.toContain("workflow.package-validation-missing");
  });

  it("reports branch push publishing", async () => {
    const root = await createFixture({
      workflow: `
name: Release
on:
  push:
    branches:
      - main
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npx pkg-guard check
      - run: npm publish
`
    });

    const ids = (await getCheckFindings(root)).map((finding) => finding.id);

    expect(ids).toContain("workflow.branch-push-publish");
  });

  it("reports missing install, test, build, and package validation steps", async () => {
    const root = await createFixture({
      workflow: `
name: Release
on:
  push:
    tags:
      - "v*"
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`
    });

    const ids = (await getCheckFindings(root)).map((finding) => finding.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "workflow.install-step-missing",
        "workflow.test-step-missing",
        "workflow.build-step-missing",
        "workflow.package-validation-missing"
      ])
    );
  });

  it("does not warn for a tag-triggered OIDC publish workflow with required steps", async () => {
    const root = await createFixture({
      workflow: `
name: Release
on:
  push:
    tags:
      - "v*"
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"
      - run: npm ci
      - run: npm test --if-present
      - run: npm run build --if-present
      - run: npx pkg-guard check
      - run: npm publish
`
    });

    const findings = await getCheckFindings(root);

    expect(findings.filter((finding) => finding.id.startsWith("workflow."))).toEqual([]);
  });

  it("ignores non-publish workflows", async () => {
    const root = await createFixture({
      workflow: `
name: CI
on:
  push:
    branches:
      - main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm test
`
    });

    const findings = await getCheckFindings(root);

    expect(findings.filter((finding) => finding.id.startsWith("workflow."))).toEqual([]);
  });

  it("warns on invalid workflow YAML", async () => {
    const root = await createFixture({
      workflow: "name: [nope\n"
    });

    const ids = (await getCheckFindings(root)).map((finding) => finding.id);

    expect(ids).toContain("workflow.yaml-invalid");
  });
});

async function getCheckFindings(root: string) {
  const discovery = await discoverProject(root);

  if (!discovery.context) {
    throw new Error("Expected fixture context");
  }

  return [...discovery.findings, ...runChecks(discovery.context)];
}

async function createFixture(options: { workflow: string; scripts?: unknown }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pkg-guard-workflow-"));
  const manifest: Record<string, unknown> = {
    name: "workflow-fixture",
    version: "1.0.0",
    license: "MIT",
    packageManager: "npm@10.8.2",
    files: ["dist", "README.md", "LICENSE"]
  };

  if (Object.hasOwn(options, "scripts")) {
    manifest.scripts = options.scripts;
  }

  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Fixture\n");
  await writeFile(join(root, "LICENSE"), "MIT\n");
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(join(root, ".github", "workflows", "release.yml"), options.workflow.trimStart());

  return root;
}
