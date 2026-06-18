import { describe, expect, it } from "vitest";

import { getHelpText } from "../src/cli/help.js";

describe("CLI help", () => {
  it("describes pkg-guard and available usage", () => {
    expect(getHelpText()).toContain("pkg-guard");
    expect(getHelpText()).toContain("Usage:");
    expect(getHelpText()).toContain("pkg-guard --help");
  });
});
