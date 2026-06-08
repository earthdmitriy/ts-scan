import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createTsMorphProject } from "../src/tools/createTsMorphProject.js";

const tempDirs: string[] = [];

const setupTempProject = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022" } })
  );
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createTsMorphProject", () => {
  it("creates project when valid projectRoot with tsconfig.json is provided", () => {
    const dir = join(tmpdir(), "ts-scan-test-valid-" + Date.now());
    setupTempProject(dir);

    const project = createTsMorphProject(dir);
    expect(project).toBeDefined();
  });

  it("throws when projectRoot does not contain tsconfig.json", () => {
    const dir = join(tmpdir(), "ts-scan-test-missing-" + Date.now());
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    expect(() => createTsMorphProject(dir)).toThrow(
      "Cannot find tsconfig.json"
    );
  });

  it("throws when projectRoot does not exist", () => {
    const dir = join(tmpdir(), "ts-scan-test-nonexistent-" + Date.now());

    expect(() => createTsMorphProject(dir)).toThrow(
      "Cannot find tsconfig.json"
    );
  });

  it("falls back to PROJECT_ROOT env var when no parameter provided", () => {
    const dir = join(tmpdir(), "ts-scan-test-env-" + Date.now());
    setupTempProject(dir);

    process.env.PROJECT_ROOT = dir;
    try {
      const project = createTsMorphProject();
      expect(project).toBeDefined();
    } finally {
      delete process.env.PROJECT_ROOT;
    }
  });

  it("parameter takes precedence over PROJECT_ROOT env var", () => {
    const validDir = join(tmpdir(), "ts-scan-test-param-" + Date.now());
    const invalidDir = join(tmpdir(), "ts-scan-test-env-invalid-" + Date.now());
    setupTempProject(validDir);
    mkdirSync(invalidDir, { recursive: true });
    tempDirs.push(invalidDir);

    process.env.PROJECT_ROOT = invalidDir;
    try {
      const project = createTsMorphProject(validDir);
      expect(project).toBeDefined();
    } finally {
      delete process.env.PROJECT_ROOT;
    }
  });
});
