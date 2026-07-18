# inspect

## Purpose

Inspect the TypeScript **symbol and type at a known file position** (IDE Hover): name, kind, type string, declaration location, enclosing scope, JSDoc, and a cross-package `importHint` when applicable.

## Without the tool

Agents open the file, dump large type bodies into context, or grep for declarations. They confuse hover info with “go to definition” and burn tokens reading implementations.

## With the tool

- **MCP:** `inspect` — absolute `file_path`, `line`, optional `column`, optional `compact` (default `true`)
- **CLI:** `ts-scan --inspect <file> --line <n> [--column <n>] [--full]`

Lines/columns are **1-based**. Omit `column` to inspect the first meaningful token on the line. Use `go_to_definition` when you need the declaration location to navigate, not just type info.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(F) + often O(N) | open the file; often grep elsewhere to learn the type |
| With the tool | O(1) roundtrip | symbol, type, JSDoc at the position |

## Examples

```bash
ts-scan --inspect src/bridge.ts --line 12
```

MCP args:

```json
{
  "file_path": "/proj/src/bridge.ts",
  "line": 12
}
```

### Example output

```text
symbol: run
kind: function
type: function run(value: Value): EdgeId
declaredIn: /proj/src/bridge.ts:12:17
enclosing: run
doc: Runs a value through the pipeline.
```
