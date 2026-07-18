import { existsSync } from "fs";
import path from "path";
import { Node, Project, SourceFile, SyntaxKind, ts } from "ts-morph";
import { error, Result, success, ToolResult } from "../../types.js";
import { ResolvedTsConfig } from "../resolveTsConfig.js";
import {
  deduplicateDefinitionSpans,
  expandDtsToWorkspaceSource,
  getOrLoadSourceFile,
  isDefinitionExternal,
  isTsSourceFile,
  isExternalPath,
  mapScriptElementKind,
  preferWorkspaceSourceFile,
  pruneNoisyDefinitionSpans,
  rankDefinitionSpans,
  RankedDefinitionSpan,
} from "../utils/definitionRank.js";
import { getRecommendedPackageImport } from "../utils/packageMetadata.js";
import {
  offsetToLineColumn,
  resolveSourcePosition,
} from "../utils/sourcePosition.js";
import { formatGoToDefinitionOutput } from "./formatGoToDefinition.js";

export { preferWorkspaceSourceFile } from "../utils/definitionRank.js";

export interface GoToDefinitionOptions {
  filePath: string;
  line: number;
  column?: number;
}

export interface DefinitionLocation {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  name: string;
  kind: string;
  external: boolean;
  importHint?: string;
}

export interface GoToDefinitionData {
  symbol?: string;
  /** Best definition for agent navigation (workspace src preferred). */
  primary?: DefinitionLocation;
  /** Remaining ranked definitions after primary. */
  alternates: DefinitionLocation[];
  /** primary + alternates (compat / CLI listing). */
  definitions: DefinitionLocation[];
  reason?: "no_symbol" | "no_definition";
}

type NormalizedSpan = RankedDefinitionSpan;

/**
 * Position → exact symbol definition (IDE Go to Definition).
 */
export const goToDefinition = (
  options: GoToDefinitionOptions,
  project: Project,
  resolvedConfig: ResolvedTsConfig,
): Result<ToolResult<GoToDefinitionData>> => {
  const positionResult = resolveSourcePosition(
    project,
    options.filePath,
    options.line,
    options.column,
    options.column === undefined ? "first-identifier" : "required",
  );
  if (!positionResult.success) {
    return error(positionResult.error);
  }

  const { sourceFile, offset, line } = positionResult.data;
  const fileName = sourceFile.getFilePath();

  try {
    if (isOffsetInComment(sourceFile.compilerNode, offset)) {
      return emptyResult(undefined, "no_symbol");
    }

    // With first-identifier, omitted column already lands on the name.
    const tokenNode = selectDefinitionToken(
      sourceFile,
      offset,
      false,
      line,
    );

    if (!tokenNode || isStringLikeLiteral(tokenNode)) {
      return emptyResult(undefined, "no_symbol");
    }

    if (
      !Node.isIdentifier(tokenNode) &&
      tokenNode.getKind() !== SyntaxKind.ThisKeyword &&
      !Node.isPrivateIdentifier(tokenNode)
    ) {
      return emptyResult(undefined, "no_symbol");
    }

    const symbolName = tokenNode.getText() || undefined;
    const inspectOffset = tokenNode.getStart();
    const languageService = project.getLanguageService().compilerObject;

    const rawDefinitions =
      languageService.getDefinitionAtPosition(fileName, inspectOffset) ?? [];

    const needsImplementations = rawDefinitions.some(
      (def) =>
        def.kind === ts.ScriptElementKind.alias ||
        /\.d\.ts$/i.test(def.fileName),
    );

    const rawImplementations = needsImplementations
      ? (languageService.getImplementationAtPosition(fileName, inspectOffset) ??
        [])
      : [];

    const normalized: NormalizedSpan[] = [];
    for (const def of rawDefinitions) {
      normalized.push(...normalizeDefinitionInfo(def, project));
    }
    for (const impl of rawImplementations) {
      normalized.push(...normalizeDocumentSpan(impl, project));
    }

    const expanded = expandDtsToWorkspaceSource(project, normalized);
    const pruned = pruneNoisyDefinitionSpans(expanded, symbolName);
    const deduped = deduplicateDefinitionSpans(pruned);
    const ranked = rankDefinitionSpans(
      deduped,
      options.filePath,
      resolvedConfig,
      symbolName,
    );
    const hasWorkspaceSrc = ranked.some(
      (span) => isTsSourceFile(span.file) && !isExternalPath(span.file),
    );
    const definitions = ranked.map((span) =>
      toDefinitionLocation(project, span, options.filePath, hasWorkspaceSrc),
    );

    if (definitions.length === 0) {
      return emptyResult(symbolName, "no_definition");
    }

    const [primary, ...alternates] = definitions;
    const data: GoToDefinitionData = {
      symbol: symbolName,
      primary,
      alternates,
      definitions,
    };
    return success({
      data,
      formattedOutput: formatGoToDefinitionOutput(data),
    });
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(
      `Error resolving definition in ${options.filePath}: ${message}`,
    );
  }
};

const emptyResult = (
  symbol: string | undefined,
  reason: "no_symbol" | "no_definition",
): Result<ToolResult<GoToDefinitionData>> => {
  const data: GoToDefinitionData = {
    symbol,
    definitions: [],
    alternates: [],
    reason,
  };
  return success({
    data,
    formattedOutput: formatGoToDefinitionOutput(data),
  });
};

const selectDefinitionToken = (
  sourceFile: SourceFile,
  offset: number,
  omittedColumn: boolean,
  line: number,
): Node | undefined => {
  if (omittedColumn) {
    return findFirstIdentifierOnLine(sourceFile, line);
  }

  let node: Node | undefined = sourceFile.getDescendantAtPos(offset);
  if (!node) {
    return undefined;
  }

  const propertyAccess = node.getFirstAncestorByKind(
    SyntaxKind.PropertyAccessExpression,
  );
  if (propertyAccess) {
    const nameNode = propertyAccess.getNameNode();
    if (offset >= nameNode.getStart() && offset <= nameNode.getEnd()) {
      return nameNode;
    }
  }

  if (
    Node.isIdentifier(node) ||
    node.getKind() === SyntaxKind.ThisKeyword ||
    Node.isPrivateIdentifier(node)
  ) {
    return node;
  }

  const typeRef = node.getFirstAncestorByKind(SyntaxKind.TypeReference);
  if (typeRef) {
    const typeName = typeRef.getTypeName();
    if (offset >= typeName.getStart() && offset <= typeName.getEnd()) {
      return Node.isIdentifier(typeName)
        ? typeName
        : (typeName.getLastChildByKind(SyntaxKind.Identifier) ?? typeName);
    }
  }

  return (
    node.getFirstAncestorByKind(SyntaxKind.Identifier) ??
    node.asKind(SyntaxKind.ThisKeyword) ??
    undefined
  );
};

const findFirstIdentifierOnLine = (
  sourceFile: SourceFile,
  line: number,
): Node | undefined => {
  const compilerNode = sourceFile.compilerNode;
  const lineStart = compilerNode.getPositionOfLineAndCharacter(line - 1, 0);
  const lineEnd =
    line < sourceFile.getEndLineNumber()
      ? compilerNode.getPositionOfLineAndCharacter(line, 0)
      : compilerNode.end;

  let best: Node | undefined;
  let bestStart = Number.POSITIVE_INFINITY;

  const visit = (node: Node) => {
    if (node.getEnd() <= lineStart || node.getStart() >= lineEnd) {
      return;
    }
    if (
      Node.isIdentifier(node) ||
      node.getKind() === SyntaxKind.ThisKeyword ||
      Node.isPrivateIdentifier(node)
    ) {
      const start = node.getStart();
      if (start >= lineStart && start < lineEnd && start < bestStart) {
        best = node;
        bestStart = start;
      }
    }
    for (const child of node.getChildren()) {
      visit(child);
    }
  };

  visit(sourceFile);
  return best;
};

const isStringLikeLiteral = (node: Node): boolean => {
  const kind = node.getKind();
  return (
    kind === SyntaxKind.StringLiteral ||
    kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === SyntaxKind.RegularExpressionLiteral ||
    kind === SyntaxKind.NumericLiteral
  );
};

const isOffsetInComment = (
  sourceFile: ts.SourceFile,
  position: number,
): boolean => {
  let found = false;
  const visitComments = (node: ts.Node) => {
    if (found) return;
    ts.forEachLeadingCommentRange(sourceFile.text, node.pos, (pos, end) => {
      if (position >= pos && position < end) found = true;
    });
    ts.forEachTrailingCommentRange(sourceFile.text, node.end, (pos, end) => {
      if (position >= pos && position < end) found = true;
    });
    ts.forEachChild(node, visitComments);
  };
  visitComments(sourceFile);

  if (!found) {
    const { character } = sourceFile.getLineAndCharacterOfPosition(position);
    const lineStart = position - character;
    const nl = sourceFile.text.indexOf("\n", lineStart);
    const lineText = sourceFile.text.slice(
      lineStart,
      nl === -1 ? sourceFile.text.length : nl,
    );
    const trimmed = lineText.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      found = true;
    }
  }

  return found;
};

const normalizeDefinitionInfo = (
  def: ts.DefinitionInfo,
  project: Project,
): NormalizedSpan[] => {
  const spans: NormalizedSpan[] = [
    {
      file: resolveExistingPath(def.fileName),
      start: def.textSpan.start,
      length: def.textSpan.length,
      name: def.name || "<anonymous>",
      kind: mapScriptElementKind(def.kind),
      isAlias: def.kind === ts.ScriptElementKind.alias,
    },
  ];

  // Declaration-map original only when the file exists.
  if (def.originalFileName && def.originalTextSpan) {
    const original = resolveExistingPath(def.originalFileName);
    if (existsSync(original)) {
      spans.push({
        file: original,
        start: def.originalTextSpan.start,
        length: def.originalTextSpan.length,
        name: def.name || "<anonymous>",
        kind: mapScriptElementKind(def.kind),
        isAlias: false,
      });
    }
  }

  void project;
  return spans;
};

const normalizeDocumentSpan = (
  span: ts.DocumentSpan,
  project: Project,
): NormalizedSpan[] => {
  const file = resolveExistingPath(span.fileName);
  const result: NormalizedSpan[] = [
    {
      file,
      start: span.textSpan.start,
      length: span.textSpan.length,
      name: guessNameFromSpan(project, file, span.textSpan),
      kind: "implementation",
      isAlias: false,
    },
  ];

  if (span.originalFileName && span.originalTextSpan) {
    const original = resolveExistingPath(span.originalFileName);
    if (existsSync(original)) {
      result.push({
        file: original,
        start: span.originalTextSpan.start,
        length: span.originalTextSpan.length,
        name: guessNameFromSpan(project, original, span.originalTextSpan),
        kind: "implementation",
        isAlias: false,
      });
    }
  }

  return result;
};

const guessNameFromSpan = (
  project: Project,
  filePath: string,
  textSpan: ts.TextSpan,
): string => {
  const sf = getOrLoadSourceFile(project, filePath);
  if (!sf) return "<anonymous>";
  const text = sf
    .getFullText()
    .slice(textSpan.start, textSpan.start + textSpan.length);
  const match = text.match(/[A-Za-z_$][\w$]*/);
  return match?.[0] ?? "<anonymous>";
};

const toDefinitionLocation = (
  project: Project,
  span: NormalizedSpan,
  queryFile: string,
  hasWorkspaceSrcPeer: boolean,
): DefinitionLocation => {
  const sf = getOrLoadSourceFile(project, span.file);
  let line = 1;
  let column = 1;
  let endLine = 1;
  let endColumn = 1;

  if (sf) {
    const start = offsetToLineColumn(sf, span.start);
    const endOffset = Math.min(
      sf.getFullText().length,
      span.start + Math.max(span.length, 0),
    );
    const end = offsetToLineColumn(sf, endOffset);
    line = start.line;
    column = start.column;
    endLine = end.line;
    endColumn = end.column;
  } else {
    const text = ts.sys.readFile(span.file) ?? "";
    const compilerSf = ts.createSourceFile(
      span.file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const start = compilerSf.getLineAndCharacterOfPosition(span.start);
    const endPos = Math.min(
      compilerSf.text.length,
      span.start + Math.max(span.length, 0),
    );
    const end = compilerSf.getLineAndCharacterOfPosition(endPos);
    line = start.line + 1;
    column = start.character + 1;
    endLine = end.line + 1;
    endColumn = end.character + 1;
  }

  const importHint = getRecommendedPackageImport(queryFile, span.file);

  return {
    file: path.resolve(span.file),
    line,
    column,
    endLine,
    endColumn,
    name: span.name,
    kind: span.kind,
    external: isDefinitionExternal(span.file, hasWorkspaceSrcPeer),
    importHint,
  };
};

const resolveExistingPath = (fileName: string): string => {
  try {
    return path.resolve(fileName);
  } catch {
    return fileName;
  }
};
