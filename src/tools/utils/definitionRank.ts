import { existsSync } from "fs";
import path from "path";
import { Node, Project, SourceFile, SyntaxKind, ts } from "ts-morph";
import { canonicalizePath, ResolvedTsConfig } from "../resolveTsConfig.js";
import {
  areDifferentPackages,
  findNearestPackageJson,
} from "./packageMetadata.js";

export interface RankedDefinitionSpan {
  file: string;
  start: number;
  length: number;
  name: string;
  kind: string;
  isAlias: boolean;
}

/**
 * When a workspace .d.ts is returned, prefer a co-located or package
 * `src/` TypeScript implementation if it exists.
 */
export const preferWorkspaceSourceFile = (
  declarationFile: string,
): string | undefined => {
  if (!/\.d\.ts$/i.test(declarationFile) || isExternalPath(declarationFile)) {
    return undefined;
  }

  const withoutDts = declarationFile.replace(/\.d\.ts$/i, "");
  for (const ext of [".ts", ".tsx"]) {
    const candidate = withoutDts + ext;
    if (existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  // dist/foo.d.ts → src/foo.ts (common package layout).
  const normalized = declarationFile.replace(/\\/g, "/");
  const distMatch = normalized.match(/^(.*)\/dist\/(.+)\.d\.ts$/i);
  if (distMatch) {
    const root = distMatch[1]!;
    const rest = distMatch[2]!;
    for (const ext of [".ts", ".tsx"]) {
      const candidate = path.resolve(`${root}/src/${rest}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const pkg = findNearestPackageJson(declarationFile);
  if (pkg) {
    const rel = path.relative(pkg.directory, declarationFile);
    const asSrc = rel
      .replace(/\\/g, "/")
      .replace(/^dist\//, "src/")
      .replace(/\.d\.ts$/i, ".ts");
    const candidate = path.resolve(pkg.directory, asSrc);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

export const isExternalPath = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.includes("/node_modules/") ||
    normalized.endsWith("/node_modules")
  );
};

export const isWorkspaceDistPath = (filePath: string): boolean => {
  if (isExternalPath(filePath)) return false;
  return /\/dist\//i.test(filePath.replace(/\\/g, "/"));
};

export const isTsSourceFile = (filePath: string): boolean => {
  return /\.tsx?$/i.test(filePath) && !/\.d\.ts$/i.test(filePath);
};

export const isJunkFileStartSpan = (span: RankedDefinitionSpan): boolean => {
  return span.start === 0 && span.length <= 1;
};

/**
 * Relocate a span into a preferred source file by named declaration.
 * Returns undefined when the name cannot be found (avoids 1:1 junk peers).
 */
export const relocateSpanToSourceFile = (
  project: Project,
  entry: RankedDefinitionSpan,
  preferredFile: string,
): RankedDefinitionSpan | undefined => {
  const preferred = getOrLoadSourceFile(project, preferredFile);
  if (!preferred) return undefined;

  if (entry.name && entry.name !== "<anonymous>") {
    const decl = findNamedDeclarationSpan(preferred, entry.name);
    if (decl) {
      return {
        file: preferred.getFilePath(),
        start: decl.start,
        length: decl.length,
        name: entry.name,
        kind: entry.kind,
        isAlias: false,
      };
    }
  }

  return undefined;
};

export const findNamedDeclarationSpan = (
  sourceFile: SourceFile,
  name: string,
): { start: number; length: number } | undefined => {
  const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const id of identifiers) {
    if (id.getText() !== name) continue;
    const parent = id.getParent();
    if (
      Node.isTypeAliasDeclaration(parent) ||
      Node.isInterfaceDeclaration(parent) ||
      Node.isClassDeclaration(parent) ||
      Node.isEnumDeclaration(parent) ||
      Node.isFunctionDeclaration(parent) ||
      Node.isVariableDeclaration(parent) ||
      Node.isModuleDeclaration(parent)
    ) {
      return { start: id.getStart(), length: id.getWidth() };
    }
  }
  return undefined;
};

export const expandDtsToWorkspaceSource = (
  project: Project,
  spans: RankedDefinitionSpan[],
): RankedDefinitionSpan[] => {
  const expanded = [...spans];
  for (const entry of spans) {
    if (!/\.d\.ts$/i.test(entry.file) || isExternalPath(entry.file)) continue;
    const preferred = preferWorkspaceSourceFile(entry.file);
    if (!preferred || preferred === entry.file) continue;
    const preferredSpan = relocateSpanToSourceFile(project, entry, preferred);
    if (preferredSpan) {
      expanded.push(preferredSpan);
    }
  }
  return expanded;
};

const DECLARATION_KINDS = new Set([
  "type",
  "interface",
  "class",
  "enum",
  "function",
  "const",
  "let",
  "variable",
  "method",
  "property",
  "constructor",
  "module",
]);

export const isDeclarationKind = (kind: string): boolean =>
  DECLARATION_KINDS.has(kind);

export const isTestPath = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, "/");
  const base = path.basename(normalized);
  if (/\.(test|spec)\.(tsx?|jsx?)$/i.test(base)) return true;
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("/__mocks__/")
  );
};

const isGoodDeclarationSpan = (
  span: RankedDefinitionSpan,
  querySymbol?: string,
): boolean => {
  if (span.name === "<anonymous>") return false;
  if (isJunkFileStartSpan(span)) return false;
  if (isExternalPath(span.file)) return false;
  if (!isTsSourceFile(span.file)) return false;
  if (isTestPath(span.file)) return false;
  if (!isDeclarationKind(span.kind)) return false;
  if (querySymbol && span.name !== querySymbol) return false;
  return true;
};

/**
 * Drop workspace dist/.d.ts peers when a workspace src hit exists for the
 * same symbol name; drop unresolved 1:1 / anonymous / test usage junk when a
 * real named declaration exists.
 */
export const pruneNoisyDefinitionSpans = (
  spans: RankedDefinitionSpan[],
  querySymbol?: string,
): RankedDefinitionSpan[] => {
  const hasWorkspaceSrcForName = (name: string): boolean =>
    spans.some(
      (s) =>
        s.name === name &&
        isTsSourceFile(s.file) &&
        !isExternalPath(s.file) &&
        !isJunkFileStartSpan(s),
    );

  const hasGoodDeclaration = spans.some((s) =>
    isGoodDeclarationSpan(s, querySymbol),
  );

  return spans.filter((span) => {
    if (
      /\.d\.ts$/i.test(span.file) &&
      !isExternalPath(span.file) &&
      hasWorkspaceSrcForName(span.name)
    ) {
      return false;
    }

    if (isJunkFileStartSpan(span) && hasWorkspaceSrcForName(span.name)) {
      return false;
    }

    if (!hasGoodDeclaration) {
      return true;
    }

    // Prefer real declarations: drop anonymous / test usage / non-decl impls.
    if (span.name === "<anonymous>") {
      return false;
    }
    if (isTestPath(span.file)) {
      return false;
    }
    // Usage-site implementations (esp. from getImplementationAtPosition) lose
    // to a real named declaration.
    if (span.kind === "implementation") {
      return false;
    }

    return true;
  });
};

export const deduplicateDefinitionSpans = (
  spans: RankedDefinitionSpan[],
): RankedDefinitionSpan[] => {
  const seen = new Set<string>();
  const result: RankedDefinitionSpan[] = [];
  for (const span of spans) {
    const key = `${canonicalizePath(span.file)}:${span.start}:${span.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(span);
  }
  return result;
};

export const rankDefinitionSpans = (
  spans: RankedDefinitionSpan[],
  queryFile: string,
  resolvedConfig?: ResolvedTsConfig,
  querySymbol?: string,
): RankedDefinitionSpan[] => {
  const scored = spans.map((span) => ({
    span,
    score: scoreDefinitionSpan(span, queryFile, resolvedConfig, querySymbol),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pathCmp = canonicalizePath(a.span.file).localeCompare(
      canonicalizePath(b.span.file),
    );
    if (pathCmp !== 0) return pathCmp;
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    return a.span.length - b.span.length;
  });
  return scored.map((entry) => entry.span);
};

export const scoreDefinitionSpan = (
  span: RankedDefinitionSpan,
  queryFile: string,
  resolvedConfig?: ResolvedTsConfig,
  querySymbol?: string,
): number => {
  let score = 0;
  const file = span.file;
  const isDts = /\.d\.ts$/i.test(file);
  const owned =
    resolvedConfig !== undefined
      ? isOwnedByWorkspace(file, resolvedConfig)
      : !isExternalPath(file);
  const external = isExternalPath(file) || !owned;
  const isTs = isTsSourceFile(file);
  const anonymous = span.name === "<anonymous>";
  const testFile = isTestPath(file);
  const implementation = span.kind === "implementation";
  const samePackage = !areDifferentPackages(queryFile, file);

  if (isTs) score += 40;
  if (!isDts) score += 10;
  if (!external) score += 20;
  // samePackage must not promote test/anonymous/implementation usage sites
  // over cross-package declarations.
  if (samePackage && !anonymous && !testFile && !implementation) {
    score += 15;
  }
  if (isDeclarationKind(span.kind)) score += 35;
  if (querySymbol && span.name === querySymbol) score += 20;
  if (anonymous) score -= 80;
  if (implementation) score -= 40;
  if (testFile) score -= 60;
  if (span.isAlias) score -= 30;
  if (isWorkspaceDistPath(file)) score -= 25;
  if (isJunkFileStartSpan(span)) score -= 50;
  return score;
};

export const isDefinitionExternal = (
  filePath: string,
  hasWorkspaceSrcPeer: boolean,
): boolean => {
  if (isExternalPath(filePath)) return true;
  if (hasWorkspaceSrcPeer && (/\.d\.ts$/i.test(filePath) || isWorkspaceDistPath(filePath))) {
    return true;
  }
  return false;
};

const isOwnedByWorkspace = (
  filePath: string,
  resolvedConfig: ResolvedTsConfig,
): boolean => {
  if (isExternalPath(filePath)) return false;
  const canonical = canonicalizePath(filePath);
  return resolvedConfig.parsed.fileNames.some(
    (name) => canonicalizePath(name) === canonical,
  );
};

export const getOrLoadSourceFile = (
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
    // External / unavailable in this project.
  }
  return undefined;
};

export const mapScriptElementKind = (
  kind: ts.ScriptElementKind | string,
): string => {
  const value = String(kind);
  const mapped: Record<string, string> = {
    [ts.ScriptElementKind.variableElement]: "variable",
    [ts.ScriptElementKind.localVariableElement]: "variable",
    [ts.ScriptElementKind.parameterElement]: "parameter",
    [ts.ScriptElementKind.functionElement]: "function",
    [ts.ScriptElementKind.localFunctionElement]: "function",
    [ts.ScriptElementKind.memberFunctionElement]: "method",
    [ts.ScriptElementKind.memberVariableElement]: "property",
    [ts.ScriptElementKind.memberGetAccessorElement]: "property",
    [ts.ScriptElementKind.memberSetAccessorElement]: "property",
    [ts.ScriptElementKind.classElement]: "class",
    [ts.ScriptElementKind.interfaceElement]: "interface",
    [ts.ScriptElementKind.typeElement]: "type",
    [ts.ScriptElementKind.typeParameterElement]: "type",
    [ts.ScriptElementKind.constElement]: "const",
    [ts.ScriptElementKind.letElement]: "let",
    [ts.ScriptElementKind.alias]: "alias",
    [ts.ScriptElementKind.keyword]: "keyword",
    [ts.ScriptElementKind.enumElement]: "enum",
    [ts.ScriptElementKind.moduleElement]: "module",
    [ts.ScriptElementKind.constructorImplementationElement]: "constructor",
  };
  if (mapped[value]) return mapped[value]!;
  return (
    value
      .replace(/element$/i, "")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/^-|-$/g, "") || "unknown"
  );
};
