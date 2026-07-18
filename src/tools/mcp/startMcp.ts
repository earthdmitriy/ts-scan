import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getFileErrors } from "../check/getFileErrors.js";
import { getDiagnostics } from "../diagnostics/getDiagnostics.js";
import { getExportedSymbols } from "../exports/getExportedSymbols.js";
import { getTsMorphProjectForFile } from "../getTsMorphProject.js";
import { fetchImportedSymbols } from "../imports/fetchImportedSymbols.js";
import { findCallers } from "../findCallers/findCallers.js";
import { findReferences } from "../findReferences/findReferences.js";
import { goToDefinition } from "../goToDefinition/goToDefinition.js";
import { inspectPosition } from "../inspect/inspectPosition.js";
import {
  EntrypointKind,
  reachability,
} from "../reachability/reachability.js";
import { resolveSymbol } from "../resolve/resolveSymbol.js";
import { getSignatureHelp } from "../signatureHelp/getSignatureHelp.js";
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

/** XOR mode check kept in handlers so inputSchema stays a plain ZodObject (MCP SDK). */
const validatePositionOrSymbolMode = (input: {
  file_path?: string;
  line?: number;
  column?: number;
  symbol?: string;
  relativeTo?: string;
}): string | undefined => {
  const hasPosition =
    input.file_path !== undefined && input.line !== undefined;
  const hasSymbol =
    input.symbol !== undefined && input.relativeTo !== undefined;
  if (hasPosition === hasSymbol) {
    return "Provide exactly one mode: (file_path + line) or (symbol + relativeTo)";
  }
  if (
    hasPosition &&
    (input.symbol !== undefined || input.relativeTo !== undefined)
  ) {
    return "Position mode cannot include symbol/relativeTo";
  }
  if (
    hasSymbol &&
    (input.file_path !== undefined ||
      input.line !== undefined ||
      input.column !== undefined)
  ) {
    return "Symbol mode cannot include file_path/line/column";
  }
  return undefined;
};

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
  "inspect",
  {
    description: `
Inspect the TypeScript **symbol and type at a known file position** (IDE Hover).

**CRITICAL - When to use (workflow order):**
1. Use this **first** when you need the type or meaning of code at a known position (\`file\` + \`line\` [, \`column\`]).
2. Use it **instead of** opening the file, dumping AST, or grepping for declarations.
3. Call \`go_to_definition\` only when you then need the source definition location.

Returns symbol name, kind, type string, declaration location, enclosing function/class, JSDoc, and a cross-package \`importHint\` when applicable.

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).
Lines and columns are **1-based**. Omit \`column\` to inspect the first meaningful token on the line. \`compact\` defaults to true.
`,
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the TypeScript file"),
      line: z.number().int().positive().describe("1-based line number"),
      column: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "1-based column; omit to use the first meaningful token on the line",
        ),
      compact: z
        .boolean()
        .optional()
        .describe(
          "When true (default), truncate long types and return the first JSDoc paragraph only",
        ),
    }),
  },
  async ({
    file_path,
    line,
    column,
    compact,
  }: {
    file_path: string;
    line: number;
    column?: number | undefined;
    compact?: boolean | undefined;
  }) => {
    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = inspectPosition(
      {
        filePath: absolute.data,
        line,
        column,
        compact: compact ?? true,
      },
      projectResult.data.project,
      projectResult.data.resolved,
    );
    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
  },
);

server.registerTool(
  "get_diagnostics",
  {
    description: `
Get **TypeScript diagnostics** for a file or a line/column range (errors by default).

**CRITICAL - When to use (workflow order):**
1. **Call after every TypeScript edit.** Use a range to validate only changed lines.
2. Use this **instead of** running full builds, \`tsc\` on one file, or visually guessing type correctness.
3. Prefer a tight \`startLine\`/\`endLine\` range for the agent edit loop; omit the range for a whole-file check.

Default \`severity\` is \`error\` (warnings/suggestions excluded). Pass \`severity: "warning"\` or \`"all"\` when needed. Optional \`codes.include\` / \`codes.exclude\` filter diagnostic codes (include applied first, then exclude). Empty result is exactly \`✅ Ok\`.

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).
Lines and columns are **1-based**.
`,
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the TypeScript file"),
      startLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "1-based start line; omit with other range fields for whole file",
        ),
      endLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based end line (requires startLine)"),
      startColumn: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based start column (requires startLine)"),
      endColumn: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based end column (requires endLine)"),
      severity: z
        .enum(["error", "warning", "all"])
        .optional()
        .describe(
          'Diagnostic severity filter. "error" (default) = errors only; "warning" = warnings+suggestions; "all" = every category',
        ),
      codes: z
        .object({
          include: z
            .array(z.number().int())
            .optional()
            .describe("Keep only these diagnostic codes"),
          exclude: z
            .array(z.number().int())
            .optional()
            .describe("Drop these diagnostic codes (applied after include)"),
        })
        .optional()
        .describe("Optional diagnostic code filters"),
    }),
  },
  async ({
    file_path,
    startLine,
    endLine,
    startColumn,
    endColumn,
    severity,
    codes,
  }: {
    file_path: string;
    startLine?: number | undefined;
    endLine?: number | undefined;
    startColumn?: number | undefined;
    endColumn?: number | undefined;
    severity?: "error" | "warning" | "all" | undefined;
    codes?:
      | { include?: number[] | undefined; exclude?: number[] | undefined }
      | undefined;
  }) => {
    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = getDiagnostics(
      {
        filePath: absolute.data,
        startLine,
        endLine,
        startColumn,
        endColumn,
        severity: severity ?? "error",
        codes,
      },
      projectResult.data.project,
    );
    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
  },
);

server.registerTool(
  "go_to_definition",
  {
    description: `
Go to the **exact TypeScript declaration** at a known source position (IDE Go to Definition).

**CRITICAL - When to use (workflow order):**
1. Use this when you know a source position (\`file_path\` + \`line\` [, \`column\`]) and need the exact declaration.
2. Use it **instead of** reading candidate files, grep, ripgrep, or searching export text to find where a symbol is defined.
3. For type/hover information without navigation, use \`inspect\` first; call this only when you need the definition location.

Returns one or more definition locations (file, span, name, kind), marks \`external: true\` for \`node_modules\`, and includes a cross-package \`importHint\` when applicable. Empty structured results use \`reason: no_symbol|no_definition\` (not a crash).

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).
Lines and columns are **1-based**. Omit \`column\` to use the first identifier on the line.
`,
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the TypeScript file"),
      line: z.number().int().positive().describe("1-based line number"),
      column: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "1-based column; omit to use the first identifier on the line",
        ),
    }),
  },
  async ({
    file_path,
    line,
    column,
  }: {
    file_path: string;
    line: number;
    column?: number | undefined;
  }) => {
    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = goToDefinition(
      {
        filePath: absolute.data,
        line,
        column,
      },
      projectResult.data.project,
      projectResult.data.resolved,
    );
    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
  },
);

server.registerTool(
  "find_references",
  {
    description: `
Find **all TypeScript-identity references** to a symbol (IDE Find All References).

**CRITICAL - When to use (workflow order):**
1. Use **before changing, renaming, or deleting a symbol** to find every real reference.
2. Use it **instead of** grep/ripgrep or opening every importing file; comments and unrelated text matches are intentionally excluded.
3. Prefer position mode when you already know \`file_path\` + \`line\`; use symbol mode when you only know the export name + an absolute \`relativeTo\` anchor.

Returns classified hits (\`declaration|read|write|call|import|type|export\`), graph \`scope\`, and \`truncated\` when capped. Defaults: includeDeclaration/crossPackage/includeTests=true, maxResults=100 (hard max 1000).

Without a root TypeScript project-references solution, scope is owner+dependencies and/or workspace package.json dependents — cross-package consumers may still be incomplete.

**Paths must be absolute** (relative paths fail because the MCP server cwd is often not the project root).
Lines/columns are **1-based**. Omit \`column\` to land on the first identifier on the line (skips \`export\`/\`const\`/…). Provide exactly one mode: position (\`file_path\`+\`line\`) **or** symbol (\`symbol\`+\`relativeTo\`).
`,
    inputSchema: z
      .object({
        file_path: z
          .string()
          .optional()
          .describe("Absolute path for position mode"),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based line (position mode)"),
        column: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "1-based column; omit to use the first identifier on the line",
          ),
        symbol: z
          .string()
          .optional()
          .describe("Exported symbol name for symbol mode"),
        relativeTo: z
          .string()
          .optional()
          .describe("Absolute path used as resolve anchor for symbol mode"),
        includeDeclaration: z
          .boolean()
          .optional()
          .describe("Include declaration entries (default true)"),
        crossPackage: z
          .boolean()
          .optional()
          .describe(
            "Search the solution/project graph across packages (default true)",
          ),
        includeTests: z
          .boolean()
          .optional()
          .describe(
            "Include *.test.ts / *.spec.ts and conventional test roots (default true)",
          ),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Cap results (default 100, hard max 1000)"),
      })
      .strict(),
  },
  async (input) => {
    const {
      file_path,
      line,
      column,
      symbol,
      relativeTo,
      includeDeclaration,
      crossPackage,
      includeTests,
      maxResults,
    } = input as {
      file_path?: string;
      line?: number;
      column?: number;
      symbol?: string;
      relativeTo?: string;
      includeDeclaration?: boolean;
      crossPackage?: boolean;
      includeTests?: boolean;
      maxResults?: number;
    };

    const modeError = validatePositionOrSymbolMode({
      file_path,
      line,
      column,
      symbol,
      relativeTo,
    });
    if (modeError) {
      return textResult(modeError);
    }

    if (file_path !== undefined && line !== undefined) {
      const absolute = requireAbsolutePath(file_path);
      if (!absolute.success) {
        return textResult(absolute.error);
      }
      const projectResult = getTsMorphProjectForFile(absolute.data);
      if (!projectResult.success) {
        return textResult(projectResult.error);
      }
      const result = findReferences(
        {
          filePath: absolute.data,
          line,
          column,
          includeDeclaration,
          crossPackage,
          includeTests,
          maxResults,
        },
        projectResult.data.project,
        projectResult.data.resolved,
      );
      return textResult(
        result.success ? result.data.formattedOutput : result.error,
      );
    }

    const absolute = requireAbsolutePath(relativeTo!, "relativeTo");
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = findReferences(
      {
        symbol: symbol!,
        relativeTo: absolute.data,
        includeDeclaration,
        crossPackage,
        includeTests,
        maxResults,
      },
      projectResult.data.project,
      projectResult.data.resolved,
    );
    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
  },
);

server.registerTool(
  "find_callers",
  {
    description: `
Find the **static caller graph** for a function/method/callable (TypeScript Call Hierarchy).

**CRITICAL - When to use (workflow order):**
1. Use this when you need to know **who statically invokes** a callable.
2. Use it **instead of** grepping its name or reading likely caller files.
3. Results are a **static caller graph, not a runtime stack**.

Prefer position mode when you know \`file_path\` + \`line\`; use symbol mode for an export name + absolute \`relativeTo\`. Edge kinds: \`direct_call|new|tagged_template|jsx|unknown_ref\`. Defaults: maxDepth=2 (hard max 5), maxResults=50 (hard max 500), crossPackage/includeTests=true.

Without a root TypeScript project-references solution, scope is owner+dependencies and/or workspace package.json dependents — cross-package callers may still be incomplete.

**Paths must be absolute** (relative paths fail because the MCP server cwd is often not the project root).
Lines/columns are **1-based**. Omit \`column\` to land on the first identifier on the line (skips \`export\`/\`const\`/…). Provide exactly one mode: position (\`file_path\`+\`line\`) **or** symbol (\`symbol\`+\`relativeTo\`).
`,
    inputSchema: z
      .object({
        file_path: z
          .string()
          .optional()
          .describe("Absolute path for position mode"),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based line (position mode)"),
        column: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "1-based column; omit to use the first identifier on the line",
          ),
        symbol: z
          .string()
          .optional()
          .describe("Exported callable name for symbol mode"),
        relativeTo: z
          .string()
          .optional()
          .describe("Absolute path used as resolve anchor for symbol mode"),
        maxDepth: z
          .number()
          .int()
          .positive()
          .max(5)
          .optional()
          .describe("Caller graph depth (default 2, hard max 5)"),
        crossPackage: z
          .boolean()
          .optional()
          .describe(
            "Search the solution/project graph across packages (default true)",
          ),
        includeTests: z
          .boolean()
          .optional()
          .describe(
            "Include *.test.ts / *.spec.ts and conventional test roots (default true)",
          ),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe("Cap results (default 50, hard max 500)"),
      })
      .strict(),
  },
  async (input) => {
    const {
      file_path,
      line,
      column,
      symbol,
      relativeTo,
      maxDepth,
      crossPackage,
      includeTests,
      maxResults,
    } = input as {
      file_path?: string;
      line?: number;
      column?: number;
      symbol?: string;
      relativeTo?: string;
      maxDepth?: number;
      crossPackage?: boolean;
      includeTests?: boolean;
      maxResults?: number;
    };

    const modeError = validatePositionOrSymbolMode({
      file_path,
      line,
      column,
      symbol,
      relativeTo,
    });
    if (modeError) {
      return textResult(modeError);
    }

    if (file_path !== undefined && line !== undefined) {
      const absolute = requireAbsolutePath(file_path);
      if (!absolute.success) {
        return textResult(absolute.error);
      }
      const projectResult = getTsMorphProjectForFile(absolute.data);
      if (!projectResult.success) {
        return textResult(projectResult.error);
      }
      const result = findCallers(
        {
          filePath: absolute.data,
          line,
          column,
          maxDepth,
          crossPackage,
          includeTests,
          maxResults,
        },
        projectResult.data.project,
        projectResult.data.resolved,
      );
      return textResult(
        result.success ? result.data.formattedOutput : result.error,
      );
    }

    const absolute = requireAbsolutePath(relativeTo!, "relativeTo");
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = findCallers(
      {
        symbol: symbol!,
        relativeTo: absolute.data,
        maxDepth,
        crossPackage,
        includeTests,
        maxResults,
      },
      projectResult.data.project,
      projectResult.data.resolved,
    );
    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
  },
);

server.registerTool(
  "reachability",
  {
    description: `
Find **static paths from entrypoints** (package exports, tests, handlers, bins) to a callable target by walking callers upward.

**CRITICAL - When to use (workflow order):**
1. Use this to find **static paths from exports, tests, handlers, or bins to a target**.
2. Use it **instead of** manually reading callers across files or grepping for entrypoints.
3. It returns **multiple approximate static paths** and **never claims runtime order** (not a runtime stack / call_stack).

Prefer when you already know \`file_path\` + \`line\` for the target. Defaults: maxDepth=6, maxPaths=20. Optional \`entrypointKinds\` filters roots: \`export|test|handler|bin|unknown\`.

Handler heuristics (v1): \`wire-*-handlers\`, \`*handler*\` filenames, and \`attach*Bridge\` / bridge path names (medium confidence). Export roots use package.json#exports (incl. re-exports from the package entry). Without a TS project-references solution, graph scope may be workspace package.json dependents.

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).
Omit \`column\` to land on the first identifier on the line (skips \`export\`/\`const\`/…).
Lines/columns are **1-based**.
`,
    inputSchema: z
      .object({
        file_path: z.string().describe("Absolute path to the TypeScript file"),
        line: z.number().int().positive().describe("1-based line number"),
        column: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based column; omit to use the first token on the line"),
        maxDepth: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe("Max caller-walk depth (default 6, hard max 20)"),
        maxPaths: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Cap completed paths (default 20, hard max 100)"),
        entrypointKinds: z
          .array(
            z.enum(["export", "test", "handler", "bin", "unknown"]),
          )
          .optional()
          .describe(
            "Subset of entrypoint kinds to keep (default: all kinds)",
          ),
      })
      .strict(),
  },
  async (input) => {
    const {
      file_path,
      line,
      column,
      maxDepth,
      maxPaths,
      entrypointKinds,
    } = input as {
      file_path: string;
      line: number;
      column?: number;
      maxDepth?: number;
      maxPaths?: number;
      entrypointKinds?: EntrypointKind[];
    };

    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = reachability(
      {
        filePath: absolute.data,
        line,
        column,
        maxDepth,
        maxPaths,
        entrypointKinds,
      },
      projectResult.data.project,
    );
    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
  },
);

server.registerTool(
  "signature_help",
  {
    description: `
Get **Parameter Hints** at a known call site: active overload, active argument index, and parameter labels (IDE signature help).

**CRITICAL - When to use (workflow order):**
1. Use while **writing or fixing arguments** at a known call site (\`file_path\` + \`line\` + \`column\`).
2. Use it **instead of** opening the callee implementation or dependency declarations to discover overloads and parameters.
3. Prefer this over \`inspect\` when you specifically need which argument slot you are in and which overload TypeScript selected.

Returns \`status: found|not_in_call\`, \`activeSignature\`, \`activeParameter\`, and compact signature/parameter labels. \`column\` is **required**. Outside a call context returns \`not_in_call\` (success, not a crash).

**file_path must be an absolute path** (relative paths fail because the MCP server cwd is often not the project root).
Lines and columns are **1-based**.
`,
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the TypeScript file"),
      line: z.number().int().positive().describe("1-based line number"),
      column: z
        .number()
        .int()
        .positive()
        .describe("1-based column inside the call or on the argument list"),
    }),
  },
  async ({
    file_path,
    line,
    column,
  }: {
    file_path: string;
    line: number;
    column: number;
  }) => {
    const absolute = requireAbsolutePath(file_path);
    if (!absolute.success) {
      return textResult(absolute.error);
    }
    const projectResult = getTsMorphProjectForFile(absolute.data);
    if (!projectResult.success) {
      return textResult(projectResult.error);
    }
    const result = getSignatureHelp(
      {
        filePath: absolute.data,
        line,
        column,
      },
      projectResult.data.project,
      projectResult.data.resolved,
    );
    return textResult(
      result.success ? result.data.formattedOutput : result.error,
    );
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
