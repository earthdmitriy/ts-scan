import { Project } from "ts-morph";
import { error, Result, success } from "../types.js";
import { createTsMorphProject } from "./createTsMorphProject.js";
import {
  canonicalizePath,
  ResolvedTsConfig,
  resolveTsConfigAtRoot,
  resolveTsConfigForFile,
} from "./resolveTsConfig.js";

interface CurrentProject {
  tsConfigPath: string;
  canonicalTsConfigPath: string;
  project: Project;
  resolved: ResolvedTsConfig;
}

let currentProject: CurrentProject | null = null;

export interface ProjectForFile {
  project: Project;
  resolved: ResolvedTsConfig;
}

/**
 * Return the current ts-morph Project for a file, recreating it when the
 * resolved tsconfig changes.
 */
export const getTsMorphProjectForFile = (
  filePath: string,
): Result<ProjectForFile> => {
  const resolvedResult = resolveTsConfigForFile(filePath);
  if (!resolvedResult.success) {
    return error(resolvedResult.error);
  }
  return getOrCreateProject(resolvedResult.data);
};

/**
 * CLI fallback for --resolve without --relative-to.
 */
export const getTsMorphProjectAtRoot = (
  rootDir?: string,
): Result<ProjectForFile> => {
  const resolvedResult = resolveTsConfigAtRoot(rootDir);
  if (!resolvedResult.success) {
    return error(resolvedResult.error);
  }
  return getOrCreateProject(resolvedResult.data);
};

const getOrCreateProject = (
  resolved: ResolvedTsConfig,
): Result<ProjectForFile> => {
  const canonicalTsConfigPath = canonicalizePath(resolved.tsConfigPath);
  if (currentProject?.canonicalTsConfigPath === canonicalTsConfigPath) {
    return success({
      project: currentProject.project,
      resolved: currentProject.resolved,
    });
  }

  try {
    const project = createTsMorphProject(resolved.tsConfigPath);
    currentProject = {
      tsConfigPath: resolved.tsConfigPath,
      canonicalTsConfigPath,
      project,
      resolved,
    };
    return success({ project, resolved });
  } catch (err) {
    const message =
      err && (err as Error).message ? (err as Error).message : String(err);
    return error(message);
  }
};

/** Test helper: clear the single-current project cache. */
export const resetCurrentTsMorphProject = (): void => {
  currentProject = null;
};

/** Test helper: expose the current tsconfig path. */
export const getCurrentTsConfigPath = (): string | null =>
  currentProject?.tsConfigPath ?? null;
