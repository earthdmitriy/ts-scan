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

`ts-scan` resolves the correct `tsconfig.json` from each absolute file path, so one global MCP server works across monorepos and multiple packages.

Prefer a **local/global install** so Cursor does not pick up a stale `npx` cache from the registry:

```bash
# from the ts-scan repo (or after npm publish of the desired version)
npm run install-local   # build + test + npm install -g .
```

```json
{
  "mcpServers": {
    "ts-scan": {
      "command": "ts-scan",
      "args": ["--mcp"]
    }
  }
}
```

`npx -y ts-scan --mcp` also works, but after upgrading you must clear the npx cache or pin a version (`npx -y ts-scan@0.3.0 --mcp`) and **restart the MCP server** in Cursor.

MCP tools require **absolute** `file_path` / `relativeTo` values. Relative paths are rejected so discovery never depends on the MCP process cwd (often the user home directory in Cursor).

CLI still accepts relative paths (resolved from `process.cwd()`). For CLI `--resolve` without `--relative-to`, `PROJECT_ROOT` remains a backward-compatible fallback.

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
| `check_type_errors`  | Show TypeScript errors for a file            | absolute `file_path` |
| `list_imports`       | List imported symbols with signatures/JSDoc  | absolute `file_path` |
| `list_exports`       | List exported symbols with signatures/JSDoc  | absolute `file_path`, `grep` (optional) |
| `resolve_symbol`     | Find the import path for an exported symbol  | `symbol`, absolute `relativeTo` |

### Environment

CLI file commands resolve the correct tsconfig from the file path. For CLI `--resolve` without `--relative-to`, `PROJECT_ROOT` (or cwd) still selects the fallback project root.

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


## Changelog

### 0.3.0

Monorepo / agent reliability improvements:

- **Owning-package tsconfig discovery** – resolve the correct `tsconfig.json` from each absolute file path (ancestors + project references); one global MCP server works across packages without `PROJECT_ROOT`.
- **Composite / TS6307 fix** – load the owning package file list so valid sibling modules no longer report false `TS6307`.
- **Clearer path errors** – distinguish missing file, excluded / outside include, and no tsconfig found; missing paths list nearest sibling `.ts` files.
- **`list_exports` grep** – exact, case-sensitive, OR filters; explicit message when nothing matches.
- **Export signatures** – no more duplicated `export export type …`.
- **`resolve_symbol` ranking** – prefer package entry (**Recommended import**) over cross-package relative **Implementation path**.
- **`list_imports` compact mode** – summarize external (non-relative) types by default (`detail: "full"` for complete surfaces); type aliases omit RHS; avoid tautological `T = T` aliases.

### 0.2.0

- MCP / CLI support for `PROJECT_ROOT` when the process cwd is not the project root.

## License

ISC – see the [LICENSE](LICENSE) file for details.
