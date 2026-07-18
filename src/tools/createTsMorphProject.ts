import { existsSync } from "fs";
import { Project } from "ts-morph";

/**
 * Create a ts-morph Project from an explicit tsconfig path.
 * Discovery of the correct tsconfig must happen before calling this.
 */
export const createTsMorphProject = (tsConfigPath: string): Project => {
  if (!existsSync(tsConfigPath)) {
    throw new Error(`Cannot find tsconfig.json at ${tsConfigPath}`);
  }

  return new Project({
    useInMemoryFileSystem: false,
    tsConfigFilePath: tsConfigPath,
    // Load the owning package file list so composite projects do not
    // emit TS6307 for valid sibling modules (tsc -p parity).
    skipAddingFilesFromTsConfig: false,
    skipLoadingLibFiles: false,
  });
};
