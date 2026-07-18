# find_callers

## Purpose

List the **static caller graph** for a function/method/callable (TypeScript Call Hierarchy) — by position or by export name. Narrower than “all references”: invocations and related call edges, not every read/import.

## Without the tool

This is not one `grep`. To rebuild a caller graph by hand the agent must:

1. Search for the target name across the repo.
2. Open hits, discard imports / types / strings that are not calls.
3. For **each** real caller, search again for *that* caller’s name (next level).
4. Repeat to depth `D`.

Every level is a new LLM loop over up to `N` files. Fan-out × depth is about **O(N·D)** and often **~O(N²)** agent work. On large monorepos that tracking usually has no practical sense — the model spends tokens long before the graph is complete. Grep also treats non-calls as calls and misses typed edges.

## With the tool

- **MCP:** `find_callers` — exactly one mode: position (`file_path` + `line` [, `column`]) **or** symbol (`symbol` + absolute `relativeTo`); optional `maxDepth`, `crossPackage`, `includeTests`, `maxResults`
- **CLI (position):** `ts-scan --callers <file> --line <n> [--column <n>] [--max-depth <n>] [--no-cross-package] [--no-include-tests] [--max-results <n>]`
- **CLI (symbol):** `ts-scan --callers-symbol <name> --relative-to <file> […]`

Defaults: maxDepth = 2 (hard max 5), maxResults = 50 (hard max 500), crossPackage / includeTests = true. Edge kinds include `direct_call`, `new`, `tagged_template`, `jsx`, `unknown_ref`. Same workspace-graph caveats as `find_references`.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | ~O(N·D) / ~O(N²) | separate grep per call-graph level × candidates across `N` files; impractical on large repos |
| With the tool | O(1) roundtrip | single call; server walks up to `maxDepth` / `maxResults` |

## Examples

```bash
ts-scan --callers src/lib/targets.ts --line 5
ts-scan --callers-symbol targetFn --relative-to src/app.ts
```

MCP args (symbol):

```json
{
  "symbol": "targetFn",
  "relativeTo": "/proj/src/app.ts",
  "maxDepth": 2
}
```

### Example output (truncated)

```text
target: targetFn @ /proj/src/lib/targets.ts:5:17
scope: owner-and-dependencies
truncated: false
callers: 12
- depth: 1
  location: /proj/src/lib/direct.ts:5:9
  callerName: directCaller
  kind: direct_call
  confidence: high package=my-app
  snippet: return targetFn(1);
- depth: 1
  location: /proj/src/lib/direct.ts:9:9
  callerName: secondSite
  kind: direct_call
  confidence: high package=my-app
  snippet: return targetFn(2) + targetFn(3);
- depth: 1
  location: /proj/src/lib/callbacks.ts:18:16
  callerName: nonCallReference
  kind: unknown_ref
  confidence: low package=my-app
  snippet: const alias = targetFn;
- depth: 2
  location: /proj/src/lib/depth-chain.ts:8:9
  callerName: level2
  kind: direct_call
  confidence: high package=my-app
  snippet: return level1();
(… more callers …)
```

`unknown_ref` means a non-call mention (alias / `any` / `Function`); treat confidence accordingly.
