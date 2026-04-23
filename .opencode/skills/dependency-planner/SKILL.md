---
name: dependency-planner
description: Understand TypeScript project structure and dependencies before writing code. Use ts-scan MCP tools to inspect imports, exports, types, and symbol locations — so your changes are correct from the first line.
---

## Critical Rules (MUST FOLLOW)

- **NEVER use `grep`, `find`, or manual file searching** to discover imports, exports, or symbol locations.
- **ALWAYS run exploring subagents with skill**
- **ALWAYS use the ts-scan MCP tools** described below for any dependency analysis.
- If you are about to edit a file and you haven't run `ts-scan_list_imports` on it, **stop and run it first**.
- When you need a function’s signature or origin, **call `ts-scan_resolve_symbol`** – do not guess or search the codebase manually.

## Why grep is wrong here

- grep only finds raw text, not **resolved** imports or exports.
- It cannot tell you the **public API** of a module (what is actually exported).
- It cannot find a symbol’s **canonical import path** across re-exports.
- ts-scan gives you **structured data** with types and JSDoc – grep gives you lines of text.

## Available MCP Tools (call these, not grep)

| Tool | What it tells you | Example call (in agent’s mind) |
|------|------------------|-------------------------------|
| `ts-scan_list_imports` | Every import in a file, with signatures and JSDoc | `{ "file_path": "src/components/Header.tsx" }` |
| `ts-scan_list_exports` | Public exports of a module | `{ "file_path": "src/utils/api.ts" }` |
| `ts-scan_resolve_symbol` | Where a symbol is defined and how to import it | `{ "symbol": "formatDate", "relative_to": "src/newFeature.ts" }` |
| `ts-scan_check_type_errors` | Type errors in a file before editing | `{ "file_path": "src/oldFile.ts" }` |

## Mandatory Workflow (execute exactly as written)

Before writing ANY code:

1. **Identify the files you will modify or depend on.**
2. **Run `ts-scan_list_imports` on each target file** – record their current dependencies.
3. **For any external module you plan to use** (e.g., `utils/logger`), run `ts-scan_list_exports` on it. Check that the function/type you need exists.
4. **If you have a symbol name but not its location** (e.g., `formatDate`), run `ts-scan_resolve_symbol` to get the correct import path.
5. **Optional but recommended**: Run `ts-scan_check_type_errors` on the file you’re editing to confirm it’s not already broken.
6. **Only then** generate your code changes – using the exact import paths and types returned by the tools.

## When you are tempted to grep

If you catch yourself typing `grep -r "functionName"` or `find . -name "*.ts" | xargs grep`, **stop**. Instead, call `ts-scan_resolve_symbol`. It is faster and always correct.

## MCP Server Status

The ts-scan MCP server must be running. If you get a “tool not found” error, remind the user to start it with:
```bash
npx ts-scan --mcp
npx ts-scan --mcp --port 3000

```