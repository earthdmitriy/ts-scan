import { existsSync } from "fs";
import path from "path";
import { Node, Project, SourceFile } from "ts-morph";
import { error, Result, success, ToolResult } from "../../types.js";
import {
  CallConfidence,
  CallKind,
  CallerItem,
  CallerLocation,
  findCallers,
} from "../findCallers/findCallers.js";
import { getTsMorphProjectForFile } from "../getTsMorphProject.js";
import { ProjectGraphScope } from "../projectGraph/resolveProjectGraphForFile.js";
import { canonicalizePath } from "../resolveTsConfig.js";
import { preferWorkspaceSourceFile } from "../utils/definitionRank.js";
import {
  findNearestPackageJson,
  isPackageBinEntryFile,
  isPackageExportsEntryFile,
  PackageJsonInfo,
} from "../utils/packageMetadata.js";
import { formatReachabilityOutput } from "./formatReachability.js";

export type EntrypointKind =
  | "export"
  | "test"
  | "handler"
  | "bin"
  | "unknown";

export type PathConfidence = "high" | "medium" | "low";

export interface ReachabilityLocation {
  file: string;
  line: number;
  column: number;
}

export interface ReachabilityStep {
  name: string;
  definition: ReachabilityLocation;
  callSite?: ReachabilityLocation;
  kind?: CallKind;
}

export interface ReachabilityPath {
  entrypoint: {
    kind: EntrypointKind;
    location: ReachabilityLocation;
    name: string;
  };
  steps: ReachabilityStep[];
  confidence: PathConfidence;
}

export interface ReachabilityData {
  target: { name: string; definition: ReachabilityLocation };
  paths: ReachabilityPath[];
  scope: ProjectGraphScope;
  truncated: boolean;
  notes: string[];
}

export interface ReachabilityOptions {
  filePath: string;
  line: number;
  column?: number;
  maxDepth?: number;
  maxPaths?: number;
  entrypointKinds?: EntrypointKind[];
  crossPackage?: boolean;
  includeTests?: boolean;
}

interface PathNode {
  name: string;
  definition: ReachabilityLocation;
  callSite?: ReachabilityLocation;
  kind?: CallKind;
  edgeConfidence: PathConfidence;
}

interface InternalPath {
  /** Target-first: [target, caller, …, outer]. */
  nodes: PathNode[];
}

interface DetectorHit {
  kind: EntrypointKind;
  confidence: PathConfidence;
  note?: string;
  reason?: "no_callers" | "max_depth";
}

const DEFAULT_MAX_DEPTH = 6;
const HARD_MAX_DEPTH = 20;
const DEFAULT_MAX_PATHS = 20;
const HARD_MAX_PATHS = 100;
const EXPANSION_BUDGET = 500;

const ALL_KINDS: EntrypointKind[] = [
  "bin",
  "test",
  "handler",
  "export",
  "unknown",
];

const KIND_PRIORITY: Record<EntrypointKind, number> = {
  bin: 0,
  test: 1,
  handler: 2,
  export: 3,
  unknown: 4,
};

const CONFIDENCE_RANK: Record<PathConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const STATIC_NOTE =
  "static approximation; dynamic dispatch may be missing; never a runtime stack";

/**
 * Find static paths from entrypoints down to a callable target by walking
 * callers upward via `findCallers` (depth-1 each step).
 */
export const reachability = (
  options: ReachabilityOptions,
  project: Project,
): Result<ToolResult<ReachabilityData>> => {
  const maxDepth = clampMaxDepth(options.maxDepth);
  const maxPaths = clampMaxPaths(options.maxPaths);
  const enabledKinds = normalizeKinds(options.entrypointKinds);
  const crossPackage = options.crossPackage !== false;
  const includeTests = options.includeTests !== false;

  try {
    const seedProjectResult = getTsMorphProjectForFile(options.filePath);
    if (!seedProjectResult.success) {
      return error(seedProjectResult.error);
    }
    // Prefer the caller-provided project when it owns the file; fall back to
    // a freshly resolved project/config pair for findCallers.
    const seedProject = project;
    const seedResolved = seedProjectResult.data.resolved;

    const seedResult = findCallers(
      {
        filePath: options.filePath,
        line: options.line,
        column: options.column,
        maxDepth: 1,
        crossPackage,
        includeTests,
        maxResults: 100,
      },
      seedProject,
      seedResolved,
    );
    if (!seedResult.success) {
      return error(seedResult.error);
    }

    const seedData = seedResult.data.data;
    const notes = [
      STATIC_NOTE,
      ...seedData.notes.filter(
        (note) =>
          !/cycle detected/i.test(note) &&
          !/static approximation/i.test(note),
      ),
    ];
    let truncated = seedData.truncated;
    let scope: ProjectGraphScope = seedData.scope;
    let expansions = 1;

    const targetNode: PathNode = {
      name: seedData.target.name,
      definition: {
        file: path.resolve(seedData.target.definition.file),
        line: seedData.target.definition.line,
        column: seedData.target.definition.column,
      },
      edgeConfidence: "high",
    };

    const completed: ReachabilityPath[] = [];
    const seenSignatures = new Set<string>();
    const queue: InternalPath[] = [{ nodes: [targetNode] }];

    const tryComplete = (
      internal: InternalPath,
      hit: DetectorHit,
    ): boolean => {
      if (!enabledKinds.has(hit.kind)) {
        return false;
      }
      const tip = internal.nodes[internal.nodes.length - 1]!;
      const forward = [...internal.nodes].reverse();
      const steps: ReachabilityStep[] = forward.map((node) => ({
        name: node.name,
        definition: node.definition,
        callSite: node.callSite,
        kind: node.kind,
      }));
      const pathConfidence = minConfidence(
        hit.confidence,
        ...internal.nodes.map((n) => n.edgeConfidence),
      );
      const signature = pathSignature(forward);
      if (seenSignatures.has(signature)) {
        return true;
      }
      seenSignatures.add(signature);
      completed.push({
        entrypoint: {
          kind: hit.kind,
          location: tip.definition,
          name: tip.name,
        },
        steps,
        confidence: pathConfidence,
      });
      if (hit.note) {
        notes.push(hit.note);
      }
      if (hit.reason === "no_callers") {
        notes.push("unknown soft-root: no_callers");
      }
      if (hit.reason === "max_depth") {
        notes.push("unknown soft-root: max_depth");
      }
      return true;
    };

    while (queue.length > 0 && completed.length < maxPaths) {
      const current = queue.shift()!;
      const tip = current.nodes[current.nodes.length - 1]!;
      const edgeDepth = current.nodes.length - 1;

      const hardHit = detectHardEntrypoint(tip);
      if (hardHit && enabledKinds.has(hardHit.kind)) {
        tryComplete(current, hardHit);
        if (completed.length >= maxPaths) {
          truncated = true;
          notes.push(`truncated: maxPaths=${maxPaths}`);
          break;
        }
        // Intermediate handlers may sit under package export/bin roots —
        // keep walking upward so outer createServer-style exports appear.
        if (hardHit.kind !== "handler") {
          continue;
        }
      }

      if (edgeDepth >= maxDepth) {
        if (enabledKinds.has("unknown")) {
          tryComplete(current, {
            kind: "unknown",
            confidence: "low",
            reason: "max_depth",
            note: `maxDepth=${maxDepth} reached before an entrypoint`,
          });
        }
        continue;
      }

      if (expansions >= EXPANSION_BUDGET) {
        truncated = true;
        notes.push(`truncated: expansion budget=${EXPANSION_BUDGET}`);
        break;
      }

      const callersResult = collectDirectCallers(
        tip.definition,
        crossPackage,
        includeTests,
      );
      expansions++;
      if (!callersResult.success) {
        return error(callersResult.error);
      }
      scope = mergeScope(scope, callersResult.data.scope);
      if (callersResult.data.truncated) {
        truncated = true;
      }
      for (const note of callersResult.data.notes) {
        if (!notes.includes(note) && !/cycle detected/i.test(note)) {
          notes.push(note);
        }
      }

      const callers = callersResult.data.callers;
      if (callers.length === 0) {
        if (enabledKinds.has("unknown")) {
          tryComplete(current, {
            kind: "unknown",
            confidence: "low",
            reason: "no_callers",
          });
        } else if (completed.length === 0 && queue.length === 0) {
          notes.push("no_callers_found");
        }
        continue;
      }

      const uniqueCallers = dedupeCallerDefinitions(callers);
      for (const caller of uniqueCallers) {
        const def = caller.callerDefinition ?? caller.location;
        const defKey = locationKey(def);
        if (current.nodes.some((n) => locationKey(n.definition) === defKey)) {
          // Cycle on this path — skip expanding this edge.
          continue;
        }

        const next: InternalPath = {
          nodes: [
            ...current.nodes,
            {
              name: caller.callerName,
              definition: {
                file: path.resolve(def.file),
                line: def.line,
                column: def.column,
              },
              callSite: {
                file: path.resolve(caller.location.file),
                line: caller.location.line,
                column: caller.location.column,
              },
              kind: caller.kind,
              edgeConfidence: caller.confidence,
            },
          ],
        };
        queue.push(next);
      }
    }

    if (queue.length > 0 && completed.length >= maxPaths) {
      truncated = true;
      if (!notes.some((n) => n.startsWith("truncated: maxPaths"))) {
        notes.push(`truncated: maxPaths=${maxPaths}`);
      }
    }

    if (
      completed.length === 0 &&
      !enabledKinds.has("unknown") &&
      !notes.includes("no_callers_found")
    ) {
      notes.push("no_callers_found");
    }

    const sorted = sortPaths(completed, targetNode.definition.file);
    const data: ReachabilityData = {
      target: {
        name: targetNode.name,
        definition: targetNode.definition,
      },
      paths: sorted.slice(0, maxPaths),
      scope,
      truncated: truncated || sorted.length > maxPaths,
      notes: uniqueNotes(notes),
    };

    return success({
      data,
      formattedOutput: formatReachabilityOutput(data),
    });
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error analyzing reachability: ${message}`);
  }
};

const collectDirectCallers = (
  definition: ReachabilityLocation,
  crossPackage: boolean,
  includeTests: boolean,
): Result<{
  callers: CallerItem[];
  scope: ProjectGraphScope;
  truncated: boolean;
  notes: string[];
}> => {
  const projectResult = getTsMorphProjectForFile(definition.file);
  if (!projectResult.success) {
    return error(projectResult.error);
  }
  const result = findCallers(
    {
      filePath: definition.file,
      line: definition.line,
      column: definition.column,
      maxDepth: 1,
      crossPackage,
      includeTests,
      maxResults: 100,
    },
    projectResult.data.project,
    projectResult.data.resolved,
  );
  if (!result.success) {
    return error(result.error);
  }
  return success({
    callers: result.data.data.callers.filter((c) => c.depth === 1),
    scope: result.data.data.scope,
    truncated: result.data.data.truncated,
    notes: result.data.data.notes,
  });
};

const detectHardEntrypoint = (tip: PathNode): DetectorHit | undefined => {
  const file = tip.definition.file;
  const base = path.basename(file).replace(/\\/g, "/");
  const normalized = file.replace(/\\/g, "/");

  if (isPackageBinEntryFile(file)) {
    return { kind: "bin", confidence: "high" };
  }

  if (isTestFile(normalized, base)) {
    return { kind: "test", confidence: "high" };
  }

  const handlerHit = detectHandler(tip, base, normalized);
  if (handlerHit) {
    return handlerHit;
  }

  if (isExportedCallable(tip) && isPackageExportRoot(tip)) {
    return { kind: "export", confidence: "high" };
  }

  return undefined;
};

/**
 * True when tip is on a package.json#exports target file, or is re-exported
 * from that entry module (dist→src mapped when possible).
 */
const isPackageExportRoot = (tip: PathNode): boolean => {
  if (isPackageExportsEntryFile(tip.definition.file)) {
    return true;
  }
  return isReExportedFromPackageEntry(tip);
};

const reExportCache = new Map<string, boolean>();
const entrySourceCache = new Map<string, string[]>();

const isReExportedFromPackageEntry = (tip: PathNode): boolean => {
  const cacheKey = `${canonicalizePath(tip.definition.file)}::${tip.name}`;
  const cached = reExportCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pkg = findNearestPackageJson(tip.definition.file);
  if (!pkg) {
    reExportCache.set(cacheKey, false);
    return false;
  }

  const tipCanonical = canonicalizePath(tip.definition.file);
  let found = false;
  for (const entry of resolvePackageEntrySourceFiles(pkg)) {
    if (canonicalizePath(entry) === tipCanonical) {
      found = true;
      break;
    }
    const projectResult = getTsMorphProjectForFile(entry);
    if (!projectResult.success) continue;
    const sf = getOrLoadSourceFile(projectResult.data.project, entry);
    if (!sf) continue;
    const decls = sf.getExportedDeclarations().get(tip.name);
    if (!decls) continue;
    for (const decl of decls) {
      const declFile = canonicalizePath(decl.getSourceFile().getFilePath());
      if (declFile === tipCanonical) {
        found = true;
        break;
      }
    }
    if (found) break;
  }
  reExportCache.set(cacheKey, found);
  return found;
};

const resolvePackageEntrySourceFiles = (pkg: PackageJsonInfo): string[] => {
  const cacheKey = canonicalizePath(pkg.directory);
  const cached = entrySourceCache.get(cacheKey);
  if (cached) return cached;

  const files = new Set<string>();
  const push = (absolute: string) => {
    if (existsSync(absolute)) {
      files.add(path.resolve(absolute));
    }
  };

  const tryMapped = (rel: string | undefined) => {
    if (!rel || typeof rel !== "string") return;
    const absolute = path.resolve(pkg.directory, rel);
    push(absolute);

    // dist/foo.js → src/foo.ts, dist/foo.d.ts → src/foo.ts
    const asDts = absolute.replace(/\.js$/i, ".d.ts");
    const preferred = preferWorkspaceSourceFile(
      /\.d\.ts$/i.test(absolute) ? absolute : asDts,
    );
    if (preferred) push(preferred);

    const jsToTs = absolute.replace(/\.js$/i, ".ts");
    if (jsToTs !== absolute) push(jsToTs);
    const jsToTsx = absolute.replace(/\.js$/i, ".tsx");
    if (jsToTsx !== absolute) push(jsToTsx);

    const distToSrc = absolute
      .replace(/\\/g, "/")
      .replace(/\/dist\//, "/src/")
      .replace(/\.js$/i, ".ts");
    if (distToSrc !== absolute.replace(/\\/g, "/")) {
      push(path.resolve(distToSrc));
    }
  };

  tryMapped(pkg.types);
  tryMapped(pkg.typings);
  tryMapped(pkg.main);

  const exportsField = pkg.exports;
  if (typeof exportsField === "string") {
    tryMapped(exportsField);
  } else if (exportsField && typeof exportsField === "object") {
    const map = exportsField as Record<string, unknown>;
    const root = map["."] ?? map["./"];
    if (typeof root === "string") {
      tryMapped(root);
    } else if (root && typeof root === "object") {
      const nested = root as Record<string, unknown>;
      for (const key of ["types", "import", "require", "default"]) {
        const value = nested[key];
        if (typeof value === "string") tryMapped(value);
      }
    }
  }

  // Common fallback when exports point at missing dist artifacts.
  push(path.join(pkg.directory, "src", "index.ts"));
  push(path.join(pkg.directory, "src", "public.ts"));

  const result = [...files];
  entrySourceCache.set(cacheKey, result);
  return result;
};

const detectHandler = (
  tip: PathNode,
  base: string,
  normalized: string,
): DetectorHit | undefined => {
  const wireFile = /^wire-.*-handlers\.(tsx?|jsx?)$/i.test(base);
  const handlerFile = /handler/i.test(base);
  const bridgeAttach =
    /^attach\w*Bridge$/i.test(tip.name) ||
    /\/bridge\.(tsx?|jsx?)$/i.test(normalized) ||
    /bridge/i.test(base);

  if (wireFile || handlerFile || bridgeAttach) {
    if (!isExportedCallable(tip) && tip.name !== "(module)") {
      // Conventional file still counts for exported-looking module roots.
      if (!wireFile && !handlerFile) {
        return undefined;
      }
    }
    const heuristic = wireFile
      ? "wire-*-handlers.ts"
      : handlerFile
        ? "*handler* file"
        : "bridge attach entry";
    return {
      kind: "handler",
      confidence: "medium",
      note: `handler heuristic: ${heuristic}`,
    };
  }
  return undefined;
};

const isExportedCallable = (tip: PathNode): boolean => {
  if (tip.name === "(module)") return false;
  const projectResult = getTsMorphProjectForFile(tip.definition.file);
  if (!projectResult.success) return false;
  const sf = getOrLoadSourceFile(
    projectResult.data.project,
    tip.definition.file,
  );
  if (!sf) return false;

  const exported = sf.getExportedDeclarations();
  for (const [exportName, decls] of exported) {
    if (exportName !== tip.name) continue;
    for (const decl of decls) {
      if (
        Node.isFunctionDeclaration(decl) ||
        Node.isClassDeclaration(decl) ||
        Node.isMethodDeclaration(decl) ||
        Node.isVariableDeclaration(decl)
      ) {
        return true;
      }
    }
  }

  // Default export / export assignment under a different local name.
  for (const [, decls] of exported) {
    for (const decl of decls) {
      const nameNode =
        "getNameNode" in decl && typeof decl.getNameNode === "function"
          ? decl.getNameNode()
          : undefined;
      if (!nameNode) continue;
      const loc = tip.definition;
      const start = nameNode.getStart();
      const sfCompiler = sf.compilerNode;
      const lc = sfCompiler.getLineAndCharacterOfPosition(start);
      if (lc.line + 1 === loc.line && lc.character + 1 === loc.column) {
        return true;
      }
    }
  }
  return false;
};

const isTestFile = (normalized: string, base: string): boolean => {
  if (/\.(test|spec)\.(tsx?|jsx?)$/i.test(base)) return true;
  if (
    normalized.includes("/__tests__/") ||
    normalized.includes("/__mocks__/") ||
    normalized.includes("/tests/")
  ) {
    return true;
  }
  return false;
};

const dedupeCallerDefinitions = (callers: CallerItem[]): CallerItem[] => {
  const seen = new Set<string>();
  const out: CallerItem[] = [];
  for (const caller of callers) {
    const def = caller.callerDefinition ?? caller.location;
    const key = `${locationKey(def)}|${caller.kind}|${caller.confidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(caller);
  }
  return out;
};

const pathSignature = (forwardSteps: PathNode[]): string =>
  forwardSteps.map((n) => locationKey(n.definition)).join(">");

const locationKey = (loc: ReachabilityLocation | CallerLocation): string =>
  `${canonicalizePath(loc.file)}:${loc.line}:${loc.column}`;

const minConfidence = (...values: PathConfidence[]): PathConfidence => {
  let best: PathConfidence = "high";
  for (const value of values) {
    if (CONFIDENCE_RANK[value] > CONFIDENCE_RANK[best]) {
      best = value;
    }
  }
  return best;
};

const sortPaths = (
  paths: ReachabilityPath[],
  anchorFile: string,
): ReachabilityPath[] => {
  void anchorFile;
  return [...paths].sort((a, b) => {
    const conf = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (conf !== 0) return conf;
    const kind =
      KIND_PRIORITY[a.entrypoint.kind] - KIND_PRIORITY[b.entrypoint.kind];
    if (kind !== 0) return kind;
    const pathCmp = canonicalizePath(a.entrypoint.location.file).localeCompare(
      canonicalizePath(b.entrypoint.location.file),
    );
    if (pathCmp !== 0) return pathCmp;
    if (a.entrypoint.location.line !== b.entrypoint.location.line) {
      return a.entrypoint.location.line - b.entrypoint.location.line;
    }
    if (a.entrypoint.location.column !== b.entrypoint.location.column) {
      return a.entrypoint.location.column - b.entrypoint.location.column;
    }
    return a.steps.length - b.steps.length;
  });
};

const mergeScope = (
  a: ProjectGraphScope,
  b: ProjectGraphScope,
): ProjectGraphScope => {
  const rank: Record<ProjectGraphScope, number> = {
    owner: 0,
    "owner-and-dependencies": 1,
    workspace: 2,
    "solution-wide": 3,
  };
  return rank[a] >= rank[b] ? a : b;
};

const normalizeKinds = (
  kinds: EntrypointKind[] | undefined,
): Set<EntrypointKind> => {
  if (!kinds || kinds.length === 0) {
    return new Set(ALL_KINDS);
  }
  const set = new Set<EntrypointKind>();
  for (const kind of kinds) {
    if (ALL_KINDS.includes(kind)) {
      set.add(kind);
    }
  }
  return set.size > 0 ? set : new Set(ALL_KINDS);
};

const clampMaxDepth = (value: number | undefined): number => {
  const n = value ?? DEFAULT_MAX_DEPTH;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_DEPTH;
  return Math.min(Math.floor(n), HARD_MAX_DEPTH);
};

const clampMaxPaths = (value: number | undefined): number => {
  const n = value ?? DEFAULT_MAX_PATHS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_PATHS;
  return Math.min(Math.floor(n), HARD_MAX_PATHS);
};

const uniqueNotes = (notes: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes) {
    if (seen.has(note)) continue;
    seen.add(note);
    out.push(note);
  }
  return out;
};

const getOrLoadSourceFile = (
  project: Project,
  filePath: string,
): SourceFile | undefined => {
  const existing = project.getSourceFile(filePath);
  if (existing) return existing;
  try {
    if (existsSync(filePath)) {
      return project.addSourceFileAtPath(filePath);
    }
  } catch {
    // Unavailable in this project.
  }
  return undefined;
};
