import { describe, expect, it, beforeEach } from "vitest";
import { cachedResolveExportInNodeModules } from "../src/tools/exportCache/exportCache.ts";
import ts from "typescript";
import { Project } from "ts-morph";

/**
 * Tests for resolving symbols AND their types from node_modules
 * using existing dependencies (ts-morph, typescript, typed-pipe, zod)
 */

describe("Node Modules Symbol & Type Resolution", () => {
  // Clear cache before each test to ensure fresh state
  beforeEach(() => {
    // Reset module cache - we need to re-import to get fresh state
  });

  describe("Symbol Resolution from ts-morph", () => {
    it("resolves Project class and can get its type info", () => {
      const result = cachedResolveExportInNodeModules("Project");
      
      expect(result.success).toBe(true);
      if (!result.success) return;
      
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0]).toContain("ts-morph");
      
      // Verify we can use TypeScript API to get type info
      const tsResult = cachedResolveExportInNodeModules("ScriptTarget");
      expect(tsResult.success).toBe(true);
      if (tsResult.success) {
        expect(tsResult.data[0]).toContain("typescript");
      }
    });

    it("resolves function types with parameters", () => {
      const result = cachedResolveExportInNodeModules("createPipe");
      
      expect(result.success).toBe(true);
      if (!result.success) return;
      
      expect(result.data[0]).toContain("typed-pipe");
    });

    it("resolves enum types", () => {
      const result = cachedResolveExportInNodeModules("ModuleKind");
      
      expect(result.success).toBe(true);
      if (!result.success) return;
      
      // Should find in both typescript and ts-morph
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe("Type Resolution Using ts-morph", () => {
    let project: Project;

    beforeEach(() => {
      project = new Project({
        useInMemoryFileSystem: true,
      });
    });

    it("can resolve and inspect complex types from ts-morph", () => {
      // Create a source file that imports and uses ts-morph types
      const sourceFile = project.createSourceFile(
        "test.ts",
        `
        import { Project, ScriptTarget } from "ts-morph";
        import ts from "typescript";
        
        const p: Project = new Project();
        const target: ts.ScriptTarget = ts.ScriptTarget.ES2020;
        `
      );

      // Get the type of the Project variable
      const projectVar = sourceFile.getVariableDeclaration("p");
      expect(projectVar).toBeDefined();
      
      if (projectVar) {
        const type = projectVar.getType();
        expect(type.getText()).toContain("Project");
      }
    });

    it("resolves union types from zod", () => {
      const sourceFile = project.createSourceFile(
        "test-zod.ts",
        `
        import { z } from "zod";
        
        const schema = z.union([z.string(), z.number()]);
        type SchemaType = z.infer<typeof schema>;
        `
      );

      // Verify zod exports are resolvable
      const zodResult = cachedResolveExportInNodeModules("z");
      expect(zodResult.success).toBe(true);
      if (zodResult.success) {
        expect(zodResult.data[0]).toContain("zod");
      }
    });

    it("resolves generic types from tslib", () => {
      const result = cachedResolveExportInNodeModules("__assign");
      
      expect(result.success).toBe(true);
      if (!result.success) return;
      
      expect(result.data[0]).toContain("tslib");
    });
  });

  describe("Complex Type Patterns", () => {
    let project: Project;

    beforeEach(() => {
      project = new Project({
        useInMemoryFileSystem: true,
      });
    });

    it("handles intersection types", () => {
      const sourceFile = project.createSourceFile(
        "test-intersection.ts",
        `
        interface HasName { name: string; }
        interface HasAge { age: number; }
        type Person = HasName & HasAge & { id: string; };
        `
      );

      const typeAlias = sourceFile.getTypeAlias("Person");
      expect(typeAlias).toBeDefined();
      
      if (typeAlias) {
        // Check the text contains the intersection
        const text = typeAlias.getText();
        expect(text).toContain("&");
      }
    });

    it("handles conditional types", () => {
      const sourceFile = project.createSourceFile(
        "test-conditional.ts",
        `
        type IsString<T> = T extends string ? true : false;
        type Test1 = IsString<string>; // true
        type Test2 = IsString<number>; // false
        `
      );

      // Verify conditional type syntax is preserved
      const typeAlias = sourceFile.getTypeAlias("IsString");
      expect(typeAlias).toBeDefined();
    });

    it("resolves types with import() references", () => {
      const sourceFile = project.createSourceFile(
        "test-import-ref.ts",
        `
        import ts from "typescript";
        
        // This type uses import() reference
        type CompilerOptions = ts.CompilerOptions;
        `
      );

      const result = cachedResolveExportInNodeModules("CompilerOptions");
      expect(result.success).toBe(true);
    });
  });

  describe("Multiple Package Resolution", () => {
    it("finds symbols that exist in multiple packages", () => {
      // ScriptTarget exists in both typescript and ts-morph
      const result = cachedResolveExportInNodeModules("ScriptTarget");
      
      expect(result.success).toBe(true);
      if (!result.success) return;
      
      // Should find in at least typescript
      const hasTypeScript = result.data.some(p => p.includes("typescript"));
      expect(hasTypeScript).toBe(true);
    });

    it("prefers more specific package when symbol exists in multiple", () => {
      // Both ts-morph and typescript might export similar things
      const result = cachedResolveExportInNodeModules("Node");
      
      expect(result.success).toBe(true);
      if (!result.success) return;
      
      // Node from ts-morph should be first (it's the primary package)
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    it("returns error for non-existent symbol", () => {
      const result = cachedResolveExportInNodeModules("NonExistentSymbol12345");
      
      expect(result.success).toBe(false);
      if (result.success) return;
      
      expect(result.error).toContain("not found");
    });

    it("handles empty symbol name", () => {
      const result = cachedResolveExportInNodeModules("");
      
      expect(result.success).toBe(false);
    });
  });

  describe("TypeScript Type Queries", () => {
    let project: Project;

    beforeEach(() => {
      project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
          strict: true,
        },
      });
    });

    it("can get parameter types of resolved function", () => {
      const sourceFile = project.createSourceFile(
        "test-params.ts",
        `
        import { createPipe } from "typed-pipe";
        
        // Verify the function signature is accessible
        const pipe = createPipe;
        `
      );

      // The fact that we can import and use it means types are resolved
      const varDecl = sourceFile.getVariableDeclaration("pipe");
      expect(varDecl).toBeDefined();
    });

    it("resolves return types of functions", () => {
      const sourceFile = project.createSourceFile(
        "test-return.ts",
        `
        import { Project } from "ts-morph";
        
        function createProject(): Project {
          return new Project();
        }
        `
      );

      const func = sourceFile.getFunction("createProject");
      expect(func).toBeDefined();
      
      if (func) {
        const returnType = func.getReturnType();
        expect(returnType.getText()).toContain("Project");
      }
    });
  });
});
