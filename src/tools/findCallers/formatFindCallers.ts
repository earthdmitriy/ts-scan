import { CallerItem, FindCallersData } from "./findCallers.js";

const formatCaller = (caller: CallerItem): string => {
  const loc = `${caller.location.file}:${caller.location.line}:${caller.location.column}`;
  const pkg = caller.package ? ` package=${caller.package}` : "";
  const parent = caller.parentId ? ` parentId=${caller.parentId}` : "";
  return [
    `- depth: ${caller.depth}`,
    `  id: ${caller.id}${parent}`,
    `  location: ${loc}`,
    `  callerName: ${caller.callerName}`,
    `  kind: ${caller.kind}`,
    `  confidence: ${caller.confidence}${pkg}`,
    `  snippet: ${caller.snippet}`,
  ].join("\n");
};

/**
 * Pure formatter for find-callers output (CLI + MCP share this text).
 */
export const formatFindCallersOutput = (data: FindCallersData): string => {
  const def = data.target.definition;
  const lines = [
    `target: ${data.target.name} @ ${def.file}:${def.line}:${def.column}`,
    `scope: ${data.scope}`,
    `truncated: ${data.truncated}`,
    `callers: ${data.callers.length}`,
  ];
  for (const caller of data.callers) {
    lines.push(formatCaller(caller));
  }
  if (data.notes.length > 0) {
    lines.push("notes:");
    for (const note of data.notes) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join("\n");
};
