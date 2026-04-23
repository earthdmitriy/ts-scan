import { describe, expect, it } from "vitest";
import { createTsMorphProject } from "../src/tools/createTsMorphProject.ts";
import { fetchImportedSymbols } from "../src/tools/imports/fetchImportedSymbols.ts";

const sampleFile = "samples/imports/sample.ts";
const complexSampleFile = "samples/imports/complex-sample.ts";
const multipleImports = "samples/imports/multipleImports.ts";

describe("fetchImportedSymbols", () => {
  it("returns imported symbol information for a sample file", () => {
    const result = fetchImportedSymbols(sampleFile, createTsMorphProject());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("Types and JSdoc:");
    expect(result.data).toContain("Returns a greeting for the provided name.");
    expect(result.data).toContain("const value:");
    expect(result.data).toContain("function greet(name: string): string");
    // Ensure implementation bodies are not included
    expect(result.data).not.toContain("return `Hello ${name}`");
    expect(result.data).not.toContain("= 42");
  });

  it("returns imported class signatures without implementation for complex imports", () => {
    const result = fetchImportedSymbols(
      complexSampleFile,
      createTsMorphProject()
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("Types and JSdoc:");
    expect(result.data).toContain("class ComplexModule");
    expect(result.data).toContain("method1(param: string): number");
    expect(result.data).not.toContain("method2");
    expect(result.data).not.toContain("static ɵfac");
    expect(result.data).not.toContain("private");
  });

  it("returns imported class signatures without implementation for complex imports", () => {
    const result = fetchImportedSymbols(
      multipleImports,
      createTsMorphProject()
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    console.log(result.data);

    expect(result.data).toContain("export class ComplexModule");
    expect(result.data).toContain("export interface ComplexInterface");
    expect(result.data).toContain("export type ComplexType");
  });
});
