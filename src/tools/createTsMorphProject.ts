import { ModuleKind, Project, ScriptTarget } from "ts-morph";

export const createTsMorphProject = () =>
  new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      target: ScriptTarget.ES2020,
      module: ModuleKind.NodeNext,
      allowJs: true,
      strict: false,
    },
  });
