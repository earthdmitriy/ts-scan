# Use Cases

`ts-scan` is built for AI coding agents in large TypeScript projects. The examples below contrast slow, error-prone habits with focused MCP/CLI calls.

Per-tool detail: [docs/tools](./tools/README.md).

---

## 1. Using an internal npm package without digging through `node_modules`

### Without ts-scan

The agent needs a function from `@company/auth`. It greps `node_modules` or opens random `.d.ts` files. Context fills with declarations; the wrong export or signature still wins.

### With ts-scan

```bash
ts-scan --resolve authenticateWithToken --relative-to src/app.ts
```

Precise import path and signature. The agent writes the correct import without scanning declaration files.

```typescript
import { authenticateWithToken } from '@company/auth';
```

---

## 2. Refactoring a file when you don’t know its imports

### Without ts-scan

Asked to refactor `src/dashboard.ts`, the agent guesses types, greps for `import`, and misses re-exports. Code fails type-checking and burns fix loops.

### With ts-scan

```bash
ts-scan --imports src/dashboard.ts
```

Every imported symbol with JSDoc, signature, and module path — before any edit.

---

## 3. Verifying changes without a full project build

### Without ts-scan

The agent runs `tsc --noEmit` on the whole monorepo and waits minutes after every edit.

### With ts-scan

```bash
ts-scan --check src/updated-file.ts
```

Language-service errors for that file only — milliseconds, not a full build.

For a changed hunk with severity/code filters, use `get_diagnostics` / `--diagnostics`.

---

## 4. Understanding a module’s public surface before using it

### Without ts-scan

The agent opens an unfamiliar module, reads hundreds of implementation lines, and may import private helpers.

### With ts-scan

```bash
ts-scan --exports src/utils/validation.ts
```

Clean export list with JSDoc and full signatures — the public contract only.

---

## 5. Finding the right import when creating a new file

### Without ts-scan

Creating `src/features/newFeature.ts`, the agent greps for `formatDate`, gets dozens of hits, and guesses `../../../` paths that break under NodeNext.

### With ts-scan

```bash
ts-scan --resolve formatDate --relative-to src/features/newFeature.ts
```

Canonical import (prefer **Recommended import** / package entry over cross-package relatives).

---

## 6. Debugging a type error without opening the whole file

### Without ts-scan

Full `tsc` dumps a wall of errors; the agent scrolls files to map messages to lines.

### With ts-scan

```bash
ts-scan --check src/components/Header.tsx
# or a range:
ts-scan --diagnostics src/components/Header.tsx --start-line 30 --end-line 60
```

Structured, line-accurate diagnostics; act on `line 42` without loading the entire file into context.

---

## 7. Hover / definition at a known position (no grep)

### Without ts-scan

The agent opens candidate files or greps the identifier to learn “what is on this line?”

### With ts-scan

```bash
ts-scan --inspect packages/server/src/bridge.ts --line 88
ts-scan --definition packages/server/src/bridge.ts --line 88
```

`inspect` = type + JSDoc at the position; `go_to_definition` = declaration location (source preferred over `dist`).

---

## 8. Safe rename / delete — find real references

### Without ts-scan

`grep` matches comments, `dist`, and unrelated packages. The agent misses real consumers or “fixes” string noise.

### With ts-scan

```bash
ts-scan --references packages/runtime/src/types.ts --line 12
ts-scan --references-symbol RuntimeEdge --relative-to packages/server/src/app.ts
```

TypeScript-identity references with optional cross-package graph search (`crossPackage`).

---

## 9. Filling call arguments without opening the callee

### Without ts-scan

The agent opens the callee, scrolls overloads, and guesses the next parameter.

### With ts-scan

```bash
ts-scan --signature-help src/client.ts --line 40 --column 18
```

Active overload and argument index at the call site.

---

## 10. Who calls this? / Is it reachable from the package surface?

### Without ts-scan

Every text hit looks like a call. Dead code vs. handler-wired exports is guesswork across barrels and `package.json` `exports`.

### With ts-scan

```bash
ts-scan --callers packages/server/src/create-server.ts --line 1
ts-scan --callers-symbol createServer --relative-to packages/server/src/index.ts
ts-scan --reachability packages/server/src/create-server.ts --line 1
```

Static caller graph vs. entrypoint paths (exports / tests / handlers / bins) — not a runtime stack.

---

## Why these patterns matter

- **Cheaper models** get precise data and stop inventing types and paths.
- **Expensive models** avoid reading whole files or search dumps — fewer tokens.
- **MCP** lets agents call tools inside the reasoning loop without shell ceremony.

All scenarios are available as CLI commands and MCP tools. Index: [docs/tools](./tools/README.md).
