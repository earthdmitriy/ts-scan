import { describe, expect, it } from "vitest";
import { createStripper } from "../src/tools/utils/stripImport.ts";

describe("createStripper", () => {
  it("strips a single import pattern", () => {
    const { stripImport, getImports } = createStripper();
    const result = stripImport(
      'import("D:/Win/Projects/ts-scan/samples/exports/sample-dependencies").ComplexType'
    );
    expect(result).toBe("ComplexType");
    expect(getImports()).toEqual([
      "D:/Win/Projects/ts-scan/samples/exports/sample-dependencies",
    ]);
  });

  it("strips multiple distinct imports from one string", () => {
    const { stripImport, getImports } = createStripper();
    const input = 'A & import("path/to/a").B | import("path/to/c").C';
    const result = stripImport(input);
    expect(result).toBe("A & B | C");
    expect(getImports().sort()).toEqual(["path/to/a", "path/to/c"].sort());
  });

  it("records each unique import path only once", () => {
    const { stripImport, getImports } = createStripper();
    const input = 'import("same/path").X & import("same/path").Y';
    const result = stripImport(input);
    expect(result).toBe("X & Y");
    expect(getImports()).toEqual(["same/path"]);
  });

  it("handles strings with no import patterns", () => {
    const { stripImport, getImports } = createStripper();
    const typeName = "SimpleType";
    expect(stripImport(typeName)).toBe("SimpleType");
    expect(getImports()).toEqual([]);
  });

  it("handles empty string", () => {
    const { stripImport, getImports } = createStripper();
    expect(stripImport("")).toBe("");
    expect(getImports()).toEqual([]);
  });

  it("ignores malformed import patterns", () => {
    const { stripImport, getImports } = createStripper();
    // Missing dot before identifier
    const malformed1 = 'import("x")Identifier';
    expect(stripImport(malformed1)).toBe(malformed1);
    // Extra whitespace
    const malformed2 = 'import("x") .Y';
    expect(stripImport(malformed2)).toBe(malformed2);
    expect(getImports()).toEqual([]);
  });

  it("correctly handles multiple calls accumulating imports", () => {
    const { stripImport, getImports } = createStripper();
    stripImport('import("a").A');
    stripImport('import("b").B');
    stripImport('import("a").A2'); // duplicate path
    expect(getImports().sort()).toEqual(["a", "b"].sort());
  });

  describe("generics and nesting", () => {
    it("strip inner imports inside generic arguments", () => {
      const { stripImport, getImports } = createStripper();
      const input = 'import("a").Foo<import("b").Bar>';
      const result = stripImport(input);
      // Outer import is stripped, inner remains because it's not preceded by a dot
      expect(result).toBe("Foo<Bar>");
      expect(getImports()).toEqual(["a", "b"]); // 'b' is not captured
    });

    it("handle nested import patterns recursively", () => {
      const { stripImport, getImports } = createStripper();
      const input = 'import("a").Foo<import("b").Bar<import("c").Baz>>';
      const result = stripImport(input);
      expect(result).toBe("Foo<Bar<Baz>>");
      expect(getImports()).toEqual(["a", "b", "c"]);
    });
  });
});
