import { Node, Project, SourceFile, SyntaxKind, ts } from "ts-morph";
import { error, Result, success, ToolResult } from "../../types.js";
import { ResolvedTsConfig } from "../resolveTsConfig.js";
import {
  expandDtsToWorkspaceSource,
  getOrLoadSourceFile,
  mapScriptElementKind as mapDefinitionKind,
  pruneNoisyDefinitionSpans,
  rankDefinitionSpans,
  RankedDefinitionSpan,
} from "../utils/definitionRank.js";
import { getRecommendedPackageImport } from "../utils/packageMetadata.js";
import {
  offsetToLineColumn,
  resolveSourcePosition,
} from "../utils/sourcePosition.js";
import { createStripper } from "../utils/stripImport.js";
import { formatInspectOutput } from "./formatInspect.js";

const COMPACT_QUICK_INFO_MAX = 700;
const COMPACT_TYPE_CAP = 800;

export interface InspectOptions {
  filePath: string;
  line: number;
  column?: number;
  compact?: boolean;
}

export interface Location {
  file: string;
  line: number;
  column: number;
}

export interface InspectData {
  status: "found" | "nothing";
  symbol?: string;
  kind?: string;
  type?: string;
  declaredIn?: Location;
  enclosing: string;
  doc: string;
  importHint?: string;
  nearestSymbol?: { name: string; line: number; column: number };
  modifiers?: string[];
}

/**
 * Positional hover: type/meaning at (file, line[, column]).
 */
export const inspectPosition = (
  options: InspectOptions,
  project: Project,
  _resolvedConfig: ResolvedTsConfig,
): Result<ToolResult<InspectData>> => {
  const compact = options.compact !== false;

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
      const languageService = project.getLanguageService().compilerObject;
      const nearest = findNearestSymbolOnLine(
        sourceFile,
        line,
        languageService,
      );
      const data: InspectData = {
        status: "nothing",
        enclosing: findEnclosingAtOffset(sourceFile, offset),
        doc: "",
        nearestSymbol: nearest,
      };
      return success({ data, formattedOutput: formatInspectOutput(data) });
    }

    // With first-identifier, omitted column already lands on the name;
    // still run selectPrimaryToken for property-access / call refinement.
    const tokenNode = selectPrimaryToken(
      sourceFile,
      offset,
      false,
      line,
    );

    const inspectOffset = tokenNode
      ? tokenNode.getStart()
      : positionResult.data.offset;

    if (tokenNode && isStringLikeLiteral(tokenNode)) {
      const languageService = project.getLanguageService().compilerObject;
      const nearest = findNearestSymbolOnLine(
        sourceFile,
        line,
        languageService,
      );
      const data: InspectData = {
        status: "nothing",
        enclosing: findEnclosingName(tokenNode),
        doc: "",
        nearestSymbol: nearest,
      };
      return success({ data, formattedOutput: formatInspectOutput(data) });
    }

    const languageService = project.getLanguageService().compilerObject;
    const quickInfo = languageService.getQuickInfoAtPosition(
      fileName,
      inspectOffset,
      compact ? COMPACT_QUICK_INFO_MAX : undefined,
    );

    if (!quickInfo || !tokenNode) {
      const nearest = findNearestSymbolOnLine(
        sourceFile,
        line,
        languageService,
      );
      const data: InspectData = {
        status: "nothing",
        enclosing: tokenNode
          ? findEnclosingName(tokenNode)
          : findEnclosingAtOffset(sourceFile, inspectOffset),
        doc: "",
        nearestSymbol: nearest,
      };
      return success({ data, formattedOutput: formatInspectOutput(data) });
    }

    const symbolName = tokenNode.getText() || "<anonymous>";
    const kind = mapScriptElementKind(quickInfo.kind);
    let typeText = formatTypeDisplay(
      ts.displayPartsToString(quickInfo.displayParts ?? []),
      compact,
    );
    if (tokenNode.getKind() === SyntaxKind.ThisKeyword) {
      typeText = resolveThisTypeDisplay(tokenNode, compact);
    }
    const docText = formatDoc(
      ts.displayPartsToString(quickInfo.documentation ?? []),
      compact,
    );
    const modifiers =
      !compact && quickInfo.kindModifiers
        ? quickInfo.kindModifiers.split(/[,\s]+/).filter(Boolean)
        : undefined;

    const declaredIn = resolveDeclaredIn(
      languageService,
      fileName,
      inspectOffset,
      sourceFile,
    );
    const importHint =
      declaredIn &&
      getRecommendedPackageImport(options.filePath, declaredIn.file);

    const data: InspectData = {
      status: "found",
      symbol: symbolName,
      kind,
      type: typeText,
      declaredIn,
      enclosing: findEnclosingName(tokenNode),
      doc: docText,
      importHint,
      modifiers,
    };

    return success({ data, formattedOutput: formatInspectOutput(data) });
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error inspecting ${options.filePath}: ${message}`);
  }
};

const selectPrimaryToken = (
  sourceFile: SourceFile,
  offset: number,
  omittedColumn: boolean,
  line: number,
): Node | undefined => {
  if (omittedColumn) {
    return findFirstMeaningfulTokenOnLine(sourceFile, line);
  }

  let node: Node | undefined = sourceFile.getDescendantAtPos(offset);
  if (!node) {
    return undefined;
  }

  // Climb off trivia / punctuation toward a meaningful parent.
  node = climbToMeaningfulNode(node, offset);
  if (!node) {
    return undefined;
  }

  // Property access: prefer RHS name when offset is on the name.
  const propertyAccess = node.getFirstAncestorByKind(
    SyntaxKind.PropertyAccessExpression,
  );
  if (propertyAccess) {
    const nameNode = propertyAccess.getNameNode();
    if (offset >= nameNode.getStart() && offset <= nameNode.getEnd()) {
      return nameNode;
    }
  }

  // Call / new: select callee expression leaf.
  const call = node.getFirstAncestorByKind(SyntaxKind.CallExpression);
  if (call) {
    const expr = call.getExpression();
    if (offset >= expr.getStart() && offset <= expr.getEnd()) {
      return leafForExpression(expr, offset);
    }
  }

  const newExpr = node.getFirstAncestorByKind(SyntaxKind.NewExpression);
  if (newExpr) {
    const expr = newExpr.getExpression();
    if (offset >= expr.getStart() && offset <= expr.getEnd()) {
      return leafForExpression(expr, offset);
    }
  }

  if (
    Node.isIdentifier(node) ||
    node.getKind() === SyntaxKind.ThisKeyword ||
    Node.isPrivateIdentifier(node)
  ) {
    return node;
  }

  // Type references often land on identifiers already; otherwise climb.
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
    (Node.isIdentifier(node) ? node : undefined) ??
    node.asKind(SyntaxKind.ThisKeyword) ??
    undefined
  );
};

const climbToMeaningfulNode = (
  node: Node,
  offset: number,
): Node | undefined => {
  let current: Node | undefined = node;
  while (current) {
    const kind = current.getKind();
    if (kind === SyntaxKind.SourceFile || kind === SyntaxKind.SyntaxList) {
      break;
    }
    if (
      Node.isIdentifier(current) ||
      kind === SyntaxKind.ThisKeyword ||
      Node.isPrivateIdentifier(current) ||
      Node.isPropertyAccessExpression(current) ||
      Node.isCallExpression(current) ||
      Node.isNewExpression(current) ||
      Node.isTypeReference(current)
    ) {
      return current;
    }
    // Punctuation / operators — prefer parent.
    if (current.getWidth() <= 1 && offset >= current.getStart()) {
      current = current.getParent();
      continue;
    }
    return current;
  }
  return node;
};

const leafForExpression = (expr: Node, offset: number): Node => {
  if (Node.isPropertyAccessExpression(expr)) {
    const nameNode = expr.getNameNode();
    if (offset >= nameNode.getStart() && offset <= nameNode.getEnd()) {
      return nameNode;
    }
  }
  if (Node.isIdentifier(expr) || expr.getKind() === SyntaxKind.ThisKeyword) {
    return expr;
  }
  const id =
    expr.getLastChildByKind(SyntaxKind.Identifier) ??
    expr.getFirstDescendantByKind(SyntaxKind.Identifier);
  return id ?? expr;
};

const findFirstMeaningfulTokenOnLine = (
  sourceFile: SourceFile,
  line: number,
): Node | undefined => {
  const compilerNode = sourceFile.compilerNode;
  const lineStart = compilerNode.getPositionOfLineAndCharacter(line - 1, 0);
  const lineEnd =
    line < sourceFile.getEndLineNumber()
      ? compilerNode.getPositionOfLineAndCharacter(line, 0)
      : compilerNode.end;

  const languageService = sourceFile
    .getProject()
    .getLanguageService().compilerObject;
  const fileName = sourceFile.getFilePath();

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
        const info = languageService.getQuickInfoAtPosition(fileName, start);
        if (info) {
          best = node;
          bestStart = start;
        }
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
    kind === SyntaxKind.RegularExpressionLiteral
  );
};

const isOffsetInComment = (
  sourceFile: ts.SourceFile,
  position: number,
): boolean => {
  const inRange = (
    pos: number,
    end: number,
    kind: ts.CommentRange["kind"],
  ): boolean => {
    void kind;
    return position >= pos && position < end;
  };

  let found = false;
  const visitComments = (node: ts.Node) => {
    if (found) return;
    ts.forEachLeadingCommentRange(
      sourceFile.text,
      node.pos,
      (pos, end, kind) => {
        if (inRange(pos, end, kind)) found = true;
      },
    );
    ts.forEachTrailingCommentRange(
      sourceFile.text,
      node.end,
      (pos, end, kind) => {
        if (inRange(pos, end, kind)) found = true;
      },
    );
    ts.forEachChild(node, visitComments);
  };
  visitComments(sourceFile);

  // Full-line `//` comments attached to the next statement still covered above;
  // also scan when position sits on a comment-only line with no owning token.
  if (!found) {
    const lineStart =
      position - sourceFile.getLineAndCharacterOfPosition(position).character;
    const lineText = sourceFile.text.slice(
      lineStart,
      sourceFile.text.indexOf("\n", lineStart) === -1
        ? sourceFile.text.length
        : sourceFile.text.indexOf("\n", lineStart),
    );
    const trimmed = lineText.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      found = true;
    }
  }

  return found;
};

const findNearestSymbolOnLine = (
  sourceFile: SourceFile,
  line: number,
  languageService: ts.LanguageService,
): { name: string; line: number; column: number } | undefined => {
  const compilerNode = sourceFile.compilerNode;
  const lineStart = compilerNode.getPositionOfLineAndCharacter(line - 1, 0);
  const lineEnd =
    line < sourceFile.getEndLineNumber()
      ? compilerNode.getPositionOfLineAndCharacter(line, 0)
      : compilerNode.end;
  const fileName = sourceFile.getFilePath();

  let nearest:
    | { name: string; line: number; column: number; start: number }
    | undefined;

  const visit = (node: Node) => {
    if (node.getEnd() <= lineStart || node.getStart() >= lineEnd) {
      return;
    }
    if (Node.isIdentifier(node) || node.getKind() === SyntaxKind.ThisKeyword) {
      const start = node.getStart();
      if (start >= lineStart && start < lineEnd) {
        const info = languageService.getQuickInfoAtPosition(fileName, start);
        if (info) {
          const loc = offsetToLineColumn(sourceFile, start);
          if (!nearest || start < nearest.start) {
            nearest = {
              name: node.getText(),
              line: loc.line,
              column: loc.column,
              start,
            };
          }
        }
      }
    }
    for (const child of node.getChildren()) {
      visit(child);
    }
  };

  visit(sourceFile);
  if (!nearest) return undefined;
  return {
    name: nearest.name,
    line: nearest.line,
    column: nearest.column,
  };
};

const findEnclosingAtOffset = (
  sourceFile: SourceFile,
  offset: number,
): string => {
  const node = sourceFile.getDescendantAtPos(offset);
  return node ? findEnclosingName(node) : "(module)";
};

const findEnclosingName = (node: Node): string => {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      return current.getName() ?? "(anonymous function)";
    }
    if (Node.isMethodDeclaration(current)) {
      const methodName = current.getName();
      const cls = current.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      const className = cls?.getName();
      return className ? `${className}.${methodName}` : methodName;
    }
    if (Node.isConstructorDeclaration(current)) {
      const cls = current.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      return cls?.getName() ? `${cls.getName()}.constructor` : "constructor";
    }
    if (Node.isClassDeclaration(current) && current.getName()) {
      return current.getName()!;
    }
    if (Node.isVariableDeclaration(current)) {
      const init = current.getInitializer();
      if (
        init &&
        (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
      ) {
        return current.getName();
      }
    }
    if (Node.isPropertyDeclaration(current)) {
      const init = current.getInitializer();
      if (
        init &&
        (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
      ) {
        const name = current.getName();
        const cls = current.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
        return cls?.getName() ? `${cls.getName()}.${name}` : name;
      }
    }
    if (Node.isFunctionExpression(current) || Node.isArrowFunction(current)) {
      const parent = current.getParent();
      if (parent && Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (parent && Node.isPropertyAssignment(parent)) {
        return parent.getName();
      }
    }
    current = current.getParent();
  }
  return "(module)";
};

const resolveDeclaredIn = (
  languageService: ts.LanguageService,
  fileName: string,
  offset: number,
  querySourceFile: SourceFile,
): Location | undefined => {
  const definitions = languageService.getDefinitionAtPosition(fileName, offset);
  if (!definitions || definitions.length === 0) {
    return undefined;
  }

  const project = querySourceFile.getProject();
  const queryFile = querySourceFile.getFilePath();
  const spans: RankedDefinitionSpan[] = definitions.map((def) => ({
    file: def.fileName,
    start: def.textSpan.start,
    length: def.textSpan.length,
    name: def.name || "<anonymous>",
    kind: mapDefinitionKind(def.kind),
    isAlias: def.kind === ts.ScriptElementKind.alias,
  }));

  const expanded = expandDtsToWorkspaceSource(project, spans);
  const querySymbol = spans.find((s) => s.name !== "<anonymous>")?.name;
  const pruned = pruneNoisyDefinitionSpans(expanded, querySymbol);
  const ranked = rankDefinitionSpans(pruned, queryFile, undefined, querySymbol);
  const top = ranked[0];
  if (!top) return undefined;

  const defSource = getOrLoadSourceFile(project, top.file);
  if (defSource) {
    const loc = offsetToLineColumn(defSource, top.start);
    return {
      file: defSource.getFilePath(),
      line: loc.line,
      column: loc.column,
    };
  }

  const sf = ts.createSourceFile(
    top.file,
    ts.sys.readFile(top.file) ?? "",
    ts.ScriptTarget.Latest,
    true,
  );
  const loc = sf.getLineAndCharacterOfPosition(top.start);
  return {
    file: top.file,
    line: loc.line + 1,
    column: loc.character + 1,
  };
};

const mapScriptElementKind = (kind: ts.ScriptElementKind | string): string => {
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

const resolveThisTypeDisplay = (tokenNode: Node, compact: boolean): string => {
  const stripper = createStripper();
  const apparent = stripper
    .stripImport(tokenNode.getType().getApparentType().getText(tokenNode))
    .trim();
  if (apparent && apparent !== "this" && !/^this\b/.test(apparent)) {
    return formatTypeDisplay(apparent, compact);
  }

  const symbol =
    tokenNode.getType().getSymbol() ||
    tokenNode.getType().getApparentType().getSymbol();
  const symbolName = symbol?.getName();
  if (symbolName && symbolName !== "this") {
    return symbolName;
  }

  const cls = tokenNode.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  return cls?.getName() ?? "this";
};

const formatTypeDisplay = (raw: string, compact: boolean): string => {
  const stripper = createStripper();
  let text = stripper.stripImport(raw).trim();
  text = text.replace(/\bexport\s+export\b/g, "export");
  text = text.replace(/\b([A-Za-z_][\w]*)\s*=\s*\1\b/g, "$1");
  if (!compact) {
    return text;
  }
  if (text.length > COMPACT_TYPE_CAP) {
    return `${text.slice(0, COMPACT_TYPE_CAP - 1)}…`;
  }
  return text;
};

const formatDoc = (raw: string, compact: boolean): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!compact) return trimmed;
  // LS may join JSDoc lines with single newlines; blank line = paragraph break.
  const paragraph = trimmed.split(/\n\s*\n/)[0] ?? trimmed;
  return paragraph.replace(/\s+/g, " ").trim();
};
