# ts-scan

CLI tool providing TypeScript code intelligence via the TypeScript Language Service.

## Commands

```bash
# CLI
ts-scan --check <file>        # Show TypeScript errors for a file
ts-scan --imports <file>     # List imported symbols with signatures/JSDoc
ts-scan --exports <file>     # List exported symbols with signatures/JSDoc
ts-scan --resolve <symbol>    # Find import path for an exported symbol
ts-scan --inspect <file> --line <n> [--column <n>] [--full]  # Hover at position
ts-scan --definition <file> --line <n> [--column <n>]  # Go to definition
ts-scan --references <file> --line <n> [--column <n>]  # Find references
ts-scan --references-symbol <name> --relative-to <file>  # Find references by symbol
ts-scan --diagnostics <file> [--start-line <n>] [--severity error|warning|all]  # Diagnostics
ts-scan --signature-help <file> --line <n> --column <n>  # Signature help at call site
ts-scan --callers <file> --line <n> [--column <n>]  # Find static callers
ts-scan --callers-symbol <name> --relative-to <file>  # Find callers by symbol
ts-scan --reachability <file> --line <n> [--column <n>]  # Static paths from entrypoints
ts-scan --mcp                 # Start MCP server (stdio by default)
ts-scan --mcp --port 3000   # Start MCP server on HTTP port

# Build & quality
npm run install-local          # Integration - rebuild, run tests, deploy locally
npm run prettier               # Format code (required before commit)
```

## Key dependencies

- `ts-morph` – wraps TypeScript Language Service for code analysis
- `typed-pipe` – utility

## Architecture

- Entry: `src/cli.ts` → `src/router.ts`
- Tool implementations in `src/tools/` subdirectories
- `resolveTsConfigForFile()` picks the configured tsconfig (ancestors + project references); `getTsMorphProjectForFile()` reuses or recreates a single current ts-morph `Project` with that package's file list loaded
- MCP tools require absolute file paths; CLI resolves relative paths from cwd
- All commands return `Result<T>` type (success/error container)

## Development notes

- All commands return `Result<T>` with `{ success, data }` or `{ success: false, error }`
- MCP server fully implemented with stdio and HTTP transports
- Build output goes to `dist/` (configured in tsconfig.json)