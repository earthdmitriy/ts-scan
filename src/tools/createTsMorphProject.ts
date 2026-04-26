import { Project } from "ts-morph";

export const createTsMorphProject = () =>
  new Project({
    useInMemoryFileSystem: false,
    tsConfigFilePath: "./tsconfig.json",
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: false,
  });
