# list_exports

## Purpose

Reveal a module’s **public API** — exported symbols with full signatures and JSDoc — without reading implementation. Use before writing any `import` from an unfamiliar module.

## Without the tool

Agents `grep "export"`, open hundreds of lines of internals, or skim `.d.ts` files. They may import private helpers or miss the real export name.

## With the tool

- **MCP:** `list_exports` — absolute `file_path`, optional `grep` (exact export-name filters, OR semantics)
- **CLI:** `ts-scan --exports <file>`

On zero `grep` matches the tool reports how many exports exist in the file. Default exports keep the local class/function name (`export default class Foo`).

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(F) | read / grep the whole module for `export` |
| With the tool | O(1) roundtrip | public API + signatures in one call |

## Examples

```bash
ts-scan --exports src/utils/math.ts
```

MCP args:

```json
{
  "file_path": "/proj/src/utils/math.ts",
  "grep": ["add", "version"]
}
```

### Example output

```text
//add: 
/**
 * Adds two values.
 * @param a first number
 * @param b second number
 */
export function add(a: number, b: number): number
//version:
export const version: "1.0"
```
