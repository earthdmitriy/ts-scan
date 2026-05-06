import { Project } from "ts-morph";

export const createTsMorphProject = () =>
  new Project({
    useInMemoryFileSystem: false,
    tsConfigFilePath: "./tsconfig.json",
    skipAddingFilesFromTsConfig: true, // Don't add all files from tsconfig
    skipFileDependencyResolution: true, // Don't resolve imports automatically
    skipLoadingLibFiles: false,
  });
