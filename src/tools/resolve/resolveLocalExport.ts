import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { error, Result, success } from "../../types.js";
import {
  canonicalizePath,
  collectConfiguredSearchRoots,
  collectConfiguredSourceFiles,
  ResolvedTsConfig,
} from "../resolveTsConfig.js";

export const resolveLocalExport = (
  symbolName: string,
  resolvedConfig: ResolvedTsConfig,
  relativeTo: string = "",
): Result<{ path: string; relative: string }[]> => {
  try {
    const configuredFiles = collectConfiguredSourceFiles(resolvedConfig);
    if (configuredFiles.length === 0) {
      return success([]);
    }

    const allowedFiles = new Set(
      configuredFiles.map((file) => canonicalizePath(file)),
    );
    const searchRoots = collectConfiguredSearchRoots(resolvedConfig);

    const escapedSymbol = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patternText = `export\\s+(class|function|const|let|var|interface|type|enum)\\s+${escapedSymbol}\\b|export\\s*\\{[^}]*\\b${escapedSymbol}\\b[^}]*\\}`;
    const pattern = new RegExp(patternText);

    let resultFiles = searchWithRipgrep(searchRoots, pattern);
    if (!resultFiles.success) {
      resultFiles = searchWithGrep(searchRoots, symbolName, pattern);
    }
    if (!resultFiles.success) {
      resultFiles = findFileInRoots(searchRoots, pattern);
    }

    if (!resultFiles.success) {
      return error("error searching for symbol: " + resultFiles.error);
    }

    const matchedFiles = resultFiles.data.filter((file) =>
      allowedFiles.has(canonicalizePath(file)),
    );

    const fromDir = relativeTo
      ? path.dirname(path.resolve(relativeTo))
      : resolvedConfig.configDirectory;

    const filePaths = matchedFiles.map((resultFile) => {
      const absoluteResult = path.resolve(resultFile);
      let relativePath = path
        .relative(fromDir, absoluteResult)
        .replace(/\\/g, "/");

      if (!relativePath.startsWith(".")) {
        relativePath = "./" + relativePath;
      }
      return {
        path: absoluteResult.replace(/\\/g, "/"),
        relative: relativePath.replace(/\.(ts|tsx|d\.ts)$/, ""),
      };
    });

    return success(filePaths);
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`resolveLocalExport error: ${message}`);
  }
};

const SEARCH_EXCLUDE_GLOBS = [
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.git/**",
] as const;

/** Keep below Vitest's default 5s testTimeout so hung rg fails softly. */
const RG_TIMEOUT_MS = 4_000;

export function searchWithRipgrep(
  roots: string[],
  pattern: RegExp,
): Result<string[]> {
  if (!commandExists("rg")) {
    return error("ripgrep (rg) is not available on this system");
  }
  if (roots.length === 0) {
    return success([]);
  }
  const args = [
    "-l",
    "--no-ignore",
    "--glob",
    "*.ts",
    "--glob",
    "*.tsx",
    "--glob",
    "*.d.ts",
    ...SEARCH_EXCLUDE_GLOBS.flatMap((glob) => ["--glob", glob]),
    "-e",
    pattern.source,
    ...roots,
  ];

  try {
    const result = spawnSync("rg", args, {
      encoding: "utf8",
      timeout: RG_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.error || result.status !== 0 || !result.stdout) {
      return success([]);
    }
    const files = result.stdout
      .trim()
      .split("\n")
      .filter((f) => Boolean(f) && !f.includes(".git"))
      .map((x) => x.replace(/\\/g, "/"));
    return success(files);
  } catch {
    return error("Error executing ripgrep");
  }
}

export function searchWithGrep(
  roots: string[],
  symbolName: string,
  pattern: RegExp,
): Result<string[]> {
  if (!commandExists("grep")) {
    return error("grep is not available on this system");
  }
  if (roots.length === 0) {
    return success([]);
  }

  const quotedRoots = roots.map((root) => `"${root}"`).join(" ");
  const includeFlags = "--include=*.ts --include=*.tsx --include=*.d.ts";
  const grepCmd = `grep -r -l ${includeFlags} -e "${symbolName}" ${quotedRoots}`;

  try {
    const output = execSync(grepCmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 10_000,
      windowsHide: true,
    });

    const files = output
      .trim()
      .split("\n")
      .filter((f) => Boolean(f) && !f.includes(".git"))
      .filter((filePath) => {
        try {
          const content = fs.readFileSync(filePath, "utf8");
          return pattern.test(content);
        } catch {
          return false;
        }
      })
      .map((x) => x.replace(/\\/g, "/"));
    return success(files);
  } catch {
    return success([]); // grep returns non-zero exit code when no matches found
  }
}

export function findFileInRoots(
  roots: string[],
  pattern: RegExp,
): Result<string[]> {
  const allFiles: string[] = [];
  for (const root of roots) {
    const found = findFileAll(root, pattern);
    found.success &&
      allFiles.push(...found.data.map((x) => x.replace(/\\/g, "/")));
  }
  return success(allFiles);
}

function findFileAll(dir: string, pattern: RegExp): Result<string[]> {
  const matches: string[] = [];
  if (!fs.existsSync(dir)) {
    return success(matches);
  }
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if ([".git", "dist", "build", "node_modules"].includes(dirent.name)) {
        continue;
      }
      const nested = findFileAll(fullPath, pattern);
      nested.success && matches.push(...nested.data);
    } else if (dirent.isFile() && /\.(ts|tsx|d\.ts)$/.test(dirent.name)) {
      const content = fs.readFileSync(fullPath, "utf8");
      if (pattern.test(content)) matches.push(fullPath);
    }
  }
  return success(matches);
}

function commandExists(cmd: string): boolean {
  try {
    const checkCmd = process.platform === "win32" ? "where" : "which";
    execSync(`${checkCmd} ${cmd}`, {
      stdio: "ignore",
      timeout: 2_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}
