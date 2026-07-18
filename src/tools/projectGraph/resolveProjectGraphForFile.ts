import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import ts from "typescript";
import { error, Result, success } from "../../types.js";
import {
  canonicalizePath,
  ResolvedTsConfig,
  resolveAbsolutePath,
  resolveTsConfigForFile,
} from "../resolveTsConfig.js";
import { findNearestPackageJson } from "../utils/packageMetadata.js";

export type ProjectGraphScope =
  | "owner"
  | "owner-and-dependencies"
  | "workspace"
  | "solution-wide";

export interface ProjectGraph {
  owner: ResolvedTsConfig;
  configs: ResolvedTsConfig[];
  configuredFiles: Set<string>;
  scope: ProjectGraphScope;
  notes: string[];
  truncated: boolean;
}

export interface ResolveProjectGraphOptions {
  /** When false, return only the owning package config. Default true. */
  crossPackage?: boolean;
  /** Soft cap on configs loaded into the graph. Default 50. */
  maxProjects?: number;
  /** Soft cap on configured source files tracked. Default 10000. */
  maxFiles?: number;
}

const DEFAULT_MAX_PROJECTS = 50;
const DEFAULT_MAX_FILES = 10_000;

/**
 * Build a read-only project graph for cross-package tools.
 * Serializes config/file identities only — never retain ts-morph Nodes.
 */
export const resolveProjectGraphForFile = (
  filePath: string,
  options: ResolveProjectGraphOptions = {},
): Result<ProjectGraph> => {
  const ownerResult = resolveTsConfigForFile(filePath);
  if (!ownerResult.success) {
    return error(ownerResult.error);
  }
  const owner = ownerResult.data;
  const crossPackage = options.crossPackage !== false;
  const maxProjects = options.maxProjects ?? DEFAULT_MAX_PROJECTS;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const notes: string[] = [];

  if (!crossPackage) {
    const configuredFiles = collectFilesFromConfigs([owner], maxFiles, notes);
    return success({
      owner,
      configs: [owner],
      configuredFiles,
      scope: "owner",
      notes,
      truncated: notes.some((n) => n.includes("truncated")),
    });
  }

  const solutionPath = findNearestSolutionConfig(owner.tsConfigPath);
  let scope: ProjectGraphScope;
  let rootConfigPath: string;

  if (solutionPath) {
    scope = "solution-wide";
    rootConfigPath = solutionPath;
  } else {
    scope = "owner-and-dependencies";
    rootConfigPath = owner.tsConfigPath;
    notes.push(
      "No solution tsconfig with project references found above owner; " +
        "falling back to owner-and-dependencies, then npm/pnpm workspace package edges.",
    );
  }

  const configPaths = collectConfigPaths(rootConfigPath, maxProjects, notes);
  // Always include the owner even if budgets skipped it.
  const ownerCanonical = canonicalizePath(owner.tsConfigPath);
  if (!configPaths.some((p) => canonicalizePath(p) === ownerCanonical)) {
    configPaths.unshift(owner.tsConfigPath);
  }

  const configs: ResolvedTsConfig[] = [];
  const seen = new Set<string>();
  for (const configPath of configPaths) {
    const canonical = canonicalizePath(configPath);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const loaded = loadResolvedConfig(configPath);
    if (loaded) {
      configs.push(loaded);
    }
  }

  // Prefer owner object identity / checked paths from the initial resolve.
  const ownerIdx = configs.findIndex(
    (c) => canonicalizePath(c.tsConfigPath) === ownerCanonical,
  );
  if (ownerIdx >= 0) {
    configs[ownerIdx] = owner;
  } else {
    configs.unshift(owner);
  }

  // When there is no TS solution, discover dependents via workspace package.json.
  if (!solutionPath) {
    const workspaceConfigs = discoverWorkspaceDependentConfigs(
      owner,
      maxProjects - configs.length,
      notes,
    );
    let added = 0;
    for (const loaded of workspaceConfigs) {
      const canonical = canonicalizePath(loaded.tsConfigPath);
      if (seen.has(canonical)) continue;
      if (configs.length >= maxProjects) {
        if (!notes.some((n) => n.includes("project budget"))) {
          notes.push(
            `Graph truncated: project budget (${maxProjects}) exceeded.`,
          );
        }
        break;
      }
      seen.add(canonical);
      configs.push(loaded);
      added++;
    }
    if (added > 0) {
      scope = "workspace";
      notes.push(
        `Workspace scope: included ${added} dependent package(s) via package.json dependency edges.`,
      );
    } else if (
      !notes.some((n) => n.includes("dependents may still be incomplete"))
    ) {
      notes.push(
        "No workspace dependents discovered; cross-package consumers may still be incomplete.",
      );
    }
  }

  const configuredFiles = collectFilesFromConfigs(configs, maxFiles, notes);
  const truncated = notes.some((n) => n.includes("truncated"));

  return success({
    owner,
    configs,
    configuredFiles,
    scope,
    notes,
    truncated,
  });
};

/**
 * Nearest ancestor (or self) tsconfig whose recursive project references
 * contain the owner config. Returns undefined when none exists.
 */
const findNearestSolutionConfig = (
  ownerConfigPath: string,
): string | undefined => {
  const ownerCanonical = canonicalizePath(ownerConfigPath);
  let searchPath = path.dirname(ownerConfigPath);

  while (true) {
    const configPath = ts.findConfigFile(
      searchPath,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    if (!configPath) {
      break;
    }
    const absolute = resolveAbsolutePath(configPath);
    const referenced = collectConfigPaths(absolute, DEFAULT_MAX_PROJECTS, []);
    const containsOwner = referenced.some(
      (p) => canonicalizePath(p) === ownerCanonical,
    );
    // A solution must reference the owner (possibly indirectly). Self alone
    // with no outbound references is not treated as solution-wide.
    const selfIsOwner = canonicalizePath(absolute) === ownerCanonical;
    const hasRefs = (readProjectReferences(absolute)?.length ?? 0) > 0;
    if (containsOwner && (!selfIsOwner || hasRefs)) {
      // Prefer an ancestor that references the owner over the owner itself
      // when the owner only references dependencies (not a solution root).
      if (!selfIsOwner || isSolutionLike(absolute, ownerCanonical)) {
        return absolute;
      }
    }

    const configDir = path.dirname(absolute);
    const parentDir = path.dirname(configDir);
    if (parentDir === configDir) {
      break;
    }
    searchPath = parentDir;
  }

  return undefined;
};

/**
 * True when this config looks like a solution root for the owner:
 * it references the owner (or equals owner and has references that form a
 * multi-package graph). Leaf packages with only dependency refs are not
 * solution roots.
 */
const isSolutionLike = (
  configPath: string,
  ownerCanonical: string,
): boolean => {
  const absolute = resolveAbsolutePath(configPath);
  const canonical = canonicalizePath(absolute);
  if (canonical !== ownerCanonical) {
    return true;
  }
  // Owner itself: only solution-like if it has references AND at least one
  // referenced project is not purely a dependency leaf used by owner alone.
  // In practice, solution roots often have `"files": []` and only references.
  const parsed = parseConfig(absolute);
  if (!parsed) return false;
  const refs = parsed.projectReferences ?? [];
  if (refs.length === 0) return false;
  const fileCount = parsed.fileNames.filter(
    (f) => !f.includes(`${path.sep}node_modules${path.sep}`),
  ).length;
  // Heuristic: empty/near-empty file list + references ⇒ solution root.
  return fileCount === 0;
};

const collectConfigPaths = (
  rootConfigPath: string,
  maxProjects: number,
  notes: string[],
): string[] => {
  const result: string[] = [];
  const visited = new Set<string>();

  const visit = (configPath: string) => {
    const absolute = resolveAbsolutePath(configPath);
    const canonical = canonicalizePath(absolute);
    if (visited.has(canonical)) return;
    visited.add(canonical);

    if (result.length >= maxProjects) {
      if (!notes.some((n) => n.includes("project budget"))) {
        notes.push(
          `Graph truncated: project budget (${maxProjects}) exceeded.`,
        );
      }
      return;
    }
    result.push(absolute);

    for (const refPath of readProjectReferences(absolute) ?? []) {
      visit(refPath);
    }
  };

  visit(rootConfigPath);
  return result;
};

const readProjectReferences = (configPath: string): string[] | undefined => {
  const parsed = parseConfig(configPath);
  if (!parsed) return undefined;
  const refs: string[] = [];
  for (const ref of parsed.projectReferences ?? []) {
    const refPath = resolveReferenceConfigPath(ref, configPath);
    if (refPath) refs.push(refPath);
  }
  return refs;
};

const parseConfig = (configPath: string): ts.ParsedCommandLine | undefined => {
  if (!existsSync(configPath)) return undefined;
  const { config, error: readError } = ts.readConfigFile(
    configPath,
    ts.sys.readFile,
  );
  if (readError) return undefined;
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  if (parsed.errors.length > 0) return undefined;
  return parsed;
};

const resolveReferenceConfigPath = (
  ref: ts.ProjectReference,
  fromConfigPath: string,
): string | undefined => {
  const resolved = ts.resolveProjectReferencePath(ref);
  if (resolved) {
    const absolute = path.isAbsolute(resolved)
      ? resolved
      : path.resolve(path.dirname(fromConfigPath), resolved);
    return resolveAbsolutePath(absolute);
  }

  const candidate = path.resolve(path.dirname(fromConfigPath), ref.path);
  if (existsSync(candidate) && candidate.endsWith(".json")) {
    return resolveAbsolutePath(candidate);
  }
  const asDir = path.join(candidate, "tsconfig.json");
  if (existsSync(asDir)) {
    return resolveAbsolutePath(asDir);
  }
  return undefined;
};

const loadResolvedConfig = (configPath: string): ResolvedTsConfig | null => {
  const parsed = parseConfig(configPath);
  if (!parsed) return null;
  return {
    tsConfigPath: resolveAbsolutePath(configPath),
    configDirectory: path.dirname(resolveAbsolutePath(configPath)),
    parsed,
    checkedConfigPaths: [resolveAbsolutePath(configPath)],
  };
};

const collectFilesFromConfigs = (
  configs: ResolvedTsConfig[],
  maxFiles: number,
  notes: string[],
): Set<string> => {
  const files = new Set<string>();
  for (const config of configs) {
    for (const fileName of config.parsed.fileNames) {
      const normalized = path.normalize(fileName);
      if (normalized.includes(`${path.sep}node_modules${path.sep}`)) {
        continue;
      }
      if (files.size >= maxFiles) {
        if (!notes.some((n) => n.includes("file budget"))) {
          notes.push(`Graph truncated: file budget (${maxFiles}) exceeded.`);
        }
        return files;
      }
      files.add(canonicalizePath(normalized));
    }
  }
  return files;
};

interface WorkspacePackage {
  name: string | null;
  directory: string;
  dependencies: Set<string>;
}

/**
 * Find packages in the npm/pnpm workspace that depend on the owner package
 * and load their nearest tsconfig.
 */
const discoverWorkspaceDependentConfigs = (
  owner: ResolvedTsConfig,
  remainingBudget: number,
  notes: string[],
): ResolvedTsConfig[] => {
  if (remainingBudget <= 0) return [];

  const ownerPkg = findNearestPackageJson(owner.tsConfigPath);
  if (!ownerPkg?.name) {
    return [];
  }

  const workspaceRoot = findWorkspaceRoot(ownerPkg.directory);
  if (!workspaceRoot) {
    notes.push(
      "No npm/pnpm workspace root (package.json#workspaces / pnpm-workspace.yaml) found above owner.",
    );
    return [];
  }

  const packages = listWorkspacePackages(workspaceRoot);
  if (packages.length === 0) {
    return [];
  }

  const result: ResolvedTsConfig[] = [];
  for (const pkg of packages) {
    if (result.length >= remainingBudget) break;
    if (!pkg.name || pkg.name === ownerPkg.name) continue;
    if (!pkg.dependencies.has(ownerPkg.name)) continue;

    const tsconfigPath = findPackageTsConfig(pkg.directory);
    if (!tsconfigPath) continue;
    const loaded = loadResolvedConfig(tsconfigPath);
    if (loaded) {
      result.push(loaded);
    }
  }
  return result;
};

const findWorkspaceRoot = (startDir: string): string | undefined => {
  let current = path.resolve(startDir);
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
          workspaces?: string[] | { packages?: string[] };
        };
        const patterns = normalizeWorkspacePatterns(pkg.workspaces);
        if (patterns.length > 0) {
          return current;
        }
      } catch {
        // ignore invalid package.json
      }
    }
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
};

const listWorkspacePackages = (workspaceRoot: string): WorkspacePackage[] => {
  const patterns = readWorkspacePatterns(workspaceRoot);
  const directories = new Set<string>();
  for (const pattern of patterns) {
    for (const dir of expandWorkspacePattern(workspaceRoot, pattern)) {
      directories.add(dir);
    }
  }

  const packages: WorkspacePackage[] = [];
  for (const directory of directories) {
    const packageJsonPath = path.join(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const dependencies = new Set<string>([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
      packages.push({
        name:
          typeof pkg.name === "string" && pkg.name.length > 0
            ? pkg.name
            : null,
        directory,
        dependencies,
      });
    } catch {
      // skip invalid package
    }
  }
  return packages;
};

const readWorkspacePatterns = (workspaceRoot: string): string[] => {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      const fromPkg = normalizeWorkspacePatterns(pkg.workspaces);
      if (fromPkg.length > 0) return fromPkg;
    } catch {
      // fall through to pnpm
    }
  }

  const pnpmPath = path.join(workspaceRoot, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    return parsePnpmWorkspacePackages(readFileSync(pnpmPath, "utf-8"));
  }
  return [];
};

const normalizeWorkspacePatterns = (
  workspaces: string[] | { packages?: string[] } | undefined,
): string[] => {
  if (!workspaces) return [];
  if (Array.isArray(workspaces)) {
    return workspaces.filter((p): p is string => typeof p === "string");
  }
  if (Array.isArray(workspaces.packages)) {
    return workspaces.packages.filter(
      (p): p is string => typeof p === "string",
    );
  }
  return [];
};

const parsePnpmWorkspacePackages = (yaml: string): string[] => {
  const patterns: string[] = [];
  let inPackages = false;
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "packages:") {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (!line.startsWith("-")) {
      inPackages = false;
      continue;
    }
    const value = line
      .slice(1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (value) patterns.push(value);
  }
  return patterns;
};

const expandWorkspacePattern = (
  workspaceRoot: string,
  pattern: string,
): string[] => {
  const normalized = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/*")) {
    const parent = path.resolve(
      workspaceRoot,
      normalized.slice(0, -2),
    );
    if (!existsSync(parent)) return [];
    try {
      return readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(parent, entry.name));
    } catch {
      return [];
    }
  }
  const exact = path.resolve(workspaceRoot, normalized);
  return existsSync(exact) ? [exact] : [];
};

const findPackageTsConfig = (packageDir: string): string | undefined => {
  const candidates = [
    path.join(packageDir, "tsconfig.json"),
    path.join(packageDir, "src", "tsconfig.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return resolveAbsolutePath(candidate);
    }
  }
  return undefined;
};
