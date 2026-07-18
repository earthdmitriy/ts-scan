import { Project } from "ts-morph";
import { getFileErrors } from "./tools/check/getFileErrors.js";
import {
  DiagnosticCodeFilter,
  DiagnosticSeverity,
  getDiagnostics,
} from "./tools/diagnostics/getDiagnostics.js";
import { getExportedSymbols } from "./tools/exports/getExportedSymbols.js";
import { fetchImportedSymbols } from "./tools/imports/fetchImportedSymbols.js";
import { findCallers } from "./tools/findCallers/findCallers.js";
import { findReferences } from "./tools/findReferences/findReferences.js";
import { goToDefinition } from "./tools/goToDefinition/goToDefinition.js";
import { inspectPosition } from "./tools/inspect/inspectPosition.js";
import { startMcp } from "./tools/mcp/startMcp.js";
import {
  EntrypointKind,
  reachability,
} from "./tools/reachability/reachability.js";
import { resolveSymbol } from "./tools/resolve/resolveSymbol.js";
import { ResolvedTsConfig } from "./tools/resolveTsConfig.js";
import { getSignatureHelp } from "./tools/signatureHelp/getSignatureHelp.js";
import { error, Result, success } from "./types.js";

export const commands = [
  {
    name: "--check",
    description: "Show TypeScript errors for a file",
    action: (file: string, project: Project) => getFileErrors(file, project),
  },
  {
    name: "--imports",
    description: "List all imported symbols with signatures and JSDoc",
    action: (file: string, project: Project) =>
      fetchImportedSymbols(file, project),
  },
  {
    name: "--exports",
    description: "List all exported symbols with signatures and JSDoc",
    action: (file: string, project: Project) =>
      getExportedSymbols(file, project),
  },
  {
    name: "--resolve",
    description:
      "Find the import path for a given exported symbol (optionally relative to a file)",
    action: (
      symbol: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      relativeTo: string,
    ): Result<string> => {
      const result = resolveSymbol(symbol, project, resolvedConfig, relativeTo);
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--inspect",
    description:
      "Inspect the TypeScript symbol/type at a file position (line/column)",
    action: (
      file: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      line: number,
      column: number | undefined,
      compact: boolean,
    ): Result<string> => {
      const result = inspectPosition(
        { filePath: file, line, column, compact },
        project,
        resolvedConfig,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--definition",
    description:
      "Go to the TypeScript definition at a file position (line/column)",
    action: (
      file: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      line: number,
      column: number | undefined,
    ): Result<string> => {
      const result = goToDefinition(
        { filePath: file, line, column },
        project,
        resolvedConfig,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--references",
    description:
      "Find TypeScript-identity references at a file position (line/column)",
    action: (
      file: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      line: number,
      column: number | undefined,
      includeDeclaration: boolean,
      crossPackage: boolean,
      includeTests: boolean,
      maxResults: number | undefined,
    ): Result<string> => {
      const result = findReferences(
        {
          filePath: file,
          line,
          column,
          includeDeclaration,
          crossPackage,
          includeTests,
          maxResults,
        },
        project,
        resolvedConfig,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--references-symbol",
    description:
      "Find TypeScript-identity references for an exported symbol name",
    action: (
      symbol: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      relativeTo: string,
      includeDeclaration: boolean,
      crossPackage: boolean,
      includeTests: boolean,
      maxResults: number | undefined,
    ): Result<string> => {
      const result = findReferences(
        {
          symbol,
          relativeTo,
          includeDeclaration,
          crossPackage,
          includeTests,
          maxResults,
        },
        project,
        resolvedConfig,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--diagnostics",
    description:
      "Show TypeScript diagnostics for a file or range (severity/codes filters)",
    action: (
      file: string,
      project: Project,
      _resolvedConfig: ResolvedTsConfig,
      startLine: number | undefined,
      endLine: number | undefined,
      startColumn: number | undefined,
      endColumn: number | undefined,
      severity: DiagnosticSeverity,
      codes: DiagnosticCodeFilter | undefined,
    ): Result<string> => {
      const result = getDiagnostics(
        {
          filePath: file,
          startLine,
          endLine,
          startColumn,
          endColumn,
          severity,
          codes,
        },
        project,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--signature-help",
    description:
      "Show active signature and argument index at a call-site position",
    action: (
      file: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      line: number,
      column: number,
    ): Result<string> => {
      const result = getSignatureHelp(
        { filePath: file, line, column },
        project,
        resolvedConfig,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--callers",
    description:
      "Find static callers of a callable at a file position (line/column)",
    action: (
      file: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      line: number,
      column: number | undefined,
      maxDepth: number | undefined,
      crossPackage: boolean,
      includeTests: boolean,
      maxResults: number | undefined,
    ): Result<string> => {
      const result = findCallers(
        {
          filePath: file,
          line,
          column,
          maxDepth,
          crossPackage,
          includeTests,
          maxResults,
        },
        project,
        resolvedConfig,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--callers-symbol",
    description: "Find static callers of an exported callable symbol name",
    action: (
      symbol: string,
      project: Project,
      resolvedConfig: ResolvedTsConfig,
      relativeTo: string,
      maxDepth: number | undefined,
      crossPackage: boolean,
      includeTests: boolean,
      maxResults: number | undefined,
    ): Result<string> => {
      const result = findCallers(
        {
          symbol,
          relativeTo,
          maxDepth,
          crossPackage,
          includeTests,
          maxResults,
        },
        project,
        resolvedConfig,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
    },
  },
  {
    name: "--reachability",
    description:
      "Find static paths from entrypoints to a callable (exports/tests/handlers/bins)",
    action: (
      file: string,
      project: Project,
      _resolvedConfig: ResolvedTsConfig,
      line: number,
      column: number | undefined,
      maxDepth: number | undefined,
      maxPaths: number | undefined,
      entrypointKinds: EntrypointKind[] | undefined,
    ): Result<string> => {
      const result = reachability(
        {
          filePath: file,
          line,
          column,
          maxDepth,
          maxPaths,
          entrypointKinds,
        },
        project,
      );
      return result.success
        ? success(result.data.formattedOutput)
        : error(result.error);
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
  --inspect <file> --line <n> [--column <n>] [--full]
                          Inspect symbol/type at a 1-based position
  --definition <file> --line <n> [--column <n>]
                          Go to definition at a 1-based position
  --references <file> --line <n> [--column <n>]
                       [--no-include-declaration] [--no-cross-package]
                       [--no-include-tests] [--max-results <n>]
                          Find references at a 1-based position
  --references-symbol <name> --relative-to <file>
                       [--no-include-declaration] [--no-cross-package]
                       [--no-include-tests] [--max-results <n>]
                          Find references for an exported symbol name
  --diagnostics <file> [--start-line <n>] [--end-line <n>]
                       [--start-column <n>] [--end-column <n>]
                       [--severity error|warning|all]
                       [--include-codes <n,n>] [--exclude-codes <n,n>]
                          Show diagnostics for a file or range (default: errors)
  --signature-help <file> --line <n> --column <n>
                          Show active signature/parameter at a call site
  --callers <file> --line <n> [--column <n>]
                       [--max-depth <n>] [--no-cross-package]
                       [--no-include-tests] [--max-results <n>]
                          Find static callers at a 1-based position
  --callers-symbol <name> --relative-to <file>
                       [--max-depth <n>] [--no-cross-package]
                       [--no-include-tests] [--max-results <n>]
                          Find static callers for an exported callable
  --reachability <file> --line <n> [--column <n>]
                       [--max-depth <n>] [--max-paths <n>]
                       [--entrypoint-kinds export,test,handler,bin,unknown]
                          Static paths from entrypoints to a callable
  --mcp                 Start MCP server (stdio by default, --port for HTTP)
    --port <n>           Port for HTTP server
  --help                 Display help`;
      console.log(helpText);
      return success(helpText);
    },
  },
] as const;

export const commandMap = commands.reduce(
  (map, cmd) => {
    map[cmd.name] = cmd;
    return map;
  },
  {} as Record<(typeof commands)[number]["name"], (typeof commands)[number]>,
);
