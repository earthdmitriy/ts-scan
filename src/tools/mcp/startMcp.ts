import { createServer } from "http";
import path from "path";
import * as z from "zod";
import { McpServer } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { StreamableHTTPServerTransport } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js";
import pkg from '../../../package.json' with { type: 'json' };
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
  version:pkg.version,
  description: "A collection of tools to analyze and understand TypeScript codebases, providing instant insights into type errors, imports, exports, and symbol definitions. Use it to navigate through *.ts files",
});

const project = createTsMorphProject();

server.registerTool(
  "check_type_errors",
  {
    description: `
Check whether a file currently has **any TypeScript errors** – errors, not just warnings.

**CRITICAL - When to use (workflow order):**
1. **Before editing** – to ensure you're not starting from a broken file (which would make your changes even harder to debug).
2. **After saving** – to prove your changes introduced zero type errors. This is your **immediate feedback loop**, much faster than running a full \`tsc\`.

**Never assume "the code looks fine"**. grep cannot detect type errors. This tool returns line‑accurate error messages that you can fix right away.
`,
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
    description: `
Get **every import** a TypeScript file currently has – including resolved symbol names, their types, and any JSDoc comments.

**CRITICAL - When to use (workflow order):**
Call this immediately after you identify a file you plan to edit, before writing any code or modifying imports. Do not read the file first – this gives you structured import data directly.
`,
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
    description: `
Instantly reveal the **public API** of any module – all exported symbols, their **type definitions** (full signatures), and their JSDoc comments – without opening the file.

**Never use \`grep "export"\` or \`cat\` on a module file again.**  
- \`grep\` shows you *every* export line, including internal/helper exports that aren't meant for you.  
- \`list_exports\` returns exactly what the module *intends* to expose, with **complete type information** (parameter types, return types, generics) and proper import specifiers.

Use this **before you write any \`import\` statement** – it guarantees you import something that actually exists, have its full type signature at hand, and avoid type errors from the start.
`,
    inputSchema: z.object({
      file_path: z.string().describe("Path to the TypeScript file to check"),
      grep: z
        .array(z.string())
        .optional()
        .describe(
          "Optional filter to only show exports matching this string (case-sensitive)"
        ),
    }),
  },
  async ({
    file_path,
    grep,
  }: {
    file_path: string;
    grep?: string[] | undefined;
  }) => {
    const normalizedPath = normalizePath(file_path);
    const result = getExportedSymbols(normalizedPath, project, grep);
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


//| `resolve_symbol` | The correct import path for a named export | When you **know the function name** but not where it's exported from (local or `node_modules`) |
// | `resolve_symbol` | The correct import path for a named export | **MUST use** when you know a symbol name but not its location. **NEVER** grep, read files, or use semantic_search to find where something is exported. If you know the name → call this FIRST. |
//| `resolve_symbol` | The correct import path + full type signature + JSDoc | **ALWAYS call this FIRST** when you know a function/class name. **FORBIDDEN**: grepping `export`, reading files to find definitions, using `semantic_search` for symbol location. **Mantra**: Name known = use `resolve_symbol`. |
// | `resolve_symbol` | The correct import path for a named export | **STEP 1** when you see a symbol name in instructions, TODOs, or existing code. **STOP** if you're about to grep/read/search for where something is defined. **INSTEAD**: call `resolve_symbol`. No exceptions. |
// | `resolve_symbol` | The correct import path + full type signature + JSDoc | **🛑 STOP — READ THIS FIRST** — When you know a symbol name (from instructions, TODOs, or code), **YOU MUST CALL THIS TOOL FIRST**. **NEVER** use grep, `semantic_search`, `file_search`, or read files to find where something is exported. **The tool exists specifically for this scenario.** |
server.registerTool(
  "resolve_symbol",
  {
    description: `
Give it a **symbol name** (e.g., \`formatDate\`, \`UserType\`) – get back the **exact import path**, the symbol's **type definition** (full signature), and its **JSDoc comment**.

**STEP 1** when you see a symbol name in instructions, TODOs, prompt, or existing code. **STOP** if you're about to grep/read/search for where something is defined. **INSTEAD**: call \`resolve_symbol\`. No exceptions.

**CRITICAL - When to use (workflow order):**
1. When you know (or guess) a symbol name from TODO/instructions/prompt OR asked to "tell me about X" OR explore the codebase → call this tool FIRST. No exceptions.
2. Before refactoring code → resolve all symbols you plan to use
3. When you see a symbol in existing code that you need → resolve it immediately
4. NEVER read multiple files, grep, or explore to find symbol definitions
5. If you catch yourself reading files to find where something is exported → STOP and use this tool

**What you receive:** the tool returns:
- The **import path** – exactly what to write in your import statement.
- The **JSDoc** – any documentation attached to the symbol.
- The **type definition** – the complete signature (parameters, return type, generics).

That means you have enough information to start using the symbol immediately – no need to call \`list_exports\` or read the target file separately.

**Mantra**: Name known = use \`resolve_symbol\`.
`,
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
