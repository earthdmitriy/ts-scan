import { FindReferencesData, ReferenceItem } from "./findReferences.js";

const formatRef = (ref: ReferenceItem): string => {
  const span = `${ref.file}:${ref.line}:${ref.column}-${ref.endLine}:${ref.endColumn}`;
  const pkg = ref.package ? ` package=${ref.package}` : "";
  const snippet = ref.snippet ? ` | ${ref.snippet}` : "";
  return `- ${span} [${ref.kind}]${pkg}${snippet}`;
};

/**
 * Pure formatter for find-references output (CLI + MCP share this text).
 */
export const formatFindReferencesOutput = (
  data: FindReferencesData,
): string => {
  const countLabel = data.truncated
    ? `${data.references.length} of ${data.totalCount}`
    : `${data.references.length}`;
  const lines = [
    `symbol: ${data.symbol}`,
    `definition: ${data.definition.file}:${data.definition.line}:${data.definition.column}`,
    `scope: ${data.scope}`,
    `truncated: ${data.truncated}`,
    `references: ${countLabel}`,
  ];
  for (const ref of data.references) {
    lines.push(formatRef(ref));
  }
  if (data.notes.length > 0) {
    lines.push("notes:");
    for (const note of data.notes) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join("\n");
};
