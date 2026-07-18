# signature_help

## Purpose

At a **call site**, return the active overload, active argument index, and parameter labels (IDE Parameter Hints). Use while writing or fixing arguments.

## Without the tool

Agents open the callee definition, scroll to overloads, and guess which parameter is next. Overloaded APIs produce wrong argument order.

## With the tool

- **MCP:** `signature_help` — absolute `file_path`, `line`, **`column` (required)**
- **CLI:** `ts-scan --signature-help <file> --line <n> --column <n>`

Place the caret inside the argument list. Outside a call context returns `not_in_call` (success, not a crash). Prefer this over `inspect` when you need the active argument slot / overload.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(F) | open the callee (and overloads) and guess the active parameter |
| With the tool | O(1) roundtrip | active signature + argument index |

## Examples

```bash
ts-scan --signature-help src/client.ts --line 22 --column 35
```

MCP args:

```json
{
  "file_path": "/proj/src/client.ts",
  "line": 22,
  "column": 35
}
```

### Example output — inside 2nd argument

```text
status: found
activeSignature: 0
activeParameter: 1
applicableSpan: /proj/src/client.ts:22:10-22:61
signatures: 1
  - [0] plainFn(a: string, b: number, c: boolean): string
    parameters:
    - a: string
    - b: number
    - c: boolean
```

Here `activeParameter: 1` means the caret is on `b: number`.
