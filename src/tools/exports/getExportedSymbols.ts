import { readFileSync } from "fs";
import { join } from "path";
import {
  ClassDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  Node,
  Project,
  ts,
  TypeAliasDeclaration,
  VariableDeclaration,
  VariableStatement,
} from "ts-morph";
import { pipeFrom } from "typed-pipe";
import { error, Result, success } from "../../types.js";
import { createStripper, StripImportFn } from "../utils/stripImport.js";

export const getExportedSymbols = (
  filePath: string,
  project: Project,
  grep: string[] = []
): Result<string> => {
  try {
    // Resolve module names to file paths
    let resolvedPath = filePath;
    if (
      ((!filePath.includes("/") && !filePath.includes("\\")) ||
        filePath.startsWith("@")) &&
      !filePath.endsWith(".ts") &&
      !filePath.endsWith(".d.ts")
    ) {
      // Assume it's a module name, try to resolve from node_modules
      try {
        const packageJsonPath = join(
          process.cwd(),
          "node_modules",
          filePath,
          "package.json"
        );
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        const types =
          packageJson.types ||
          packageJson.typings ||
          packageJson.exports?.["."]?.import?.types ||
          packageJson.exports?.["."]?.types ||
          packageJson.main;
        if (types) {
          resolvedPath = join("node_modules", filePath, types);
        } else {
          return error(
            `No types or main found in package.json for ${filePath}`
          );
        }
      } catch (e) {
        return error(`Cannot resolve module ${filePath}: ${e}`);
      }
    }

    const result = pipeFrom(resolvedPath, { bypassNull: true })(
      (path) => project.addSourceFileAtPath(path),
      (sourceFile) => {
        const exportedDeclarations = sourceFile.getExportedDeclarations();
        const infos: string[] = [];

        // TODO output grouped imports
        const stripper = createStripper();
        const stripImport = stripper.stripImport;

        for (const [name, declarations] of exportedDeclarations) {
          for (const declaration of declarations) {
            const info = extractInfo(declaration, name, stripImport, grep);
            if (info) infos.push(info);
          }
        }
        return infos.join("\n");
      }
    );
    return success(result);
  } catch (err) {
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    return error(`Error processing ${filePath}: ${message}`);
  }
};

function extractInfo(
  declaration: Node,
  exportName: string,
  stripImport: StripImportFn,
  grep: string[] = []
): string | undefined {
  const symbol = declaration.getSymbol();
  const type = declaration.getType();
  const strippedType =
    type
      .getSymbol()
      ?.getDeclarations()
      .map((x) => x.getText())
      .pop() ?? stripImport(type.getText());

  if (!symbol) return undefined;

  let signature: string;

  if (declaration instanceof FunctionDeclaration) {
    const params = declaration
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    const returnType = stripImport(declaration.getReturnType().getText());
    signature = `export function ${exportName}(${params}): ${returnType}`;
  } else if (declaration instanceof ClassDeclaration) {
    const decorators = declaration
      .getDecorators()
      .map((d) => d.getText())
      .join("\n");
    const methods = declaration
      .getMethods()
      .filter((m) => m.getScope() === "public");
    const properties = declaration
      .getProperties()
      .filter((p) => p.getScope() === "public");
    const methodSigs = methods.map((m) => {
      const params = m
        .getParameters()
        .map((p) => p.getText())
        .join(", ");
      const returnType = stripImport(m.getReturnType().getText());
      return `  ${getJsDoc(m)}\n  ${m.getName()}(${params}): ${returnType}`;
    });
    const propSigs = properties.map(
      (p) =>
        `  ${getJsDoc(p)}\n  ${p.getName()}: ${stripImport(
          p.getType().getText()
        )}`
    );
    const allSigs = [...methodSigs, ...propSigs].join("\n");
    const decoratorStr = decorators ? `${decorators}\n` : "";
    signature = `${decoratorStr}export class ${exportName} {\n${allSigs}\n}`;
  } else if (declaration instanceof TypeAliasDeclaration) {
    signature = `export ${declaration.getText()}`;
  } else if (declaration instanceof InterfaceDeclaration) {
    signature = `export ${declaration.getText()}`;
  } else {
    signature = `export const ${exportName}: ${strippedType}`;
  }

  if (grep.length && grep.some((x) => exportName !== x)) return undefined;

  const originalJsDoc = Node.isJSDocable(declaration)
    ? getJsDoc(declaration)
    : declaration instanceof VariableDeclaration
    ? getJsDoc(declaration.getVariableStatement())
    : "";

  // try fetch jsdoc for declared type
  // TODO optimize it
  /*
  const typeJsDoc =
    type
      .getSymbol()
      ?.getDeclarations()
      .map((x) => x.getSourceFile())
      .flatMap((x) => x.getExportedDeclarations())
      .flatMap((x) => x.get(strippedType))
      .filter((x) => !!x && Node.isJSDocable(x))
      .map((x) => getJsDoc(x))
      .join("\n") ?? "";
      */

  const formattedName = exportName === "default" ? "default" : exportName;

  const jsDoc = originalJsDoc;

  if (jsDoc.length === 0) return `//${formattedName}:\n${signature}`;

  return `//${formattedName}: \n${jsDoc}\n${signature}`;
}

function getJsDoc(node?: Node<ts.Node> | VariableStatement): string {
  if (!node) return "";
  if (!Node.isJSDocable(node)) return "";

  const jsDocs = node.getJsDocs();
  if (jsDocs.length === 0) return "";
  return jsDocs.map((d) => d.getText()).join("\n");
}
