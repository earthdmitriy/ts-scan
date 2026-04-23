# ts-scan

CLI tool providing TypeScript code intelligence via the TypeScript Language Service.

## Commands

```bash
# CLI
ts-scan --check <file>        # Show TypeScript errors for a file
ts-scan --imports <file>     # List imported symbols with signatures/JSDoc
ts-scan --exports <file>     # List exported symbols with signatures/JSDoc
ts-scan --resolve <symbol>    # Find import path for an exported symbol
ts-scan --mcp                 # Start MCP server (stdio by default)
ts-scan --mcp --port 3000   # Start MCP server on HTTP port

# Build
npx tsc                       # Compile TypeScript to dist/
# Lint & format
npx prettier --write src/      # Format code (required before commit)
```

## Key dependencies

- `ts-morph` – wraps TypeScript Language Service for code analysis
- `typed-pipe` – utility

## Architecture

- Entry: `src/cli.ts` → `src/router.ts`
- Tool implementations in `src/tools/` subdirectories
- Each tool uses `createTsMorphProject()` which creates an in-memory ts-morph `Project` with relaxed settings (non-strict, no lib)
- All commands return `Result<T>` type (success/error container)

## Development notes

- All commands return `Result<T>` with `{ success, data }` or `{ success: false, error }`
- MCP server fully implemented with stdio and HTTP transports
- Build output goes to `dist/` (configured in tsconfig.json)