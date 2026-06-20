import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runChecks } from "../src/core/checks.js";
import { discoverProject } from "../src/core/discovery.js";

const missingValidationFindingIds = [
  "workflow.test-step-missing",
  "workflow.build-step-missing",
  "workflow.package-validation-missing"
];

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

  it("recognizes validation commands reached through nested npm scripts", async () => {
    const root = await createFixture({
      scripts: createReleaseScripts(),
      workflow: createPublishWorkflow("npm run verify:release")
    });

    const ids = await getCheckFindingIds(root);

    for (const id of missingValidationFindingIds) {
      expect(ids).not.toContain(id);
    }
  });

  it.each([
    ["pnpm run verify:release"],
    ["yarn verify:release"],
    ["bun run verify:release"]
  ])("recognizes validation commands reached through %s", async (command) => {
    const root = await createFixture({
      scripts: createReleaseScripts(),
      workflow: createPublishWorkflow(command)
    });

    const ids = await getCheckFindingIds(root);

    for (const id of missingValidationFindingIds) {
      expect(ids).not.toContain(id);
    }
  });

  it("terminates cyclic script expansion and keeps reachable validation commands", async () => {
    const root = await createFixture({
      scripts: {
        "verify:release": "npm run test:release && npm run build:release && npm run loop && npm run pack:check",
        "test:release": "npm test",
        "build:release": "npm run build",
        loop: "npm run loop",
        "pack:check": "pkg-guard check && npm pack --dry-run --ignore-scripts"
      },
      workflow: createPublishWorkflow("npm run verify:release")
    });

    const ids = await getCheckFindingIds(root);

    for (const id of missingValidationFindingIds) {
      expect(ids).not.toContain(id);
    }
  });

  it("reports missing validation when a referenced package script is absent", async () => {
    const root = await createFixture({
      scripts: {},
      workflow: createPublishWorkflow("npm run verify:release")
    });

    const ids = await getCheckFindingIds(root);

    expect(ids).toEqual(expect.arrayContaining(missingValidationFindingIds));
  });

  it.each([
    ["null scripts", null],
    ["array scripts", []],
    ["non-string script entries", { "verify:release": false, "pack:check": 42 }]
  ])("ignores %s without creating false validation confidence", async (_name, scripts) => {
    const root = await createFixture({
      scripts,
      workflow: createPublishWorkflow("npm run verify:release")
    });

    const ids = await getCheckFindingIds(root);

    expect(ids).toEqual(expect.arrayContaining(missingValidationFindingIds));
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

async function getCheckFindingIds(root: string): Promise<string[]> {
  return (await getCheckFindings(root)).map((finding) => finding.id);
}

function createReleaseScripts(): Record<string, string> {
  return {
    "verify:release": "npm run lint && npm run format && npm run typecheck && npm test && npm run build && npm run pack:check && npm run smoke:package",
    "pack:check": "pkg-guard check && npm pack --dry-run --ignore-scripts"
  };
}

function createPublishWorkflow(validationCommand: string): string {
  return `
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
      - run: ${validationCommand}
      - run: npm publish
`;
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
