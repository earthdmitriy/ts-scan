import { describe, expect, it } from "vitest";
import { createTsMorphProject } from "../src/tools/createTsMorphProject.ts";
import { getExportedSymbols } from "../src/tools/exports/getExportedSymbols.ts";

const sampleFunctionsFile = "samples/exports/sample-functions.ts";
const sampleClassFile = "samples/exports/sample-class.ts";
const sampleComplexTypesFile = "samples/exports/sample-complex-types.ts";

describe("getExportedSymbols", () => {
  it("returns exported function signatures without implementation", () => {
    const result = getExportedSymbols(
      sampleFunctionsFile,
      createTsMorphProject()
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain(
      "export function add(a: number, b: number): number"
    );
    expect(result.data).toContain('export const version: "1.0"');
    // Check JSDoc content
    expect(result.data).toContain("Adds two values");
    expect(result.data).toContain("@param a first number");
    // Ensure no implementation details
    expect(result.data).not.toContain("return a + b");
    expect(result.data).not.toContain("{");
    expect(result.data).not.toContain("}");
  });

  it("returns exported class signatures with only public methods and properties", () => {
    const result = getExportedSymbols(sampleClassFile, createTsMorphProject());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("export class Calculator");
    expect(result.data).toContain("add(a: number, b: number): number");
    expect(result.data).toContain("version: string");
    expect(result.data).toContain("@Component");
    // Check JSDoc content
    expect(result.data).toContain("A sample class");
    // Ensure no private methods
    expect(result.data).not.toContain("subtract");
    expect(result.data).not.toContain("private");
    // Ensure no implementation details
    expect(result.data).not.toContain("return a + b");
    expect(result.data).not.toContain("return a - b");
  });

  it("returns current ChaosComponent signature without implementation details", () => {
    const result = getExportedSymbols(
      sampleComplexTypesFile,
      createTsMorphProject()
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("export class ChaosComponent");
    expect(result.data).toContain("project: Project");
    expect(result.data).not.toContain("new Project()");
  });

  it("returns full type declaration", () => {
    const result = getExportedSymbols(
      "samples/exports/sampe-type.ts",
      createTsMorphProject()
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("export type Product");
    expect(result.data).toContain("productId: number;");
    expect(result.data).toContain("export type PopulatedBucket");
    expect(result.data).toContain(
      "goods: { product: Product; amount: number }[];"
    );
  });

  it("handle node_modules - ts-morph", () => {
    const result = getExportedSymbols("ts-morph", createTsMorphProject());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("Project");
  });

  it("handle node_modules - typed-pipe", () => {
    const result = getExportedSymbols("typed-pipe", createTsMorphProject());

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toContain("PipeFn");
  });

  it("handle node_modules - @types/node", () => {
    const result = getExportedSymbols("@types/node", createTsMorphProject());

    expect(result.success).toBe(true);
    if (!result.success) return;

    // @types/node is a global types file, may not have named exports
    expect(typeof result.data).toBe("string");
  });
});
