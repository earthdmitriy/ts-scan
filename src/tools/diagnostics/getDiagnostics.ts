import path from "path";
import { Project, SourceFile, ts } from "ts-morph";
import { error, Result, success, ToolResult } from "../../types.js";
import { canonicalizePath } from "../resolveTsConfig.js";
import { loadFile } from "../utils/loadTsMorphFile.js";
import { offsetToLineColumn } from "../utils/sourcePosition.js";
import { formatDiagnosticsOutput } from "./formatDiagnostics.js";

export type DiagnosticSeverity = "error" | "warning" | "all";

export interface DiagnosticCodeFilter {
  include?: number[];
  exclude?: number[];
}

export interface DiagnosticItem {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  code: number;
  category: "error" | "warning" | "suggestion" | "message";
  message: string;
  related: Array<{
    file?: string;
    line?: number;
    column?: number;
    message: string;
  }>;
}

export interface DiagnosticsData {
  diagnostics: DiagnosticItem[];
}

export type DiagnosticCollector = "languageService" | "preEmit";

export interface GetDiagnosticsOptions {
  filePath: string;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  severity?: DiagnosticSeverity;
  codes?: DiagnosticCodeFilter;
  /**
   * `languageService` (default): syntactic + semantic (+ suggestions when
   * severity allows). `preEmit`: SourceFile.getPreEmitDiagnostics — used by
   * the backward-compatible `check_type_errors` adapter.
   */
  collector?: DiagnosticCollector;
}

interface CollectedDiagnostic {
  item: DiagnosticItem;
  raw: ts.Diagnostic;
  start: number;
  length: number;
  dedupeKey: string;
}

/**
 * Structured file/range diagnostics from the Language Service.
 */
export const getDiagnostics = (
  options: GetDiagnosticsOptions,
  project: Project,
): Result<ToolResult<DiagnosticsData>> => {
  const collected = collectFilteredDiagnostics(options, project);
  if (!collected.success) {
    return error(collected.error);
  }

  const data: DiagnosticsData = {
    diagnostics: collected.data.map((entry) => entry.item),
  };
  return success({
    data,
    formattedOutput: formatDiagnosticsOutput(data),
  });
};

/**
 * Shared collection used by `get_diagnostics` and the `check_type_errors`
 * adapter. Returns filtered diagnostics with raw TS objects for legacy
 * color formatting.
 */
export const collectFilteredDiagnostics = (
  options: GetDiagnosticsOptions,
  project: Project,
): Result<CollectedDiagnostic[]> => {
  const severity: DiagnosticSeverity = options.severity ?? "error";

  let sourceFile: SourceFile;
  try {
    sourceFile = loadFile(project, options.filePath);
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error processing ${options.filePath}: ${message}`);
  }

  const rangeResult = resolveDiagnosticRange(sourceFile, options);
  if (!rangeResult.success) {
    return error(rangeResult.error);
  }
  const range = rangeResult.data;

  try {
    const raw = collectRawDiagnostics(
      sourceFile,
      project,
      severity,
      options.collector,
    );
    const queryCanonical = canonicalizePath(options.filePath);
    const mapped: CollectedDiagnostic[] = [];
    const seen = new Set<string>();

    for (const diagnostic of raw) {
      const entry = mapDiagnostic(diagnostic, project, queryCanonical);
      if (!entry) continue;

      if (range && !overlapsRange(entry, range)) {
        continue;
      }

      if (!matchesSeverity(entry.item.category, severity)) {
        continue;
      }

      if (!matchesCodes(entry.item.code, options.codes)) {
        continue;
      }

      if (seen.has(entry.dedupeKey)) continue;
      seen.add(entry.dedupeKey);
      mapped.push(entry);
    }

    mapped.sort((a, b) => {
      const fileCmp = canonicalizePath(a.item.file).localeCompare(
        canonicalizePath(b.item.file),
      );
      if (fileCmp !== 0) return fileCmp;
      if (a.start !== b.start) return a.start - b.start;
      return a.item.code - b.item.code;
    });

    return success(mapped);
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error processing ${options.filePath}: ${message}`);
  }
};

const collectRawDiagnostics = (
  sourceFile: SourceFile,
  project: Project,
  severity: DiagnosticSeverity,
  collector: DiagnosticCollector = "languageService",
): ts.Diagnostic[] => {
  if (collector === "preEmit") {
    return sourceFile
      .getPreEmitDiagnostics()
      .map((diagnostic) => diagnostic.compilerObject);
  }

  const languageService = project.getLanguageService().compilerObject;
  const fileName = sourceFile.getFilePath();
  const raw: ts.Diagnostic[] = [
    ...languageService.getSyntacticDiagnostics(fileName),
    ...languageService.getSemanticDiagnostics(fileName),
  ];

  if (severity === "warning" || severity === "all") {
    raw.push(...languageService.getSuggestionDiagnostics(fileName));
  }

  return raw;
};

interface ResolvedRange {
  start: number;
  end: number;
}

const resolveDiagnosticRange = (
  sourceFile: SourceFile,
  options: GetDiagnosticsOptions,
): Result<ResolvedRange | undefined> => {
  const { startLine, endLine, startColumn, endColumn } = options;
  const hasAny =
    startLine !== undefined ||
    endLine !== undefined ||
    startColumn !== undefined ||
    endColumn !== undefined;

  if (!hasAny) {
    return success(undefined);
  }

  if (endLine !== undefined && startLine === undefined) {
    return error("Invalid range: endLine requires startLine.");
  }
  if (startColumn !== undefined && startLine === undefined) {
    return error("Invalid range: startColumn requires startLine.");
  }
  if (endColumn !== undefined && endLine === undefined) {
    return error("Invalid range: endColumn requires endLine.");
  }
  if (startLine === undefined) {
    return error(
      "Invalid range: startLine is required when specifying a range.",
    );
  }

  if (!Number.isInteger(startLine) || startLine < 1) {
    return error(
      `Invalid startLine: ${startLine}. Line must be a 1-based integer.`,
    );
  }
  if (endLine !== undefined && (!Number.isInteger(endLine) || endLine < 1)) {
    return error(
      `Invalid endLine: ${endLine}. Line must be a 1-based integer.`,
    );
  }
  if (
    startColumn !== undefined &&
    (!Number.isInteger(startColumn) || startColumn < 1)
  ) {
    return error(
      `Invalid startColumn: ${startColumn}. Column must be a 1-based integer.`,
    );
  }
  if (
    endColumn !== undefined &&
    (!Number.isInteger(endColumn) || endColumn < 1)
  ) {
    return error(
      `Invalid endColumn: ${endColumn}. Column must be a 1-based integer.`,
    );
  }

  const lineCount = sourceFile.getEndLineNumber();
  if (startLine > lineCount) {
    return error(
      `Invalid startLine: ${startLine}. File has ${lineCount} line${lineCount === 1 ? "" : "s"}.`,
    );
  }
  if (endLine !== undefined && endLine > lineCount) {
    return error(
      `Invalid endLine: ${endLine}. File has ${lineCount} line${lineCount === 1 ? "" : "s"}.`,
    );
  }

  const compilerNode = sourceFile.compilerNode;
  const text = sourceFile.getFullText();

  const lineExtent = (line: number): { start: number; end: number } => {
    const start = compilerNode.getPositionOfLineAndCharacter(line - 1, 0);
    const end =
      line < lineCount
        ? compilerNode.getPositionOfLineAndCharacter(line, 0)
        : text.length;
    return { start, end };
  };

  const columnOffset = (line: number, column: number): Result<number> => {
    const { start, end } = lineExtent(line);
    const lineText = text.slice(start, end).replace(/\r?\n$/, "");
    const maxColumn = lineText.length + 1;
    if (column > maxColumn) {
      return error(
        `Invalid column: ${column}. Line ${line} has ${lineText.length} character${lineText.length === 1 ? "" : "s"} (max column ${maxColumn}).`,
      );
    }
    return success(
      compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1),
    );
  };

  let rangeStart: number;
  let rangeEnd: number;

  if (endLine === undefined) {
    const line = lineExtent(startLine);
    if (startColumn === undefined) {
      rangeStart = line.start;
      rangeEnd = line.end;
    } else {
      const startResult = columnOffset(startLine, startColumn);
      if (!startResult.success) return error(startResult.error);
      rangeStart = startResult.data;
      rangeEnd = line.end;
    }
  } else {
    const startCol = startColumn ?? 1;
    const startResult = columnOffset(startLine, startCol);
    if (!startResult.success) return error(startResult.error);
    rangeStart = startResult.data;

    if (endColumn === undefined) {
      rangeEnd = lineExtent(endLine).end;
    } else {
      const endResult = columnOffset(endLine, endColumn);
      if (!endResult.success) return error(endResult.error);
      rangeEnd = endResult.data;
    }
  }

  if (rangeStart > rangeEnd) {
    return error(
      `Invalid range: start (${rangeStart}) is after end (${rangeEnd}).`,
    );
  }

  return success({ start: rangeStart, end: rangeEnd });
};

const overlapsRange = (
  entry: CollectedDiagnostic,
  range: ResolvedRange,
): boolean => {
  const diagStart = entry.start;
  const diagEnd = entry.start + entry.length;

  if (entry.length === 0) {
    return diagStart >= range.start && diagStart < range.end;
  }

  return diagStart < range.end && diagEnd > range.start;
};

const matchesSeverity = (
  category: DiagnosticItem["category"],
  severity: DiagnosticSeverity,
): boolean => {
  if (severity === "all") return true;
  if (severity === "error") return category === "error";
  // warning: Warning + Suggestion (not errors)
  return category === "warning" || category === "suggestion";
};

const matchesCodes = (
  code: number,
  codes: DiagnosticCodeFilter | undefined,
): boolean => {
  if (!codes) return true;
  if (codes.include && codes.include.length > 0) {
    if (!codes.include.includes(code)) return false;
  }
  if (codes.exclude && codes.exclude.length > 0) {
    if (codes.exclude.includes(code)) return false;
  }
  return true;
};

const mapDiagnostic = (
  diagnostic: ts.Diagnostic,
  project: Project,
  queryCanonical: string,
): CollectedDiagnostic | undefined => {
  if (!diagnostic.file) {
    return undefined;
  }

  const filePath = path.resolve(diagnostic.file.fileName);
  if (canonicalizePath(filePath) !== queryCanonical) {
    return undefined;
  }

  const start = diagnostic.start ?? 0;
  const length = diagnostic.length ?? 0;
  const message = flattenMessage(diagnostic.messageText);
  const category = mapCategory(diagnostic.category);

  let sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) {
    try {
      sourceFile = project.addSourceFileAtPath(filePath);
    } catch {
      sourceFile = undefined;
    }
  }

  let line = 1;
  let column = 1;
  let endLine: number | undefined;
  let endColumn: number | undefined;

  if (sourceFile) {
    const startLoc = offsetToLineColumn(sourceFile, start);
    line = startLoc.line;
    column = startLoc.column;
    if (length > 0) {
      const endLoc = offsetToLineColumn(
        sourceFile,
        Math.min(sourceFile.getFullText().length, start + length),
      );
      endLine = endLoc.line;
      endColumn = endLoc.column;
    }
  } else {
    const loc = diagnostic.file.getLineAndCharacterOfPosition(start);
    line = loc.line + 1;
    column = loc.character + 1;
    if (length > 0) {
      const endLoc = diagnostic.file.getLineAndCharacterOfPosition(
        start + length,
      );
      endLine = endLoc.line + 1;
      endColumn = endLoc.character + 1;
    }
  }

  const related = (diagnostic.relatedInformation ?? []).map((info) =>
    mapRelated(info, project),
  );

  const item: DiagnosticItem = {
    file: filePath,
    line,
    column,
    endLine,
    endColumn,
    code: diagnostic.code,
    category,
    message,
    related,
  };

  return {
    item,
    raw: diagnostic,
    start,
    length,
    dedupeKey: `${canonicalizePath(filePath)}:${start}:${length}:${diagnostic.code}:${message}`,
  };
};

const mapRelated = (
  info: ts.DiagnosticRelatedInformation,
  project: Project,
): DiagnosticItem["related"][number] => {
  const message = flattenMessage(info.messageText);
  if (!info.file || info.start === undefined) {
    return { message };
  }

  const filePath = path.resolve(info.file.fileName);
  let sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) {
    try {
      sourceFile = project.addSourceFileAtPath(filePath);
    } catch {
      sourceFile = undefined;
    }
  }

  if (sourceFile) {
    const loc = offsetToLineColumn(sourceFile, info.start);
    return {
      file: filePath,
      line: loc.line,
      column: loc.column,
      message,
    };
  }

  const loc = info.file.getLineAndCharacterOfPosition(info.start);
  return {
    file: filePath,
    line: loc.line + 1,
    column: loc.character + 1,
    message,
  };
};

const flattenMessage = (
  messageText: string | ts.DiagnosticMessageChain,
): string => ts.flattenDiagnosticMessageText(messageText, "\n");

const mapCategory = (
  category: ts.DiagnosticCategory,
): DiagnosticItem["category"] => {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "suggestion";
    case ts.DiagnosticCategory.Message:
      return "message";
    default:
      return "message";
  }
};
