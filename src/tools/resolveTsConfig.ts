import { existsSync, readdirSync, realpathSync } from "fs";
import path from "path";
import ts from "typescript";
import { error, Result, success } from "../types.js";

export interface ResolvedTsConfig {
  tsConfigPath: string;
  configDirectory: string;
  parsed: ts.ParsedCommandLine;
  checkedConfigPaths: string[];
}

/**
 * Resolve a path to an absolute real path suitable for filesystem APIs.
 */
export const resolveAbsolutePath = (filePath: string): string => {
  const absolute = path.resolve(filePath);
  try {
    if (existsSync(absolute)) {
      return path.normalize(realpathSync(absolute));
    }
  } catch {
    // Keep resolved absolute path when realpath fails.
  }
  return path.normalize(absolute);
};

/**
 * Canonicalize a filesystem path for stable comparisons across Windows casing
 * and path separators.
 */
export const canonicalizePath = (filePath: string): string => {
  const resolved = resolveAbsolutePath(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const parseTsConfig = (configPath: string): Result<ts.ParsedCommandLine> => {
  const { config, error: readError } = ts.readConfigFile(
    configPath,
    ts.sys.readFile,
  );
  if (readError) {
    return error(
      `Failed to read ${configPath}: ${ts.flattenDiagnosticMessageText(readError.messageText, "\n")}`,
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  if (parsed.errors.length > 0) {
    const details = parsed.errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("\n");
    return error(`Failed to parse ${configPath}: ${details}`);
  }

  return success(parsed);
};

const includesFile = (
  parsed: ts.ParsedCommandLine,
  canonicalFile: string,
): boolean => {
  return parsed.fileNames.some(
    (fileName) => canonicalizePath(fileName) === canonicalFile,
  );
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

const tryConfigTree = (
  configPath: string,
  canonicalFile: string,
  visited: Set<string>,
  checkedConfigPaths: string[],
): Result<ResolvedTsConfig | null> => {
  const absoluteConfig = resolveAbsolutePath(configPath);
  const canonicalConfig = canonicalizePath(absoluteConfig);
  if (visited.has(canonicalConfig)) {
    return success(null);
  }
  visited.add(canonicalConfig);
  checkedConfigPaths.push(absoluteConfig);

  const parsedResult = parseTsConfig(absoluteConfig);
  if (!parsedResult.success) {
    return error(parsedResult.error);
  }
  const parsed = parsedResult.data;

  if (includesFile(parsed, canonicalFile)) {
    return success({
      tsConfigPath: absoluteConfig,
      configDirectory: path.dirname(absoluteConfig),
      parsed,
      checkedConfigPaths: [...checkedConfigPaths],
    });
  }

  for (const ref of parsed.projectReferences ?? []) {
    const refConfigPath = resolveReferenceConfigPath(ref, absoluteConfig);
    if (!refConfigPath) {
      continue;
    }
    const nested = tryConfigTree(
      refConfigPath,
      canonicalFile,
      visited,
      checkedConfigPaths,
    );
    if (!nested.success) {
      return nested;
    }
    if (nested.data) {
      return nested;
    }
  }

  return success(null);
};

/**
 * Resolve the configured TypeScript project that includes the given file.
 * Walks ancestor tsconfig.json files and their project references.
 * Returns an error when no configured project includes the file.
 */
export const resolveTsConfigForFile = (
  filePath: string,
): Result<ResolvedTsConfig> => {
  const absoluteFile = resolveAbsolutePath(filePath);
  const fileExists = existsSync(absoluteFile);
  const canonicalFile = canonicalizePath(absoluteFile);
  const checkedConfigPaths: string[] = [];
  const visited = new Set<string>();

  let searchPath = path.dirname(absoluteFile);
  let sawAnyTsConfig = false;

  while (true) {
    const configPath = ts.findConfigFile(
      searchPath,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    if (!configPath) {
      break;
    }
    sawAnyTsConfig = true;

    const absoluteConfig = resolveAbsolutePath(configPath);
    const found = tryConfigTree(
      absoluteConfig,
      canonicalFile,
      visited,
      checkedConfigPaths,
    );
    if (!found.success) {
      return found;
    }
    if (found.data) {
      return success(found.data);
    }

    const configDir = path.dirname(absoluteConfig);
    const parentDir = path.dirname(configDir);
    if (parentDir === configDir) {
      break;
    }
    searchPath = parentDir;
  }

  const nearest =
    checkedConfigPaths.length > 0 ? checkedConfigPaths[0] : "(none)";
  const checked =
    checkedConfigPaths.length > 0 ? checkedConfigPaths.join(", ") : "(none)";

  if (!sawAnyTsConfig) {
    return error(
      `No tsconfig.json found above "${path.dirname(absoluteFile)}".`,
    );
  }

  if (!fileExists) {
    const siblingHint = formatNearestSiblingHint(absoluteFile);
    return error(
      `File does not exist: "${absoluteFile}". Nearest tsconfig searched: ${nearest}.${siblingHint}`,
    );
  }

  return error(
    `File exists but is not included by any configured TypeScript project (excluded or outside include). Checked: ${checked}`,
  );
};

const formatNearestSiblingHint = (absoluteFile: string): string => {
  const dir = path.dirname(absoluteFile);
  if (!existsSync(dir)) {
    return "";
  }
  try {
    const missingBase = path
      .basename(absoluteFile)
      .replace(/\.(tsx?|d\.ts)$/i, "")
      .toLowerCase();
    const allTs = readdirSync(dir).filter(
      (name) => name.endsWith(".ts") || name.endsWith(".tsx"),
    );
    if (allTs.length === 0) {
      return "";
    }
    const scored = allTs
      .map((name) => {
        const base = name.replace(/\.(tsx?|d\.ts)$/i, "").toLowerCase();
        let score = 0;
        if (base.includes(missingBase) || missingBase.includes(base)) {
          score += 100;
        }
        for (const token of missingBase.split(/[-_.]/).filter(Boolean)) {
          if (token.length >= 3 && base.includes(token)) {
            score += 10;
          }
        }
        return { name, score };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const siblings = scored.slice(0, 5).map((x) => x.name);
    const more = scored.length > siblings.length ? ", ..." : "";
    return ` Nearest under ${dir}/: ${siblings.join(", ")}${more}.`;
  } catch {
    return "";
  }
};

/**
 * Resolve a tsconfig for CLI --resolve without --relative-to.
 * Uses PROJECT_ROOT or cwd and accepts the nearest config without file matching.
 */
export const resolveTsConfigAtRoot = (
  rootDir: string = process.env.PROJECT_ROOT ?? process.cwd(),
): Result<ResolvedTsConfig> => {
  const absoluteRoot = path.resolve(rootDir);
  const configPath = ts.findConfigFile(
    absoluteRoot,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath) {
    return error(
      `Cannot find tsconfig.json at or above ${absoluteRoot}. Pass --relative-to <file> or set PROJECT_ROOT.`,
    );
  }

  const absoluteConfig = resolveAbsolutePath(configPath);
  const parsedResult = parseTsConfig(absoluteConfig);
  if (!parsedResult.success) {
    return error(parsedResult.error);
  }

  return success({
    tsConfigPath: absoluteConfig,
    configDirectory: path.dirname(absoluteConfig),
    parsed: parsedResult.data,
    checkedConfigPaths: [absoluteConfig],
  });
};

/**
 * Collect absolute source file paths from a config and its project references.
 */
export const collectConfiguredSourceFiles = (
  resolved: ResolvedTsConfig,
): string[] => {
  const files = new Set<string>();
  visitConfiguredProjects(resolved.tsConfigPath, (absoluteConfig, parsed) => {
    for (const fileName of parsed.fileNames) {
      const normalized = path.normalize(fileName);
      if (normalized.includes(`${path.sep}node_modules${path.sep}`)) {
        continue;
      }
      files.add(normalized);
    }
  });
  return [...files];
};

/**
 * Collect config directories for a project and its references (search roots).
 */
export const collectConfiguredSearchRoots = (
  resolved: ResolvedTsConfig,
): string[] => {
  const roots = new Set<string>();
  visitConfiguredProjects(resolved.tsConfigPath, (absoluteConfig) => {
    roots.add(path.dirname(absoluteConfig));
  });
  return [...roots];
};

const visitConfiguredProjects = (
  configPath: string,
  visitor: (absoluteConfig: string, parsed: ts.ParsedCommandLine) => void,
): void => {
  const visited = new Set<string>();

  const visit = (nextConfigPath: string) => {
    const absoluteConfig = resolveAbsolutePath(nextConfigPath);
    const canonical = canonicalizePath(absoluteConfig);
    if (visited.has(canonical)) {
      return;
    }
    visited.add(canonical);

    const parsedResult = parseTsConfig(absoluteConfig);
    if (!parsedResult.success) {
      return;
    }

    visitor(absoluteConfig, parsedResult.data);

    for (const ref of parsedResult.data.projectReferences ?? []) {
      const refConfigPath = resolveReferenceConfigPath(ref, absoluteConfig);
      if (refConfigPath) {
        visit(refConfigPath);
      }
    }
  };

  visit(configPath);
};
