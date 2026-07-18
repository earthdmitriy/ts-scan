import { Project, SourceFile, ts } from "ts-morph";
import { error, Result, success } from "../../types.js";
import { loadFile } from "./loadTsMorphFile.js";

export interface ResolvedPosition {
  sourceFile: SourceFile;
  offset: number;
  line: number;
  column: number;
}

export type ColumnPolicy = "required" | "first-token" | "first-identifier";

/**
 * Resolve a one-based public (line, column?) to a UTF-16 Language Service offset.
 */
export const resolveSourcePosition = (
  project: Project,
  filePath: string,
  line: number,
  column?: number,
  columnPolicy: ColumnPolicy = column === undefined
    ? "first-token"
    : "required",
): Result<ResolvedPosition> => {
  if (!Number.isInteger(line) || line < 1) {
    return error(
      `Invalid line: ${line}. Line must be a 1-based integer within the file.`,
    );
  }

  if (column !== undefined && (!Number.isInteger(column) || column < 1)) {
    return error(
      `Invalid column: ${column}. Column must be a 1-based integer within the line.`,
    );
  }

  let sourceFile: SourceFile;
  try {
    sourceFile = loadFile(project, filePath);
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error loading ${filePath}: ${message}`);
  }

  const compilerNode = sourceFile.compilerNode;
  const lineCount = sourceFile.getEndLineNumber();

  if (line > lineCount) {
    return error(
      `Invalid line: ${line}. File has ${lineCount} line${lineCount === 1 ? "" : "s"}.`,
    );
  }

  const lineStart = compilerNode.getPositionOfLineAndCharacter(line - 1, 0);
  const lineText = sourceFile
    .getFullText()
    .slice(lineStart, getLineEndOffset(compilerNode, lineStart));
  // Allow caret at end-of-line (length + 1 in 1-based columns).
  const maxColumn = lineText.length + 1;

  if (columnPolicy === "required") {
    const col = column ?? 1;
    if (col > maxColumn) {
      return error(
        `Invalid column: ${col}. Line ${line} has ${lineText.length} character${lineText.length === 1 ? "" : "s"} (max column ${maxColumn}).`,
      );
    }
    const offset = compilerNode.getPositionOfLineAndCharacter(
      line - 1,
      col - 1,
    );
    return success({ sourceFile, offset, line, column: col });
  }

  // Explicit column always wins when provided.
  if (column !== undefined) {
    if (column > maxColumn) {
      return error(
        `Invalid column: ${column}. Line ${line} has ${lineText.length} character${lineText.length === 1 ? "" : "s"} (max column ${maxColumn}).`,
      );
    }
    const offset = compilerNode.getPositionOfLineAndCharacter(
      line - 1,
      column - 1,
    );
    return success({ sourceFile, offset, line, column });
  }

  if (columnPolicy === "first-identifier") {
    const idOffset = findFirstIdentifierOffsetOnLine(compilerNode, line);
    if (idOffset === undefined) {
      const tokenOffset = findFirstNonWhitespaceOffset(
        compilerNode,
        lineStart,
        lineText,
      );
      if (tokenOffset !== undefined) {
        const suggested = offsetToOneBasedColumn(compilerNode, tokenOffset);
        return error(
          `ambiguous_position: no identifier on line ${line}; pass column on symbol name` +
            (suggested !== undefined
              ? ` (first token column: ${suggested})`
              : ""),
        );
      }
      return error(
        `ambiguous_position: no identifier on line ${line}; pass column on symbol name`,
      );
    }
    const loc = compilerNode.getLineAndCharacterOfPosition(idOffset);
    return success({
      sourceFile,
      offset: idOffset,
      line: loc.line + 1,
      column: loc.character + 1,
    });
  }

  // first-token: optional column omitted — find first non-whitespace token.
  const tokenOffset = findFirstNonWhitespaceOffset(
    compilerNode,
    lineStart,
    lineText,
  );
  if (tokenOffset === undefined) {
    return success({
      sourceFile,
      offset: lineStart,
      line,
      column: 1,
    });
  }

  const loc = compilerNode.getLineAndCharacterOfPosition(tokenOffset);
  return success({
    sourceFile,
    offset: tokenOffset,
    line: loc.line + 1,
    column: loc.character + 1,
  });
};

/**
 * Convert a UTF-16 offset to one-based line/column.
 */
export const offsetToLineColumn = (
  sourceFile: SourceFile,
  offset: number,
): { line: number; column: number } => {
  const loc = sourceFile.compilerNode.getLineAndCharacterOfPosition(offset);
  return { line: loc.line + 1, column: loc.character + 1 };
};

/**
 * First Identifier / this / #private on a 1-based line, or undefined.
 */
export const findFirstIdentifierOffsetOnLine = (
  compilerNode: ts.SourceFile,
  line: number,
): number | undefined => {
  const lineStart = compilerNode.getPositionOfLineAndCharacter(line - 1, 0);
  const lineEnd = getLineEndOffset(compilerNode, lineStart);

  let best: number | undefined;

  const visit = (node: ts.Node) => {
    if (node.getEnd() <= lineStart || node.getStart() >= lineEnd) {
      return;
    }
    if (
      ts.isIdentifier(node) ||
      node.kind === ts.SyntaxKind.ThisKeyword ||
      ts.isPrivateIdentifier(node)
    ) {
      const start = node.getStart(compilerNode);
      if (start >= lineStart && start < lineEnd) {
        if (best === undefined || start < best) {
          best = start;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(compilerNode);
  return best;
};

/**
 * Suggest a 1-based column for the first identifier on a line (agent UX).
 */
export const suggestIdentifierColumn = (
  sourceFile: SourceFile,
  line: number,
): number | undefined => {
  const offset = findFirstIdentifierOffsetOnLine(
    sourceFile.compilerNode,
    line,
  );
  if (offset === undefined) return undefined;
  return offsetToOneBasedColumn(sourceFile.compilerNode, offset);
};

const offsetToOneBasedColumn = (
  compilerNode: ts.SourceFile,
  offset: number,
): number => {
  return compilerNode.getLineAndCharacterOfPosition(offset).character + 1;
};

const getLineEndOffset = (
  compilerNode: ts.SourceFile,
  lineStart: number,
): number => {
  const text = compilerNode.text;
  let i = lineStart;
  while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
    i++;
  }
  return i;
};

const findFirstNonWhitespaceOffset = (
  compilerNode: ts.SourceFile,
  lineStart: number,
  lineText: string,
): number | undefined => {
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i]!;
    if (ch !== " " && ch !== "\t" && ch !== "\f" && ch !== "\v") {
      return lineStart + i;
    }
  }
  return undefined;
};
