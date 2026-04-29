import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getFileErrors } from "../check/getFileErrors.js";
import { createTsMorphProject } from "../createTsMorphProject.js";
import { getExportedSymbols } from "../exports/getExportedSymbols.js";
import { fetchImportedSymbols } from "../imports/fetchImportedSymbols.js";
import { resolveSymbol } from "../resolve/resolveSymbol.js";
import { normalizePath } from "../utils/pathUtils.js";

const server = new McpServer({
  name: "ts-scan",
  version: "1.0.0",
  description:
    "A collection of tools to analyze and understand TypeScript codebases, providing instant insights into type errors, imports, exports, and symbol definitions. Use it to navigate through *.ts files",
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
  },
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
  },
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
          "Optional filter to only show exports matching this string (case-sensitive)",
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
  },
);

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
    const result = resolveSymbol(symbol, project, relativeTo);

    return {
      content: [
        {
          type: "text",
          text: result.success ? result.data.formattedOutput : result.error,
        },
      ],
    };
  },
);

export const startMcp = async (port?: number) => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
