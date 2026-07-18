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
import { findReferences } from "../findReferences/findReferences.js";
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
  suggestIdentifierColumn,
} from "../utils/sourcePosition.js";
import { formatFindCallersOutput } from "./formatFindCallers.js";

export type CallKind =
  | "direct_call"
  | "new"
  | "tagged_template"
  | "jsx"
  | "unknown_ref";

export type CallConfidence = "high" | "medium" | "low";

export interface CallerLocation {
  file: string;
  line: number;
  column: number;
}

export interface CallerItem {
  id: string;
  parentId?: string;
  depth: number;
  location: CallerLocation;
  callerName: string;
  callerDefinition?: CallerLocation;
  package?: string;
  kind: CallKind;
  confidence: CallConfidence;
  snippet: string;
}

export interface FindCallersData {
  target: { name: string; definition: CallerLocation };
  callers: CallerItem[];
  scope: ProjectGraphScope;
  truncated: boolean;
  notes: string[];
}

export interface FindCallersOptions {
  filePath?: string;
  line?: number;
  column?: number;
  symbol?: string;
  relativeTo?: string;
  maxDepth?: number;
  crossPackage?: boolean;
  includeTests?: boolean;
  maxResults?: number;
}

interface HierarchyTarget {
  name: string;
  file: string;
  selectionStart: number;
  spanStart: number;
  spanLength: number;
  kind: string;
  item: ts.CallHierarchyItem;
}

interface QueueEntry {
  target: HierarchyTarget;
  depth: number;
  parentEdgeId?: string;
}

const DEFAULT_MAX_DEPTH = 2;
const HARD_MAX_DEPTH = 5;
const DEFAULT_MAX_RESULTS = 50;
const HARD_MAX_RESULTS = 500;
const SNIPPET_MAX = 200;

/**
 * Find static callers of a callable (Call Hierarchy + supplemental refs).
 */
export const findCallers = (
  options: FindCallersOptions,
  project: Project,
  resolvedConfig: ResolvedTsConfig,
): Result<ToolResult<FindCallersData>> => {
  const modeResult = validateMode(options);
  if (!modeResult.success) {
    return error(modeResult.error);
  }

  const crossPackage = options.crossPackage !== false;
  const includeTests = options.includeTests !== false;
  const maxDepth = clampMaxDepth(options.maxDepth);
  const maxResults = clampMaxResults(options.maxResults);

  try {
    const targetResult =
      modeResult.data === "position"
        ? resolvePositionTargets(options, project)
        : resolveSymbolTargets(options, project, resolvedConfig);

    if (!targetResult.success) {
      return error(targetResult.error);
    }

    const { targets, notes: targetNotes } = targetResult.data;
    const primary = targets[0]!;
    const definition = spanToLocation(
      primary.file,
      primary.selectionStart,
      Math.max(primary.item.selectionSpan.length, 1),
    );

    const anchorFile = options.filePath ?? options.relativeTo ?? primary.file;
    const graphResult = resolveProjectGraphForFile(anchorFile, {
      crossPackage,
    });
    if (!graphResult.success) {
      return error(graphResult.error);
    }
    const graph = graphResult.data;
    const notes = [...targetNotes, ...graph.notes];

    if (targets.length > 1) {
      notes.push(
        `Multiple callable candidates (${targets.length}); listing callers for each.`,
      );
    }

    const callers: CallerItem[] = [];
    const seenSiteKeys = new Set<string>();
    const expandedDefs = new Set<string>();
    let truncated = false;
    let cycleNoted = false;

    const queue: QueueEntry[] = targets.map((target) => ({
      target,
      depth: 0,
    }));

    for (const seed of targets) {
      expandedDefs.add(defKey(seed.file, seed.selectionStart));
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) {
        continue;
      }

      const incoming = collectIncomingAcrossGraph(
        current.target,
        graph.configs,
        crossPackage,
      );

      const levelItems: Array<{
        item: CallerItem;
        fromItem: ts.CallHierarchyItem;
      }> = [];

      for (const call of incoming) {
        const fromFile = resolveAbsolutePath(call.from.file);
        const callerDef = spanToLocation(
          fromFile,
          call.from.selectionSpan.start,
          Math.max(call.from.selectionSpan.length, 1),
        );
        const callerName = hierarchyCallerName(call.from);

        for (const span of call.fromSpans) {
          if (callers.length + levelItems.length >= maxResults) {
            truncated = true;
            break;
          }

          const siteFile = fromFile;
          const siteKey = `${canonicalizePath(siteFile)}:${span.start}:${span.length}`;
          if (seenSiteKeys.has(siteKey)) continue;
          seenSiteKeys.add(siteKey);

          if (!includeTests && isTestFile(siteFile)) {
            continue;
          }
          if (
            !crossPackage &&
            areDifferentPackageNames(primary.file, siteFile)
          ) {
            continue;
          }

          const classified = classifySpan(siteFile, span.start);
          const location = spanToLocation(
            siteFile,
            span.start,
            Math.max(span.length, 1),
          );
          const id = makeEdgeId(
            fromFile,
            call.from.selectionSpan.start,
            siteFile,
            span.start,
          );

          levelItems.push({
            fromItem: call.from,
            item: {
              id,
              parentId: current.parentEdgeId,
              depth: current.depth + 1,
              location,
              callerName,
              callerDefinition: callerDef,
              package: findNearestPackageName(siteFile) ?? undefined,
              kind: classified.kind,
              confidence: classified.confidence,
              snippet: extractSnippetFromFile(siteFile, span.start),
            },
          });
        }
        if (truncated) break;
      }

      const sortedLevel = levelItems
        .map((entry) => entry.item)
        .sort((a, b) => compareCallers(a, b, primary.file));
      const fromById = new Map(
        levelItems.map((entry) => [entry.item.id, entry.fromItem]),
      );

      for (const item of sortedLevel) {
        if (callers.length >= maxResults) {
          truncated = true;
          break;
        }
        callers.push(item);
      }

      if (truncated || current.depth + 1 >= maxDepth) {
        continue;
      }

      // Expand each distinct caller definition once (shallowest first).
      const expansionSeen = new Set<string>();
      for (const item of sortedLevel) {
        if (!item.callerDefinition) continue;
        const key = defKey(
          item.callerDefinition.file,
          locationToOffset(item.callerDefinition),
        );
        if (expansionSeen.has(key)) continue;
        expansionSeen.add(key);

        if (expandedDefs.has(key)) {
          if (!cycleNoted) {
            notes.push(
              "Cycle detected: repeated caller definition skipped for deeper expansion.",
            );
            cycleNoted = true;
          }
          continue;
        }

        if (item.callerName === "(module)") {
          continue;
        }

        const fromItem = fromById.get(item.id);
        const nextTarget =
          hierarchyItemToTarget(fromItem) ??
          recoverHierarchyTarget(
            item.callerDefinition.file,
            locationToOffset(item.callerDefinition),
          );
        if (!nextTarget) continue;

        expandedDefs.add(key);
        queue.push({
          target: nextTarget,
          depth: current.depth + 1,
          parentEdgeId: item.id,
        });
      }
    }

    // Supplemental unknown_ref / callback pass for the root target only.
    const supplemental = collectSupplementalUnknownRefs(
      options,
      project,
      resolvedConfig,
      primary,
      seenSiteKeys,
      includeTests,
      crossPackage,
      maxResults - callers.length,
    );
    for (const item of supplemental.items) {
      if (callers.length >= maxResults) {
        truncated = true;
        break;
      }
      callers.push(item);
      seenSiteKeys.add(
        `${canonicalizePath(item.location.file)}:${item.location.line}:${item.location.column}`,
      );
    }
    notes.push(...supplemental.notes);

    // Re-sort full list: by depth, then package/path/line within depth.
    const sorted = sortCallers(callers, primary.file);

    const data: FindCallersData = {
      target: {
        name: primary.name,
        definition: {
          file: definition.file,
          line: definition.line,
          column: definition.column,
        },
      },
      callers: sorted,
      scope: crossPackage ? graph.scope : "owner",
      truncated: truncated || graph.truncated || supplemental.truncated,
      notes,
    };

    return success({
      data,
      formattedOutput: formatFindCallersOutput(data),
    });
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error finding callers: ${message}`);
  }
};

const validateMode = (
  options: FindCallersOptions,
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
  if (
    options.filePath !== undefined ||
    options.line !== undefined ||
    options.column !== undefined
  ) {
    return error("Symbol mode cannot include file_path/line/column fields.");
  }
  return success("symbol");
};

const clampMaxDepth = (value: number | undefined): number => {
  const n = value ?? DEFAULT_MAX_DEPTH;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_DEPTH;
  return Math.min(Math.floor(n), HARD_MAX_DEPTH);
};

const clampMaxResults = (value: number | undefined): number => {
  const n = value ?? DEFAULT_MAX_RESULTS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.floor(n), HARD_MAX_RESULTS);
};

const resolvePositionTargets = (
  options: FindCallersOptions,
  project: Project,
): Result<{ targets: HierarchyTarget[]; notes: string[] }> => {
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

  let prepared =
    languageService.prepareCallHierarchy(fileName, offset) ?? undefined;

  if (!prepared) {
    const fallbackOffset = findEnclosingCallableOffset(sourceFile, offset);
    if (fallbackOffset !== undefined) {
      prepared =
        languageService.prepareCallHierarchy(fileName, fallbackOffset) ??
        undefined;
    }
  }

  if (!prepared) {
    const hint = inspectLikeHint(project, fileName, offset);
    const suggested = suggestCallableColumnHint(sourceFile, options.line!);
    return error(
      `not_callable: cannot resolve callable target at ${filePath}:${options.line}` +
        (options.column !== undefined ? `:${options.column}` : "") +
        `; found: ${hint}` +
        (suggested ?? ""),
    );
  }

  const items = Array.isArray(prepared) ? prepared : [prepared];
  const targets = items
    .map(hierarchyItemToTarget)
    .filter(Boolean) as HierarchyTarget[];
  if (targets.length === 0) {
    const hint = inspectLikeHint(project, fileName, offset);
    const suggested = suggestCallableColumnHint(sourceFile, options.line!);
    return error(
      `not_callable: cannot resolve callable target at ${filePath}:${options.line}` +
        (options.column !== undefined ? `:${options.column}` : "") +
        `; found: ${hint}` +
        (suggested ?? ""),
    );
  }

  return success({ targets, notes: [] });
};

const resolveSymbolTargets = (
  options: FindCallersOptions,
  project: Project,
  resolvedConfig: ResolvedTsConfig,
): Result<{ targets: HierarchyTarget[]; notes: string[] }> => {
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

  const candidates: Array<{ file: string; offset: number; label: string }> = [];

  for (const importPath of nodeResults) {
    const located = locateExportedDeclaration(importPath, symbol, project);
    if (located) {
      candidates.push({
        file: located.file,
        offset: located.offset,
        label: `recommended:${importPath}`,
      });
    }
  }
  for (const local of localResults) {
    const located = locateExportedDeclaration(local.path, symbol, project);
    if (located) {
      candidates.push({
        file: located.file,
        offset: located.offset,
        label: `local:${local.path}`,
      });
    }
  }

  const unique = dedupeCandidates(candidates);
  if (unique.length === 0) {
    return error(`Symbol unresolved: "${symbol}"`);
  }
  if (unique.length > 1) {
    const lines = unique.map(
      (c) => `- ${c.file}:${offsetToDisplay(c.file, c.offset)} (${c.label})`,
    );
    return error(
      `ambiguous_symbol: multiple distinct definitions for "${symbol}":\n` +
        lines.join("\n"),
    );
  }

  const chosen = unique[0]!;
  const projectResult = getTsMorphProjectForFile(chosen.file);
  const queryProject = projectResult.success
    ? projectResult.data.project
    : project;
  const languageService = queryProject.getLanguageService().compilerObject;
  const prepared =
    languageService.prepareCallHierarchy(chosen.file, chosen.offset) ??
    undefined;

  if (!prepared) {
    return error(
      `not_callable: symbol "${symbol}" resolved but is not a callable target ` +
        `at ${chosen.file}:${offsetToDisplay(chosen.file, chosen.offset)}`,
    );
  }

  const items = Array.isArray(prepared) ? prepared : [prepared];
  const targets = items
    .map(hierarchyItemToTarget)
    .filter(Boolean) as HierarchyTarget[];
  return success({ targets, notes: [] });
};

const suggestCallableColumnHint = (
  sourceFile: SourceFile,
  line: number,
): string => {
  const suggested = suggestIdentifierColumn(sourceFile, line);
  if (suggested === undefined) return "";
  return `; ambiguous_position: pass column on symbol name (suggested column: ${suggested})`;
};

const findEnclosingCallableOffset = (
  sourceFile: SourceFile,
  offset: number,
): number | undefined => {
  let node: Node | undefined = sourceFile.getDescendantAtPos(offset);
  while (node) {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    ) {
      const name = node.getNameNode?.();
      return name ? name.getStart() : node.getStart();
    }
    if (Node.isConstructorDeclaration(node)) {
      return node.getStart();
    }
    if (Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
      const parent = node.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getNameNode().getStart();
      }
      if (
        Node.isPropertyAssignment(parent) ||
        Node.isPropertyDeclaration(parent)
      ) {
        const name = parent.getNameNode?.();
        if (name) return name.getStart();
      }
      if (Node.isExportAssignment(parent)) {
        return node.getStart();
      }
      return node.getStart();
    }
    if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (
        init &&
        (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
      ) {
        return node.getNameNode().getStart();
      }
    }
    if (Node.isClassDeclaration(node)) {
      const name = node.getNameNode();
      if (name) return name.getStart();
    }
    node = node.getParent();
  }
  return undefined;
};

const collectIncomingAcrossGraph = (
  target: HierarchyTarget,
  configs: ResolvedTsConfig[],
  crossPackage: boolean,
): ts.CallHierarchyIncomingCall[] => {
  const merged: ts.CallHierarchyIncomingCall[] = [];
  const seen = new Set<string>();

  const append = (calls: readonly ts.CallHierarchyIncomingCall[]) => {
    for (const call of calls) {
      for (const span of call.fromSpans) {
        const key = `${canonicalizePath(call.from.file)}:${call.from.selectionSpan.start}:${span.start}:${span.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      // Deduplicate whole call groups by from + first span
      const groupKey = `${canonicalizePath(call.from.file)}:${call.from.selectionSpan.start}:${call.fromSpans.map((s) => s.start).join(",")}`;
      if (seen.has(`g:${groupKey}`)) continue;
      seen.add(`g:${groupKey}`);
      merged.push(call);
    }
  };

  // Owning project of the target definition.
  const ownerResult = getTsMorphProjectForFile(target.file);
  if (ownerResult.success) {
    append(
      getIncomingSafe(
        ownerResult.data.project,
        target.file,
        target.selectionStart,
      ),
    );
  }

  if (!crossPackage) {
    return merged;
  }

  for (const config of configs) {
    const representative =
      config.parsed.fileNames.find(
        (f) => !f.includes(`${path.sep}node_modules${path.sep}`),
      ) ?? config.parsed.fileNames[0];
    if (!representative) continue;

    const projectResult = getTsMorphProjectForFile(representative);
    if (!projectResult.success) continue;
    const project = projectResult.data.project;

    const queryPositions = discoverTargetQueryPositions(
      project,
      config,
      target,
    );
    for (const qp of queryPositions) {
      const prepared =
        project
          .getLanguageService()
          .compilerObject.prepareCallHierarchy(qp.file, qp.offset) ?? undefined;
      if (!prepared) continue;
      const items = Array.isArray(prepared) ? prepared : [prepared];
      for (const item of items) {
        if (!hierarchyMatchesTarget(item, target)) continue;
        append(
          getIncomingSafe(
            project,
            resolveAbsolutePath(item.file),
            item.selectionSpan.start,
          ),
        );
      }
    }
  }

  return merged;
};

const getIncomingSafe = (
  project: Project,
  file: string,
  offset: number,
): ts.CallHierarchyIncomingCall[] => {
  try {
    return (
      project
        .getLanguageService()
        .compilerObject.provideCallHierarchyIncomingCalls(file, offset) ?? []
    );
  } catch {
    return [];
  }
};

const discoverTargetQueryPositions = (
  project: Project,
  config: ResolvedTsConfig,
  target: HierarchyTarget,
): Array<{ file: string; offset: number }> => {
  const positions: Array<{ file: string; offset: number }> = [];
  const targetCanonical = canonicalizePath(target.file);
  const configFiles = new Set(
    config.parsed.fileNames.map((f) => canonicalizePath(f)),
  );

  // Same-program: Call Hierarchy from the definition is enough.
  if (configFiles.has(targetCanonical)) {
    return [{ file: target.file, offset: target.selectionStart }];
  }

  // Cross-package: scan only identifiers named like the target that are
  // import/export bindings or call-like uses (not the full AST of every node).
  const languageService = project.getLanguageService().compilerObject;
  const targetName = target.name;

  for (const fileName of config.parsed.fileNames) {
    if (fileName.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const sf = getOrLoadSourceFile(project, fileName);
    if (!sf) continue;

    for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (id.getText() !== targetName) continue;
      if (!isCrossPackageQueryCandidate(id)) continue;

      const offset = id.getStart();
      const defs =
        languageService.getDefinitionAtPosition(sf.getFilePath(), offset) ?? [];
      const matches = defs.some((d) =>
        definitionMatchesTarget(d.fileName, targetCanonical),
      );
      if (!matches) continue;
      positions.push({
        file: path.resolve(sf.getFilePath()),
        offset,
      });
    }
  }

  return dedupePositions(positions);
};

const isCrossPackageQueryCandidate = (id: Node): boolean => {
  const parent = id.getParent();
  if (!parent) return false;

  if (
    Node.isImportSpecifier(parent) ||
    Node.isExportSpecifier(parent) ||
    Node.isImportClause(parent) ||
    Node.isNamespaceImport(parent)
  ) {
    return true;
  }

  if (Node.isCallExpression(parent) && parent.getExpression() === id) {
    return true;
  }
  if (Node.isNewExpression(parent) && parent.getExpression() === id) {
    return true;
  }
  if (
    Node.isTaggedTemplateExpression(parent) &&
    parent.getTag() === id
  ) {
    return true;
  }
  if (
    Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === id
  ) {
    const grand = parent.getParent();
    return (
      Node.isCallExpression(grand) ||
      Node.isNewExpression(grand) ||
      Node.isTaggedTemplateExpression(grand)
    );
  }

  if (
    Node.isJsxOpeningElement(parent) ||
    Node.isJsxSelfClosingElement(parent) ||
    Node.isJsxClosingElement(parent)
  ) {
    return true;
  }

  return false;
};

const definitionMatchesTarget = (
  defFile: string,
  targetCanonical: string,
): boolean => {
  const file = resolveAbsolutePath(defFile);
  const canonical = canonicalizePath(file);
  if (canonical === targetCanonical) return true;
  if (/\.d\.ts$/i.test(file)) {
    const asTs = file.replace(/\.d\.ts$/i, ".ts");
    if (canonicalizePath(asTs) === targetCanonical) return true;
  }
  return false;
};

const hierarchyMatchesTarget = (
  item: ts.CallHierarchyItem,
  target: HierarchyTarget,
): boolean => {
  const file = resolveAbsolutePath(item.file);
  if (canonicalizePath(file) === canonicalizePath(target.file)) {
    return (
      item.selectionSpan.start === target.selectionStart ||
      item.name === target.name
    );
  }
  // Alias / re-export may point at different file but same name — accept name match
  // only when definition resolves to target (checked by caller via prepare position).
  return item.name === target.name;
};

const classifySpan = (
  filePath: string,
  offset: number,
): { kind: CallKind; confidence: CallConfidence } => {
  const projectResult = getTsMorphProjectForFile(filePath);
  const project = projectResult.success
    ? projectResult.data.project
    : undefined;
  const sf = project ? getOrLoadSourceFile(project, filePath) : undefined;
  if (!sf) {
    return { kind: "unknown_ref", confidence: "low" };
  }

  const compilerSf = sf.compilerNode;
  const token = findTokenAt(compilerSf, offset);
  if (!token) {
    return { kind: "unknown_ref", confidence: "low" };
  }

  let current: ts.Node | undefined = token;
  while (current) {
    if (ts.isCallExpression(current)) {
      if (nodeContains(current.expression, token)) {
        return { kind: "direct_call", confidence: "high" };
      }
    }
    if (ts.isNewExpression(current)) {
      if (nodeContains(current.expression, token)) {
        return { kind: "new", confidence: "high" };
      }
    }
    if (ts.isTaggedTemplateExpression(current)) {
      if (nodeContains(current.tag, token)) {
        return { kind: "tagged_template", confidence: "high" };
      }
    }
    if (
      ts.isJsxOpeningElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxClosingElement(current)
    ) {
      if (nodeContains(current.tagName, token)) {
        return { kind: "jsx", confidence: "high" };
      }
    }
    if (
      ts.isPropertyAccessExpression(current) &&
      ts.isIdentifier(current.name) &&
      nodeContains(current.name, token)
    ) {
      const parent: ts.Node = current.parent;
      if (ts.isCallExpression(parent) && parent.expression === current) {
        return { kind: "direct_call", confidence: "high" };
      }
      if (ts.isTaggedTemplateExpression(parent) && parent.tag === current) {
        return { kind: "tagged_template", confidence: "high" };
      }
    }
    current = current.parent;
  }

  return { kind: "unknown_ref", confidence: "low" };
};

const collectSupplementalUnknownRefs = (
  _options: FindCallersOptions,
  project: Project,
  resolvedConfig: ResolvedTsConfig,
  primary: HierarchyTarget,
  seenSiteKeys: Set<string>,
  includeTests: boolean,
  crossPackage: boolean,
  budget: number,
): { items: CallerItem[]; notes: string[]; truncated: boolean } => {
  if (budget <= 0) {
    return { items: [], notes: [], truncated: true };
  }

  const defLoc = spanToLocation(
    primary.file,
    primary.selectionStart,
    Math.max(primary.item.selectionSpan.length, 1),
  );

  const defProjectResult = getTsMorphProjectForFile(primary.file);
  const queryProject = defProjectResult.success
    ? defProjectResult.data.project
    : project;
  const queryResolved = defProjectResult.success
    ? defProjectResult.data.resolved
    : resolvedConfig;

  const refsResult = findReferences(
    {
      filePath: primary.file,
      line: defLoc.line,
      column: defLoc.column,
      includeDeclaration: false,
      crossPackage,
      includeTests,
      maxResults: Math.min(budget + 50, HARD_MAX_RESULTS),
    },
    queryProject,
    queryResolved,
  );

  if (!refsResult.success) {
    return { items: [], notes: [], truncated: false };
  }

  const items: CallerItem[] = [];
  let truncated = false;

  for (const ref of refsResult.data.data.references) {
    if (items.length >= budget) {
      truncated = true;
      break;
    }

    // Skip clear call-site / import kinds already covered by Call Hierarchy.
    if (
      ref.kind === "call" ||
      ref.kind === "import" ||
      ref.kind === "export" ||
      ref.kind === "type" ||
      ref.kind === "declaration"
    ) {
      continue;
    }

    const absOffset = lineColToOffset(ref.file, ref.line, ref.column);
    if (hasSeenSite(seenSiteKeys, ref.file, absOffset)) {
      continue;
    }

    // Argument / alias references only — never claim direct_call here.
    const enclosing = findEnclosingCallerName(ref.file, absOffset);
    const id = makeEdgeId(ref.file, absOffset, ref.file, absOffset);

    items.push({
      id: `unknown:${id}`,
      depth: 1,
      location: {
        file: path.resolve(ref.file),
        line: ref.line,
        column: ref.column,
      },
      callerName: enclosing.name,
      callerDefinition: enclosing.definition,
      package: ref.package,
      kind: "unknown_ref",
      confidence: "low",
      snippet: ref.snippet ?? extractSnippetFromFile(ref.file, absOffset),
    });
    seenSiteKeys.add(`${canonicalizePath(ref.file)}:${absOffset}:0`);
  }

  return { items, notes: [], truncated };
};

const hasSeenSite = (
  seenSiteKeys: Set<string>,
  file: string,
  offset: number,
): boolean => {
  const canonical = canonicalizePath(file);
  for (const key of seenSiteKeys) {
    const match = key.match(/^(.*):(\d+):(\d+)$/);
    if (!match) continue;
    if (canonicalizePath(match[1]!) !== canonical) continue;
    if (Number(match[2]) === offset) return true;
  }
  return false;
};

const findEnclosingCallerName = (
  filePath: string,
  offset: number,
): { name: string; definition?: CallerLocation } => {
  const projectResult = getTsMorphProjectForFile(filePath);
  if (!projectResult.success) {
    return { name: "(module)" };
  }
  const sf = getOrLoadSourceFile(projectResult.data.project, filePath);
  if (!sf) return { name: "(module)" };

  let node: Node | undefined = sf.getDescendantAtPos(offset);
  while (node) {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    ) {
      const name = node.getName() ?? "<anonymous>";
      const nameNode = node.getNameNode?.();
      return {
        name,
        definition: nameNode
          ? spanToLocation(filePath, nameNode.getStart(), nameNode.getWidth())
          : spanToLocation(filePath, node.getStart(), 1),
      };
    }
    if (Node.isConstructorDeclaration(node)) {
      return {
        name: "constructor",
        definition: spanToLocation(filePath, node.getStart(), 11),
      };
    }
    if (Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
      const parent = node.getParent();
      if (Node.isVariableDeclaration(parent)) {
        const nameNode = parent.getNameNode();
        return {
          name: nameNode.getText(),
          definition: spanToLocation(
            filePath,
            nameNode.getStart(),
            nameNode.getWidth(),
          ),
        };
      }
    }
    node = node.getParent();
  }
  return { name: "(module)" };
};

const hierarchyItemToTarget = (
  item: ts.CallHierarchyItem | undefined,
): HierarchyTarget | undefined => {
  if (!item) return undefined;
  return {
    name: item.name || "<anonymous>",
    file: resolveAbsolutePath(item.file),
    selectionStart: item.selectionSpan.start,
    spanStart: item.span.start,
    spanLength: item.span.length,
    kind: String(item.kind),
    item,
  };
};

const recoverHierarchyTarget = (
  file: string,
  offset: number,
): HierarchyTarget | undefined => {
  const projectResult = getTsMorphProjectForFile(file);
  if (!projectResult.success) return undefined;
  const prepared =
    projectResult.data.project
      .getLanguageService()
      .compilerObject.prepareCallHierarchy(file, offset) ?? undefined;
  if (!prepared) return undefined;
  const item = Array.isArray(prepared) ? prepared[0] : prepared;
  return hierarchyItemToTarget(item);
};

const hierarchyCallerName = (item: ts.CallHierarchyItem): string => {
  const kind = String(item.kind);
  if (
    kind === ts.ScriptElementKind.moduleElement ||
    kind === ts.ScriptElementKind.scriptElement ||
    kind === "module" ||
    kind === "script"
  ) {
    return "(module)";
  }
  return item.name || "<anonymous>";
};

const compareCallers = (
  a: CallerItem,
  b: CallerItem,
  anchorFile: string,
): number => {
  if (a.depth !== b.depth) return a.depth - b.depth;
  const anchorPackage = findNearestPackageName(anchorFile);
  const aPkg = a.package ?? "";
  const bPkg = b.package ?? "";
  const aSame = anchorPackage && a.package === anchorPackage ? 0 : 1;
  const bSame = anchorPackage && b.package === anchorPackage ? 0 : 1;
  if (aSame !== bSame) return aSame - bSame;
  if (aPkg !== bPkg) return aPkg.localeCompare(bPkg);
  const pathCmp = canonicalizePath(a.location.file).localeCompare(
    canonicalizePath(b.location.file),
  );
  if (pathCmp !== 0) return pathCmp;
  if (a.location.line !== b.location.line) {
    return a.location.line - b.location.line;
  }
  return a.location.column - b.location.column;
};

const sortCallers = (items: CallerItem[], anchorFile: string): CallerItem[] => {
  return [...items].sort((a, b) => compareCallers(a, b, anchorFile));
};

const makeEdgeId = (
  callerFile: string,
  callerOffset: number,
  siteFile: string,
  siteOffset: number,
): string => {
  return [
    canonicalizePath(callerFile),
    String(callerOffset),
    canonicalizePath(siteFile),
    String(siteOffset),
  ].join("|");
};

const defKey = (file: string, offset: number): string =>
  `${canonicalizePath(file)}:${offset}`;

const spanToLocation = (
  file: string,
  start: number,
  length: number,
): CallerLocation => {
  const abs = path.resolve(file);
  const projectResult = getTsMorphProjectForFile(abs);
  const sf = projectResult.success
    ? getOrLoadSourceFile(projectResult.data.project, abs)
    : undefined;
  const startLc = sf
    ? offsetToLineColumn(sf, start)
    : lineColFromFile(abs, start);
  void length;
  return {
    file: abs,
    line: startLc.line,
    column: startLc.column,
  };
};

const locationToOffset = (loc: CallerLocation): number => {
  return lineColToOffset(loc.file, loc.line, loc.column);
};

const lineColToOffset = (
  filePath: string,
  line: number,
  column: number,
): number => {
  const projectResult = getTsMorphProjectForFile(filePath);
  const sf = projectResult.success
    ? getOrLoadSourceFile(projectResult.data.project, filePath)
    : undefined;
  if (sf) {
    return sf.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1);
  }
  const text = ts.sys.readFile(filePath) ?? "";
  const compilerSf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  return compilerSf.getPositionOfLineAndCharacter(line - 1, column - 1);
};

const inspectLikeHint = (
  project: Project,
  fileName: string,
  offset: number,
): string => {
  const languageService = project.getLanguageService().compilerObject;
  const quickInfo = languageService.getQuickInfoAtPosition(fileName, offset);
  if (quickInfo) {
    const name = ts.displayPartsToString(quickInfo.displayParts).split("\n")[0];
    return `${quickInfo.kind}: ${name ?? "<unknown>"}`;
  }
  const sf = project.getSourceFile(fileName);
  if (!sf) return "unknown";
  const node = sf.getDescendantAtPos(offset);
  if (!node) return "unknown";
  return `${node.getKindName()}: ${node.getText().slice(0, 40)}`;
};

const locateExportedDeclaration = (
  definitionPath: string,
  symbol: string,
  fallbackProject: Project,
): { file: string; offset: number; endOffset: number } | undefined => {
  const absolute = path.resolve(definitionPath);
  if (!existsSync(absolute) || !/\.(tsx?|d\.ts)$/i.test(absolute)) {
    return undefined;
  }
  const projectResult = getTsMorphProjectForFile(absolute);
  const project = projectResult.success
    ? projectResult.data.project
    : fallbackProject;
  const sf = getOrLoadSourceFile(project, absolute);
  if (!sf) return undefined;

  for (const decl of sf.getExportedDeclarations().get(symbol) ?? []) {
    if (Node.isVariableDeclaration(decl)) {
      const name = decl.getNameNode();
      return {
        file: path.resolve(sf.getFilePath()),
        offset: name.getStart(),
        endOffset: name.getEnd(),
      };
    }
    if (
      Node.isFunctionDeclaration(decl) ||
      Node.isClassDeclaration(decl) ||
      Node.isMethodDeclaration(decl)
    ) {
      const name = decl.getNameNode?.();
      if (name) {
        return {
          file: path.resolve(sf.getFilePath()),
          offset: name.getStart(),
          endOffset: name.getEnd(),
        };
      }
    }
  }
  return undefined;
};

const dedupeCandidates = <T extends { file: string; offset: number }>(
  items: T[],
): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${canonicalizePath(item.file)}:${item.offset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

const dedupePositions = (
  items: Array<{ file: string; offset: number }>,
): Array<{ file: string; offset: number }> => {
  const seen = new Set<string>();
  const out: Array<{ file: string; offset: number }> = [];
  for (const item of items) {
    const key = `${canonicalizePath(item.file)}:${item.offset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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

const nodeContains = (container: ts.Node, target: ts.Node): boolean => {
  const targetStart = target.getStart();
  return targetStart >= container.getStart() && target.end <= container.end;
};

const extractSnippetFromFile = (file: string, offset: number): string => {
  const projectResult = getTsMorphProjectForFile(file);
  const sf = projectResult.success
    ? getOrLoadSourceFile(projectResult.data.project, file)
    : undefined;
  if (sf) {
    const { line } = offsetToLineColumn(sf, offset);
    const text = sf.getFullText();
    const compilerSf = sf.compilerNode;
    const lineStart = compilerSf.getPositionOfLineAndCharacter(line - 1, 0);
    const lineEnd =
      line < sf.getEndLineNumber()
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
  }
  const content = ts.sys.readFile(file);
  if (content === undefined) return "";
  const compilerSf = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const { line } = compilerSf.getLineAndCharacterOfPosition(
    Math.min(offset, Math.max(0, compilerSf.text.length - 1)),
  );
  const lineStart = compilerSf.getPositionOfLineAndCharacter(line, 0);
  const lineEnd =
    line + 1 <=
    compilerSf.getLineAndCharacterOfPosition(compilerSf.text.length).line
      ? compilerSf.getPositionOfLineAndCharacter(line + 1, 0)
      : compilerSf.text.length;
  let snippet = compilerSf.text
    .slice(lineStart, lineEnd)
    .replace(/\r?\n$/, "")
    .trim();
  if (snippet.length > SNIPPET_MAX) {
    snippet = snippet.slice(0, SNIPPET_MAX - 1) + "…";
  }
  return snippet;
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
