import { exit } from "node:process";
import path from "path";
import { commandMap } from "./commands.js";
import {
  getTsMorphProjectAtRoot,
  getTsMorphProjectForFile,
} from "./tools/getTsMorphProject.js";
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
