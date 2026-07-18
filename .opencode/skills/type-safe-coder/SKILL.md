---
name: type-safe-coder
description: Write TypeScript code that compiles on the first try. Use ts-scan to collect type information before editing, then validate your changes immediately after saving.
---

## CRITICAL RULES – VIOLATIONS WILL CAUSE TYPE ERRORS

- **NEVER use `grep`, `find`, `rg`, `ag`, or any text-based search** to discover TypeScript types, imports, exports, or symbol locations.
- **NEVER read a file’s contents directly** (with `read_file`, `cat`, etc.) **without first calling `list_exports` on that file**. The exports tell you the module’s official public API – reading the file raw encourages guessing internal implementation.
- **NEVER assume an import path** – always resolve it with `resolve_symbol`.
- **NEVER write code that imports a function/type without first verifying its signature** using `list_exports` (for external modules) or `list_imports` (for existing dependencies).
- **ALWAYS call `check_type_errors` after saving a file** – if there are errors, fix them immediately.
- Prefer position tools (`inspect`, `go_to_definition`, `signature_help`) over opening files when you already know `file_path` + `line`.
- Before rename/delete/API change, call `find_references` (and `find_callers` for callables). Use `reachability` when asking whether something is wired from package exports/tests/handlers.

**Paths:** MCP `file_path` / `relativeTo` must be **absolute**.

## Why raw file reads are forbidden before `list_exports`

- Reading a file gives you implementation details, not the **public contract**. You might use a private function or a non-exported type, causing compile errors.
- `list_exports` returns exactly what is available to import – with signatures, JSDoc, and export kind (type/value). That is the safe basis for writing correct imports.
- If you read a file first, you’re likely to copy internal paths or use non-canonical import specifiers. Always let the TypeScript compiler (via ts-scan) tell you what the module exposes.

## Mandatory Pre-edit Workflow (execute in this order, never skip)

Before you modify or read **any** TypeScript file:

1. **If you plan to import from a module**, first call `list_exports` on that module’s absolute file path.  
   → This tells you the exact public API. **Do not read the module file directly** unless you have already called `list_exports` and still need clarification.

2. **List current imports** – call `list_imports` on the file you’ll edit.  
   → This tells you what the file already relies on, so you don't duplicate or conflict.

3. **If you need a symbol from another module**, call `resolve_symbol` with the symbol name and absolute `relativeTo` (the importing file).  
   → Prefer the **Recommended import** (package entry). Do not grep and do not guess.

4. **(Optional but recommended)** Call `check_type_errors` on the file you’re about to edit.  
   → If there are pre-existing errors, report them. For a changed hunk, prefer `get_diagnostics` with a line range.

Only after steps 1–4 can you **read** the file (if you still need to) and then write or generate code.

## Mandatory Post-edit Validation (always do this)

After you save your changes, immediately call:

```
check_type_errors(file_path = "<absolute path you just changed>")
```

- **If the result is ✅ / no errors** → your changes are type-safe. Proceed.
- **If errors are present** → examine each error. Fix them **before** moving on. Use `signature_help` at call sites and `inspect` / `go_to_definition` at error positions when needed.

## Available MCP Tools (use these before any file read)

| Tool | Required parameters | When to use |
|------|---------------------|-------------|
| `list_exports` | absolute `file_path` | **Before reading any module** – see its public API |
| `list_imports` | absolute `file_path` | **Before editing a file** – see existing dependencies |
| `resolve_symbol` | `symbol`, absolute `relativeTo` | **Before importing an unknown symbol** |
| `check_type_errors` | absolute `file_path` | **Before edit** (optional) and **always after save** |
| `get_diagnostics` | absolute `file_path` (+ range?) | Range / severity / code-filtered validation |
| `inspect` | `file_path`, `line` | Type/hover at a known position |
| `go_to_definition` | `file_path`, `line` | Exact declaration location |
| `find_references` | position **or** `symbol`+`relativeTo` | Before rename/delete/API change |
| `signature_help` | `file_path`, `line`, `column` | While writing call arguments |
| `find_callers` | position **or** `symbol`+`relativeTo` | Who statically invokes a callable |
| `reachability` | `file_path`, `line` | Paths from exports/tests/handlers/bins |

## Example Correct Behavior (internal monologue)

> User: “Read `src/utils/logger.ts` and tell me what logging functions are available.”
>
> Agent (with this skill):
> 1. “I must not read the file directly. I will call `list_exports` first.”
> 2. Call `list_exports` with absolute `{ "file_path": "…" }` → receives exports with signatures.
> 3. Now that I know the public API, I can optionally read the file for implementation details, but I can already answer from the exports.

## What to do if the MCP server is not responding

If any ts-scan tool returns an error, do **not** fall back to reading files or grepping. Inform the user:

> “The ts-scan MCP server is not available. Please start it with `ts-scan --mcp` (or `npx ts-scan --mcp`) and ensure the client is connected. I cannot safely inspect TypeScript modules without it.”

## Integration note

This skill works alongside `dependency-planner`. Both require the same MCP server. Once the server is running, `list_exports` is your **gateway** before any file read.
