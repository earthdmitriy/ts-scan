# ts-scan

> **TypeScript code intelligence that makes AI coding agents smarter and more efficient.**
>
> `ts-scan` gives LLM-powered tools instant access to type errors, imports, exports, definitions, references, callers, and more — so *“dumber” models produce reliable code* and *“smarter” models use fewer tokens*.

## Why ts-scan?

AI coding assistants often struggle with large TypeScript codebases:

- **Less capable (cheap) models** generate incorrect imports, miss type errors, or guess symbol locations – leading to broken code.
- **Powerful (expensive) models** can reason about the project structure, but reading entire files or search results wastes context-window tokens.

### Project intelligence has a complexity problem

“Understand the codebase” via `grep` → open file → reason is not free:

- One-shot lookups (find a name, list exports) are already **O(N)** LLM work over the repo.
- Graph questions — *who calls this?* / *is it reachable from package exports?* — need a **separate search at every level**. Fan-out × depth lands around **O(N·D)** and often **~O(N²)** agent loops. On large monorepos that tracking usually has no practical sense: the model burns tokens before it finishes the walk.

`ts-scan` does **not** make graph walks magically free. The Language Service / caller walk still runs **inside** the tool (with project reuse, depth caps, and other optimizations) — that cost lives on **cheap CPU**. The model pays **O(1) tool roundtrip** and reads a compact answer instead of spending expensive LLM cycles on each hop.

Per-tool LLM complexity estimates: [docs/tools/README.md](docs/tools/README.md).

## Features

| Feature | Description |
|---------|-------------|
| Instant type checking | Single-file errors via the language service (`check_type_errors`) |
| Import / export introspection | Signatures + JSDoc without reading implementations |
| Symbol resolve | Correct import path for a named export (`resolve_symbol`) |
| Hover & definition | Position-based `inspect` and `go_to_definition` |
| Diagnostics ranges | File or line-range diagnostics with severity/code filters |
| References & callers | TypeScript-identity references and static caller graphs |
| Signature help | Active overload / argument index at a call site |
| Reachability | Static paths from exports / tests / handlers / bins |
| Cheap-CPU graph walks | O(1) LLM roundtrips; heavy work stays in ts-scan, not the model |
| AI-friendly output | Compact plain text designed for LLM consumption |
| MCP server | All features as MCP tools (stdio or HTTP) |

Scenarios: [docs/use-cases.md](docs/use-cases.md). Per-tool docs (incl. complexity): [docs/tools/README.md](docs/tools/README.md).

## Installation

**Requirements**: Node.js 18+ and a TypeScript project with a valid `tsconfig.json`.

```bash
# Install globally
npm install -g ts-scan

# Or use on-the-fly with npx
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

Install from npm, then point Cursor at the global binary:

```bash
npm install -g ts-scan
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

After upgrading the global package, **restart the MCP server** in Cursor.

MCP tools require **absolute** `file_path` / `relativeTo` values. Relative paths are rejected so discovery never depends on the MCP process cwd (often the user home directory in Cursor).

CLI still accepts relative paths (resolved from `process.cwd()`). For CLI `--resolve` without `--relative-to`, `PROJECT_ROOT` remains a backward-compatible fallback.

## Claude Code Integration

Add ts-scan as a user-scoped or project-scoped MCP server (stdio):

```bash
# user scope (available in all projects)
claude mcp add --scope user --transport stdio ts-scan -- ts-scan --mcp

# project scope (current repo)
claude mcp add --scope project --transport stdio ts-scan -- ts-scan --mcp
```

Or add a project `.mcp.json` (after a global/local `ts-scan` install):

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

Ensure `ts-scan` is on `PATH` (`npm install -g ts-scan` or `npm run install-local` from this repo). Restart Claude Code after changing MCP config.

## Skills

Models are not trained to use ts-scan, so two skills enforce its use for any TypeScript code generation or modification. See [type-safe-coder](.opencode/skills/type-safe-coder/SKILL.md) and [dependency-planner](.opencode/skills/dependency-planner/SKILL.md) for detailed workflows.

## AGENTS.md

Pasteable agent instructions live in [docs/AGENTS.md](docs/AGENTS.md) (all MCP tools, path rules, startup). Copy that block into a consuming project's `AGENTS.md` so agents use ts-scan even without the opencode skills.

## Manual use (CLI)

```bash
# Check for type errors
ts-scan --check src/app.ts

# List imports / exports
ts-scan --imports src/app.ts
ts-scan --exports src/utils.ts

# Resolve a symbol (prefer --relative-to)
ts-scan --resolve UserService --relative-to src/index.ts

# Hover / definition at a position
ts-scan --inspect src/app.ts --line 42
ts-scan --definition src/app.ts --line 42

# Diagnostics (optional range)
ts-scan --diagnostics src/app.ts --start-line 10 --end-line 40

# References / callers (position or symbol)
ts-scan --references src/types.ts --line 12
ts-scan --references-symbol RuntimeEdge --relative-to src/app.ts
ts-scan --callers src/create-server.ts --line 1
ts-scan --callers-symbol createServer --relative-to src/index.ts

# Signature help / reachability
ts-scan --signature-help src/client.ts --line 40 --column 18
ts-scan --reachability src/create-server.ts --line 1
```

## MCP Server Mode

`ts-scan` can run as an MCP server, exposing all commands as tools that AI agents can call directly – no shell commands needed.

### Start the server

```bash
# Stdio (Claude Code, Claude Desktop, Cline, Cursor, opencode, etc.)
ts-scan --mcp

# HTTP
ts-scan --mcp --port 3000
```

### Available MCP Tools

| Tool Name | Description | Parameters (summary) | Docs |
|-----------|-------------|----------------------|------|
| `check_type_errors` | Type errors for a file | absolute `file_path` | [doc](docs/tools/check_type_errors.md) |
| `list_imports` | Imports + signatures/JSDoc | absolute `file_path`, `detail?` | [doc](docs/tools/list_imports.md) |
| `list_exports` | Exports + signatures/JSDoc | absolute `file_path`, `grep?` | [doc](docs/tools/list_exports.md) |
| `resolve_symbol` | Import path for a symbol | `symbol`, absolute `relativeTo` | [doc](docs/tools/resolve_symbol.md) |
| `inspect` | Hover at position | `file_path`, `line`, `column?`, `compact?` | [doc](docs/tools/inspect.md) |
| `get_diagnostics` | Diagnostics / range | `file_path`, range?, `severity?`, `codes?` | [doc](docs/tools/get_diagnostics.md) |
| `go_to_definition` | Definition at position | `file_path`, `line`, `column?` | [doc](docs/tools/go_to_definition.md) |
| `find_references` | Identity references | position **or** symbol mode; `crossPackage?`… | [doc](docs/tools/find_references.md) |
| `signature_help` | Call-site parameter hints | `file_path`, `line`, `column` | [doc](docs/tools/signature_help.md) |
| `find_callers` | Static caller graph | position **or** symbol mode; `maxDepth?`… | [doc](docs/tools/find_callers.md) |
| `reachability` | Paths from entrypoints | `file_path`, `line`, `column?`, `entrypointKinds?`… | [doc](docs/tools/reachability.md) |

Index: [docs/tools/README.md](docs/tools/README.md).

### Environment

CLI file commands resolve the correct tsconfig from the file path. For CLI `--resolve` without `--relative-to`, `PROJECT_ROOT` (or cwd) still selects the fallback project root.

## AI-Friendly Output

All commands return **compact plain-text** designed for LLM consumption:

- **No noise** – Only the requested data, no configuration logs or build artifacts.
- **Token-efficient** – Minimal output so expensive models don't burn tokens on irrelevant context.
- **Machine-parseable** – Structured text with clear separators between blocks.

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

New MCP / CLI tools (see [docs/tools](docs/tools/README.md)):

- **`inspect`** / `--inspect` – hover: symbol, type, JSDoc at a file position.
- **`get_diagnostics`** / `--diagnostics` – diagnostics for a file or line range (severity / code filters).
- **`go_to_definition`** / `--definition` – definition at a position (prefer source over `dist` / junk peers).
- **`find_references`** / `--references` / `--references-symbol` – TypeScript-identity references.
- **`signature_help`** / `--signature-help` – active signature and argument index at a call site.
- **`find_callers`** / `--callers` / `--callers-symbol` – static caller graph.
- **`reachability`** / `--reachability` – static paths from exports / tests / handlers / bins.

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
