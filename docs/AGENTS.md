# MCP servers
## ts-scan — instant TypeScript intelligence for AI coding agents

Stop grepping `node_modules`, stop reading entire files, and stop running full
builds just to check your work. **ts-scan** is an MCP server that gives you
exactly the TypeScript information you need — in seconds.

### Tools

| Tool | What you get | When to use it |
|---|---|---|
| `check_type_errors` | Type errors for a single file | After **every edit** — validate instantly, no full build |
| `list_imports` | Imports with signatures and JSDoc | Before **refactoring** a file |
| `list_exports` | Exports with signatures and JSDoc | Before **using an unfamiliar module** |
| `resolve_symbol` | Correct import path + signature for a name | When you **know the symbol name** but not the import |
| `inspect` | Hover: type, kind, JSDoc at `file`+`line` | When you know a **position** and need meaning/type |
| `get_diagnostics` | Diagnostics for a file or line range | After edits when you need **range/severity/code** filters |
| `go_to_definition` | Declaration location at a position | When you need the **exact definition**, not a grep hit |
| `find_references` | TypeScript-identity references | Before **rename / delete / API change** |
| `signature_help` | Active signature + argument index | While **writing call arguments** |
| `find_callers` | Static caller graph | When you need **who invokes** a callable |
| `reachability` | Static paths from entrypoints to a target | “Is this wired from exports/tests/handlers?” |

**Paths:** `file_path` / `relativeTo` must be **absolute**. Relative paths fail because the MCP server cwd is often not the project root.

**Positions:** lines and columns are **1-based**. Omitting `column` (where allowed) lands on the first identifier on the line.

Prefer `resolve_symbol`'s **Recommended import** (package entry) over cross-package relative implementation paths.

After upgrading ts-scan, use a global/local install (`npm run install-local`) or pin the version; restart the MCP server so Cursor does not keep a stale `npx` build.

Full per-tool docs: [tools/README.md](./tools/README.md). Scenarios: [use-cases.md](./use-cases.md).

### Starting the server

```bash
# preferred after local install
ts-scan --mcp

# or pin an explicit version
npx -y ts-scan@0.3.0 --mcp

# HTTP (for browser-based agents)
npx -y ts-scan@0.3.0 --mcp --port 3000
```
