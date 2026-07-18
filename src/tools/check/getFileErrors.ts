import { Project, ts } from "ts-morph";
import { error, Result, success } from "../../types.js";
import { collectFilteredDiagnostics } from "../diagnostics/getDiagnostics.js";

const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getCanonicalFileName: (fileName) =>
    ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
  getNewLine: () => ts.sys.newLine,
};

/**
 * Whole-file errors-only adapter over the shared diagnostics core.
 * Preserves the existing color+context UX for `check_type_errors` / `--check`.
 */
export const getFileErrors = (
  filePath: string,
  project: Project,
): Result<string> => {
  const collected = collectFilteredDiagnostics(
    { filePath, severity: "error", collector: "preEmit" },
    project,
  );
  if (!collected.success) {
    return error(collected.error);
  }

  if (collected.data.length === 0) {
    return success("✅ Ok");
  }

  try {
    const formatted = ts
      .formatDiagnosticsWithColorAndContext(
        collected.data.map((entry) => entry.raw),
        formatHost,
      )
      .trim();
    return success(formatted || "✅ Ok");
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(`Error processing ${filePath}: ${message}`);
  }
};
