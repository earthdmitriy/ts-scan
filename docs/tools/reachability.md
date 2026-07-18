# reachability

## Purpose

Find **static paths from entrypoints** (package exports, tests, handlers, bins) to a callable target by walking callers upward. Answers “is this reachable from the public surface / tests / handlers?” — not a runtime stack.

## Without the tool

Agents assume “if it is exported from a file, it is public,” miss barrel / `package.json` `exports` re-exports, or stop at event-handler wrappers and call the code unreachable.

Doing it “properly” by hand is worse than a single callers walk: first discover entrypoints (exports, tests, handlers, bins) across `N` files, then for each root run the same level-by-level grep/read loop upward toward the target. That stacks to roughly **~O(N²)** LLM work (entrypoints × per-level search). On large monorepos the agent usually gives up or invents an answer.

## With the tool

- **MCP:** `reachability` — absolute `file_path`, `line`, optional `column`, optional `maxDepth`, `maxPaths`, `entrypointKinds`
- **CLI:** `ts-scan --reachability <file> --line <n> [--column <n>] [--max-depth <n>] [--max-paths <n>] [--entrypoint-kinds export,test,handler,bin,unknown]`

Defaults: maxDepth = 6, maxPaths = 20. `entrypointKinds`: `export` | `test` | `handler` | `bin` | `unknown`. Export roots use `package.json#exports` (including re-exports from the package entry). Handler heuristics include `wire-*-handlers`, `*handler*` filenames, and bridge-style names.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | ~O(N²) | find entrypoints O(N), then caller-style search per root / level; usually not worth it on huge repos |
| With the tool | O(1) roundtrip | single call; server returns capped static paths (`maxDepth` / `maxPaths`) |

## Examples

```bash
ts-scan --reachability src/internal.ts --line 3
```

MCP args:

```json
{
  "file_path": "/proj/src/internal.ts",
  "line": 3,
  "entrypointKinds": ["export", "handler", "test", "bin"]
}
```

### Example output (truncated)

```text
target: leafHelper @ /proj/src/internal.ts:3:17
scope: owner-and-dependencies
truncated: false
paths: 7
path[0]:
  entrypoint:
    kind: bin
    name: runCli
    location: /proj/src/cli.ts:4:17
  confidence: high
  steps: 3
  - runCli @ /proj/src/cli.ts:4:17
    callSite: /proj/src/cli.ts:6:9
    kind: direct_call
  - midHelper @ /proj/src/internal.ts:7:17
    callSite: /proj/src/internal.ts:9:9
    kind: direct_call
  - leafHelper @ /proj/src/internal.ts:3:17
path[1]:
  entrypoint:
    kind: test
    name: testOnlyFromTest
    location: /proj/tests/internal.test.ts:3:10
  confidence: high
  steps: 3
  - testOnlyFromTest @ /proj/tests/internal.test.ts:3:10
    callSite: /proj/tests/internal.test.ts:5:2
    kind: direct_call
  - onlyFromTest @ /proj/src/internal.ts:13:17
    callSite: /proj/src/internal.ts:15:9
    kind: direct_call
  - leafHelper @ /proj/src/internal.ts:3:17
path[2]:
  entrypoint:
    kind: export
    name: publicApi
    location: /proj/src/public.ts:11:17
  confidence: high
  steps: 3
  - publicApi @ /proj/src/public.ts:11:17
    callSite: /proj/src/public.ts:13:9
    kind: direct_call
  - midHelper @ /proj/src/internal.ts:7:17
    callSite: /proj/src/internal.ts:9:9
    kind: direct_call
  - leafHelper @ /proj/src/internal.ts:3:17
path[3]:
  entrypoint:
    kind: handler
    name: wireEventHandlers
    location: /proj/src/wire-event-handlers.ts:6:17
  confidence: medium
  steps: 3
  - wireEventHandlers @ /proj/src/wire-event-handlers.ts:6:17
    callSite: /proj/src/wire-event-handlers.ts:8:9
    kind: direct_call
  - midHelper @ /proj/src/internal.ts:7:17
    callSite: /proj/src/internal.ts:9:9
    kind: direct_call
  - leafHelper @ /proj/src/internal.ts:3:17
(… more paths …)
notes:
- static approximation; dynamic dispatch may be missing; never a runtime stack
```
