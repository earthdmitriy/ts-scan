import {
  ClassDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  JSDocableNode,
  Node,
  Project,
  TypeAliasDeclaration,
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
    const result = pipeFrom(filePath, { bypassNull: true })(
      (filePath) => project.addSourceFileAtPath(filePath),
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
  const isJSDocableNode = (d: unknown): d is JSDocableNode =>
    Boolean((d as unknown as JSDocableNode)?.getJsDocs);

  const symbol = declaration.getSymbol();
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
      return `  ${m.getName()}(${params}): ${returnType}`;
    });
    const propSigs = properties.map(
      (p) => `  ${p.getName()}: ${stripImport(p.getType().getText())}`
    );
    const allSigs = [...methodSigs, ...propSigs].join("\n");
    const decoratorStr = decorators ? `${decorators}\n` : "";
    signature = `${decoratorStr}export class ${exportName} {\n${allSigs}\n}`;
  } else if (declaration instanceof TypeAliasDeclaration) {
    signature = `export ${declaration.getText()}`;
  } else if (declaration instanceof InterfaceDeclaration) {
    signature = `export ${declaration.getText()}`;
  } else {
    // For variables, assume const
    const type = stripImport(declaration.getType().getText());
    signature = `export const ${exportName}: ${type}`;
  }

  if (grep.length && grep.some((x) => !exportName.includes(x)))
    return undefined;

  const jsDocs =
    symbol
      .getDeclarations()
      ?.filter(isJSDocableNode)
      .flatMap((d) => (d as unknown as JSDocableNode)?.getJsDocs()) ?? [];

  const formattedName = exportName === "default" ? "default" : exportName;

  if (jsDocs.length === 0) return `//${formattedName}:\n${signature}`;

  const originalJsDoc = jsDocs[0].getText();
  return `//${formattedName}: \n${originalJsDoc}\n${signature}`;
}
