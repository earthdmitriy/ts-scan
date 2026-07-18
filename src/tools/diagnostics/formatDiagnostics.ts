import { DiagnosticItem, DiagnosticsData } from "./getDiagnostics.js";

const formatRelated = (related: DiagnosticItem["related"][number]): string => {
  if (
    related.file !== undefined &&
    related.line !== undefined &&
    related.column !== undefined
  ) {
    return `    related: ${related.file}:${related.line}:${related.column} ${related.message}`;
  }
  return `    related: ${related.message}`;
};

const formatItem = (item: DiagnosticItem): string => {
  const head = `  - ${item.file}:${item.line}:${item.column} TS${item.code} ${item.category}: ${item.message}`;
  if (item.related.length === 0) {
    return head;
  }
  return [head, ...item.related.map(formatRelated)].join("\n");
};

/**
 * Pure formatter for get_diagnostics output (CLI + MCP share this text).
 */
export const formatDiagnosticsOutput = (data: DiagnosticsData): string => {
  if (data.diagnostics.length === 0) {
    return "✅ Ok";
  }

  return ["diagnostics:", ...data.diagnostics.map(formatItem)].join("\n");
};
