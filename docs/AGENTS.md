
# MCP servers
## ts-scan — instant TypeScript intelligence for AI coding agents

Stop grepping `node_modules`, stop reading entire files, and stop running full
builds just to check your work. **ts-scan** is an MCP server that gives you
exactly the TypeScript information you need — in seconds.

### Tools

| Tool | What you get | When to use it |
|---|---|---|
| `check_type_errors` | Type errors for a single file (line, column, message) | After **every edit** — validate your changes instantly, no build needed |
| `list_imports` | Every imported symbol with its signature and JSDoc | Before **refactoring** a file — know exactly what types and APIs you're dealing with |
| `list_exports` | Every exported symbol with its signature and JSDoc | Before **using an unfamiliar module** — see its public surface without reading the source |
| `resolve_symbol` | The correct import path for a named export | When you **know the function name** but not where it's exported from (local or `node_modules`) |

### Starting the server

```bash
# stdio (default)
npx ts-scan --mcp

# HTTP (for browser-based agents)
npx ts-scan --mcp --port 3000
```