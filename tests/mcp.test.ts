import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TextContent = { type: "text"; text: string };

const isTextContentArray = (value: unknown): value is TextContent[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (item): item is TextContent =>
      typeof item === "object" &&
      item !== null &&
      (item as any).type === "text" &&
      typeof (item as any).text === "string"
  );

describe("MCP Server (integration)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Create client with stdio transport
    transport = new StdioClientTransport({
      command: "node",
      args: ["dist/cli.js", "--mcp"],
    });

    client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    await client.connect(transport);
  }, 10000);

  afterAll(async () => {
    await client.close();
  });

  it("should connect to MCP server", async () => {
    expect(client).toBeDefined();
  });

  describe("Tools", () => {
    it("should list all available tools", async () => {
      const toolsResponse = await client.listTools();

      expect(toolsResponse.tools).toBeDefined();
      expect(toolsResponse.tools.length).toBeGreaterThan(0);

      const toolNames = toolsResponse.tools.map((t) => t.name);
      expect(toolNames).toContain("check_type_errors");
      expect(toolNames).toContain("list_imports");
      expect(toolNames).toContain("list_exports");
      expect(toolNames).toContain("resolve_symbol");
    });

    describe("check_type_errors", () => {
      it("should check type errors in a file", async () => {
        const result = await client.callTool({
          name: "check_type_errors",
          arguments: {
            file_path: "src/types.ts",
          },
        });

        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        expect(result.content[0].type).toBe("text");
        expect(typeof result.content[0].text).toBe("string");
      });

      it("should return 'Ok' for a file with no errors", async () => {
        const result = await client.callTool({
          name: "check_type_errors",
          arguments: {
            file_path: "src/types.ts",
          },
        });

        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        const text = result.content[0].text;

        expect(text).toBe("✅ Ok");
      });
    });

    describe("list_exports", () => {
      it("should list exported symbols from a file", async () => {
        const result = await client.callTool({
          name: "list_exports",
          arguments: {
            file_path: "src/types.ts",
          },
        });
        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        expect(result.content[0].type).toBe("text");

        const text = result.content[0].text;
        expect(text).toContain("export export type Result<T>");
        // Should contain at least one export
        expect(text.length).toBeGreaterThan(
          "export export type Result<T>".length
        );
      });

      it("should include export names in output", async () => {
        const result = await client.callTool({
          name: "list_exports",
          arguments: {
            file_path: "src/types.ts",
          },
        });
        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        const text = result.content[0].text;
        // Check for known exports from types.ts
        expect(text).toMatch(/Result|success|error/);
      });
    });

    describe("list_imports", () => {
      it("should list imported symbols from a file", async () => {
        const result = await client.callTool({
          name: "list_imports",
          arguments: {
            file_path: "src/router.ts",
          },
        });
        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        expect(result.content[0].type).toBe("text");

        const text = result.content[0].text;
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
      });

      it("should show imports with proper formatting", async () => {
        const result = await client.callTool({
          name: "list_imports",
          arguments: {
            file_path: "src/router.ts",
          },
        });
        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        const text = result.content[0].text;
        // Should contain import information
        expect(text).toMatch(/Types and JSdoc:|import|from/);
      });
    });

    describe("resolve_symbol", () => {
      it("should attempt to resolve a symbol", async () => {
        const result = await client.callTool({
          name: "resolve_symbol",
          arguments: {
            symbol: "NonExistentSymbol",
          },
        });
        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        expect(result.content[0].type).toBe("text");
        const text = result.content[0].text;
        // Should return either found message or not found message
        expect(typeof text).toBe("string");
      });

      it("should indicate when a symbol is not found", async () => {
        const result = await client.callTool({
          name: "resolve_symbol",
          arguments: {
            symbol: "NonExistentSymbol123",
          },
        });
        expect(isTextContentArray(result.content)).toBe(true);
        if (!isTextContentArray(result.content)) return;

        const text = result.content[0].text;
        expect(text).toContain("not found");
      });
    });
  });
});
