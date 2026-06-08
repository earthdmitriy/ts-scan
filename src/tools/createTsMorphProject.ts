import { existsSync } from "fs";
import { join } from "path";
import { Project } from "ts-morph";

export const createTsMorphProject = (projectRoot?: string) => {
  const root = projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
  const tsConfigPath = join(root, "tsconfig.json");

  if (!existsSync(tsConfigPath)) {
    throw new Error(
      `Cannot find tsconfig.json at ${root}. Set PROJECT_ROOT env var to the project root directory, or run the command from the project root.`
    );
  }

  return new Project({
    useInMemoryFileSystem: false,
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: false,
  });
};
