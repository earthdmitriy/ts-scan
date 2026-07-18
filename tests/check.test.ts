import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getFileErrors } from '../src/tools/check/getFileErrors.ts';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';

const errorFile = path.resolve('samples/check/error.ts');
const okRouter = path.resolve('src/router.ts');
const tempDirs: string[] = [];

afterEach(() => {
	resetCurrentTsMorphProject();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('getFileErrors', () => {
	it('returns ✅ Ok string for a valid TypeScript file', () => {
		const projectResult = getTsMorphProjectForFile(okRouter);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = getFileErrors(okRouter, projectResult.data.project);

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toBe('✅ Ok');
	});

	it('reports diagnostics for an invalid TypeScript file', () => {
		const projectResult = getTsMorphProjectForFile(errorFile);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = getFileErrors(errorFile, projectResult.data.project);

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('TS');
		expect(result.data).toContain('type');
	});

	it('does not report TS6307 for sibling files in a composite package', () => {
		const root = path.join(tmpdir(), `ts-scan-composite-${Date.now()}`);
		tempDirs.push(root);
		mkdirSync(path.join(root, 'src'), { recursive: true });

		writeFileSync(
			path.join(root, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					target: 'ES2022',
					module: 'NodeNext',
					moduleResolution: 'NodeNext',
					strict: true,
					composite: true,
					declaration: true,
					skipLibCheck: true,
					rootDir: 'src',
					outDir: 'dist',
				},
				include: ['src/**/*.ts'],
			}),
		);
		writeFileSync(
			path.join(root, 'src', 'helpers.ts'),
			'export const helper = 1;\n',
		);
		const typesFile = path.join(root, 'src', 'types.ts');
		writeFileSync(
			typesFile,
			'import { helper } from "./helpers.js";\nexport const value = helper;\n',
		);

		const projectResult = getTsMorphProjectForFile(typesFile);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = getFileErrors(typesFile, projectResult.data.project);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).not.toContain('TS6307');
		expect(result.data).toBe('✅ Ok');
	});
});
