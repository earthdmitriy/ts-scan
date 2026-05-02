import { Project } from "ts-morph";

export const loadFile = (project: Project, filePath: string) => {
  const existing = project.getSourceFile(filePath);
  if (existing) {
    existing.refreshFromFileSystemSync();
    return existing;
  }
  return project.addSourceFileAtPath(filePath);
};
