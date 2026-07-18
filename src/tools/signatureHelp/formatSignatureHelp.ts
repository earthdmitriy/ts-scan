import {
  SignatureData,
  SignatureHelpData,
  SignatureParameterData,
} from "./getSignatureHelp.js";

const formatParameter = (param: SignatureParameterData): string => {
  const flags = [
    param.optional ? "optional" : undefined,
    param.rest ? "rest" : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const meta = flags ? ` (${flags})` : "";
  const doc = param.documentation ? ` — ${param.documentation}` : "";
  return `    - ${param.label}${meta}${doc}`;
};

const formatSignature = (sig: SignatureData, index: number): string => {
  const lines = [`  - [${index}] ${sig.label}`];
  if (sig.documentation) {
    lines.push(`    documentation: ${sig.documentation}`);
  }
  if (sig.variadic) {
    lines.push(`    variadic: true`);
  }
  if (sig.parameters.length > 0) {
    lines.push(`    parameters:`);
    for (const param of sig.parameters) {
      lines.push(formatParameter(param));
    }
  }
  return lines.join("\n");
};

/**
 * Pure formatter for signature-help output (CLI + MCP share this text).
 */
export const formatSignatureHelpOutput = (data: SignatureHelpData): string => {
  if (data.status === "not_in_call") {
    return ["status: not_in_call", "signatures: 0"].join("\n");
  }

  const lines = [
    `status: found`,
    `activeSignature: ${data.activeSignature ?? 0}`,
    `activeParameter: ${data.activeParameter ?? 0}`,
  ];

  if (data.applicableSpan) {
    const span = data.applicableSpan;
    lines.push(
      `applicableSpan: ${span.file}:${span.line}:${span.column}-${span.endLine}:${span.endColumn}`,
    );
  }

  lines.push(`signatures: ${data.signatures.length}`);
  data.signatures.forEach((sig, index) => {
    lines.push(formatSignature(sig, index));
  });

  return lines.join("\n");
};
