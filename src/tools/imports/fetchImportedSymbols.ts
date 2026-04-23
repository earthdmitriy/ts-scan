import { ImportDeclaration, JSDocableNode, Node, Project } from "ts-morph";
import { pipeFrom } from "typed-pipe";
import { error, Result, success } from "../../types.js";
import { createStripper, StripImportFn } from "../utils/stripImport.js";

export const fetchImportedSymbols = (
  filePath: string,
  project: Project,
  grep: string[] = []
): Result<string> => {
  try {
    const result = pipeFrom(filePath, { bypassNull: true })(
      (filePath) => project.addSourceFileAtPath(filePath),
      (sourceFile) =>
        sourceFile
          .getImportDeclarations()
          .flatMap((importDec) => extractInfo(importDec, grep))
          .join("\n\n\n"),
      (string) => "Types and JSdoc:\n\n" + string
    );
    return success(result);
  } catch (err) {
    const message = err && (err as any).message ? (err as any).message : err;
    return error(`Error processing ${filePath}: ${message}`);
  }
};

function extractInfo(
  importDec: ImportDeclaration,
  grep: string[] = []
): string {
  // TODO output grouped imports
  const stripper = createStripper();
  const stripImport = stripper.stripImport;

  const importedEntities = [
    importDec.getDefaultImport(),
    importDec.getNamespaceImport(),
    ...importDec.getNamedImports(),
  ]
    .filter((node) => !!node)
    .map((node) => {
      const name = node.getText();
      if (grep.length && grep.some((x) => !name.includes(x))) return "";

      const symbol =
        node.getSymbol()?.getAliasedSymbol() || node.getSymbol() || null;

      const declarations = symbol?.getDeclarations() || [];

      const symbolJsDocs = declarations.map((declaration) =>
        formatSymbolJsDoc(declaration)
      );

      const signatures = declarations.map((declaration) =>
        getDeclarationSignature(declaration, stripImport)
      );

      return [...symbolJsDocs, ...signatures].filter((x) => !!x).join("\n");
    });

  return `//from\n${importDec.getFullText()}\n${importedEntities.join("\n\n")}`;
}

const isJSDocableNode = (d: unknown): d is JSDocableNode =>
  Boolean((d as unknown as JSDocableNode)?.getJsDocs);

function formatSymbolJsDoc(declaration: Node): string {
  if (!isJSDocableNode(declaration)) return "";

  const jsDocs = (declaration as JSDocableNode)?.getJsDocs();

  if (jsDocs.length === 0) return "";

  const originalJsDoc = jsDocs[0].getText();

  return originalJsDoc;
}

function getDeclarationSignature(
  declaration: Node,
  stripImport: StripImportFn
): string {
  if (Node.isFunctionDeclaration(declaration)) {
    const name = declaration.getName() ?? "";
    const params = declaration
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    const returnType = stripImport(declaration.getReturnType().getText());
    const asyncModifier = declaration.isAsync() ? "async " : "";
    return `export ${asyncModifier}function ${name}(${params}): ${returnType}`;
  }

  if (Node.isVariableDeclaration(declaration)) {
    const name = declaration.getName();
    const type = stripImport(declaration.getType().getApparentType().getText());
    const parent = declaration.getParent();
    const declarationKind = Node.isVariableDeclarationList(parent)
      ? parent.getDeclarationKind()
      : "const";
    return `export ${declarationKind} ${name}: ${type}`;
  }

  if (Node.isClassDeclaration(declaration)) {
    const name = declaration.getName() ?? "";
    const methods = declaration
      .getMethods()
      .filter((m) => m.getScope() === "public");
    const properties = declaration
      .getProperties()
      .filter((p) => p.getScope() === "public" && !p.isStatic());
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
    return `export class ${name} {\n${allSigs}\n}`;
  }

  if (Node.isInterfaceDeclaration(declaration)) {
    const name = declaration.getName();
    const members = declaration.getMembers().map((m) => `  ${m.getText()}`);
    return `export interface ${name} {\n${members.join("\n")}\n}`;
  }

  if (Node.isTypeAliasDeclaration(declaration)) {
    const name = declaration.getName();
    const type = stripImport(declaration.getType().getText());
    return `export type ${name} = ${type}`;
  }

  // For other declarations, try to get a basic signature
  return ""; // Just the first line
}
