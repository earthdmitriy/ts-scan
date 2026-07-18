import {
  ReachabilityData,
  ReachabilityPath,
  ReachabilityStep,
} from "./reachability.js";

const formatLocation = (loc: {
  file: string;
  line: number;
  column: number;
}): string => `${loc.file}:${loc.line}:${loc.column}`;

const formatStep = (step: ReachabilityStep): string => {
  const parts = [
    `- ${step.name} @ ${formatLocation(step.definition)}`,
  ];
  if (step.callSite) {
    parts.push(`  callSite: ${formatLocation(step.callSite)}`);
  }
  if (step.kind) {
    parts.push(`  kind: ${step.kind}`);
  }
  return parts.join("\n");
};

const formatPath = (pathItem: ReachabilityPath, index: number): string => {
  const ep = pathItem.entrypoint;
  const lines = [
    `path[${index}]:`,
    `  entrypoint:`,
    `    kind: ${ep.kind}`,
    `    name: ${ep.name}`,
    `    location: ${formatLocation(ep.location)}`,
    `  confidence: ${pathItem.confidence}`,
    `  steps: ${pathItem.steps.length}`,
  ];
  for (const step of pathItem.steps) {
    for (const line of formatStep(step).split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  return lines.join("\n");
};

/**
 * Pure formatter for reachability output (CLI + MCP share this text).
 */
export const formatReachabilityOutput = (data: ReachabilityData): string => {
  const def = data.target.definition;
  const lines = [
    `target: ${data.target.name} @ ${formatLocation(def)}`,
    `scope: ${data.scope}`,
    `truncated: ${data.truncated}`,
    `paths: ${data.paths.length}`,
  ];
  data.paths.forEach((pathItem, index) => {
    lines.push(formatPath(pathItem, index));
  });
  if (data.notes.length > 0) {
    lines.push("notes:");
    for (const note of data.notes) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join("\n");
};
