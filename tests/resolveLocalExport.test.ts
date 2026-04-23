import path from "path";
import { describe, expect, it } from "vitest";
import {
  findFileInRoots,
  resolveLocalExport,
  searchWithGrep,
  searchWithRipgrep,
} from "../src/tools/resolve/resolveLocalExport.ts";

const sampleDir = path.resolve("samples");

describe("Search strategies unit tests", () => {
  const pattern = /export\s+(const|function|class)\s+localResolveSymbol\b/;
  const patternMissing = /export\s+(const|function|class)\s+missingSymbol\b/;

  it("searchWithRipgrep finds symbol when rg is available", () => {
    const result = searchWithRipgrep([sampleDir], pattern);
    if (result.success) {
      expect(result.data[0]).toContain("sample-export.ts");
    }
  });

  it("searchWithRipgrep returns null for missing symbol when rg is available", () => {
    const result = searchWithRipgrep([sampleDir], patternMissing);
    expect(result).toEqual({ success: true, data: [] });
  });

  it("searchWithGrep finds symbol when grep is available", () => {
    const result = searchWithGrep([sampleDir], "localResolveSymbol", pattern);
    if (result.success) {
      expect(result.data[0]).toContain("sample-export.ts");
    }
  });

  it("searchWithGrep returns [] for missing symbol when grep is available", () => {
    const result = searchWithGrep([sampleDir], "missingSymbol", patternMissing);
    expect(result).toEqual({ success: true, data: [] });
  });

  it("findFileInRoots finds symbol via filesystem walk", () => {
    const result = findFileInRoots([sampleDir], pattern);
    if (result.success) {
      expect(result.data[0]).toContain("sample-export.ts");
    }
  });

  it("findFileInRoots returns null for missing symbol via filesystem walk", () => {
    const result = findFileInRoots([sampleDir], patternMissing);
    expect(result).toEqual({ success: true, data: [] });
  });

  it("search strategies return same file path for existing symbol", () => {
    const rgResult = searchWithRipgrep([sampleDir], pattern);
    const grepResult = searchWithGrep(
      [sampleDir],
      "localResolveSymbol",
      pattern
    );
    const fsResult = findFileInRoots([sampleDir], pattern);

    if (!rgResult.success || !grepResult.success || !fsResult.success) {
      throw new Error(
        "One of the search strategies failed to find the symbol, cannot compare results"
      );
    }

    expect(rgResult).toEqual(fsResult);
    expect(grepResult).toEqual(fsResult);
  });

  it("search strategies all return null for missing symbol", () => {
    const rgResult = searchWithRipgrep([sampleDir], patternMissing);
    const grepResult = searchWithGrep(
      [sampleDir],
      "missingSymbol",
      patternMissing
    );
    const fsResult = findFileInRoots([sampleDir], patternMissing);

    expect(rgResult).toEqual({ success: true, data: [] });
    expect(grepResult).toEqual({ success: true, data: [] });
    expect(fsResult).toEqual({ success: true, data: [] });
  });
});

describe("resolveLocalExport (integration)", () => {
  it("returns the correct import path for a local export", () => {
    const result = resolveLocalExport("localResolveSymbol");

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toEqual([
      {
        path: "samples/sample-export.ts",
        relative: "./samples/sample-export",
      },
    ]);
  });

  it("returns empty success for a missing symbol", () => {
    const result = resolveLocalExport("missingSymbol");
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toEqual([]);
  });

  it("handles errors gracefully", () => {
    const result = resolveLocalExport("");
    expect(result.success).toBe(true);
  });
});

describe("relativeTo path calculation", () => {
  it("finds getFileErrors from src/cli.ts", () => {
    const result = resolveLocalExport("getFileErrors", "src/cli.ts");
    expect(result.success).toBe(true);
    if (!result.success) return;

    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/tools/check/getFileErrors.ts",
        relative: "./tools/check/getFileErrors",
      },
    ]);
  });

  it("finds createTsMorphProject from src/cli.ts", () => {
    const result = resolveLocalExport("createTsMorphProject", "src/cli.ts");
    expect(result.success).toBe(true);
    if (!result.success) return;

    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/tools/createTsMorphProject.ts",
        relative: "./tools/createTsMorphProject",
      },
    ]);
  });

  it("finds getFileErrors from src/router.ts", () => {
    const result = resolveLocalExport("getFileErrors", "src/router.ts");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/tools/check/getFileErrors.ts",
        relative: "./tools/check/getFileErrors",
      },
    ]);
  });

  it("finds resolveLocalExport from src/router.ts", () => {
    const result = resolveLocalExport("resolveLocalExport", "src/router.ts");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/tools/resolve/resolveLocalExport.ts",
        relative: "./tools/resolve/resolveLocalExport",
      },
    ]);
  });

  it("finds success from src/cli.ts", () => {
    const result = resolveLocalExport("success", "src/cli.ts");
    expect(result.success).toBe(true);

    if (!result.success) return;

    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/types.ts",
        relative: "./types",
      },
    ]);
  });

  it("finds startMcp from src/cli.ts", () => {
    const result = resolveLocalExport("startMcp", "src/cli.ts");
    expect(result.success).toBe(true);
    if (!result.success) return;

    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/tools/mcp/startMcp.ts",
        relative: "./tools/mcp/startMcp",
      },
    ]);
  });

  it("finds getExportedSymbols from nested src/tools/check/getFileErrors.ts", () => {
    const result = resolveLocalExport(
      "getExportedSymbols",
      "src/tools/check/getFileErrors.ts"
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/tools/exports/getExportedSymbols.ts",
        relative: "../exports/getExportedSymbols",
      },
    ]);
  });

  it("finds success from deeply nested src/tools/check/getFileErrors.ts", () => {
    const result = resolveLocalExport(
      "success",
      "src/tools/check/getFileErrors.ts"
    );
    expect(result.success).toBe(true);

    if (!result.success) return;

    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/types.ts",
        relative: "../../types",
      },
    ]);
  });

  it("calculates relative path correctly from src/tools/resolve/resolveLocalExport.ts", () => {
    const result = resolveLocalExport(
      "getFileErrors",
      "src/tools/resolve/resolveLocalExport.ts"
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    const importPath = result.data;
    expect(importPath).toEqual([
      {
        path: "src/tools/check/getFileErrors.ts",
        relative: "../check/getFileErrors",
      },
    ]);
  });

  it("returns empty string when symbol not found regardless of relativeTo", () => {
    const result1 = resolveLocalExport("nonExistentSymbol", "src/cli.ts");
    const result2 = resolveLocalExport(
      "nonExistentSymbol",
      "src/tools/check/getFileErrors.ts"
    );
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    if (!result1.success) return;
    if (!result2.success) return;

    expect(result1.data).toEqual([]);
    expect(result2.data).toEqual([]);
  });
});
