import { Project } from "ts-morph";
import { Result, success, error } from "../../types.js";
import { resolveLocalExport } from "./resolveLocalExport.js";
import { cachedResolveExportInNodeModules } from "../exportCache/exportCache.js";
import { getExportedSymbols } from "../exports/getExportedSymbols.js";

export interface ResolvedSymbol {
  path: string;
  relative: string;
}

export interface ResolveSymbolResult {
  localResults: ResolvedSymbol[];
  nodeResults: string[];
  formattedOutput: string;
}

/**
 * Shared logic for resolving a symbol to its import path.
 * Used by both CLI --resolve command and MCP resolve_symbol tool.
 */
export const resolveSymbol = (
  symbol: string,
  project: Project,
  relativeTo?: string,
): Result<ResolveSymbolResult> => {
  const localResult = resolveLocalExport(symbol, relativeTo || "");
  const nodeResult = cachedResolveExportInNodeModules(symbol);

  const localResults: ResolvedSymbol[] = localResult.success
    ? localResult.data
    : [];
  const nodeResults: string[] = nodeResult.success ? nodeResult.data : [];

  let formattedOutput = "";
  const errors: string[] = [];

  localResults.forEach((x) => {
    formattedOutput += `\n✅ Found in: ${x.path}\n   import { ${symbol} } from "${x.relative}";`;

    const exports = getExportedSymbols(x.path, project, [symbol]);
    if (exports.success) {
      formattedOutput += `\n${exports.data}`;
    }
  });

  nodeResults.forEach((x) => {
    formattedOutput += `\n✅ Found in: ${x}\n   import { ${symbol} } from "${x}";`;

    const exports = getExportedSymbols(x, project, [symbol]);
    if (exports.success) {
      formattedOutput += `\n${exports.data}`;
    }
  });

  if (!formattedOutput) {
    return error(
      "❌ Symbol not found in local files or node_modules. Consider checking for typos or if the symbol is indeed exported.",
    );
  }

  return success({
    localResults,
    nodeResults,
    formattedOutput,
  });
};
