# resolve_symbol

## Purpose

Given a **symbol name**, return the correct import path, type signature, and JSDoc. Prefer the **Recommended import** (package entry) over a cross-package relative implementation path.

## Without the tool

Agents grep the monorepo, get dozens of hits in `src` and `dist`, then guess `../../../` paths that break under NodeNext.

## With the tool

- **MCP:** `resolve_symbol` — `symbol`, absolute `relativeTo` (importing file)
- **CLI:** `ts-scan --resolve <symbol> [--relative-to <file>]`

Call this first when a TODO/prompt names a symbol and you are about to search the tree.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(N) + O(M) | repo-wide grep, then open candidates and guess the import path |
| With the tool | O(1) roundtrip | ranked import path + signature |

## Examples

```bash
ts-scan --resolve ComplexInterface --relative-to src/features/newFeature.ts
```

MCP args:

```json
{
  "symbol": "ComplexInterface",
  "relativeTo": "/proj/src/features/newFeature.ts"
}
```

### Example output

When several declarations match, each candidate is listed (pick the one that matches your module):

```text
✅ Found in: /proj/samples/exports/sample-complex-types.ts
   import { ComplexInterface } from "../exports/sample-complex-types";
//ComplexInterface:
export interface ComplexInterface {
  id: number;
  name: string;
}
✅ Found in: /proj/samples/exports/sample-dependencies.ts
   import { ComplexInterface } from "../exports/sample-dependencies";
//ComplexInterface: 
/**
 * An interface with members.
 */
export interface ComplexInterface {
  prop1: string;
  prop2: number;
  method(): void;
}
```

When a package entry ranks above a relative implementation path, output labels **Recommended import** vs **Implementation path** (prefer the package entry).
