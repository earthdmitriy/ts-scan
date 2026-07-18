import { InspectData, Location } from "./inspectPosition.js";

const formatLocation = (location: Location): string =>
  `${location.file}:${location.line}:${location.column}`;

/**
 * Pure formatter for inspect output (CLI + MCP share this text).
 */
export const formatInspectOutput = (data: InspectData): string => {
  if (data.status === "nothing") {
    const lines = ["status: nothing"];
    if (data.nearestSymbol) {
      lines.push(
        `nearestSymbol: ${data.nearestSymbol.name} @ ${data.nearestSymbol.line}:${data.nearestSymbol.column}`,
      );
    }
    lines.push(`enclosing: ${data.enclosing}`);
    return lines.join("\n");
  }

  const lines = [
    `symbol: ${data.symbol ?? "<anonymous>"}`,
    `kind: ${data.kind ?? "unknown"}`,
    `type: ${data.type ?? ""}`,
  ];

  if (data.declaredIn) {
    lines.push(`declaredIn: ${formatLocation(data.declaredIn)}`);
  }

  lines.push(`enclosing: ${data.enclosing}`);
  lines.push(`doc: ${data.doc}`);

  if (data.importHint) {
    lines.push(`importHint: ${data.importHint}`);
  }

  if (data.modifiers && data.modifiers.length > 0) {
    lines.push(`modifiers: ${data.modifiers.join(", ")}`);
  }

  return lines.join("\n");
};
