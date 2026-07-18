import { existsSync, readFileSync } from "fs";
import path from "path";
import { Project } from "ts-morph";
import { error, Result, success } from "../../types.js";
import { cachedResolveExportInNodeModules } from "../exportCache/exportCache.js";
import { getExportedSymbols } from "../exports/getExportedSymbols.js";
import { ResolvedTsConfig } from "../resolveTsConfig.js";
import { resolveLocalExport } from "./resolveLocalExport.js";

export interface ResolvedSymbol {
  path: string;
  relative: string;
}

export interface ResolveSymbolResult {
  localResults: ResolvedSymbol[];
  nodeResults: string[];
  formattedOutput: string;
}

interface RankedHit {
  kind: "recommended" | "same-package" | "implementation";
  label: string;
  importPath: string;
  definitionPath: string;
}

/**
 * Shared logic for resolving a symbol to its import path.
 * Used by both CLI --resolve command and MCP resolve_symbol tool.
 */
export const resolveSymbol = (
  symbol: string,
  project: Project,
  resolvedConfig: ResolvedTsConfig,
  relativeTo: string,
): Result<ResolveSymbolResult> => {
  const localResult = resolveLocalExport(symbol, resolvedConfig, relativeTo);
  const nodeResult = cachedResolveExportInNodeModules(symbol, {
    anchorFile: relativeTo,
    resolvedConfig,
  });

  const localResults: ResolvedSymbol[] = localResult.success
    ? localResult.data
    : [];
  const nodeResults: string[] = nodeResult.success ? nodeResult.data : [];

  const anchorPackage = findNearestPackageName(relativeTo);
  const ranked = rankHits(localResults, nodeResults, anchorPackage);

  let formattedOutput = "";
  for (const hit of ranked) {
    formattedOutput += `\n${hit.label}\n   import { ${symbol} } from "${hit.importPath}";`;

    const exports = getExportedSymbols(
      hit.definitionPath,
      project,
      [symbol],
      relativeTo,
    );
    if (exports.success) {
      formattedOutput += `\n${exports.data}`;
    }
  }

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

const rankHits = (
  localResults: ResolvedSymbol[],
  nodeResults: string[],
  anchorPackage: string | null,
): RankedHit[] => {
  const recommended: RankedHit[] = nodeResults.map((importPath) => ({
    kind: "recommended" as const,
    label: `✅ Recommended import: ${importPath}`,
    importPath,
    definitionPath: importPath,
  }));

  const samePackage: RankedHit[] = [];
  const implementation: RankedHit[] = [];

  for (const local of localResults) {
    const hitPackage = findNearestPackageName(local.path);
    const isCrossPackage =
      !!anchorPackage && !!hitPackage && anchorPackage !== hitPackage;

    if (isCrossPackage) {
      implementation.push({
        kind: "implementation",
        label: `📁 Implementation path (cross-package): ${local.path}`,
        importPath: local.relative,
        definitionPath: local.path,
      });
    } else {
      samePackage.push({
        kind: "same-package",
        label: `✅ Found in: ${local.path}`,
        importPath: local.relative,
        definitionPath: local.path,
      });
    }
  }

  // Prefer package entrypoints when available; demote cross-package relatives.
  if (recommended.length > 0) {
    return [...recommended, ...samePackage, ...implementation];
  }
  return [...samePackage, ...implementation];
};

/**
 * Walk up from a file and return the nearest package.json "name", if any.
 */
export const findNearestPackageName = (filePath: string): string | null => {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: string;
        };
        if (typeof pkg.name === "string" && pkg.name.length > 0) {
          return pkg.name;
        }
      } catch {
        // Ignore invalid package.json while walking up.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};
