## Architecture & Technical Details

`ts-scan` is built on top of the [TypeScript Language Service](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API) via the excellent `ts-morph` wrapper. This gives it access to the same analysis that powers editors like VS Code – without needing to compile the entire project.

- **Entry point**: `src/cli.ts` → routes commands to `src/router.ts`.
- **Tool implementations** live in `src/tools/` (check, imports, exports, resolve, mcp).
- **Project model**: Each tool creates a lightweight `ts-morph` `Project` with relaxed compiler settings (`allowJs`, non‑strict) that loads only the files it needs.
- **Symbol resolution** combines local `grep`/`ripgrep` search with TypeScript module resolution for `node_modules`.
- **MCP integration** uses the official `@modelcontextprotocol/sdk` and supports both stdio and HTTP transports.

Key dependencies:

| Package | Purpose |
|---------|---------|
| [`ts-morph`](https://github.com/dsherret/ts-morph) | High‑level wrapper around the TypeScript compiler API |
| [`typed-pipe`](https://github.com/typed-pipe)        | Lightweight functional pipeline utility |
| [`zod`](https://github.com/colinhacks/zod)            | Schema validation for MCP tool inputs |
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/spec) | MCP server & client SDK |

---



## Development

```bash
# Clone the repository
git clone https://github.com/earthdmitriy/ts-scan.git
cd ts-scan

# Install dependencies
npm install

# Build (output to dist/)
npm run build

# Run tests
npm test

# Install the local build globally for testing
npm run install-local

# Remove the local installation
npm run remove-local

# Format code (Prettier – required before commits)
npm run format
```

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository.
2. Create a feature branch.
3. Run `npm run format` before committing.
4. Ensure all tests pass (`npm test`).
5. Open a pull request with a clear description of your changes.

---