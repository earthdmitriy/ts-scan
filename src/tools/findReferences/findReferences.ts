import { existsSync } from "fs";
import path from "path";
import { Node, Project, SourceFile, SyntaxKind, ts } from "ts-morph";
import { error, Result, success, ToolResult } from "../../types.js";
import { getTsMorphProjectForFile } from "../getTsMorphProject.js";
import {
  ProjectGraphScope,
  resolveProjectGraphForFile,
} from "../projectGraph/resolveProjectGraphForFile.js";
import { cachedResolveExportInNodeModules } from "../exportCache/exportCache.js";
import { resolveLocalExport } from "../resolve/resolveLocalExport.js";
import {
  canonicalizePath,
  ResolvedTsConfig,
  resolveAbsolutePath,
} from "../resolveTsConfig.js";
import { findNearestPackageName } from "../utils/packageMetadata.js";
import {
  offsetToLineColumn,
  resolveSourcePosition,
} from "../utils/sourcePosition.js";
import { formatFindReferencesOutput } from "./formatFindReferences.js";

export type ReferenceKind =
  | "declaration"
  | "read"
  | "write"
  | "call"
  | "import"
  | "type"
  | "export"
  | "unknown";

export interface ReferenceLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface ReferenceItem {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  kind: ReferenceKind;
  package?: string;
  snippet?: string;
}

export interface FindReferencesData {
  symbol: string;
  definition: ReferenceLocation;
  references: ReferenceItem[];
  /** Total references before maxResults truncation. */
  totalCount: number;
  scope: ProjectGraphScope;
  truncated: boolean;
  notes: string[];
}

export interface FindReferencesOptions {
  filePath?: string;
  line?: number;
  column?: number;
  symbol?: string;
  relativeTo?: string;
  includeDeclaration?: boolean;
  crossPackage?: boolean;
  includeTests?: boolean;
  maxResults?: number;
}

interface SerializedEntry {
  file: string;
  start: number;
  length: number;
  isWriteAccess: boolean;
  isDefinition: boolean;
}

interface QueryTarget {
  symbol: string;
  definition: ReferenceLocation;
  queryPositions: Array<{ file: string; offset: number }>;
  notes: string[];
}

const DEFAULT_MAX_RESULTS = 100;
const HARD_MAX_RESULTS = 1000;
const SNIPPET_MAX = 200;

/**
 * Find TypeScript-identity references for a position or exported symbol.
 */
export const findReferences = (
  options: FindReferencesOptions,
  project: Project,
  resolvedConfig: ResolvedTsConfig,
): Result<ToolResult<FindReferencesData>> => {
  const modeResult = validateMode(options);
  if (!modeResult.success) {
    return error(modeResult.error);
  }

  const includeDeclaration = options.includeDeclaration !== false;
  const crossPackage = options.crossPackage !== false;
  const includeTests = options.includeTests !== false;
  const maxResults = clampMaxResults(options.maxResults);

  try {
    const targetResult =
      modeResult.data === "position"
        ? resolvePositionTarget(options, project)
        : resolveSymbolTarget(options, project, resolvedConfig);

    if (!targetResult.success) {
      return error(targetResult.error);
    }
    const target = targetResult.data;

    const anchorFile =
      options.filePath ?? options.relativeTo ?? target.definition.file;
    const graphResult = resolveProjectGraphForFile(anchorFile, {
      crossPackage,
    });
    if (!graphResult.success) {
      return error(graphResult.error);
    }
    const graph = graphResult.data;
    const notes = [...target.notes, ...graph.notes];

    if (graph.scope !== "solution-wide" && crossPackage) {
      // Already noted by graph helper when applicable.
    }

    const entries = collectEntriesAcrossGraph(
      graph.configs,
      target.queryPositions,
      crossPackage ? graph.configuredFiles : undefined,
    );

    const classified = entries.map((entry) =>
      toReferenceItem(entry, target.definition.file),
    );

    const deduped = deduplicateItems(classified);
    const filtered = deduped.filter((item) => {
      if (!includeDeclaration && item.kind === "declaration") {
        return false;
      }
      if (!includeTests && isTestFile(item.file)) {
        return false;
      }
      if (
        !crossPackage &&
        areDifferentPackageNames(target.definition.file, item.file)
      ) {
        return false;
      }
      return true;
    });

    const sorted = sortReferences(filtered, target.definition.file);
    const totalCount = sorted.length;
    const truncatedByCap = totalCount > maxResults;
    const references = truncatedByCap ? sorted.slice(0, maxResults) : sorted;

    if (
      notes.every((n) => !n.includes("export *")) &&
      mayHaveStarExportGaps(deduped)
    ) {
      notes.push(
        "export * re-exports may not map every downstream alias to one identity.",
      );
    }

    const data: FindReferencesData = {
      symbol: target.symbol,
      definition: target.definition,
      references,
      totalCount,
      scope: crossPackage ? graph.scope : "owner",
      truncated: truncatedByCap || graph.truncated,
      notes,
    };

    return success({
      data,
      formattedOutput: formatFindReferencesOutput(data),
    });
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error finding references: ${message}`);
  }
};

const validateMode = (
  options: FindReferencesOptions,
): Result<"position" | "symbol"> => {
  const hasPosition =
    options.filePath !== undefined && options.line !== undefined;
  const hasSymbol =
    options.symbol !== undefined && options.relativeTo !== undefined;

  if (hasPosition && hasSymbol) {
    return error(
      "Provide either position mode (file_path + line) or symbol mode " +
        "(symbol + relativeTo), not both.",
    );
  }
  if (!hasPosition && !hasSymbol) {
    return error(
      "Provide either position mode (file_path + line) or symbol mode " +
        "(symbol + relativeTo).",
    );
  }
  if (hasPosition) {
    if (options.symbol !== undefined || options.relativeTo !== undefined) {
      return error("Position mode cannot include symbol/relativeTo fields.");
    }
    return success("position");
  }
  if (options.filePath !== undefined || options.line !== undefined) {
    return error("Symbol mode cannot include file_path/line/column fields.");
  }
  return success("symbol");
};

const clampMaxResults = (value: number | undefined): number => {
  const n = value ?? DEFAULT_MAX_RESULTS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.floor(n), HARD_MAX_RESULTS);
};

const resolvePositionTarget = (
  options: FindReferencesOptions,
  project: Project,
): Result<QueryTarget> => {
  const filePath = options.filePath!;
  const positionResult = resolveSourcePosition(
    project,
    filePath,
    options.line!,
    options.column,
    options.column === undefined ? "first-identifier" : "required",
  );
  if (!positionResult.success) {
    return error(positionResult.error);
  }

  const { sourceFile, offset } = positionResult.data;
  const fileName = sourceFile.getFilePath();
  const languageService = project.getLanguageService().compilerObject;
  const referenced = languageService.findReferences(fileName, offset) ?? [];

  if (referenced.length === 0) {
    return error(
      `Symbol unresolved at ${filePath}:${options.line}` +
        (options.column !== undefined ? `:${options.column}` : ""),
    );
  }

  const primary = referenced[0]!;
  const def = primary.definition;
  const defFile = resolveAbsolutePath(def.fileName);
  const defSpan = def.textSpan;
  const defSf = getOrLoadSourceFile(project, defFile);
  const start = defSf
    ? offsetToLineColumn(defSf, defSpan.start)
    : lineColFromFile(defFile, defSpan.start);
  const end = defSf
    ? offsetToLineColumn(defSf, defSpan.start + Math.max(defSpan.length, 0))
    : lineColFromFile(defFile, defSpan.start + Math.max(defSpan.length, 0));

  const symbol = cleanSymbolName(
    def.name && def.name.length > 0
      ? def.name
      : (guessNameAt(project, defFile, defSpan.start) ?? "<anonymous>"),
  );

  const queryPositions = collectQueryPositionsFromReferenced(
    referenced,
    fileName,
    offset,
  );

  return success({
    symbol,
    definition: {
      file: defFile,
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
    queryPositions,
    notes: [],
  });
};

const resolveSymbolTarget = (
  options: FindReferencesOptions,
  project: Project,
  resolvedConfig: ResolvedTsConfig,
): Result<QueryTarget> => {
  const symbol = options.symbol!;
  const relativeTo = options.relativeTo!;

  const localResult = resolveLocalExport(symbol, resolvedConfig, relativeTo);
  const nodeResult = cachedResolveExportInNodeModules(symbol, {
    anchorFile: relativeTo,
    resolvedConfig,
  });
  const localResults = localResult.success ? localResult.data : [];
  const nodeResults = nodeResult.success ? nodeResult.data : [];

  if (localResults.length === 0 && nodeResults.length === 0) {
    return error(`Symbol unresolved: "${symbol}"`);
  }

  const ranked = rankSymbolCandidates(
    symbol,
    localResults,
    nodeResults,
    relativeTo,
  );

  const identities: Array<{
    file: string;
    offset: number;
    endOffset: number;
    label: string;
  }> = [];

  for (const candidate of ranked) {
    const resolved = locateExportedDeclaration(
      candidate.definitionPath,
      symbol,
      project,
    );
    if (!resolved) continue;
    const key = `${canonicalizePath(resolved.file)}:${resolved.offset}`;
    if (
      identities.some(
        (id) => `${canonicalizePath(id.file)}:${id.offset}` === key,
      )
    ) {
      continue;
    }
    identities.push({
      file: resolved.file,
      offset: resolved.offset,
      endOffset: resolved.endOffset,
      label: candidate.label,
    });
  }

  if (identities.length === 0) {
    return error(`Symbol unresolved: "${symbol}"`);
  }

  if (identities.length > 1) {
    const lines = identities.map(
      (id) =>
        `- ${id.file}:${offsetToDisplay(id.file, id.offset)} (${id.label})`,
    );
    return error(
      `ambiguous_symbol: multiple distinct definitions for "${symbol}":\n` +
        lines.join("\n"),
    );
  }

  const chosen = identities[0]!;
  const start = lineColFromFile(chosen.file, chosen.offset);
  const end = lineColFromFile(chosen.file, chosen.endOffset);

  // Ensure we query from a project that owns the definition file.
  const defProjectResult = getTsMorphProjectForFile(chosen.file);
  const queryProject = defProjectResult.success
    ? defProjectResult.data.project
    : project;
  const languageService = queryProject.getLanguageService().compilerObject;
  const referenced =
    languageService.findReferences(chosen.file, chosen.offset) ?? [];
  const queryPositions = collectQueryPositionsFromReferenced(
    referenced,
    chosen.file,
    chosen.offset,
  );

  return success({
    symbol,
    definition: {
      file: chosen.file,
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
    },
    queryPositions,
    notes: [],
  });
};

interface RankedCandidate {
  label: string;
  definitionPath: string;
  rank: number;
}

const rankSymbolCandidates = (
  symbol: string,
  localResults: Array<{ path: string; relative: string }>,
  nodeResults: string[],
  relativeTo: string,
): RankedCandidate[] => {
  const anchorPackage = findNearestPackageName(relativeTo);
  const ranked: RankedCandidate[] = [];

  for (const importPath of nodeResults) {
    ranked.push({
      label: `recommended:${importPath}`,
      definitionPath: importPath,
      rank: 300,
    });
  }

  for (const local of localResults) {
    const hitPackage = findNearestPackageName(local.path);
    const isCross =
      !!anchorPackage && !!hitPackage && anchorPackage !== hitPackage;
    ranked.push({
      label: isCross
        ? `implementation:${local.path}`
        : `same-package:${local.path}`,
      definitionPath: local.path,
      rank: isCross ? 100 : 200,
    });
  }

  ranked.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return canonicalizePath(a.definitionPath).localeCompare(
      canonicalizePath(b.definitionPath),
    );
  });

  void symbol;
  return ranked;
};

const locateExportedDeclaration = (
  definitionPath: string,
  symbol: string,
  fallbackProject: Project,
): { file: string; offset: number; endOffset: number } | undefined => {
  const absolute = path.resolve(definitionPath);
  // Package entry may be a bare specifier — skip non-files.
  if (!existsSync(absolute) || !/\.(tsx?|d\.ts)$/i.test(absolute)) {
    return undefined;
  }

  const projectResult = getTsMorphProjectForFile(absolute);
  const project = projectResult.success
    ? projectResult.data.project
    : fallbackProject;
  const sf = getOrLoadSourceFile(project, absolute);
  if (!sf) return undefined;

  const span = findExportedNameSpan(sf, symbol);
  if (!span) return undefined;
  return {
    file: path.resolve(sf.getFilePath()),
    offset: span.start,
    endOffset: span.start + span.length,
  };
};

const findExportedNameSpan = (
  sourceFile: SourceFile,
  symbol: string,
): { start: number; length: number } | undefined => {
  for (const decl of sourceFile.getExportedDeclarations().get(symbol) ?? []) {
    if (Node.isVariableDeclaration(decl)) {
      const name = decl.getNameNode();
      return { start: name.getStart(), length: name.getWidth() };
    }
    if (
      Node.isFunctionDeclaration(decl) ||
      Node.isClassDeclaration(decl) ||
      Node.isInterfaceDeclaration(decl) ||
      Node.isTypeAliasDeclaration(decl) ||
      Node.isEnumDeclaration(decl)
    ) {
      const name = decl.getNameNode?.();
      if (name) {
        return { start: name.getStart(), length: name.getWidth() };
      }
    }
    if (Node.isIdentifier(decl)) {
      return { start: decl.getStart(), length: decl.getWidth() };
    }
  }

  // Fallback: first exported identifier with this text.
  for (const id of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() !== symbol) continue;
    const parent = id.getParent();
    if (
      Node.isFunctionDeclaration(parent) ||
      Node.isVariableDeclaration(parent) ||
      Node.isClassDeclaration(parent) ||
      Node.isInterfaceDeclaration(parent) ||
      Node.isTypeAliasDeclaration(parent) ||
      Node.isEnumDeclaration(parent)
    ) {
      return { start: id.getStart(), length: id.getWidth() };
    }
  }
  return undefined;
};

const collectQueryPositionsFromReferenced = (
  referenced: readonly ts.ReferencedSymbol[],
  fallbackFile: string,
  fallbackOffset: number,
): Array<{ file: string; offset: number }> => {
  const positions: Array<{ file: string; offset: number }> = [
    { file: resolveAbsolutePath(fallbackFile), offset: fallbackOffset },
  ];
  const seen = new Set<string>();

  for (const sym of referenced) {
    const defFile = resolveAbsolutePath(sym.definition.fileName);
    const defOffset = sym.definition.textSpan.start;
    const defKey = `${canonicalizePath(defFile)}:${defOffset}`;
    if (!seen.has(defKey)) {
      seen.add(defKey);
      positions.push({ file: defFile, offset: defOffset });
    }
    for (const entry of sym.references) {
      if (!entry.isDefinition) continue;
      const file = resolveAbsolutePath(entry.fileName);
      const offset = entry.textSpan.start;
      const key = `${canonicalizePath(file)}:${offset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      positions.push({ file, offset });
    }
  }
  return positions;
};

const collectEntriesAcrossGraph = (
  configs: ResolvedTsConfig[],
  queryPositions: Array<{ file: string; offset: number }>,
  configuredFiles: Set<string> | undefined,
): SerializedEntry[] => {
  const entries: SerializedEntry[] = [];
  const seenEntry = new Set<string>();
  const queried = new Set<string>();

  // Always try each query position in its owning project.
  for (const qp of queryPositions) {
    const key = `${canonicalizePath(qp.file)}:${qp.offset}`;
    if (queried.has(key)) continue;
    queried.add(key);
    const projectResult = getTsMorphProjectForFile(qp.file);
    if (!projectResult.success) continue;
    appendFindReferences(
      projectResult.data.project,
      qp.file,
      qp.offset,
      entries,
      seenEntry,
      configuredFiles,
    );
  }

  // For each graph config, also try querying at definition/alias positions
  // that belong to that config (catches dependent packages).
  for (const config of configs) {
    const configFiles = new Set(
      config.parsed.fileNames.map((f) => canonicalizePath(f)),
    );
    const positionsInConfig = queryPositions.filter((qp) =>
      configFiles.has(canonicalizePath(qp.file)),
    );

    // Prefer a representative file from this config to load the project.
    const representative =
      positionsInConfig[0]?.file ??
      config.parsed.fileNames.find(
        (f) => !f.includes(`${path.sep}node_modules${path.sep}`),
      );
    if (!representative) continue;

    const projectResult = getTsMorphProjectForFile(representative);
    if (!projectResult.success) continue;
    const project = projectResult.data.project;

    for (const qp of queryPositions) {
      const qKey = `${canonicalizePath(config.tsConfigPath)}:${canonicalizePath(qp.file)}:${qp.offset}`;
      if (queried.has(qKey)) continue;
      queried.add(qKey);

      const ownedByConfig = configFiles.has(canonicalizePath(qp.file));
      if (!ownedByConfig) {
        // Do not addSourceFileAtPath foreign definitions into this
        // package project — discover local import/export aliases instead.
        discoverAndQueryAliases(
          project,
          config,
          qp,
          entries,
          seenEntry,
          configuredFiles,
          queried,
        );
        continue;
      }

      appendFindReferences(
        project,
        qp.file,
        qp.offset,
        entries,
        seenEntry,
        configuredFiles,
      );
    }
  }

  return entries;
};

const discoverAndQueryAliases = (
  project: Project,
  config: ResolvedTsConfig,
  definitionQuery: { file: string; offset: number },
  entries: SerializedEntry[],
  seenEntry: Set<string>,
  configuredFiles: Set<string> | undefined,
  queried: Set<string>,
): void => {
  const languageService = project.getLanguageService().compilerObject;
  const targetCanonical = canonicalizePath(definitionQuery.file);
  const targetName = guessSymbolNameFromFile(
    definitionQuery.file,
    definitionQuery.offset,
  );

  for (const fileName of config.parsed.fileNames) {
    if (fileName.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const sf = getOrLoadSourceFile(project, fileName);
    if (!sf) continue;

    for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (targetName && id.getText() !== targetName) continue;

      const parent = id.getParent();
      if (
        !Node.isImportSpecifier(parent) &&
        !Node.isExportSpecifier(parent) &&
        !Node.isImportClause(parent)
      ) {
        continue;
      }

      const offset = id.getStart();
      const defs =
        languageService.getDefinitionAtPosition(sf.getFilePath(), offset) ?? [];
      const matches = defs.some((d) => {
        const file = resolveAbsolutePath(d.fileName);
        const canonical = canonicalizePath(file);
        if (canonical === targetCanonical) return true;
        // Prefer workspace .ts when LS returns a sibling .d.ts.
        if (/\.d\.ts$/i.test(file)) {
          const asTs = file.replace(/\.d\.ts$/i, ".ts");
          if (canonicalizePath(asTs) === targetCanonical) return true;
        }
        return false;
      });
      if (!matches) continue;

      const qKey = `${canonicalizePath(config.tsConfigPath)}:${canonicalizePath(sf.getFilePath())}:${offset}`;
      if (queried.has(qKey)) continue;
      queried.add(qKey);
      appendFindReferences(
        project,
        sf.getFilePath(),
        offset,
        entries,
        seenEntry,
        configuredFiles,
      );
    }
  }
};

const guessSymbolNameFromFile = (
  filePath: string,
  offset: number,
): string | undefined => {
  const text = ts.sys.readFile(filePath);
  if (text === undefined) return undefined;
  const slice = text.slice(offset, Math.min(text.length, offset + 128));
  const match = slice.match(/^[A-Za-z_$][\w$]*/);
  return match?.[0];
};

const appendFindReferences = (
  project: Project,
  file: string,
  offset: number,
  entries: SerializedEntry[],
  seenEntry: Set<string>,
  configuredFiles: Set<string> | undefined,
): void => {
  const languageService = project.getLanguageService().compilerObject;
  let referenced: readonly ts.ReferencedSymbol[] | undefined;
  try {
    referenced = languageService.findReferences(file, offset) ?? [];
  } catch {
    return;
  }

  for (const sym of referenced) {
    for (const entry of sym.references) {
      const abs = resolveAbsolutePath(entry.fileName);
      if (
        configuredFiles &&
        !configuredFiles.has(canonicalizePath(abs)) &&
        !isExternalPath(abs)
      ) {
        // Keep entries outside the graph budget only when external.
        // Workspace files not in graph are skipped.
        const inAnyLoaded = project.getSourceFile(abs) !== undefined;
        if (!inAnyLoaded) continue;
      }
      const key = `${canonicalizePath(abs)}:${entry.textSpan.start}:${entry.textSpan.length}`;
      if (seenEntry.has(key)) continue;
      seenEntry.add(key);
      entries.push({
        file: abs,
        start: entry.textSpan.start,
        length: entry.textSpan.length,
        isWriteAccess: !!entry.isWriteAccess,
        isDefinition: !!entry.isDefinition,
      });
    }
  }
};

const toReferenceItem = (
  entry: SerializedEntry,
  anchorFile: string,
): ReferenceItem => {
  const projectResult = getTsMorphProjectForFile(entry.file);
  const project = projectResult.success
    ? projectResult.data.project
    : undefined;
  const sf = project ? getOrLoadSourceFile(project, entry.file) : undefined;

  const start = sf
    ? offsetToLineColumn(sf, entry.start)
    : lineColFromFile(entry.file, entry.start);
  const endOffset = entry.start + Math.max(entry.length, 0);
  const end = sf
    ? offsetToLineColumn(sf, endOffset)
    : lineColFromFile(entry.file, endOffset);

  const kind = classifyReference(entry, sf);
  const pkg = findNearestPackageName(entry.file) ?? undefined;
  const snippet = sf
    ? extractSnippet(sf, entry.start)
    : extractSnippetFromDisk(entry.file, entry.start);

  void anchorFile;
  return {
    file: path.resolve(entry.file),
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    kind,
    package: pkg,
    snippet,
  };
};

const classifyReference = (
  entry: SerializedEntry,
  sourceFile: SourceFile | undefined,
): ReferenceKind => {
  if (!sourceFile) {
    if (entry.isDefinition) return "declaration";
    if (entry.isWriteAccess) return "write";
    return "unknown";
  }

  const compilerSf = sourceFile.compilerNode;
  const node = findTokenAt(compilerSf, entry.start);
  if (!node) {
    if (entry.isDefinition) return "declaration";
    if (entry.isWriteAccess) return "write";
    return "unknown";
  }

  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isImportSpecifier(current) ||
      ts.isImportClause(current) ||
      ts.isNamespaceImport(current) ||
      ts.isImportEqualsDeclaration(current)
    ) {
      return "import";
    }
    if (ts.isExportSpecifier(current)) {
      return "export";
    }
    if (
      ts.isExportDeclaration(current) &&
      current.moduleSpecifier &&
      !entry.isDefinition
    ) {
      return "export";
    }
    if (isTypeContext(current, node)) {
      return "type";
    }
    if (isCallCallee(current, node)) {
      return "call";
    }
    if (isDeclarationName(current, node)) {
      return "declaration";
    }
    current = current.parent;
  }

  if (entry.isDefinition) {
    return "declaration";
  }

  current = node;
  while (current) {
    if (isWriteTarget(current, node)) {
      return "write";
    }
    current = current.parent;
  }

  if (entry.isWriteAccess) return "write";
  return "read";
};

const findTokenAt = (
  sourceFile: ts.SourceFile,
  position: number,
): ts.Node | undefined => {
  const getToken = (node: ts.Node): ts.Node | undefined => {
    for (const child of node.getChildren(sourceFile)) {
      if (position >= child.getStart(sourceFile) && position < child.end) {
        return getToken(child) ?? child;
      }
    }
    return node;
  };
  return getToken(sourceFile);
};

const isTypeContext = (current: ts.Node, target: ts.Node): boolean => {
  if (
    ts.isTypeReferenceNode(current) ||
    ts.isTypeQueryNode(current) ||
    ts.isExpressionWithTypeArguments(current) ||
    ts.isTypeOperatorNode(current) ||
    ts.isImportTypeNode(current)
  ) {
    return nodeContains(current, target);
  }
  if (
    ts.isTypeAliasDeclaration(current) ||
    ts.isInterfaceDeclaration(current)
  ) {
    // Name of the alias/interface itself is declaration, not type-use.
    const name = (current as ts.TypeAliasDeclaration | ts.InterfaceDeclaration)
      .name;
    if (name && nodeContains(name, target)) {
      return false;
    }
  }
  if (ts.isParameter(current) && current.type) {
    return nodeContains(current.type, target);
  }
  if (
    (ts.isVariableDeclaration(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isPropertySignature(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodSignature(current)) &&
    "type" in current &&
    current.type
  ) {
    return nodeContains(current.type as ts.Node, target);
  }
  return false;
};

const isCallCallee = (current: ts.Node, target: ts.Node): boolean => {
  if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
    return nodeContains(current.expression, target);
  }
  if (ts.isTaggedTemplateExpression(current)) {
    return nodeContains(current.tag, target);
  }
  if (
    ts.isPropertyAccessExpression(current) &&
    ts.isIdentifier(current.name) &&
    nodeContains(current.name, target)
  ) {
    const parent = current.parent;
    if (ts.isCallExpression(parent) && parent.expression === current) {
      return true;
    }
  }
  return false;
};

const isDeclarationName = (current: ts.Node, target: ts.Node): boolean => {
  if (
    ts.isFunctionDeclaration(current) ||
    ts.isClassDeclaration(current) ||
    ts.isInterfaceDeclaration(current) ||
    ts.isTypeAliasDeclaration(current) ||
    ts.isEnumDeclaration(current) ||
    ts.isMethodDeclaration(current) ||
    ts.isPropertyDeclaration(current) ||
    ts.isGetAccessorDeclaration(current) ||
    ts.isSetAccessorDeclaration(current)
  ) {
    const name = current.name;
    return !!name && nodeContains(name, target);
  }
  if (ts.isVariableDeclaration(current)) {
    return nodeContains(current.name, target);
  }
  if (ts.isParameter(current)) {
    return nodeContains(current.name, target);
  }
  return false;
};

const isWriteTarget = (current: ts.Node, target: ts.Node): boolean => {
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return nodeContains(current.left, target);
  }
  if (
    ts.isBinaryExpression(current) &&
    isAssignmentOperator(current.operatorToken.kind)
  ) {
    return nodeContains(current.left, target);
  }
  if (
    ts.isPrefixUnaryExpression(current) ||
    ts.isPostfixUnaryExpression(current)
  ) {
    if (
      current.operator === ts.SyntaxKind.PlusPlusToken ||
      current.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      return nodeContains(current.operand, target);
    }
  }
  if (ts.isBindingElement(current)) {
    return nodeContains(current.name, target);
  }
  return false;
};

const isAssignmentOperator = (kind: ts.SyntaxKind): boolean => {
  return (
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken
  );
};

const nodeContains = (container: ts.Node, target: ts.Node): boolean => {
  const targetStart = target.getStart();
  return targetStart >= container.getStart() && target.end <= container.end;
};

const extractSnippet = (sourceFile: SourceFile, offset: number): string => {
  const { line } = offsetToLineColumn(sourceFile, offset);
  const text = sourceFile.getFullText();
  const compilerSf = sourceFile.compilerNode;
  const lineStart = compilerSf.getPositionOfLineAndCharacter(line - 1, 0);
  const lineEnd =
    line < sourceFile.getEndLineNumber()
      ? compilerSf.getPositionOfLineAndCharacter(line, 0)
      : text.length;
  let snippet = text
    .slice(lineStart, lineEnd)
    .replace(/\r?\n$/, "")
    .trim();
  if (snippet.length > SNIPPET_MAX) {
    snippet = snippet.slice(0, SNIPPET_MAX - 1) + "…";
  }
  return snippet;
};

const extractSnippetFromDisk = (
  file: string,
  offset: number,
): string | undefined => {
  const content = ts.sys.readFile(file);
  if (content === undefined) return undefined;
  const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const { line } = sf.getLineAndCharacterOfPosition(
    Math.min(offset, Math.max(0, sf.text.length - 1)),
  );
  const lineStart = sf.getPositionOfLineAndCharacter(line, 0);
  const lineEnd =
    line + 1 < sf.getLineAndCharacterOfPosition(sf.text.length).line + 1
      ? sf.getPositionOfLineAndCharacter(line + 1, 0)
      : sf.text.length;
  let snippet = sf.text
    .slice(lineStart, lineEnd)
    .replace(/\r?\n$/, "")
    .trim();
  if (snippet.length > SNIPPET_MAX) {
    snippet = snippet.slice(0, SNIPPET_MAX - 1) + "…";
  }
  return snippet;
};

const deduplicateItems = (items: ReferenceItem[]): ReferenceItem[] => {
  const seen = new Set<string>();
  const result: ReferenceItem[] = [];
  for (const item of items) {
    const key = `${canonicalizePath(item.file)}:${item.line}:${item.column}:${item.endLine}:${item.endColumn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

const sortReferences = (
  items: ReferenceItem[],
  anchorFile: string,
): ReferenceItem[] => {
  const anchorPackage = findNearestPackageName(anchorFile);
  return [...items].sort((a, b) => {
    const aPkg = a.package ?? "";
    const bPkg = b.package ?? "";
    const aSame = anchorPackage && a.package === anchorPackage ? 0 : 1;
    const bSame = anchorPackage && b.package === anchorPackage ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    if (aPkg !== bPkg) return aPkg.localeCompare(bPkg);
    const pathCmp = canonicalizePath(a.file).localeCompare(
      canonicalizePath(b.file),
    );
    if (pathCmp !== 0) return pathCmp;
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
};

const isTestFile = (filePath: string): boolean => {
  const base = path.basename(filePath).replace(/\\/g, "/");
  const normalized = filePath.replace(/\\/g, "/");
  if (/\.(test|spec)\.(tsx?|jsx?)$/i.test(base)) return true;
  if (
    normalized.includes("/__tests__/") ||
    normalized.includes("/__mocks__/")
  ) {
    return true;
  }
  return false;
};

const areDifferentPackageNames = (fileA: string, fileB: string): boolean => {
  const a = findNearestPackageName(fileA);
  const b = findNearestPackageName(fileB);
  return !!a && !!b && a !== b;
};

const mayHaveStarExportGaps = (items: ReferenceItem[]): boolean => {
  return items.some((item) => {
    const snippet = item.snippet ?? "";
    return /export\s*\*/.test(snippet);
  });
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

const lineColFromFile = (
  filePath: string,
  offset: number,
): { line: number; column: number } => {
  const text = ts.sys.readFile(filePath) ?? "";
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const clamped = Math.min(Math.max(offset, 0), Math.max(sf.text.length, 0));
  const lc = sf.getLineAndCharacterOfPosition(clamped);
  return { line: lc.line + 1, column: lc.character + 1 };
};

const offsetToDisplay = (filePath: string, offset: number): string => {
  const lc = lineColFromFile(filePath, offset);
  return `${lc.line}:${lc.column}`;
};

const guessNameAt = (
  project: Project,
  filePath: string,
  offset: number,
): string | undefined => {
  const sf = getOrLoadSourceFile(project, filePath);
  if (!sf) return undefined;
  const text = sf.getFullText();
  const slice = text.slice(offset, Math.min(text.length, offset + 64));
  const match = slice.match(/^[A-Za-z_$][\w$]*/);
  return match?.[0];
};

const isExternalPath = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, "/");
  return (
    normalized.includes("/node_modules/") ||
    normalized.endsWith("/node_modules")
  );
};

/** Collapse LS display names like `let x: number` / alias blurbs to an ident. */
const cleanSymbolName = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "<anonymous>";
  // `(alias) type TrackedId = string\nimport TrackedId` → TrackedId
  const aliasType = trimmed.match(/\(alias\)\s+type\s+([A-Za-z_$][\w$]*)/);
  if (aliasType) return aliasType[1]!;
  const aliasFn = trimmed.match(
    /\(alias\)\s+(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  );
  if (aliasFn) return aliasFn[1]!;
  const decl = trimmed.match(
    /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|type|interface|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  );
  if (decl) return decl[1]!;
  const ident = trimmed.match(/^([A-Za-z_$][\w$]*)/);
  if (ident && !trimmed.includes("\n")) return ident[1]!;
  const lastIdent = trimmed.match(/([A-Za-z_$][\w$]*)\s*$/);
  return lastIdent?.[1] ?? trimmed.split(/\s+/)[0] ?? "<anonymous>";
};
