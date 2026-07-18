import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	canonicalizePath,
	resolveTsConfigForFile,
} from '../src/tools/resolveTsConfig.js';
import {
	getCurrentTsConfigPath,
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.js';

const tempDirs: string[] = [];

afterEach(() => {
	resetCurrentTsMorphProject();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const createMonorepoFixture = () => {
	const root = path.join(tmpdir(), `ts-scan-mono-${Date.now()}`);
	tempDirs.push(root);
	mkdirSync(path.join(root, 'packages', 'a', 'src'), { recursive: true });
	mkdirSync(path.join(root, 'packages', 'b', 'src'), { recursive: true });
	mkdirSync(path.join(root, 'packages', 'a', 'excluded'), { recursive: true });

	writeFileSync(
		path.join(root, 'tsconfig.base.json'),
		JSON.stringify({
			compilerOptions: {
				target: 'ES2022',
				module: 'NodeNext',
				moduleResolution: 'NodeNext',
				strict: true,
				skipLibCheck: true,
				noEmit: true,
			},
		}),
	);

	writeFileSync(
		path.join(root, 'tsconfig.json'),
		JSON.stringify({
			files: [],
			references: [
				{ path: './packages/a' },
				{ path: './packages/b' },
			],
		}),
	);

	writeFileSync(
		path.join(root, 'packages', 'a', 'tsconfig.json'),
		JSON.stringify({
			extends: '../../tsconfig.base.json',
			compilerOptions: {
				paths: { '@a/*': ['./src/*'] },
			},
			include: ['src/**/*.ts'],
			exclude: ['excluded/**'],
		}),
	);

	writeFileSync(
		path.join(root, 'packages', 'b', 'tsconfig.json'),
		JSON.stringify({
			extends: '../../tsconfig.base.json',
			include: ['src/**/*.ts'],
		}),
	);

	const fileA = path.join(root, 'packages', 'a', 'src', 'index.ts');
	const fileB = path.join(root, 'packages', 'b', 'src', 'index.ts');
	const excluded = path.join(root, 'packages', 'a', 'excluded', 'skip.ts');
	writeFileSync(fileA, 'export const a = 1;\n');
	writeFileSync(fileB, 'export const b = 2;\n');
	writeFileSync(excluded, 'export const skipped = 3;\n');

	return { root, fileA, fileB, excluded };
};

describe('resolveTsConfigForFile', () => {
	it('resolves package config via root project references', () => {
		const { fileA, root } = createMonorepoFixture();
		const result = resolveTsConfigForFile(fileA);

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(canonicalizePath(result.data.tsConfigPath)).toBe(
			canonicalizePath(path.join(root, 'packages', 'a', 'tsconfig.json')),
		);
	});

	it('resolves nested package config for package b', () => {
		const { fileB, root } = createMonorepoFixture();
		const result = resolveTsConfigForFile(fileB);

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(canonicalizePath(result.data.tsConfigPath)).toBe(
			canonicalizePath(path.join(root, 'packages', 'b', 'tsconfig.json')),
		);
	});

	it('returns excluded/outside-include error for excluded files', () => {
		const { excluded } = createMonorepoFixture();
		const result = resolveTsConfigForFile(excluded);

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error).toContain(
			'File exists but is not included by any configured TypeScript project',
		);
	});

	it('returns distinct error when the file does not exist', () => {
		const { root } = createMonorepoFixture();
		const missing = path.join(
			root,
			'packages',
			'a',
			'src',
			'does-not-exist.ts',
		);
		const result = resolveTsConfigForFile(missing);

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error).toContain('File does not exist:');
		expect(result.error).toContain('Nearest tsconfig searched:');
		expect(result.error).toContain('Nearest under');
		expect(result.error).toContain('index.ts');
	});

	it('returns distinct error when no tsconfig exists above the path', () => {
		const root = path.join(tmpdir(), `ts-scan-no-tsconfig-${Date.now()}`);
		tempDirs.push(root);
		mkdirSync(path.join(root, 'src'), { recursive: true });
		const file = path.join(root, 'src', 'orphan.ts');
		writeFileSync(file, 'export const x = 1;\n');

		const result = resolveTsConfigForFile(file);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error).toContain('No tsconfig.json found above');
	});

	it('resolves files from this repository src tree', () => {
		const file = path.resolve('src/types.ts');
		const result = resolveTsConfigForFile(file);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(canonicalizePath(result.data.tsConfigPath)).toBe(
			canonicalizePath(path.resolve('tsconfig.json')),
		);
	});

	it('resolves samples through samples/tsconfig.json', () => {
		const file = path.resolve('samples/check/ok.ts');
		const result = resolveTsConfigForFile(file);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(canonicalizePath(result.data.tsConfigPath)).toBe(
			canonicalizePath(path.resolve('samples/tsconfig.json')),
		);
	});
});

describe('getTsMorphProjectForFile lifecycle', () => {
	it('reuses project for the same tsconfig and recreates on switch', () => {
		const { fileA, fileB, root } = createMonorepoFixture();

		const first = getTsMorphProjectForFile(fileA);
		expect(first.success).toBe(true);
		if (!first.success) return;
		const firstProject = first.data.project;
		expect(canonicalizePath(getCurrentTsConfigPath()!)).toBe(
			canonicalizePath(path.join(root, 'packages', 'a', 'tsconfig.json')),
		);

		const reused = getTsMorphProjectForFile(fileA);
		expect(reused.success).toBe(true);
		if (!reused.success) return;
		expect(reused.data.project).toBe(firstProject);

		const switched = getTsMorphProjectForFile(fileB);
		expect(switched.success).toBe(true);
		if (!switched.success) return;
		expect(switched.data.project).not.toBe(firstProject);
		expect(canonicalizePath(getCurrentTsConfigPath()!)).toBe(
			canonicalizePath(path.join(root, 'packages', 'b', 'tsconfig.json')),
		);

		const backToA = getTsMorphProjectForFile(fileA);
		expect(backToA.success).toBe(true);
		if (!backToA.success) return;
		expect(backToA.data.project).not.toBe(firstProject);
		expect(canonicalizePath(getCurrentTsConfigPath()!)).toBe(
			canonicalizePath(path.join(root, 'packages', 'a', 'tsconfig.json')),
		);
	});
});
