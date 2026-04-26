import { describe, expect, it } from "vitest";
import { cachedResolveExportInNodeModules } from "../src/tools/exportCache/exportCache.ts";

describe("cachedResolveExportInNodeModules", () => {
  it("returns a not-found message for an unknown symbol", () => {
    const result = cachedResolveExportInNodeModules("NonExistentSymbol123");

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error).toContain('Symbol "NonExistentSymbol123" not found.');
  });

  it("finds Project from ts-morph", () => {
    const result = cachedResolveExportInNodeModules("Project");

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data[0]).toContain("ts-morph");
  });

  it("finds ScriptTarget from ts-morph", () => {
    const result = cachedResolveExportInNodeModules("ScriptTarget");

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data[0]).toContain("ts-morph");
  });

  it("finds createPipe from typed-pipe", () => {
    const result = cachedResolveExportInNodeModules("createPipe");

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data[0]).toContain("typed-pipe");
  });

  it("finds ModuleKind from ts-morph", () => {
    const result = cachedResolveExportInNodeModules("ModuleKind");

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data[0]).toContain("ts-morph");
  });

  it("finds symbols from different packages", () => {
    // Test zod exports
    const zodResult = cachedResolveExportInNodeModules("z");
    expect(zodResult.success).toBe(true);
    if (zodResult.success) {
      expect(zodResult.data[0]).toMatch(/zod/);
    }

    // Test tslib exports
    const tslibResult = cachedResolveExportInNodeModules("__assign");
    expect(tslibResult.success).toBe(true);
    if (tslibResult.success) {
      expect(tslibResult.data[0]).toMatch(/tslib/);
    }
  });

  it("handles symbols that exist in multiple packages", () => {
    // This should find the first match
    const result = cachedResolveExportInNodeModules("default");
    expect(result.success).toBe(true);
    if (!result.success) return;
  });
});
