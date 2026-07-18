import { exit } from "node:process";
import path from "path";
import { commandMap } from "./commands.js";
import {
  getTsMorphProjectAtRoot,
  getTsMorphProjectForFile,
} from "./tools/getTsMorphProject.js";
import { parseCliFlags } from "./tools/utils/cliFlags.js";
import { normalizePath } from "./tools/utils/pathUtils.js";
import { error, Result } from "./types.js";

const printResult = (result: Result<string>) => {
  if (result.success) {
    console.log(result.data);
  } else {
    console.error(result.error);
  }
};

const parseArgs = (args: string[]) => {
  const toExecute: (() => Result<string>)[] = [];
  let noExit = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as keyof typeof commandMap;

    if (commandMap[arg]) {
      const cmd = commandMap[arg];

      if (
        cmd.name === "--check" ||
        cmd.name === "--imports" ||
        cmd.name === "--exports"
      ) {
        const filePath = args[i + 1];
        if (filePath) {
          const normalizedPath = normalizePath(filePath);
          toExecute.push(() => {
            const projectResult = getTsMorphProjectForFile(normalizedPath);
            if (!projectResult.success) {
              return error(projectResult.error);
            }
            return cmd.action(normalizedPath, projectResult.data.project);
          });
          i++;
        } else {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        }
      } else if (cmd.name === "--resolve") {
        const symbolName = args[i + 1];
        if (symbolName && !symbolName.startsWith("--")) {
          if (args[i + 2] === "--relative-to") {
            const relativeFile = args[i + 3];
            if (relativeFile) {
              const normalizedPath = normalizePath(relativeFile);
              toExecute.push(() => {
                const projectResult = getTsMorphProjectForFile(normalizedPath);
                if (!projectResult.success) {
                  return error(projectResult.error);
                }
                return cmd.action(
                  symbolName,
                  projectResult.data.project,
                  projectResult.data.resolved,
                  normalizedPath,
                );
              });
              i += 3;
            } else {
              console.error(
                `Error: --relative-to requires a file path argument.`,
              );
              i++;
            }
          } else {
            toExecute.push(() => {
              const projectResult = getTsMorphProjectAtRoot();
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              const relativeTo = path.join(
                projectResult.data.resolved.configDirectory,
                "index.ts",
              );
              return cmd.action(
                symbolName,
                projectResult.data.project,
                projectResult.data.resolved,
                relativeTo,
              );
            });
            i++;
          }
        } else {
          console.error(`Error: ${cmd.name} requires a symbol name argument.`);
        }
      } else if (cmd.name === "--inspect") {
        const filePath = args[i + 1];
        if (!filePath || filePath.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "line", type: "integer", required: true, min: 1 },
            { name: "column", type: "integer", min: 1 },
            { name: "full", type: "boolean" },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const line = parsed.data.flags.line as number;
            const column = parsed.data.flags.column as number | undefined;
            const compact = parsed.data.flags.full !== true;
            const normalizedPath = normalizePath(filePath);
            toExecute.push(() => {
              const projectResult = getTsMorphProjectForFile(normalizedPath);
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              return cmd.action(
                normalizedPath,
                projectResult.data.project,
                projectResult.data.resolved,
                line,
                column,
                compact,
              );
            });
          }
        }
      } else if (cmd.name === "--definition") {
        const filePath = args[i + 1];
        if (!filePath || filePath.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "line", type: "integer", required: true, min: 1 },
            { name: "column", type: "integer", min: 1 },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const line = parsed.data.flags.line as number;
            const column = parsed.data.flags.column as number | undefined;
            const normalizedPath = normalizePath(filePath);
            toExecute.push(() => {
              const projectResult = getTsMorphProjectForFile(normalizedPath);
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              return cmd.action(
                normalizedPath,
                projectResult.data.project,
                projectResult.data.resolved,
                line,
                column,
              );
            });
          }
        }
      } else if (cmd.name === "--references") {
        const filePath = args[i + 1];
        if (!filePath || filePath.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "line", type: "integer", required: true, min: 1 },
            { name: "column", type: "integer", min: 1 },
            { name: "no-include-declaration", type: "boolean" },
            { name: "no-cross-package", type: "boolean" },
            { name: "no-include-tests", type: "boolean" },
            { name: "max-results", type: "integer", min: 1, max: 1000 },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const line = parsed.data.flags.line as number;
            const column = parsed.data.flags.column as number | undefined;
            const includeDeclaration =
              parsed.data.flags["no-include-declaration"] !== true;
            const crossPackage = parsed.data.flags["no-cross-package"] !== true;
            const includeTests = parsed.data.flags["no-include-tests"] !== true;
            const maxResults = parsed.data.flags["max-results"] as
              | number
              | undefined;
            const normalizedPath = normalizePath(filePath);
            toExecute.push(() => {
              const projectResult = getTsMorphProjectForFile(normalizedPath);
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              return cmd.action(
                normalizedPath,
                projectResult.data.project,
                projectResult.data.resolved,
                line,
                column,
                includeDeclaration,
                crossPackage,
                includeTests,
                maxResults,
              );
            });
          }
        }
      } else if (cmd.name === "--references-symbol") {
        const symbolName = args[i + 1];
        if (!symbolName || symbolName.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a symbol name argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "relative-to", type: "string", required: true },
            { name: "no-include-declaration", type: "boolean" },
            { name: "no-cross-package", type: "boolean" },
            { name: "no-include-tests", type: "boolean" },
            { name: "max-results", type: "integer", min: 1, max: 1000 },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const relativeTo = normalizePath(
              parsed.data.flags["relative-to"] as string,
            );
            const includeDeclaration =
              parsed.data.flags["no-include-declaration"] !== true;
            const crossPackage = parsed.data.flags["no-cross-package"] !== true;
            const includeTests = parsed.data.flags["no-include-tests"] !== true;
            const maxResults = parsed.data.flags["max-results"] as
              | number
              | undefined;
            toExecute.push(() => {
              const projectResult = getTsMorphProjectForFile(relativeTo);
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              return cmd.action(
                symbolName,
                projectResult.data.project,
                projectResult.data.resolved,
                relativeTo,
                includeDeclaration,
                crossPackage,
                includeTests,
                maxResults,
              );
            });
          }
        }
      } else if (cmd.name === "--diagnostics") {
        const filePath = args[i + 1];
        if (!filePath || filePath.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "start-line", type: "integer", min: 1 },
            { name: "end-line", type: "integer", min: 1 },
            { name: "start-column", type: "integer", min: 1 },
            { name: "end-column", type: "integer", min: 1 },
            { name: "severity", type: "string" },
            { name: "include-codes", type: "stringList" },
            { name: "exclude-codes", type: "stringList" },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const severityRaw =
              (parsed.data.flags.severity as string | undefined) ?? "error";
            if (
              severityRaw !== "error" &&
              severityRaw !== "warning" &&
              severityRaw !== "all"
            ) {
              console.error(
                `Error: --severity must be error, warning, or all (got: ${severityRaw}).`,
              );
            } else {
              const parseCodes = (
                value: unknown,
                flagName: string,
              ): number[] | undefined => {
                if (value === undefined) return undefined;
                const list = value as string[];
                const codes: number[] = [];
                for (const part of list) {
                  if (!/^-?\d+$/.test(part)) {
                    throw new Error(
                      `Flag --${flagName} expects integer codes, got: ${part}`,
                    );
                  }
                  codes.push(Number.parseInt(part, 10));
                }
                return codes;
              };

              try {
                const include = parseCodes(
                  parsed.data.flags["include-codes"],
                  "include-codes",
                );
                const exclude = parseCodes(
                  parsed.data.flags["exclude-codes"],
                  "exclude-codes",
                );
                const codes =
                  include || exclude ? { include, exclude } : undefined;
                const normalizedPath = normalizePath(filePath);
                const startLine = parsed.data.flags["start-line"] as
                  | number
                  | undefined;
                const endLine = parsed.data.flags["end-line"] as
                  | number
                  | undefined;
                const startColumn = parsed.data.flags["start-column"] as
                  | number
                  | undefined;
                const endColumn = parsed.data.flags["end-column"] as
                  | number
                  | undefined;
                toExecute.push(() => {
                  const projectResult =
                    getTsMorphProjectForFile(normalizedPath);
                  if (!projectResult.success) {
                    return error(projectResult.error);
                  }
                  return cmd.action(
                    normalizedPath,
                    projectResult.data.project,
                    projectResult.data.resolved,
                    startLine,
                    endLine,
                    startColumn,
                    endColumn,
                    severityRaw,
                    codes,
                  );
                });
              } catch (err) {
                const message =
                  err && (err as Error).message
                    ? (err as Error).message
                    : String(err);
                console.error(`Error: ${message}`);
              }
            }
          }
        }
      } else if (cmd.name === "--signature-help") {
        const filePath = args[i + 1];
        if (!filePath || filePath.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "line", type: "integer", required: true, min: 1 },
            { name: "column", type: "integer", required: true, min: 1 },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const line = parsed.data.flags.line as number;
            const column = parsed.data.flags.column as number;
            const normalizedPath = normalizePath(filePath);
            toExecute.push(() => {
              const projectResult = getTsMorphProjectForFile(normalizedPath);
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              return cmd.action(
                normalizedPath,
                projectResult.data.project,
                projectResult.data.resolved,
                line,
                column,
              );
            });
          }
        }
      } else if (cmd.name === "--callers") {
        const filePath = args[i + 1];
        if (!filePath || filePath.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "line", type: "integer", required: true, min: 1 },
            { name: "column", type: "integer", min: 1 },
            { name: "max-depth", type: "integer", min: 1, max: 5 },
            { name: "no-cross-package", type: "boolean" },
            { name: "no-include-tests", type: "boolean" },
            { name: "max-results", type: "integer", min: 1, max: 500 },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const line = parsed.data.flags.line as number;
            const column = parsed.data.flags.column as number | undefined;
            const maxDepth = parsed.data.flags["max-depth"] as
              | number
              | undefined;
            const crossPackage = parsed.data.flags["no-cross-package"] !== true;
            const includeTests = parsed.data.flags["no-include-tests"] !== true;
            const maxResults = parsed.data.flags["max-results"] as
              | number
              | undefined;
            const normalizedPath = normalizePath(filePath);
            toExecute.push(() => {
              const projectResult = getTsMorphProjectForFile(normalizedPath);
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              return cmd.action(
                normalizedPath,
                projectResult.data.project,
                projectResult.data.resolved,
                line,
                column,
                maxDepth,
                crossPackage,
                includeTests,
                maxResults,
              );
            });
          }
        }
      } else if (cmd.name === "--callers-symbol") {
        const symbolName = args[i + 1];
        if (!symbolName || symbolName.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a symbol name argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "relative-to", type: "string", required: true },
            { name: "max-depth", type: "integer", min: 1, max: 5 },
            { name: "no-cross-package", type: "boolean" },
            { name: "no-include-tests", type: "boolean" },
            { name: "max-results", type: "integer", min: 1, max: 500 },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const relativeTo = normalizePath(
              parsed.data.flags["relative-to"] as string,
            );
            const maxDepth = parsed.data.flags["max-depth"] as
              | number
              | undefined;
            const crossPackage = parsed.data.flags["no-cross-package"] !== true;
            const includeTests = parsed.data.flags["no-include-tests"] !== true;
            const maxResults = parsed.data.flags["max-results"] as
              | number
              | undefined;
            toExecute.push(() => {
              const projectResult = getTsMorphProjectForFile(relativeTo);
              if (!projectResult.success) {
                return error(projectResult.error);
              }
              return cmd.action(
                symbolName,
                projectResult.data.project,
                projectResult.data.resolved,
                relativeTo,
                maxDepth,
                crossPackage,
                includeTests,
                maxResults,
              );
            });
          }
        }
      } else if (cmd.name === "--reachability") {
        const filePath = args[i + 1];
        if (!filePath || filePath.startsWith("--")) {
          console.error(`Error: ${cmd.name} requires a file path argument.`);
        } else {
          i++;
          const flagArgs: string[] = [];
          while (
            i + 1 < args.length &&
            !commandMap[args[i + 1] as keyof typeof commandMap]
          ) {
            flagArgs.push(args[++i]!);
          }
          const parsed = parseCliFlags(flagArgs, [
            { name: "line", type: "integer", required: true, min: 1 },
            { name: "column", type: "integer", min: 1 },
            { name: "max-depth", type: "integer", min: 1, max: 20 },
            { name: "max-paths", type: "integer", min: 1, max: 100 },
            { name: "entrypoint-kinds", type: "stringList" },
          ]);
          if (!parsed.success) {
            console.error(`Error: ${parsed.error}`);
          } else {
            const line = parsed.data.flags.line as number;
            const column = parsed.data.flags.column as number | undefined;
            const maxDepth = parsed.data.flags["max-depth"] as
              | number
              | undefined;
            const maxPaths = parsed.data.flags["max-paths"] as
              | number
              | undefined;
            const kindList = parsed.data.flags["entrypoint-kinds"] as
              | string[]
              | undefined;
            const allowed = new Set([
              "export",
              "test",
              "handler",
              "bin",
              "unknown",
            ]);
            const invalid = (kindList ?? []).filter((k) => !allowed.has(k));
            if (invalid.length > 0) {
              console.error(
                `Error: Invalid --entrypoint-kinds value(s): ${invalid.join(", ")}`,
              );
            } else {
              const entrypointKinds = kindList as
                | Array<"export" | "test" | "handler" | "bin" | "unknown">
                | undefined;
              const normalizedPath = normalizePath(filePath);
              toExecute.push(() => {
                const projectResult = getTsMorphProjectForFile(normalizedPath);
                if (!projectResult.success) {
                  return error(projectResult.error);
                }
                return cmd.action(
                  normalizedPath,
                  projectResult.data.project,
                  projectResult.data.resolved,
                  line,
                  column,
                  maxDepth,
                  maxPaths,
                  entrypointKinds,
                );
              });
            }
          }
        }
      } else if (cmd.name === "--mcp") {
        let port: number | undefined;
        if (args[i + 1] === "--port") {
          const portStr = args[i + 2];
          if (portStr) {
            port = parseInt(portStr, 10);
            i += 2;
          }
        }
        toExecute.push(() => cmd.action(port));
        noExit = true;
      } else {
        toExecute.push(() => cmd.action());
      }
    }
  }

  return [toExecute, noExit] as const;
};

export const router = (args: string[]) => {
  const [commands, noExit] = parseArgs(args);

  commands.forEach((cmd) => printResult(cmd()));

  if (commands.length === 0) {
    console.log("No valid command provided. Use --help for usage information.");
  }

  if (noExit) {
    console.log("MCP server running. Press Ctrl+C to exit.");
  } else {
    exit(0);
  }
};
