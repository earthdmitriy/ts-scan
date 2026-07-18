---
name: dependency-planner
description: Understand TypeScript project structure and dependencies before writing code. Use ts-scan MCP tools to inspect imports, exports, types, and symbol locations — so your changes are correct from the first line.
---

## Critical Rules (MUST FOLLOW)

- **NEVER use `grep`, `find`, or manual file searching** to discover imports, exports, or symbol locations.
- **ALWAYS run exploring subagents with skill**
- **ALWAYS use the ts-scan MCP tools** described below for any dependency analysis.
- If you are about to edit a file and you haven't run `list_imports` on it, **stop and run it first**.
- When you need a function’s signature or origin, **call `resolve_symbol`** – do not guess or search the codebase manually.
- Before changing a shared API, run `find_references` (and `find_callers` for callables). Use `reachability` to see static paths from package exports/tests/handlers.
- **Paths:** MCP `file_path` / `relativeTo` must be **absolute**.

## Why grep is wrong here

- grep only finds raw text, not **resolved** imports or exports.
- It cannot tell you the **public API** of a module (what is actually exported).
- It cannot find a symbol’s **canonical import path** across re-exports.
- ts-scan gives you **structured data** with types and JSDoc – grep gives you lines of text.

## Available MCP Tools (call these, not grep)

| Tool | What it tells you | Example args |
|------|-------------------|--------------|
| `list_imports` | Every import in a file, with signatures and JSDoc | `{ "file_path": "<abs>/Header.tsx" }` |
| `list_exports` | Public exports of a module | `{ "file_path": "<abs>/api.ts" }` |
| `resolve_symbol` | Where a symbol is defined and how to import it | `{ "symbol": "formatDate", "relativeTo": "<abs>/newFeature.ts" }` |
| `check_type_errors` | Type errors in a file | `{ "file_path": "<abs>/oldFile.ts" }` |
| `inspect` | Hover type/JSDoc at a position | `{ "file_path": "<abs>/f.ts", "line": 42 }` |
| `go_to_definition` | Declaration location | `{ "file_path": "<abs>/f.ts", "line": 42 }` |
| `find_references` | Identity references (position or symbol mode) | `{ "symbol": "X", "relativeTo": "<abs>/a.ts" }` |
| `find_callers` | Static callers of a callable | `{ "symbol": "fn", "relativeTo": "<abs>/a.ts" }` |
| `reachability` | Paths from entrypoints to a target | `{ "file_path": "<abs>/f.ts", "line": 1 }` |
| `signature_help` | Active argument at a call site | `{ "file_path": "<abs>/c.ts", "line": 10, "column": 20 }` |
| `get_diagnostics` | Range-scoped diagnostics | `{ "file_path": "<abs>/f.ts", "startLine": 1, "endLine": 40 }` |

## Mandatory Workflow (execute exactly as written)

Before writing ANY code:

1. **Identify the files you will modify or depend on.**
2. **Run `list_imports` on each target file** – record their current dependencies.
3. **For any external module you plan to use**, run `list_exports` on it. Check that the function/type you need exists.
4. **If you have a symbol name but not its location**, run `resolve_symbol` to get the correct import path (prefer **Recommended import**).
5. **Optional but recommended**: Run `check_type_errors` on the file you’re editing to confirm it’s not already broken.
6. **If changing a shared symbol**, run `find_references` / `find_callers` first; use `reachability` for “is this dead / only handler-wired?” questions.
7. **Only then** generate your code changes – using the exact import paths and types returned by the tools.

## When you are tempted to grep

If you catch yourself typing `grep -r "functionName"` or `find . -name "*.ts" | xargs grep`, **stop**. Instead, call `resolve_symbol` (name known) or `find_references` / `go_to_definition` (position known). It is faster and always correct.

## MCP Server Status

The ts-scan MCP server must be running. If you get a “tool not found” error, remind the user to start it with:

```bash
ts-scan --mcp
# or
npx ts-scan --mcp
npx ts-scan --mcp --port 3000
```
