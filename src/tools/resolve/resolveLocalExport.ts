import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { error, Result, success } from "../../types.js";

export const resolveLocalExport = (
  symbolName: string,
  relativeTo: string = ""
): Result<{ path: string; relative: string }[]> => {
  try {
    // ---------- 1. Load tsconfig ----------
    const configPath = ts.findConfigFile(
      ".",
      ts.sys.fileExists,
      "tsconfig.json"
    );
    const { config } = ts.readConfigFile(configPath!, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      path.dirname(configPath!)
    );

    // Determine search roots: project source dirs + node_modules
    let searchRoots: string[] = [];
    if (parsed.options.rootDir) searchRoots.push(parsed.options.rootDir);
    else if (parsed.options.rootDirs)
      searchRoots.push(...parsed.options.rootDirs);
    else searchRoots.push("src", "lib", "app"); // fallback

    // Always include samples fixtures for resolver tests and sample-based checks.
    searchRoots.push("samples");

    // Also include node_modules (always)
    // Exclude node_modules from search if it's the only root to avoid unnecessary scanning
    // searchRoots.push("node_modules");

    // Remove duplicates and ensure existence (node_modules may not exist in some cases)
    searchRoots = [...new Set(searchRoots)].filter((d) => fs.existsSync(d));

    const escapedSymbol = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Single, safe pattern – no line breaks, no ambiguous quantifiers
    const patternText = `export\\s+(class|function|const|let|var|interface|type|enum)\\s+${escapedSymbol}\\b|export\\s*\\{[^}]*\\b${escapedSymbol}\\b[^}]*\\}`;
    const pattern = new RegExp(patternText);

    let resultFiles = searchWithRipgrep(searchRoots, pattern);
    if (!resultFiles.success) {
      resultFiles = searchWithGrep(searchRoots, symbolName, pattern);
    }
    if (!resultFiles.success) {
      resultFiles = findFileInRoots(searchRoots, pattern);
    }

    if (!resultFiles.success)
      return error("error searching for symbol: " + resultFiles.error);

    // Compute relative import path from the requested source file or root when none is provided.
    const fromDir = relativeTo ? path.dirname(relativeTo) : process.cwd();

    const filePaths = resultFiles.data.map((resultFile) => {
      let relativePath = path.relative(fromDir, resultFile).replace(/\\/g, "/"); // rg returns paths with forward slashes even on Windows, ensure consistency

      if (!relativePath.startsWith(".")) relativePath = "./" + relativePath;
      return {
        path: resultFile,
        relative: relativePath.replace(/\.(ts|tsx|d\.ts)$/, ""),
      };
    });

    return success(filePaths);
  } catch (err) {
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    return error(`resolveLocalExport error: ${message}`);
  }
};

export function searchWithRipgrep(
  roots: string[],
  pattern: RegExp
): Result<string[]> {
  if (!commandExists("rg"))
    return error("ripgrep (rg) is not available on this system");
  const args = [
    "-l",
    "--no-ignore",
    "--glob",
    "*.ts",
    "--glob",
    "*.tsx",
    "--glob",
    "*.d.ts",
    "-e",
    pattern.source,
    ...roots,
  ];

  try {
    const result = spawnSync("rg", args, {
      encoding: "utf8",
      timeout: 10000,
    });
    if (result.status !== 0 || !result.stdout) return success([]);
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
  pattern: RegExp
): Result<string[]> {
  if (!commandExists("grep"))
    return error("grep is not available on this system");

  const quotedRoots = roots.map((root) => `"${root}"`).join(" ");
  const includeFlags = "--include=*.ts --include=*.tsx --include=*.d.ts";
  const grepCmd = `grep -r -l ${includeFlags} -e "${symbolName}" ${quotedRoots}`;

  try {
    const output = execSync(grepCmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 30000,
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
  } catch (e) {
    return success([]); // grep returns non-zero exit code when no matches found, treat as empty result
  }
}

export function findFileInRoots(
  roots: string[],
  pattern: RegExp
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
    execSync(`${checkCmd} ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
