# ts-scan tools

Agent-oriented reference for every MCP tool (and matching CLI flag).

Each page follows the same shape: **Purpose**, **Without the tool**, **With the tool**, **Complexity**, **Examples** (commands + anonymized sample output).

## Complexity model (LLM vs CPU)

Two different costs — do not confuse them:

| Kind | What it counts | Where it hurts |
|------|----------------|----------------|
| **LLM / agent work** | `grep` → read → reason loops, tokens, tool roundtrips | Expensive models / context window |
| **ts-scan / LS CPU** | Project load, identity refs, caller/reachability walks | Cheap local CPU |

Without tools, graph tasks grow as roughly **O(N·D)** and often **~O(N²)** LLM steps (a new search per level × candidates across the repo). On large monorepos that is usually not worth doing.

With ts-scan the agent pays **O(1) LLM roundtrip**. The walk may still be non-trivial **inside** ts-scan (project reuse, `maxDepth` / `maxResults`, ranking) — that full cost can live in the tool internals, but it runs on **cheap CPU**, not on the model.

Notation used on tool pages:

- `N` — `.ts` / `.tsx` files in the search scope (package / monorepo)
- `M` — textual name matches
- `D` — walk depth (callers / reachability)
- `F` — size of one file
- `I` — imports in a file

| MCP tool | Without (LLM) | With (LLM) | Doc |
|----------|---------------|------------|-----|
| `check_type_errors` | O(N) full `tsc` (or skip checks) | O(1) | [check_type_errors](./check_type_errors.md) |
| `list_imports` | O(F) + up to O(I·N) | O(1) | [list_imports](./list_imports.md) |
| `list_exports` | O(F) | O(1) | [list_exports](./list_exports.md) |
| `resolve_symbol` | O(N) + O(M) opens | O(1) | [resolve_symbol](./resolve_symbol.md) |
| `inspect` | O(F) + often O(N) | O(1) | [inspect](./inspect.md) |
| `get_diagnostics` | O(N) full `tsc` | O(1) | [get_diagnostics](./get_diagnostics.md) |
| `go_to_definition` | O(N) + O(M) | O(1) | [go_to_definition](./go_to_definition.md) |
| `find_references` | O(N) + O(M) (still not identity) | O(1) | [find_references](./find_references.md) |
| `signature_help` | O(F) (+ overloads) | O(1) | [signature_help](./signature_help.md) |
| `find_callers` | ~O(N·D) / ~O(N²) | O(1) | [find_callers](./find_callers.md) |
| `reachability` | ~O(N²) (entrypoints × walk) | O(1) | [reachability](./reachability.md) |

**CLI column** (same tools):

| MCP tool | CLI |
|----------|-----|
| `check_type_errors` | `--check` |
| `list_imports` | `--imports` |
| `list_exports` | `--exports` |
| `resolve_symbol` | `--resolve` |
| `inspect` | `--inspect` |
| `get_diagnostics` | `--diagnostics` |
| `go_to_definition` | `--definition` |
| `find_references` | `--references` / `--references-symbol` |
| `signature_help` | `--signature-help` |
| `find_callers` | `--callers` / `--callers-symbol` |
| `reachability` | `--reachability` |

**Paths:** MCP `file_path` / `relativeTo` must be **absolute**. CLI accepts paths relative to cwd.

**Positions:** lines and columns are **1-based**. Omitting `column` lands on the first identifier on the line (skips `export` / `const` / …).

See also [Use cases](../use-cases.md) and the pasteable agent block in [AGENTS.md](../AGENTS.md).
