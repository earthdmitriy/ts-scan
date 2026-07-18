# list_imports

## Purpose

List every import in a file with resolved symbols, signatures, and JSDoc. Use before refactoring so you know the exact APIs the file already depends on.

## Without the tool

Agents `grep` for `import`, miss re-exports, or open the whole file and hallucinate types. Context fills with noise; signatures stay wrong.

## With the tool

- **MCP:** `list_imports` — absolute `file_path`, optional `detail`: `"compact"` (default) | `"full"`
- **CLI:** `ts-scan --imports <file>`

`compact` summarizes third-party (`node_modules`) surfaces; `full` expands everything.

## Complexity

| | LLM complexity | Notes |
|---|---|---|
| Without the tool | O(F) + up to O(I·N) | read the file, then grep/open each import target |
| With the tool | O(1) roundtrip | structured imports + signatures in one call |

## Examples

```bash
ts-scan --imports src/dashboard.ts
```

MCP args:

```json
{
  "file_path": "/proj/src/dashboard.ts",
  "detail": "compact"
}
```

### Example output

```text
Types and JSdoc:

//from
import {
  ComplexInterface,
  ComplexModule,
  ComplexType,
} from "../exports/sample-dependencies";
/**
 * An interface with members.
 */
export interface ComplexInterface {
  prop1: string;
  prop2: number;
  method(): void;
}

/**
 * A sample class with complex types and static properties.
 */
export class ComplexModule {
  method1(param: string): number
  promise: Promise<Project>
}

/**
 * A type alias.
 */
export type ComplexType = {
  key: string;
  value: number;
  promise: Promise<typeof Calculator>;
}


//from

import { greet, value } from "./imported";
/**
 * Returns a greeting for the provided name.
 */
export function greet(name: string): string

export const value: Number
```
