# go_to_definition

## Purpose

Jump from a **file + position** to the exact TypeScript declaration (IDE Go to Definition). Prefer **package source** over `dist` / anonymous / impl / test peers when a named declaration exists.

## Without the tool

Agents `grep` the name, open the first hit (often `dist` or a test helper), or follow a wrong re-export. Implementation and declaration files look equally plausible.

## With the tool

- **MCP:** `go_to_definition` — absolute `file_path`, `line`, optional `column`
- **CLI:** `ts-scan --definition <file> --line <n> [--column <n>]`

Lines/columns are **1-based**. Omit `column` to land on the first identifier on the line. For type/hover without navigation, use `inspect` first. For name → import path, use `resolve_symbol`.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(N) + O(M) | grep the name, open candidates (`dist`, tests, re-exports) |
| With the tool | O(1) roundtrip | primary definition (+ alternates) in one call |

## Examples

```bash
ts-scan --definition src/consumer.ts --line 9
```

MCP args:

```json
{
  "file_path": "/proj/src/consumer.ts",
  "line": 9
}
```

### Example output — local type

```text
symbol: LocalId
primary: /proj/src/definitions.ts:3:13-3:20 LocalId [type]
alternates: 0
```

### Example output — workspace type with import hint

```text
symbol: RuntimeEdge
primary: /proj/packages/runtime/src/types.ts:4:13-4:24 RuntimeEdge [type] (importHint=@acme/runtime)
alternates: 0
```
