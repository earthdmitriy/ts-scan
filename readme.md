# ts-scan

> **TypeScript code intelligence that makes AI coding agents smarter and more efficient.**
>
> `ts-scan` gives LLM‑powered tools instant access to type errors, imports, exports, and symbol locations so that *“dumber” models produce reliable code* and *“smarter” models use fewer tokens*.

## Why ts‑scan?

AI coding assistants often struggle with large TypeScript codebases:

- **Less capable (cheap) models** generate incorrect imports, miss type errors, or guess symbol locations – leading to broken code.
- **Powerful (expensive) models** can reason about the project structure, but reading entire files or search results wastes context‑window tokens.

`ts-scan` bridges this gap by providing **on‑demand, laser‑focused information** through a simple CLI or an MCP server. Instead of dumping a whole file, you get exactly what you need: the type errors, the imports with their JSDoc, or the correct import path for a symbol – all without a full project build.

## Features

| Feature | Description |
|---------|-------------|
| ✅ **Instant type checking** | Get TypeScript diagnostics for a single file using incremental compilation and language service caching. |
| 📦 **Import introspection** | List every imported symbol along with its JSDoc description and function signature. |
| 📤 **Export documentation** | Display JSDoc comments and signatures for all exports of a given file. |
| 🔍 **Symbol lookup** | Find the correct import path for any exported symbol in your project (no more `grep` guessing). |
| 🧠 **AI‑friendly output** | Compact plain‑text with signatures and JSDoc, designed for LLM consumption. |
| 🌐 **MCP server mode** | Exposes all features as MCP tools (`check_type_errors`, `list_imports`, `list_exports`, `resolve_symbol`) over stdio. |

## Installation

**Requirements**: Node.js 18+ and a TypeScript project with a valid `tsconfig.json`.

```bash
# Install globally
npm install -g ts-scan

# Or use on‑the‑fly with npx
npx ts-scan <command>
```

## opencode Integration

Configure `ts-scan` as an MCP server so agents can call its tools directly:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ts-scan": {
      "type": "local",
      "command": ["npx", "ts-scan", "--mcp"],
      "enabled": true
    }
  }
}
```

## Cursor Integration

Cursor launches MCP servers with the **user's home directory** as the working directory, not your project root. `ts-scan` needs to find `tsconfig.json` to work, so set `PROJECT_ROOT` to point at your project:

```json
{
  "mcpServers": {
    "ts-scan": {
      "command": "npx",
      "args": ["-y", "ts-scan", "--mcp"],
      "env": {
        "PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

`PROJECT_ROOT` is also supported by all CLI commands — set it to any project root to run `ts-scan` from outside the project directory.

## Skills 
Models are not trained to use ts-scan, so two skills enforce its use for any TypeScript code generation or modification. See [type-safe-coder](.opencode/skills/type-safe-coder/SKILL.md) and [dependency-planner](.opencode/skills/dependency-planner/SKILL.md) for detailed workflows.

## AGENTS.md
I also added a section about ts-scan in AGENTS.md with example prompts and instructions for using the MCP tools. This way, even if an agent doesn't use the skills directly, it can still understand how to leverage ts-scan for better TypeScript code generation.

## Manual use (CLI)

```bash
# Check for type errors
npx ts-scan --check src/app.ts

# List all imports with their JSDoc & signatures
npx ts-scan --imports src/app.ts

# List all exports with their JSDoc & signatures
npx ts-scan --exports src/utils.ts

# Find the import path for a symbol (local or from node_modules)
npx ts-scan --resolve UserService

# Resolve relative to a specific file (for relative import paths)
npx ts-scan --resolve UserService --relative-to src/index.ts
```

## MCP Server Mode

`ts-scan` can run as an MCP server, exposing all commands as tools that AI agents can call directly – no shell commands needed.

### Start the server

```bash
# Stdio (for Claude Desktop, Cline, Cursor, opencode, etc.)
npx ts-scan --mcp
```

### Available MCP Tools

| Tool Name            | Description                                  | Parameters |
|----------------------|----------------------------------------------|------------|
| `check_type_errors`  | Show TypeScript errors for a file            | `file_path` |
| `list_imports`       | List imported symbols with signatures/JSDoc  | `file_path` |
| `list_exports`       | List exported symbols with signatures/JSDoc  | `file_path`, `grep` (optional filter) |
| `resolve_symbol`     | Find the import path for an exported symbol  | `symbol`, `relativeTo` (optional) |

### Environment

Set `PROJECT_ROOT` to run `ts-scan` from any working directory:

```bash
PROJECT_ROOT=/path/to/project ts-scan --check src/app.ts
```

## AI‑Friendly Output

All commands return **compact plain‑text** designed for LLM consumption:

- **No noise** – Only the requested data, no configuration logs or build artifacts.
- **Token‑efficient** – The output is minimal, so expensive models don't burn tokens on irrelevant context.
- **Machine‑parseable** – Structured text with clear separators between blocks.

Example output:

```
Types and JSdoc:

//from
import { fetchUser } from "./api/user"

/** Fetches a user by ID. Returns a promise that resolves to the user object. */
export async function fetchUser(id: string): Promise<User>
```


## License

ISC – see the [LICENSE](LICENSE) file for details.
