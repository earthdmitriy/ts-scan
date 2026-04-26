import { createServer } from "http";
import path from "path";
import * as z from "zod";
import { McpServer } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { StreamableHTTPServerTransport } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js";
import { getFileErrors } from "../check/getFileErrors.js";
import { createTsMorphProject } from "../createTsMorphProject.js";
import { cachedResolveExportInNodeModules } from "../exportCache/exportCache.js";
import { getExportedSymbols } from "../exports/getExportedSymbols.js";
import { fetchImportedSymbols } from "../imports/fetchImportedSymbols.js";
import { resolveLocalExport } from "../resolve/resolveLocalExport.js";

/**
 * Normalize file paths: resolve relative paths against cwd, keep absolute paths as-is.
 * Ensures MCP server works from any directory with consistent path resolution.
 */
const normalizePath = (filePath: string): string => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
};

const server = new McpServer({
  name: "ts-scan",
  version: "0.0.1",
});

const project = createTsMorphProject();

server.registerTool(
  "check_type_errors",
  {
    description: "Show TypeScript errors for a file",
    inputSchema: z.object({
      file_path: z.string().describe("Path to the TypeScript file to check"),
    }),
  },
  async ({ file_path }: { file_path: string }) => {
    const normalizedPath = normalizePath(file_path);
    const result = getFileErrors(normalizedPath, project);
    return {
      content: [
        {
          type: "text",
          text: result.success ? result.data || "✅ Ok" : result.error,
          annotations: { audience: ["assistant"], priority: 1 },
        },
      ],
    };
  }
);

server.registerTool(
  "list_imports",
  {
    description: "List all imported symbols with signatures and JSDoc",
    inputSchema: z.object({
      file_path: z.string().describe("Path to the TypeScript file to check"),
    }),
  },
  async ({ file_path }: { file_path: string }) => {
    const normalizedPath = normalizePath(file_path);
    const result = fetchImportedSymbols(normalizedPath, project);
    return {
      content: [
        {
          type: "text",
          text: result.success ? result.data : result.error,
        },
      ],
    };
  }
);

server.registerTool(
  "list_exports",
  {
    description: "List all exported symbols with signatures and JSDoc",
    inputSchema: z.object({
      file_path: z.string().describe("Path to the TypeScript file to check"),
    }),
  },
  async ({ file_path }: { file_path: string }) => {
    const normalizedPath = normalizePath(file_path);
    const result = getExportedSymbols(normalizedPath, project);
    return {
      content: [
        {
          type: "text",
          text: result.success ? result.data : result.error,
        },
      ],
    };
  }
);

server.registerTool(
  "resolve_symbol",
  {
    description: "Find the import path for a given exported symbol",
    inputSchema: z.object({
      symbol: z.string().describe("Symbol name to resolve"),
      relativeTo: z
        .string()
        .optional()
        .describe("Relative file path to resolve from (for local exports)"),
    }),
  },
  async ({ symbol, relativeTo }: { symbol: string; relativeTo?: string }) => {
    const localResult = resolveLocalExport(symbol, relativeTo);
    const nodeResult = cachedResolveExportInNodeModules(symbol);

    let res = "";

    localResult.success &&
      localResult.data.length > 0 &&
      localResult.data.forEach((x) => {
        res += `\n✅ Found in: ${x.path}\n   import { ${symbol} } from "${x.relative}";`;

        const exports = getExportedSymbols(x.path, project, [symbol]);
        exports.success && (res += `\n${exports.data}`);
      });

    nodeResult.success &&
      nodeResult.data.length > 0 &&
      nodeResult.data.forEach((x) => {
        res += `\n✅ Found in: ${x}\n   import { ${symbol} } from "${x}";`;

        const exports = getExportedSymbols(x, project, [symbol]);
        exports.success && (res += `\n${exports.data}`);
      });

    return {
      content: [
        {
          type: "text",
          text: res
            ? res
            : "❌ Symbol not found in local files or node_modules. Consider checking for typos or if the symbol is indeed exported.",
        },
      ],
    };
  }
);

export const startMcp = async (port?: number) => {
  if (port) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    await server.connect(transport);

    const server_ = createServer((req, res) => {
      transport.handleRequest(req, res);
    });

    server_.listen(port, () => {
      console.log(`MCP server running on http://localhost:${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
};
