import { describe, expect, it } from "vitest";
import { getFileErrors } from "../src/tools/check/getFileErrors.ts";
import { createTsMorphProject } from "../src/tools/createTsMorphProject.ts";

const errorFile = "samples/check/error.ts";

describe("getFileErrors", () => {
  it("returns empty string for a valid TypeScript file", () => {
    const result = getFileErrors("src/router.ts", createTsMorphProject());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toBe("");
  });

  it("reports diagnostics for an invalid TypeScript file", () => {
    const result = getFileErrors(errorFile, createTsMorphProject());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("TS");
    expect(result.data).toContain("type");
  });
});
