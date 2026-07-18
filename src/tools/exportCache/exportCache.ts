import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { error, Result, success } from "../../types.js";

import { createRequire } from "module";
import ts from "typescript";
import { ResolvedTsConfig } from "../resolveTsConfig.js";

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

const cachesByTsConfig = new Map<string, ExportCache>();

export interface NodeModulesResolveOptions {
  anchorFile: string;
  resolvedConfig: ResolvedTsConfig;
  withLog?: boolean;
}

export const cachedResolveExportInNodeModules = (
  symbol: string,
  options: NodeModulesResolveOptions,
): Result<string[]> => {
  try {
    const cacheKey = options.resolvedConfig.tsConfigPath;
    let cache = cachesByTsConfig.get(cacheKey);
    if (!cache) {
      const cacheResult = createExportCache(options);
      if (!cacheResult.success) {
        return error(`Failed to create export cache: ${cacheResult.error}`);
      }
      cache = cacheResult.data;
      cachesByTsConfig.set(cacheKey, cache);
    }

    const result = cache.resolveSymbol(symbol);
    if (!result.success || result.data.length === 0) {
      return error(`Symbol "${symbol}" not found.`);
    }
    return success(result.data);
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`resolveExportInNodeModules error: ${message}`);
  }
};

export const createExportCache = (
  options: NodeModulesResolveOptions,
): Result<ExportCache> => {
  const cache = new Map<string, string[]>();
  const { anchorFile, resolvedConfig, withLog = false } = options;
  const anchorDir = dirname(anchorFile);
  const deps = collectDependencyNames(anchorDir);

  withLog && console.log(`🔍 Indexing dependencies ...`);

  const allEntries: { pkgName: string; subpath: string; filePath: string }[] =
    [];

  for (const pkgName of deps) {
    try {
      const pkgJsonPath = resolvePackageJsonPath(
        pkgName,
        anchorFile,
        resolvedConfig.parsed.options,
      );
      if (!pkgJsonPath) {
        withLog &&
          console.warn(
            `Warning: Could not find package "${pkgName}". Skipping.`,
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
      ...resolvedConfig.parsed.options,
      target: ts.ScriptTarget.ESNext,
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

/** Test helper */
export const resetExportCaches = (): void => {
  cachesByTsConfig.clear();
};

const collectDependencyNames = (startDir: string): string[] => {
  const deps = new Set<string>();
  let current = startDir;

  while (true) {
    const pkgPath = join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf8"));
        for (const name of Object.keys({
          ...pkg.dependencies,
          ...pkg.devDependencies,
        })) {
          deps.add(name);
        }
      } catch {
        // Ignore invalid package.json files while walking up.
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return [...deps];
};

const resolvePackageJsonPath = (
  pkgName: string,
  anchorFile: string,
  compilerOptions: ts.CompilerOptions,
): string | null => {
  const resolved = ts.resolveModuleName(
    pkgName,
    anchorFile,
    compilerOptions,
    ts.sys,
  );
  const resolvedFile = resolved.resolvedModule?.resolvedFileName;
  if (resolvedFile) {
    const fromResolved = findNearestPackageJson(dirname(resolvedFile), pkgName);
    if (fromResolved) {
      return fromResolved;
    }
  }

  try {
    return require.resolve(`${pkgName}/package.json`, {
      paths: [dirname(anchorFile)],
    });
  } catch {
    const fallbackPath = join(
      dirname(anchorFile),
      "node_modules",
      pkgName,
      "package.json",
    );
    if (existsSync(fallbackPath)) {
      return fallbackPath;
    }
    return null;
  }
};

const findNearestPackageJson = (
  startDir: string,
  pkgName: string,
): string | null => {
  let current = startDir;
  while (true) {
    const pkgPath = join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
        };
        if (
          pkg.name === pkgName ||
          current.endsWith(pkgName.replace("/", "\\")) ||
          current.replace(/\\/g, "/").endsWith(pkgName)
        ) {
          return pkgPath;
        }
      } catch {
        // continue walking
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
};

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
