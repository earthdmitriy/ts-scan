import path from "node:path";
import { exit } from "node:process";
import { commandMap } from "./commands.js";
import { createTsMorphProject } from "./tools/createTsMorphProject.js";
import { Result } from "./types.js";

/**
 * Normalize file paths: resolve relative paths against cwd, keep absolute paths as-is.
 * Used to ensure CLI commands work from project root with both relative and absolute paths.
 */
const normalizePath = (filePath: string): string => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
};

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
          toExecute.push(() =>
            cmd.action(normalizedPath, createTsMorphProject())
          );
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
              toExecute.push(() =>
                cmd.action(symbolName, createTsMorphProject(), normalizedPath)
              );
              i += 3;
            } else {
              toExecute.push(() =>
                cmd.action(symbolName, createTsMorphProject())
              );
              i++;
            }
          } else {
            toExecute.push(() =>
              cmd.action(symbolName, createTsMorphProject())
            );
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
