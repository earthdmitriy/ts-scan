# get_diagnostics

## Purpose

Return TypeScript **diagnostics for a file or a line/column range**, with severity and optional code filters. Use when you need structured rows or a hunk-scoped check — not only a boolean “has errors.”

## Without the tool

Agents run full-project `tsc`, or use `check_type_errors` and then re-open the whole file to map messages to a hunk. Range-scoped review is manual.

## With the tool

- **MCP:** `get_diagnostics` — absolute `file_path`; optional `startLine` / `endLine` / `startColumn` / `endColumn`; `severity`: `"error"` (default) | `"warning"` | `"all"`; optional `codes.include` / `codes.exclude`
- **CLI:** `ts-scan --diagnostics <file> [--start-line <n>] [--end-line <n>] [--start-column <n>] [--end-column <n>] [--severity error|warning|all] [--include-codes <n,n>] [--exclude-codes <n,n>]`

For a quick whole-file ✅/❌ loop after edits, prefer `check_type_errors`. Empty result is `✅ Ok`.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(N) | full-project `tsc`, then manually map messages to a hunk |
| With the tool | O(1) roundtrip | file or range diagnostics in one call |

## Examples

```bash
ts-scan --diagnostics src/app.ts
ts-scan --diagnostics src/app.ts --start-line 1 --end-line 1
```

MCP args:

```json
{
  "file_path": "/proj/src/app.ts",
  "startLine": 1,
  "endLine": 1,
  "severity": "error"
}
```

### Example output — whole file

```text
diagnostics:
  - /proj/src/app.ts:1:30 TS2322 error: Type 'string' is not assignable to type 'number'.
  - /proj/src/app.ts:5:31 TS2322 error: Type 'number' is not assignable to type 'string'.
```

### Example output — range (line 1 only)

```text
diagnostics:
  - /proj/src/app.ts:1:30 TS2322 error: Type 'string' is not assignable to type 'number'.
```

### Example output — clean

```text
✅ Ok
```
