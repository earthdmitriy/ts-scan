import { DefinitionLocation, GoToDefinitionData } from "./goToDefinition.js";

const formatLocation = (location: DefinitionLocation): string => {
  const span = `${location.file}:${location.line}:${location.column}`;
  const end = `-${location.endLine}:${location.endColumn}`;
  const flags = [
    location.external ? "external" : undefined,
    location.importHint ? `importHint=${location.importHint}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const meta = flags ? ` (${flags})` : "";
  return `${span}${end} ${location.name} [${location.kind}]${meta}`;
};

/**
 * Pure formatter for go-to-definition output (CLI + MCP share this text).
 */
export const formatGoToDefinitionOutput = (
  data: GoToDefinitionData,
): string => {
  if (data.definitions.length === 0) {
    const lines = [
      `definitions: 0`,
      `reason: ${data.reason ?? "no_definition"}`,
    ];
    if (data.symbol) {
      lines.unshift(`symbol: ${data.symbol}`);
    }
    return lines.join("\n");
  }

  const primary = data.primary ?? data.definitions[0]!;
  const alternates =
    data.alternates.length > 0
      ? data.alternates
      : data.definitions.slice(1);

  const lines = [
    `symbol: ${data.symbol ?? "<anonymous>"}`,
    `primary: ${formatLocation(primary)}`,
  ];

  if (alternates.length > 0) {
    lines.push(`alternates: ${alternates.length}`);
    for (const def of alternates) {
      lines.push(`- ${formatLocation(def)}`);
    }
  } else {
    lines.push(`alternates: 0`);
  }

  return lines.join("\n");
};
