import { describe, expect, it } from "vitest";

import { collectPackageTargets, isSimpleTargetPattern } from "../src/core/package-targets.js";

describe("collectPackageTargets", () => {
  it("collects top-level entrypoint and bin targets", () => {
    const result = collectPackageTargets({
      main: "./dist/index.cjs",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
      typings: "./dist/compat.d.ts",
      bin: {
        fixture: "./dist/cli.js"
      }
    });

    expect(result.findings).toEqual([]);
    expect(result.targets).toEqual([
      expect.objectContaining({
        kind: "file",
        source: "main",
        target: "./dist/index.cjs",
        jsonPath: "$.main",
        conditions: []
      }),
      expect.objectContaining({
        kind: "file",
        source: "module",
        target: "./dist/index.js",
        jsonPath: "$.module",
        conditions: []
      }),
      expect.objectContaining({
        kind: "file",
        source: "types",
        target: "./dist/index.d.ts",
        jsonPath: "$.types",
        conditions: []
      }),
      expect.objectContaining({
        kind: "file",
        source: "typings",
        target: "./dist/compat.d.ts",
        jsonPath: "$.typings",
        conditions: []
      }),
      expect.objectContaining({
        kind: "file",
        source: "bin",
        target: "./dist/cli.js",
        jsonPath: "$.bin.fixture",
        conditions: []
      })
    ]);
  });

  it("collects nested export targets with condition metadata", () => {
    const result = collectPackageTargets({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          require: "./dist/index.cjs",
          node: {
            default: "./dist/node.js"
          }
        },
        "./feature/*": "./dist/feature/*.js"
      }
    });

    expect(result.findings).toEqual([]);
    expect(result.targets).toEqual([
      expect.objectContaining({
        kind: "file",
        source: "exports",
        target: "./dist/index.d.ts",
        jsonPath: '$.exports.".".types',
        conditions: ["types"],
        exportSubpath: "."
      }),
      expect.objectContaining({
        kind: "file",
        source: "exports",
        target: "./dist/index.js",
        jsonPath: '$.exports.".".import',
        conditions: ["import"],
        exportSubpath: "."
      }),
      expect.objectContaining({
        kind: "file",
        source: "exports",
        target: "./dist/index.cjs",
        jsonPath: '$.exports.".".require',
        conditions: ["require"],
        exportSubpath: "."
      }),
      expect.objectContaining({
        kind: "file",
        source: "exports",
        target: "./dist/node.js",
        jsonPath: '$.exports.".".node.default',
        conditions: ["node", "default"],
        exportSubpath: "."
      }),
      expect.objectContaining({
        kind: "pattern",
        source: "exports",
        targetPattern: "./dist/feature/*.js",
        jsonPath: '$.exports."./feature/*"',
        conditions: [],
        exportSubpath: "./feature/*"
      })
    ]);
  });

  it("collects root conditional exports", () => {
    const result = collectPackageTargets({
      exports: {
        import: "./dist/index.js",
        require: "./dist/index.cjs"
      }
    });

    expect(result.findings).toEqual([]);
    expect(result.targets).toEqual([
      expect.objectContaining({
        target: "./dist/index.js",
        jsonPath: "$.exports.import",
        conditions: ["import"],
        exportSubpath: "."
      }),
      expect.objectContaining({
        target: "./dist/index.cjs",
        jsonPath: "$.exports.require",
        conditions: ["require"],
        exportSubpath: "."
      })
    ]);
  });

  it("returns pack unsupported target findings for invalid shapes", () => {
    const result = collectPackageTargets({
      main: false,
      bin: {
        fixture: []
      },
      exports: {
        ".": null,
        "./feature/**": "./dist/feature/**/*.js"
      }
    });

    expect(result.targets).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "pack.unsupported-target",
        path: "$.main"
      }),
      expect.objectContaining({
        id: "pack.unsupported-target",
        path: "$.bin.fixture"
      }),
      expect.objectContaining({
        id: "pack.unsupported-target",
        path: '$.exports."."'
      }),
      expect.objectContaining({
        id: "pack.unsupported-target",
        path: '$.exports."./feature/**"'
      })
    ]);
  });
});

describe("isSimpleTargetPattern", () => {
  it("accepts exactly one wildcard", () => {
    expect(isSimpleTargetPattern("./dist/*.js")).toBe(true);
    expect(isSimpleTargetPattern("./dist/**/*.js")).toBe(false);
    expect(isSimpleTargetPattern("./dist/index.js")).toBe(false);
  });
});
