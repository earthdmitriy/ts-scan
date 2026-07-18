import { existsSync, readFileSync } from "fs";
import path from "path";
import { canonicalizePath } from "../resolveTsConfig.js";

export interface PackageJsonInfo {
  name: string | null;
  directory: string;
  packageJsonPath: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  types?: string;
  typings?: string;
  main?: string;
}

/**
 * Walk up from a file and return the nearest package.json metadata, if any.
 */
export const findNearestPackageJson = (
  filePath: string,
): PackageJsonInfo | null => {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
          name?: string;
          exports?: unknown;
          bin?: string | Record<string, string>;
          types?: string;
          typings?: string;
          main?: string;
        };
        return {
          name:
            typeof pkg.name === "string" && pkg.name.length > 0
              ? pkg.name
              : null,
          directory: current,
          packageJsonPath,
          exports: pkg.exports,
          bin: pkg.bin,
          types: pkg.types,
          typings: pkg.typings,
          main: pkg.main,
        };
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

/**
 * Walk up from a file and return the nearest package.json "name", if any.
 */
export const findNearestPackageName = (filePath: string): string | null => {
  return findNearestPackageJson(filePath)?.name ?? null;
};

/**
 * True when two files belong to different named packages.
 */
export const areDifferentPackages = (fileA: string, fileB: string): boolean => {
  const a = findNearestPackageName(fileA);
  const b = findNearestPackageName(fileB);
  return !!a && !!b && a !== b;
};

/**
 * True when `filePath` is a resolved target of package.json#exports / main /
 * types for the nearest package.
 */
export const isPackageExportsEntryFile = (filePath: string): boolean => {
  const pkg = findNearestPackageJson(filePath);
  if (!pkg) return false;
  const canonical = canonicalizePath(filePath);
  return collectPackageEntryFiles(pkg).some(
    (candidate) => canonicalizePath(candidate) === canonical,
  );
};

/**
 * True when `filePath` is a resolved target of package.json#bin.
 */
export const isPackageBinEntryFile = (filePath: string): boolean => {
  const pkg = findNearestPackageJson(filePath);
  if (!pkg?.bin) return false;
  const canonical = canonicalizePath(filePath);
  const binTargets =
    typeof pkg.bin === "string"
      ? [pkg.bin]
      : Object.values(pkg.bin).filter(
          (value): value is string => typeof value === "string",
        );
  return binTargets.some((rel) => {
    const absolute = path.resolve(pkg.directory, rel);
    return canonicalizePath(absolute) === canonical;
  });
};

/**
 * Best-effort recommended public package import when declaration is
 * cross-package relative to the query file. Returns undefined when uncertain.
 */
export const getRecommendedPackageImport = (
  queryFile: string,
  declarationFile: string,
): string | undefined => {
  if (!areDifferentPackages(queryFile, declarationFile)) {
    return undefined;
  }

  const pkg = findNearestPackageJson(declarationFile);
  if (!pkg?.name) {
    return undefined;
  }

  if (!isDeclarationCoveredByPackageExports(pkg, declarationFile)) {
    return undefined;
  }

  return pkg.name;
};

const isDeclarationCoveredByPackageExports = (
  pkg: PackageJsonInfo,
  declarationFile: string,
): boolean => {
  const canonicalDecl = canonicalizePath(declarationFile);
  const candidates = collectPackageEntryFiles(pkg);
  if (candidates.length === 0) {
    // Named package without exports: only accept files under package root
    // when they are TypeScript sources (best-effort workspace layout).
    const underPackage =
      canonicalizePath(declarationFile).startsWith(
        canonicalizePath(pkg.directory) + path.sep,
      ) ||
      canonicalizePath(declarationFile) === canonicalizePath(pkg.directory);
    return underPackage && /\.(tsx?|d\.ts)$/i.test(declarationFile);
  }

  return candidates.some(
    (candidate) => canonicalizePath(candidate) === canonicalDecl,
  );
};

const collectPackageEntryFiles = (pkg: PackageJsonInfo): string[] => {
  const files: string[] = [];
  const pushRelative = (rel: string | undefined) => {
    if (!rel || typeof rel !== "string") return;
    const absolute = path.resolve(pkg.directory, rel);
    if (existsSync(absolute)) {
      files.push(absolute);
    }
  };

  pushRelative(pkg.types);
  pushRelative(pkg.typings);
  pushRelative(pkg.main);

  const rootExport = getRootExportTarget(pkg.exports);
  if (typeof rootExport === "string") {
    pushRelative(rootExport);
  } else if (rootExport && typeof rootExport === "object") {
    const map = rootExport as Record<string, unknown>;
    for (const key of ["types", "import", "require", "default"]) {
      const value = map[key];
      if (typeof value === "string") {
        pushRelative(value);
      } else if (value && typeof value === "object") {
        const nested = value as Record<string, unknown>;
        if (typeof nested.types === "string") {
          pushRelative(nested.types);
        }
        if (typeof nested.default === "string") {
          pushRelative(nested.default);
        }
      }
    }
  }

  return files;
};

const getRootExportTarget = (exportsField: unknown): unknown => {
  if (!exportsField) return undefined;
  if (typeof exportsField === "string") return exportsField;
  if (typeof exportsField !== "object") return undefined;
  const map = exportsField as Record<string, unknown>;
  return map["."] ?? map["./"];
};
