import { Project, ts } from "ts-morph";
import { error, Result, success, ToolResult } from "../../types.js";
import { ResolvedTsConfig } from "../resolveTsConfig.js";
import {
  offsetToLineColumn,
  resolveSourcePosition,
} from "../utils/sourcePosition.js";
import { formatSignatureHelpOutput } from "./formatSignatureHelp.js";

const COMPACT_DOC_MAX = 300;
const COMPACT_LABEL_MAX = 1000;

export interface SignatureHelpOptions {
  filePath: string;
  line: number;
  column: number;
}

export interface LocationSpan {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface SignatureParameterData {
  name: string;
  label: string;
  documentation: string;
  optional: boolean;
  rest: boolean;
}

export interface SignatureData {
  label: string;
  parameters: SignatureParameterData[];
  documentation: string;
  variadic: boolean;
}

export interface SignatureHelpData {
  status: "found" | "not_in_call";
  activeSignature?: number;
  activeParameter?: number;
  applicableSpan?: LocationSpan;
  signatures: SignatureData[];
}

/**
 * IDE Parameter Hints: active signature and argument index inside a call.
 */
export const getSignatureHelp = (
  options: SignatureHelpOptions,
  project: Project,
  _resolvedConfig: ResolvedTsConfig,
): Result<ToolResult<SignatureHelpData>> => {
  if (options.column === undefined) {
    return error(
      "Missing required column. signature_help requires --column / column (1-based).",
    );
  }

  const positionResult = resolveSourcePosition(
    project,
    options.filePath,
    options.line,
    options.column,
    "required",
  );
  if (!positionResult.success) {
    return error(positionResult.error);
  }

  const { sourceFile, offset } = positionResult.data;
  const fileName = sourceFile.getFilePath();

  try {
    const languageService = project.getLanguageService().compilerObject;
    const help = languageService.getSignatureHelpItems(fileName, offset, {
      triggerReason: { kind: "invoked" },
    });

    if (!help) {
      const data: SignatureHelpData = {
        status: "not_in_call",
        signatures: [],
      };
      return success({
        data,
        formattedOutput: formatSignatureHelpOutput(data),
      });
    }

    const items = help.items ?? [];
    const selectedItemIndex = help.selectedItemIndex;
    const argumentIndex = help.argumentIndex;

    if (
      selectedItemIndex < 0 ||
      selectedItemIndex >= items.length ||
      argumentIndex < 0
    ) {
      return error(
        `Internal error: inconsistent signature help indexes ` +
          `(selectedItemIndex=${selectedItemIndex}, argumentIndex=${argumentIndex}, ` +
          `signatures=${items.length}).`,
      );
    }

    const signatures = items.map((item) => mapSignatureItem(item));
    const start = offsetToLineColumn(sourceFile, help.applicableSpan.start);
    const endOffset = Math.min(
      sourceFile.getFullText().length,
      help.applicableSpan.start + Math.max(help.applicableSpan.length, 0),
    );
    const end = offsetToLineColumn(sourceFile, endOffset);

    const data: SignatureHelpData = {
      status: "found",
      activeSignature: selectedItemIndex,
      activeParameter: argumentIndex,
      applicableSpan: {
        file: sourceFile.getFilePath(),
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
      },
      signatures,
    };

    return success({
      data,
      formattedOutput: formatSignatureHelpOutput(data),
    });
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(
      `Error resolving signature help in ${options.filePath}: ${message}`,
    );
  }
};

const mapSignatureItem = (item: ts.SignatureHelpItem): SignatureData => {
  const separator = ts.displayPartsToString(item.separatorDisplayParts ?? []);
  const prefix = ts.displayPartsToString(item.prefixDisplayParts ?? []);
  const suffix = ts.displayPartsToString(item.suffixDisplayParts ?? []);
  const parameters = (item.parameters ?? []).map((param) =>
    mapParameter(param),
  );
  const paramLabels = parameters.map((p) => p.label);
  const label = compactLabel(prefix + paramLabels.join(separator) + suffix);

  return {
    label,
    parameters,
    documentation: compactDoc(
      ts.displayPartsToString(item.documentation ?? []),
    ),
    variadic: Boolean(item.isVariadic),
  };
};

const mapParameter = (
  param: ts.SignatureHelpParameter,
): SignatureParameterData => {
  const label = compactLabel(ts.displayPartsToString(param.displayParts ?? []));
  const name = param.name || extractParameterName(label);
  const rest =
    label.trimStart().startsWith("...") || name.trimStart().startsWith("...");

  return {
    name,
    label,
    documentation: compactDoc(
      ts.displayPartsToString(param.documentation ?? []),
    ),
    optional: Boolean(param.isOptional),
    rest,
  };
};

const extractParameterName = (label: string): string => {
  const trimmed = label.trim();
  const match = trimmed.match(/^\.{3}?([A-Za-z_$][\w$]*)/);
  return match?.[1] ?? trimmed;
};

const compactDoc = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const paragraph = trimmed.split(/\n\s*\n/)[0] ?? trimmed;
  const singleLine = paragraph.replace(/\s+/g, " ").trim();
  if (singleLine.length <= COMPACT_DOC_MAX) {
    return singleLine;
  }
  return `${singleLine.slice(0, COMPACT_DOC_MAX - 1)}…`;
};

const compactLabel = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length <= COMPACT_LABEL_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, COMPACT_LABEL_MAX - 1)}…`;
};
