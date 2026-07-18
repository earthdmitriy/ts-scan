import path from "path";
import { error, Result, success } from "../../types.js";

/**
 * Normalize file paths: resolve relative paths against cwd, keep absolute paths as-is.
 * Used by CLI commands for consistent path resolution from the process cwd.
 */
export const normalizePath = (filePath: string): string => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  // If starts with @ (scoped package) or no path separators, assume it's a module name, don't resolve
  if (
    filePath.startsWith("@") ||
    (!filePath.includes(path.sep) && !filePath.includes("/"))
  ) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
};

/**
 * MCP tools require absolute filesystem paths so discovery does not depend on
 * the MCP process cwd (often the user home directory).
 */
export const requireAbsolutePath = (
  filePath: string,
  paramName: string = "file_path",
): Result<string> => {
  if (!path.isAbsolute(filePath)) {
    return error(
      `${paramName} must be an absolute path. Received: "${filePath}"`,
    );
  }
  return success(filePath);
};

/**
 * Check if a specifier is a module name (vs file path)
 */
export const isModuleSpecifier = (specifier: string): boolean => {
  return (
    specifier.startsWith("@") ||
    (!specifier.includes(path.sep) && !specifier.includes("/"))
  );
};
