---
name: type-safe-coder
description: Write TypeScript code that compiles on the first try. Use ts‑scan to collect type information before editing, then validate your changes immediately after saving.
---

## ⚠️ CRITICAL RULES – VIOLATIONS WILL CAUSE TYPE ERRORS

- **NEVER use `grep`, `find`, `rg`, `ag`, or any text‑based search** to discover TypeScript types, imports, exports, or symbol locations.
- **NEVER read a file’s contents directly** (with `read_file`, `cat`, etc.) **without first calling `ts-scan_list_exports` on that file**. The exports tell you the module’s official public API – reading the file raw encourages guessing internal implementation.
- **NEVER assume an import path** – always resolve it with `ts-scan_resolve_symbol`.
- **NEVER write code that imports a function/type without first verifying its signature** using `ts-scan_list_exports` (for external modules) or `ts-scan_list_imports` (for existing dependencies).
- **ALWAYS call `ts-scan_check_type_errors` after saving a file** – if there are errors, fix them immediately.

## Why raw file reads are forbidden before `list_exports`

- Reading a file gives you implementation details, not the **public contract**. You might use a private function or a non‑exported type, causing compile errors.
- `ts-scan_list_exports` returns exactly what is available to import – with signatures, JSDoc, and export kind (type/value). That is the safe basis for writing correct imports.
- If you read a file first, you’re likely to copy internal paths or use non‑canonical import specifiers. Always let the TypeScript compiler (via ts-scan) tell you what the module exposes.

## Mandatory Pre‑edit Workflow (execute in this order, never skip)

Before you modify or read **any** TypeScript file:

1. **If you plan to import from a module**, first call `ts-scan_list_exports` on that module’s file path.  
   → This tells you the exact public API. **Do not read the module file directly** unless you have already called `list_exports` and still need clarification.

2. **List current imports** – call `ts-scan_list_imports` on the file you’ll edit.  
   → This tells you what the file already relies on, so you don't duplicate or conflict.

3. **If you need a symbol from another module**, call `ts-scan_resolve_symbol` with the symbol name.  
   → This gives you the exact import path. Do not grep and do not guess.

4. **(Optional but recommended)** Call `ts-scan_check_type_errors` on the file you’re about to edit.  
   → If there are pre‑existing errors, report them.

Only after steps 1–4 can you **read** the file (if you still need to) and then write or generate code.

## Mandatory Post‑edit Validation (always do this)

After you save your changes, immediately call:

```
ts-scan_check_type_errors(file_path = "<file you just changed>")
```

- **If the returned array is empty** → your changes are type‑safe. Proceed.
- **If errors are present** → examine each error. Fix them **before** moving on.

## Available MCP Tools (use these before any file read)

| Tool | Required parameter | When to use |
|------|-------------------|--------------|
| `ts-scan_list_exports` | `file_path` (string) | **Before reading any module** – see its public API |
| `ts-scan_list_imports` | `file_path` (string) | **Before editing a file** – see existing dependencies |
| `ts-scan_resolve_symbol` | `symbol` (string) | **Before importing an unknown symbol** – find its location |
| `ts-scan_check_type_errors` | `file_path` (string) | **Before edit** (optional) and **always after save** |

## Example Correct Behavior (internal monologue)

> User: “Read `src/utils/logger.ts` and tell me what logging functions are available.”
>
> Agent (with this skill):
> 1. “I must not read the file directly. I will call `ts-scan_list_exports` first.”
> 2. Call `ts-scan_list_exports` with `{ "file_path": "src/utils/logger.ts" }` → receives: `["log", "error", "warn"]` with signatures.
> 3. Now that I know the public API, I can optionally read the file for implementation details, but I can already answer the user’s question from the exports.

## What to do if the MCP server is not responding

If any `ts-scan_*` tool returns an error, do **not** fall back to reading files or grepping. Inform the user:

> “The ts-scan MCP server is not available. Please start it with `npx ts-scan --mcp` and ensure OpenCode is connected. I cannot safely inspect TypeScript modules without it.”

## Integration note

This skill works alongside `dependency-planner`. Both require the same MCP server. Once the server is running, `list_exports` is your **gateway** before any file read.