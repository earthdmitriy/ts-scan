import { Project } from "ts-morph";

export const createTsMorphProject = () =>
  new Project({
    useInMemoryFileSystem: false,
    tsConfigFilePath: "./tsconfig.json",
    skipAddingFilesFromTsConfig: false, // Changed from true to false to load tsconfig
    skipFileDependencyResolution: false,
  });
