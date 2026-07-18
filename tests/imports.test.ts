import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchImportedSymbols } from '../src/tools/imports/fetchImportedSymbols.ts';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import { projectFor } from './testProject.ts';

const sampleFile = 'samples/imports/sample.ts';
const complexSampleFile = 'samples/imports/complex-sample.ts';
const multipleImports = 'samples/imports/multipleImports.ts';
const tempDirs: string[] = [];

afterEach(() => {
	resetCurrentTsMorphProject();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('fetchImportedSymbols', () => {
	it('returns imported symbol information for a sample file', () => {
		const result = fetchImportedSymbols(sampleFile, projectFor(sampleFile));

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('Types and JSdoc:');
		expect(result.data).toContain('Returns a greeting for the provided name.');
		expect(result.data).toContain('const value:');
		expect(result.data).toContain('function greet(name: string): string');
		// Ensure implementation bodies are not included
		expect(result.data).not.toContain('return `Hello ${name}`');
		expect(result.data).not.toContain('= 42');
	});

	it('returns imported class signatures without implementation for complex imports', () => {
		const result = fetchImportedSymbols(
			complexSampleFile,
			projectFor(complexSampleFile),
		);

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('Types and JSdoc:');
		expect(result.data).toContain('class ComplexModule');
		expect(result.data).toContain('method1(param: string): number');
		expect(result.data).not.toContain('method2');
		expect(result.data).not.toContain('static ɵfac');
		expect(result.data).not.toContain('private');
	});

	it('returns imported class signatures without implementation for multiple imports', () => {
		const result = fetchImportedSymbols(
			multipleImports,
			projectFor(multipleImports),
		);

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('export class ComplexModule');
		expect(result.data).toContain('export interface ComplexInterface');
		expect(result.data).toContain('export type ComplexType');
	});

	it('uses type-node text so type aliases are not tautological T = T', () => {
		const root = path.join(tmpdir(), `ts-scan-imports-alias-${Date.now()}`);
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
					skipLibCheck: true,
				},
				include: ['src/**/*.ts'],
			}),
		);
		writeFileSync(
			path.join(root, 'src', 'types.ts'),
			'export type ServerContext = { id: string };\n',
		);
		const consumer = path.join(root, 'src', 'app.ts');
		writeFileSync(
			consumer,
			'import type { ServerContext } from "./types.js";\nexport type X = ServerContext;\n',
		);

		const projectResult = getTsMorphProjectForFile(consumer);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = fetchImportedSymbols(
			consumer,
			projectResult.data.project,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('export type ServerContext = { id: string }');
		expect(result.data).not.toContain(
			'export type ServerContext = ServerContext',
		);
	});

	it('summarizes node_modules class imports in compact mode', () => {
		const file = path.resolve('samples/exports/sample-dependencies.ts');
		const result = fetchImportedSymbols(file, projectFor(file), [], 'compact');

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('export class Project /* from ts-morph */');
		expect(result.data.length).toBeLessThan(5000);
	});
});
