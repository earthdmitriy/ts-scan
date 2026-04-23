Below is the proposed content for `use-cases.md`. It presents the three real‑world examples you gave, contrasting the typical slow/error‑prone approach with how `ts-scan` makes the agent instantly smarter and more efficient.

---

```markdown
# Use Cases

`ts-scan` is built specifically for AI coding agents that operate inside large TypeScript projects.  
The following examples show how it eliminates common time‑wasting and error‑prone behaviours.

---

## 1. Using an internal npm package without digging through `node_modules`

### ❌ Without ts‑scan
The agent needs to call a function from an internal library (`@company/auth`).  
It doesn’t know the exact exports, so it runs `grep -r "export" node_modules/@company/auth` or reads random `.d.ts` files.  
The context window fills with raw declaration files, tokens are burned, and the agent may still choose the wrong export or signature.

### ✅ With ts‑scan
```bash
npx ts-scan --resolve authenticateWithToken
```
**Output**: a precise import path and signature, even for declarations deep inside `node_modules`.  
The agent immediately writes the correct import without scanning a single file.

```typescript
import { authenticateWithToken } from '@company/auth';
```

---

## 2. Refactoring a file when you don’t know its imports

### ❌ Without ts‑scan
The agent is asked to refactor `src/dashboard.ts`.  
It starts guessing types (`User`? `UserData`?), hallucinating function signatures, or grepping the whole file for `import` statements – often missing re‑exports or barrel files.  
The resulting code may fail type‑checking, forcing expensive back‑and‑forth.

### ✅ With ts‑scan
```bash
npx ts-scan --imports src/dashboard.ts
```
**Output**: a list of every imported symbol, complete with:
- JSDoc description  
- Full function/type signature  
- Module path  

Now the agent understands the exact types and APIs it’s dealing with. No guessing, no hallucination.

---

## 3. Verifying changes without a full project build

### ❌ Without ts‑scan
The agent modifies a complex file and then triggers `tsc --noEmit` (or the project’s own build).  
Builds can take minutes in large monorepos, burning time and tokens while the agent waits idle.

### ✅ With ts‑scan
```bash
npx ts-scan --check src/updated-file.ts
```
**Output**: only the type errors for that single file, delivered in milliseconds using the TypeScript language service.  
The agent instantly knows if its changes are valid – no full build required.

---

## 4. Understanding a module’s public surface before using it

### ❌ Without ts‑scan
The agent must implement a feature that depends on an unfamiliar module (`src/utils/validation`).  
It opens the whole file, reads hundreds of lines of implementation details, and tries to extract the exported functions manually – wasting tokens and often missing JSDoc constraints.

### ✅ With ts‑scan
```bash
ts-scan --exports src/utils/validation.ts
```
**Output**: a clean summary of every export with its JSDoc and full signature.  
The agent instantly sees what’s safe to use and how to call it, without reading a single line of internal code.

---

## 5. Finding the right import when creating a new file

### ❌ Without ts‑scan
The agent is creating `src/features/newFeature.ts` and needs to import `formatDate`.  
It greps the entire project, gets 20 matches across `node_modules` and local code, then guesses the relative path – often `../../../` that breaks at runtime.

### ✅ With ts‑scan
```bash
ts-scan --resolve formatDate --relative-to src/features/newFeature.ts
```
**Output**: a correct, relative import path validated by TypeScript’s module resolution.  
No manual path guessing, no broken imports.

---

## 6. Debugging a type error without opening the file

### ❌ Without ts‑scan
The agent runs `tsc --noEmit` and gets a wall of errors.  
It has to manually parse the output, figure out which file to look at, then open the file and scroll to the line – slow and token‑heavy.

### ✅ With ts‑scan
```bash
ts-scan --check src/components/Header.tsx
```
**Output**: a structured JSON array of errors with `line`, `column`, `message`, and `category`.  
The agent can directly act on `line 42: Type 'string' is not assignable…` without ever opening the file.


## Why these patterns matter

- **Cheaper models** (that tend to hallucinate) get precise data and stop making type mistakes.  
- **Expensive models** avoid reading whole files or running searches, drastically reducing token usage.  
- **Integration via MCP** means the agent can call these tools *inside its reasoning loop* – without shell commands.

All use cases are available both as CLI commands and as MCP tools (`check_type_errors`, `list_imports`, `list_exports`, `resolve_symbol`).
```

