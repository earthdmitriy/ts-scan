import { getFileErrors } from "./tools/check/getFileErrors.js";
import { createTsMorphProject } from "./tools/createTsMorphProject.js";
import { cachedResolveExportInNodeModules } from "./tools/exportCache/exportCache.js";
import { getExportedSymbols } from "./tools/exports/getExportedSymbols.js";
import { fetchImportedSymbols } from "./tools/imports/fetchImportedSymbols.js";
import { startMcp } from "./tools/mcp/startMcp.js";
import { resolveLocalExport } from "./tools/resolve/resolveLocalExport.js";
import { error, Result, success } from "./types.js";

export const commands = [
  {
    name: "--check",
    description: "Show TypeScript errors for a file",
    action: (file: string, project: ReturnType<typeof createTsMorphProject>) =>
      getFileErrors(file, project),
  },
  {
    name: "--imports",
    description: "List all imported symbols with signatures and JSDoc",
    action: (file: string, project: ReturnType<typeof createTsMorphProject>) =>
      fetchImportedSymbols(file, project),
  },
  {
    name: "--exports",
    description: "List all exported symbols with signatures and JSDoc",
    action: (file: string, project: ReturnType<typeof createTsMorphProject>) =>
      getExportedSymbols(file, project),
  },
  {
    name: "--resolve",
    description:
      "Find the import path for a given exported symbol (optionally relative to a file)",
    action: (
      symbol: string,
      project: ReturnType<typeof createTsMorphProject>,
      relativeTo: string = ""
    ): Result<string> => {
      const localResult = resolveLocalExport(symbol, relativeTo);
      const nodeResult = cachedResolveExportInNodeModules(symbol);

      let res = "";

      localResult.success &&
        localResult.data.length > 0 &&
        localResult.data.forEach((x) => {
          res += `\n✅ Found in: ${x.path}\n   import { ${symbol} } from "${x.relative}";`;

          const exports = getExportedSymbols(x.path, project, [symbol]);
          exports.success && (res += `\n${exports.data}`);
        });

      nodeResult.success &&
        nodeResult.data.length > 0 &&
        nodeResult.data.forEach((x) => {
          res += `\n✅ Found in: ${x}\n   import { ${symbol} } from "${x}";`;

          const exports = getExportedSymbols(x, project, [symbol]);
          exports.success && (res += `\n${exports.data}`);
        });

      return res
        ? success(res)
        : error(
            "❌ Symbol not found in local files or node_modules. Consider checking for typos or if the symbol is indeed exported."
          );
    },
  },
  {
    name: "--mcp",
    description: "Start MCP server (stdio by default, --port for HTTP)",
    noExit: true,
    action: (_port: number | undefined) => {
      startMcp(_port);
      return success("");
    },
  },
  {
    name: "--help",
    description: "Display help",
    action: () => {
      const helpText = `Usage: ts-scan <command> [options] <file-or-symbol>
Commands:
  --check <file>          Show TypeScript errors for a file
  --imports <file>        List all imported symbols with signatures and JSDoc
  --exports <file>        List all exported symbols with signatures and JSDoc
  --resolve <symbol>     Find the import path for a given exported symbol
  --mcp                 Start MCP server (stdio by default, --port for HTTP)
    --port <n>           Port for HTTP server
  --help                 Display help`;
      console.log(helpText);
      return success(helpText);
    },
  },
] as const;

export const commandMap = commands.reduce((map, cmd) => {
  map[cmd.name] = cmd;
  return map;
}, {} as Record<typeof commands[number]["name"], typeof commands[number]>);
