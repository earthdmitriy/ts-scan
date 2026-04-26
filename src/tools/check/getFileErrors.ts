import { Project } from "ts-morph";
import { pipeFrom } from "typed-pipe";
import { error, Result, success } from "../../types.js";

export const getFileErrors = (
  filePath: string,
  project: Project
): Result<string> => {
  try {
    const result = pipeFrom(filePath, { bypassNull: true })(
      (filePath) => project.addSourceFileAtPath(filePath),
      (sourceFile) =>
        project.formatDiagnosticsWithColorAndContext(
          sourceFile.getPreEmitDiagnostics()
        ),
      (errors) => errors.trim() || "✅ Ok"
    );
    return success(result);
  } catch (err) {
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    return error(`Error processing ${filePath}: ${message}`);
  }
};
