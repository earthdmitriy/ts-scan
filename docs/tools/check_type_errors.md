# check_type_errors

## Purpose

Answer whether a single TypeScript file currently has **type errors** (not warnings), with line-accurate messages. Use it as the immediate feedback loop after every edit — much faster than a full `tsc`.

## Without the tool

Agents run `tsc --noEmit` on the whole package/monorepo, wait minutes, then parse a wall of unrelated diagnostics. Or they assume “the code looks fine” and ship broken types.

## With the tool

- **MCP:** `check_type_errors` — absolute `file_path`
- **CLI:** `ts-scan --check <file>`

Uses the owning package’s tsconfig via the TypeScript language service. Call **before** editing a broken file and **after** saving changes.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(N) | full-project `tsc` / build wait, or skip checks and guess |
| With the tool | O(1) roundtrip | single-file errors via LS |

## Examples

```bash
ts-scan --check src/app.ts
```

MCP args:

```json
{ "file_path": "/proj/src/app.ts" }
```

### Example output — clean file

```text
✅ Ok
```

### Example output — errors

```text
samples/check/error.ts:1:14 - error TS2322: Type 'string' is not assignable to type 'number'.

1 export const bad: number = "not a number";
              ~~~
```

(CLI may colorize the same text; MCP returns the same structure as plain text.)
