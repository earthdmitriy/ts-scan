import { ImportDeclaration, JSDocableNode, Node, Project } from "ts-morph";
import { pipeFrom } from "typed-pipe";
import { error, Result, success } from "../../types.js";
import { loadFile } from "../utils/loadTsMorphFile.js";
import { createStripper, StripImportFn } from "../utils/stripImport.js";

export type ImportDetail = "compact" | "full";

const MAX_SIGNATURE_LENGTH = 200;

export const fetchImportedSymbols = (
  filePath: string,
  project: Project,
  grep: string[] = [],
  detail: ImportDetail = "compact",
): Result<string> => {
  try {
    const result = pipeFrom(filePath, { bypassNull: true })(
      (path) => loadFile(project, path),
      (sourceFile) =>
        sourceFile
          .getImportDeclarations()
          .flatMap((importDec) => extractInfo(importDec, grep, detail))
          .join("\n\n\n"),
      (string) => "Types and JSdoc:\n\n" + string,
    );
    return success(result);
  } catch (err) {
    const message = err && (err as any).message ? (err as any).message : err;
    return error(`Error processing ${filePath}: ${message}`);
  }
};

function extractInfo(
  importDec: ImportDeclaration,
  grep: string[] = [],
  detail: ImportDetail,
): string {
  // TODO output grouped imports
  const stripper = createStripper();
  const stripImport = stripper.stripImport;
  const moduleSpecifier = importDec.getModuleSpecifierValue();

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
        formatSymbolJsDoc(declaration, detail),
      );

      const signatures = declarations.map((declaration) =>
        getDeclarationSignature(
          declaration,
          stripImport,
          detail,
          moduleSpecifier,
        ),
      );

      return [...symbolJsDocs, ...signatures].filter((x) => !!x).join("\n");
    });

  return `//from\n${importDec.getFullText()}\n${importedEntities.join("\n\n")}`;
}

const isJSDocableNode = (d: unknown): d is JSDocableNode =>
  Boolean((d as unknown as JSDocableNode)?.getJsDocs);

function formatSymbolJsDoc(declaration: Node, detail: ImportDetail): string {
  if (!isJSDocableNode(declaration)) return "";

  const jsDocs = (declaration as JSDocableNode)?.getJsDocs();

  if (jsDocs.length === 0) return "";

  const originalJsDoc = jsDocs[0].getText();
  if (detail === "compact") {
    return truncate(originalJsDoc, MAX_SIGNATURE_LENGTH);
  }
  return originalJsDoc;
}

/** Non-relative import specifiers are treated as external (npm / workspace). */
function isExternalImport(moduleSpecifier: string): boolean {
  return (
    !moduleSpecifier.startsWith("./") && !moduleSpecifier.startsWith("../")
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function getDeclarationSignature(
  declaration: Node,
  stripImport: StripImportFn,
  detail: ImportDetail,
  moduleSpecifier: string,
): string {
  const useCompact = detail === "compact" && isExternalImport(moduleSpecifier);

  if (Node.isFunctionDeclaration(declaration)) {
    const name = declaration.getName() ?? "";
    const params = declaration
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    const returnType = stripImport(declaration.getReturnType().getText());
    const asyncModifier = declaration.isAsync() ? "async " : "";
    const signature = `export ${asyncModifier}function ${name}(${params}): ${returnType}`;
    return useCompact
      ? truncate(
          `${signature} /* from ${moduleSpecifier} */`,
          MAX_SIGNATURE_LENGTH,
        )
      : truncateIfNeeded(signature, detail);
  }

  if (Node.isVariableDeclaration(declaration)) {
    const name = declaration.getName();
    const typeText = stripImport(
      declaration.getType().getApparentType().getText(),
    );
    const parent = declaration.getParent();
    const declarationKind = Node.isVariableDeclarationList(parent)
      ? parent.getDeclarationKind()
      : "const";
    const signature = `export ${declarationKind} ${name}: ${typeText}`;
    return useCompact
      ? truncate(
          `export ${declarationKind} ${name}: ${shortType(typeText)} /* from ${moduleSpecifier} */`,
          MAX_SIGNATURE_LENGTH,
        )
      : truncateIfNeeded(signature, detail);
  }

  if (Node.isClassDeclaration(declaration)) {
    const name = declaration.getName() ?? "";
    if (useCompact) {
      return truncate(
        `export class ${name} /* from ${moduleSpecifier} */`,
        MAX_SIGNATURE_LENGTH,
      );
    }
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
      (p) => `  ${p.getName()}: ${stripImport(p.getType().getText())}`,
    );
    const allSigs = [...methodSigs, ...propSigs].join("\n");
    return truncateIfNeeded(`export class ${name} {\n${allSigs}\n}`, detail);
  }

  if (Node.isInterfaceDeclaration(declaration)) {
    const name = declaration.getName();
    if (useCompact) {
      return truncate(
        `export interface ${name} /* from ${moduleSpecifier} */`,
        MAX_SIGNATURE_LENGTH,
      );
    }
    const members = declaration.getMembers().map((m) => `  ${m.getText()}`);
    return truncateIfNeeded(
      `export interface ${name} {\n${members.join("\n")}\n}`,
      detail,
    );
  }

  if (Node.isTypeAliasDeclaration(declaration)) {
    const name = declaration.getName();
    if (useCompact) {
      return `export type ${name} /* from ${moduleSpecifier} */`;
    }
    const typeNode = declaration.getTypeNode();
    const type = typeNode
      ? stripImport(typeNode.getText())
      : stripImport(declaration.getType().getText());
    return truncateIfNeeded(`export type ${name} = ${type}`, detail);
  }

  // For other declarations, try to get a basic signature
  return ""; // Just the first line
}

function shortType(typeText: string): string {
  const firstLine = typeText.split("\n")[0] ?? typeText;
  return truncate(firstLine, 80);
}

function truncateIfNeeded(text: string, detail: ImportDetail): string {
  if (detail === "full") return text;
  return truncate(text, MAX_SIGNATURE_LENGTH * 4);
}
