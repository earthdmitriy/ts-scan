import path from "path";

/**
 * Normalize file paths: resolve relative paths against cwd, keep absolute paths as-is.
 * Used to ensure CLI commands and MCP server work from any directory with consistent path resolution.
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
 * Check if a specifier is a module name (vs file path)
 */
export const isModuleSpecifier = (specifier: string): boolean => {
  return (
    specifier.startsWith("@") ||
    (!specifier.includes(path.sep) && !specifier.includes("/"))
  );
};
