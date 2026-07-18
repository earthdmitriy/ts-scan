import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getFileErrors } from "../check/getFileErrors.js";
import { getExportedSymbols } from "../exports/getExportedSymbols.js";
import { getTsMorphProjectForFile } from "../getTsMorphProject.js";
import { fetchImportedSymbols } from "../imports/fetchImportedSymbols.js";
import { resolveSymbol } from "../resolve/resolveSymbol.js";
import { requireAbsolutePath } from "../utils/pathUtils.js";

const server = new McpServer({
  name: "ts-scan",
  version: "1.0.0",
  description:
    "A collection of tools to analyze and understand TypeScript codebases, providing instant insights into type errors, imports, exports, and symbol definitions. Use it to navigate through *.ts files",
});

const textResult = (text: string) => ({
  content: [
    {
      type: "text" as const,
      text,
    },
  ],
});

server.registerTool(
  "check_type_errors",
  {
    description: `
Check whether a file currently has **any TypeScript errors** – errors, not just warnings.

**CRITICAL - When to use (workflow order):**
1. **Before editing** – to ensure you're not starting from a broken file (which would make your changes even harder to debug).
2. **After saving** – to prove your changes introduced zero type errors. This is your **immediate feedback loop**, much faster than running a full \`tsc\`.

**Never assume "the code looks fine"**. grep cannot detect type errors. This tool returns line‑accurate error messages that you can fix right away.

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).
`,
    inputSchema: z.object({
      file_path: z
        .string()
        .describe("Absolute path to the TypeScript file to check"),
    }),
  },
  async ({ file_path }: { file_path: string }) => {
    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = getFileErrors(absolute.data, projectResult.data.project);
    return {
      content: [
        {
          type: "text" as const,
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

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).

By default third-party (\`node_modules\`) types are summarized; pass \`detail: "full"\` for complete signatures.
`,
    inputSchema: z.object({
      file_path: z
        .string()
        .describe("Absolute path to the TypeScript file to check"),
      detail: z
        .enum(["compact", "full"])
        .optional()
        .describe(
          'Signature detail. "compact" (default) summarizes node_modules types; "full" expands everything.',
        ),
    }),
  },
  async ({
    file_path,
    detail,
  }: {
    file_path: string;
    detail?: "compact" | "full" | undefined;
  }) => {
    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = fetchImportedSymbols(
      absolute.data,
      projectResult.data.project,
      [],
      detail ?? "compact",
    );
    return textResult(result.success ? result.data : result.error);
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

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).

\`grep\` uses exact, case-sensitive export-name match with OR semantics. On zero matches the tool reports how many exports exist in the file.
`,
    inputSchema: z.object({
      file_path: z
        .string()
        .describe("Absolute path to the TypeScript file to check"),
      grep: z
        .array(z.string())
        .optional()
        .describe(
          "Optional exact export-name filters (case-sensitive). OR semantics: keep exports whose name equals any listed value.",
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
    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = getExportedSymbols(
      absolute.data,
      projectResult.data.project,
      grep,
      absolute.data,
    );
    return textResult(result.success ? result.data : result.error);
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

**relativeTo must be an absolute path** to the importing file (relative paths fail because the MCP server cwd is often not the project root).

When both a package entry (\`@scope/pkg\`) and a cross-package relative path match, prefer the **Recommended import** (package entry). Cross-package relatives are labeled as implementation paths.

**Mantra**: Name known = use \`resolve_symbol\`.
`,
    inputSchema: z.object({
      symbol: z.string().describe("Symbol name to resolve"),
      relativeTo: z
        .string()
        .describe(
          "Absolute path to the importing TypeScript file used as the resolve anchor",
        ),
    }),
  },
  async ({ symbol, relativeTo }: { symbol: string; relativeTo: string }) => {
    const absolute = requireAbsolutePath(relativeTo, "relativeTo");
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = resolveSymbol(
      symbol,
      projectResult.data.project,
      projectResult.data.resolved,
      absolute.data,
    );

    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
  },
);

export const startMcp = async (_port?: number) => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
