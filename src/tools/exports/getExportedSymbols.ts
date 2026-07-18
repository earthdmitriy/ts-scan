import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
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
import { loadFile } from "../utils/loadTsMorphFile.js";
import { createStripper, StripImportFn } from "../utils/stripImport.js";

export const getExportedSymbols = (
  filePath: string,
  project: Project,
  grep: string[] = [],
  containingFile: string = "",
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
      const modulePath = resolveModuleTypesPath(
        filePath,
        project,
        containingFile,
      );
      if (!modulePath.success) {
        return error(modulePath.error);
      }
      resolvedPath = modulePath.data;
    }

    const result = pipeFrom(resolvedPath, { bypassNull: true })(
      (path) => loadFile(project, path),
      (sourceFile) => {
        const exportedDeclarations = sourceFile.getExportedDeclarations();
        const infos: string[] = [];
        const totalExports = exportedDeclarations.size;

        // TODO output grouped imports
        const stripper = createStripper();
        const stripImport = stripper.stripImport;

        for (const [name, declarations] of exportedDeclarations) {
          if (grep.length > 0 && !grep.includes(name)) {
            continue;
          }
          for (const declaration of declarations) {
            const info = extractInfo(declaration, name, stripImport);
            if (info) infos.push(info);
          }
        }

        if (grep.length > 0 && infos.length === 0) {
          return `No exports matched filters: ${grep.join(", ")} (${totalExports} exports in file).`;
        }
        return infos.join("\n");
      },
    );
    return success(result);
  } catch (err) {
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    return error(`Error processing ${filePath}: ${message}`);
  }
};

function resolveModuleTypesPath(
  moduleName: string,
  project: Project,
  containingFile: string,
): Result<string> {
  const anchor = containingFile || join(process.cwd(), "index.ts");
  const compilerOptions = project.compilerOptions.get();
  const resolved = ts.resolveModuleName(
    moduleName,
    anchor,
    compilerOptions,
    ts.sys,
  );
  const resolvedFile = resolved.resolvedModule?.resolvedFileName;
  if (resolvedFile && existsSync(resolvedFile)) {
    return success(resolvedFile);
  }

  try {
    let current = dirname(anchor);
    while (true) {
      const packageJsonPath = join(
        current,
        "node_modules",
        moduleName,
        "package.json",
      );
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        const types =
          packageJson.types ||
          packageJson.typings ||
          packageJson.exports?.["."]?.import?.types ||
          packageJson.exports?.["."]?.types ||
          packageJson.main;
        if (types) {
          const typesPath = join(dirname(packageJsonPath), types);
          if (existsSync(typesPath)) {
            return success(typesPath);
          }
        }
        return error(
          `No types or main found in package.json for ${moduleName}`,
        );
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return error(`Cannot resolve module ${moduleName}`);
  } catch (e) {
    return error(`Cannot resolve module ${moduleName}: ${e}`);
  }
}

const asExportedSource = (text: string): string => {
  const trimmed = text.trimStart();
  return trimmed.startsWith("export ") ? trimmed : `export ${trimmed}`;
};

/** Prefer local declaration name for default exports (keep export key as "default"). */
const declarationLocalName = (declaration: Node): string | undefined => {
  if (
    declaration instanceof ClassDeclaration ||
    declaration instanceof FunctionDeclaration
  ) {
    return declaration.getName() ?? undefined;
  }
  return undefined;
};

const formatClassOrFunctionExport = (
  kind: "class" | "function",
  exportName: string,
  localName: string | undefined,
  afterName: string,
): string => {
  const isDefault = exportName === "default";
  const namePart = isDefault ? (localName ?? "") : exportName;
  const head = isDefault
    ? `export default ${kind}`
    : `export ${kind}`;
  const withName = namePart ? `${head} ${namePart}` : head;
  return `${withName}${afterName}`;
};

function extractInfo(
  declaration: Node,
  exportName: string,
  stripImport: StripImportFn,
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

  const localName = declarationLocalName(declaration);
  let signature: string;

  if (declaration instanceof FunctionDeclaration) {
    const params = declaration
      .getParameters()
      .map((p) => p.getText())
      .join(", ");
    const returnType = stripImport(declaration.getReturnType().getText());
    signature = formatClassOrFunctionExport(
      "function",
      exportName,
      localName,
      `(${params}): ${returnType}`,
    );
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
          p.getType().getText(),
        )}`,
    );
    const allSigs = [...methodSigs, ...propSigs].join("\n\n");
    const decoratorStr = decorators ? `${decorators}\n` : "";
    const classSig = formatClassOrFunctionExport(
      "class",
      exportName,
      localName,
      ` {\n${allSigs}\n}`,
    );
    signature = `${decoratorStr}${classSig}`;
  } else if (declaration instanceof TypeAliasDeclaration) {
    signature = asExportedSource(declaration.getText());
  } else if (declaration instanceof InterfaceDeclaration) {
    signature = asExportedSource(declaration.getText());
  } else if (exportName === "default") {
    signature = `export default: ${strippedType}`;
  } else {
    signature = `export const ${exportName}: ${strippedType}`;
  }

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
