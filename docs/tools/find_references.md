# find_references

## Purpose

Find **all TypeScript-identity references** to a symbol (IDE Find All References) — by position or by export name. Use before renames, deletions, or API changes. Comments and unrelated text matches are excluded.

## Without the tool

Agents `grep` and drown in string matches (`dist`, comments, unrelated packages). Cross-package consumers are guesswork without the project/workspace graph.

## With the tool

- **MCP:** `find_references` — exactly one mode: position (`file_path` + `line` [, `column`]) **or** symbol (`symbol` + absolute `relativeTo`); optional `includeDeclaration`, `crossPackage`, `includeTests`, `maxResults`
- **CLI (position):** `ts-scan --references <file> --line <n> [--column <n>] [--no-include-declaration] [--no-cross-package] [--no-include-tests] [--max-results <n>]`
- **CLI (symbol):** `ts-scan --references-symbol <name> --relative-to <file> […]`

Defaults: includeDeclaration / crossPackage / includeTests = true; maxResults = 100 (hard max 1000). Without a root TypeScript project-references solution, graph scope is owner+dependencies and/or workspace `package.json` dependents. Results include classified hits and `truncated` when capped.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(N) + O(M) | repo grep + hand-filter; still not TypeScript identity |
| With the tool | O(1) roundtrip | classified references; server caps via `maxResults` |

## Examples

```bash
ts-scan --references src/api/types.ts --line 1
ts-scan --references-symbol trackedFn --relative-to src/app.ts
```

MCP args (position):

```json
{
  "file_path": "/proj/src/api/types.ts",
  "line": 1,
  "crossPackage": true
}
```

### Example output

```text
symbol: trackedValue
definition: /proj/src/api/types.ts:1:14
scope: owner-and-dependencies
truncated: false
references: 11
- /proj/src/api/comments.ts:1:10-1:22 [import] package=my-app | import { trackedValue } from './types.js';
- /proj/src/api/comments.ts:8:9-8:21 [read] package=my-app | return trackedValue;
- /proj/src/api/consumer.test.ts:1:10-1:22 [import] package=my-app | import { trackedValue } from './types.js';
- /proj/src/api/consumer.test.ts:5:9-5:21 [read] package=my-app | return trackedValue;
- /proj/src/api/types.ts:1:14-1:26 [declaration] package=my-app | export const trackedValue = 1;
- /proj/src/api/types.ts:13:9-13:21 [read] package=my-app | return trackedValue;
- /proj/src/api/re-export.ts:1:10-1:22 [export] package=my-app | export { trackedValue as reexportedTracked } from './types.js';
- /proj/src/api/reads-writes.ts:1:26-1:38 [import] package=my-app | import { trackedMutable, trackedValue } from './types.js';
- /proj/src/api/reads-writes.ts:5:19-5:31 [read] package=my-app | trackedMutable = trackedValue;
- /proj/src/api/reads-writes.ts:7:15-7:27 [read] package=my-app | const copy = trackedValue;
(… more rows / notes when the graph is incomplete …)
```

Kinds include `declaration`, `read`, `write`, `call`, `import`, `type`, `export`. String/comment text matches (e.g. `'trackedValue in a string'`) are omitted.
