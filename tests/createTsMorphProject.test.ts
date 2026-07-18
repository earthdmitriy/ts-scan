import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTsMorphProject } from '../src/tools/createTsMorphProject.js';

const tempDirs: string[] = [];

const setupTempProject = (dir: string) => {
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	const tsConfigPath = join(dir, 'tsconfig.json');
	writeFileSync(
		tsConfigPath,
		JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
	);
	return tsConfigPath;
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('createTsMorphProject', () => {
	it('creates project when valid tsconfig path is provided', () => {
		const dir = join(tmpdir(), 'ts-scan-test-valid-' + Date.now());
		const tsConfigPath = setupTempProject(dir);

		const project = createTsMorphProject(tsConfigPath);
		expect(project).toBeDefined();
	});

	it('throws when tsconfig path does not exist', () => {
		const tsConfigPath = join(
			tmpdir(),
			'ts-scan-test-missing-' + Date.now(),
			'tsconfig.json',
		);

		expect(() => createTsMorphProject(tsConfigPath)).toThrow(
			'Cannot find tsconfig.json',
		);
	});
});
