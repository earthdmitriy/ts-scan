import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { error, Result, success } from "../../types.js";

import { createRequire } from "module";
import ts from "typescript";

const require = createRequire(import.meta.url);

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  types?: string;
  typings?: string;
  main?: string;
  exports?: Record<string, string | { [key: string]: any }>;
}

type ExportCache = { resolveSymbol: (symbol: string) => Result<string[]> };

let cache = null as ExportCache | null;

export const cachedResolveExportInNodeModules = (
  symbol: string,
  withLog: boolean = false,
): Result<string[]> => {
  try {
    if (!cache) {
      const cacheResult = createExportCache(withLog);
      if (!cacheResult.success) {
        return error(`Failed to create export cache: ${cacheResult.error}`);
      }
      cache = cacheResult.data;
    }

    const result = cache.resolveSymbol(symbol);
    if (!result.success || result.data.length === 0) {
      return error(`Symbol "${symbol}" not found.`);
    }
    return success(result.data);
  } catch (err) {
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    return error(`resolveExportInNodeModules error: ${message}`);
  }
};

export const createExportCache = (
  withLog: boolean = false,
): Result<ExportCache> => {
  const cache = new Map<string, string[]>();

  const rootPkg: PackageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const deps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };

  withLog && console.log(`🔍 Indexing dependencies ...`);

  const allEntries: { pkgName: string; subpath: string; filePath: string }[] =
    [];

  const currentDir = process.cwd();
  const nodeModulesDir = join(currentDir, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return error(`No node_modules directory found in ${currentDir}`);
  }

  for (const pkgName of Object.keys(deps)) {
    try {
      const pkgJsonPath = findPackageDir(pkgName, currentDir);
      if (!pkgJsonPath) {
        console.warn(
          `Warning: Could not find package "${pkgName}" in node_modules. Skipping.`,
        );
        continue;
      }

      const pkgDir = dirname(pkgJsonPath);
      const pkgJson: PackageJson = JSON.parse(
        readFileSync(pkgJsonPath, "utf8"),
      );

      const entryMap = resolveAllTypesFiles(pkgDir, pkgJson);
      for (const [subpath, filePath] of entryMap) {
        allEntries.push({ pkgName, subpath, filePath });
      }
    } catch (e) {
      withLog &&
        console.warn(
          `Warning: Could not resolve package "${pkgName}". Error: ${e}. Skipping.`,
        );
    }
  }
  withLog && console.log(`🔍 createProgram`);

  const program = ts.createProgram(
    allEntries.map((e) => e.filePath),
    {
      target: ts.ScriptTarget.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: true,
    },
  );

  const checker = program.getTypeChecker();

  withLog && console.log(`🔍 iterating`);

  for (const entry of allEntries) {
    const sourceFile = program.getSourceFile(entry.filePath);
    if (!sourceFile) continue;

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol) {
      const exports = checker.getExportsOfModule(moduleSymbol);
      const exportNames = exports.map((exp) => exp.getName());
      exportNames.forEach((name) => {
        const importPath =
          entry.subpath === "."
            ? entry.pkgName
            : `${entry.pkgName}/${entry.subpath.replace(/^\.\//, "")}`;

        cache.get(name)?.push(importPath) || cache.set(name, [importPath]);
      });
    }
  }

  withLog && console.log(`🔍 Indexing complete. Cached ${cache.size} exports.`);

  return success({
    resolveSymbol: (symbol: string) => {
      if (cache.has(symbol)) {
        return success(cache.get(symbol) as string[]);
      }
      return success([]);
    },
  });
};

function findPackageDir(pkgName: string, startDir: string): string | null {
  try {
    return require.resolve(`${pkgName}/package.json`, {
      paths: [startDir],
    });
  } catch (e) {
    // Fallback for packages with exports that don't include package.json
    const fallbackPath = join(
      startDir,
      "node_modules",
      pkgName,
      "package.json",
    );
    if (existsSync(fallbackPath)) {
      return fallbackPath;
    }
    return null;
  }
}

function resolveAllTypesFiles(
  pkgDir: string,
  pkgJson: PackageJson,
): Map<string, string> {
  const entryPoints = new Map<string, string>();

  function addEntry(subpath: string, relativePath: string) {
    const fullPath = join(pkgDir, relativePath);
    if (existsSync(fullPath)) entryPoints.set(subpath, fullPath);
  }

  if (pkgJson.types || pkgJson.typings) {
    const typesPath = pkgJson.types || pkgJson.typings;
    addEntry(".", typesPath!);
  }

  if (pkgJson.exports) {
    for (const [key, value] of Object.entries(pkgJson.exports)) {
      if (typeof value === "object" && value !== null) {
        const val = value as { [key: string]: any };
        const typesPath = val.types || val.default?.types || val.import?.types;
        if (typesPath) addEntry(key, typesPath);
      } else if (typeof value === "string" && value.endsWith(".d.ts")) {
        addEntry(key, value);
      }
    }
  }

  if (!entryPoints.has(".") && pkgJson.main) {
    const dts = pkgJson.main.replace(/\.(js|mjs|cjs)$/, ".d.ts");
    addEntry(".", dts);
  }
  if (!entryPoints.has(".")) addEntry(".", "index.d.ts");

  return entryPoints;
}
