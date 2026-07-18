import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getFileErrors } from '../src/tools/check/getFileErrors.ts';
import { resetExportCaches } from '../src/tools/exportCache/exportCache.ts';
import { getExportedSymbols } from '../src/tools/exports/getExportedSymbols.ts';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import { fetchImportedSymbols } from '../src/tools/imports/fetchImportedSymbols.ts';
import { resolveSymbol } from '../src/tools/resolve/resolveSymbol.ts';
import { resolveTsConfigForFile } from '../src/tools/resolveTsConfig.ts';

const tempDirs: string[] = [];

afterEach(() => {
	resetCurrentTsMorphProject();
	resetExportCaches();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

interface MonorepoParityFixture {
	root: string;
	runtimeTypes: string;
	serverAttach: string;
	sharedWorkflow: string;
	missingWorkflow: string;
}

/**
 * Mini monorepo mirroring composite / NodeNext / workspace patterns that agents hit:
 * composite + include src glob, NodeNext .js imports, workspaces, missing path.
 */
const createMonorepoParityFixture = (): MonorepoParityFixture => {
	const root = path.join(tmpdir(), `ts-scan-monorepo-parity-${Date.now()}`);
	tempDirs.push(root);

	mkdirSync(path.join(root, 'packages', 'runtime', 'src'), { recursive: true });
	mkdirSync(path.join(root, 'packages', 'server', 'src', 'bridge'), {
		recursive: true,
	});
	mkdirSync(path.join(root, 'packages', 'shared', 'src', 'types'), {
		recursive: true,
	});
	mkdirSync(path.join(root, 'node_modules', '@test'), { recursive: true });
	mkdirSync(path.join(root, 'node_modules', 'fake-rxjs'), { recursive: true });

	writeFileSync(
		path.join(root, 'tsconfig.base.json'),
		JSON.stringify({
			compilerOptions: {
				target: 'ES2022',
				module: 'NodeNext',
				moduleResolution: 'NodeNext',
				strict: true,
				skipLibCheck: true,
				composite: true,
				declaration: true,
			},
		}),
	);

	writeFileSync(
		path.join(root, 'tsconfig.json'),
		JSON.stringify({
			files: [],
			references: [
				{ path: './packages/runtime' },
				{ path: './packages/server' },
				{ path: './packages/shared' },
			],
		}),
	);

	// --- runtime ---
	writeFileSync(
		path.join(root, 'packages', 'runtime', 'package.json'),
		JSON.stringify({
			name: '@test/runtime',
			version: '1.0.0',
			types: 'src/types.ts',
			exports: {
				'.': {
					types: './src/types.ts',
					default: './src/types.ts',
				},
			},
			dependencies: { 'fake-rxjs': '1.0.0' },
		}),
	);
	writeFileSync(
		path.join(root, 'packages', 'runtime', 'tsconfig.json'),
		JSON.stringify({
			extends: '../../tsconfig.base.json',
			compilerOptions: { rootDir: 'src', outDir: 'dist' },
			include: ['src/**/*.ts'],
		}),
	);
	writeFileSync(
		path.join(root, 'packages', 'runtime', 'src', 'runtime-helpers.ts'),
		'export type GraphCluster = { nodeIds: string[] };\n',
	);
	const runtimeTypes = path.join(
		root,
		'packages',
		'runtime',
		'src',
		'types.ts',
	);
	writeFileSync(
		runtimeTypes,
		[
			"import type { Observable } from 'fake-rxjs';",
			"import type { StatefulConnection } from 'fake-stateful';",
			"import type { GraphCluster } from './runtime-helpers.js';",
			'',
			'export type RuntimeEdge = {',
			'\treadonly edgeId: string;',
			'\treadonly fromNodeId: string;',
			'};',
			'',
			'export type LocalCluster = GraphCluster;',
			'export type Observed = Observable<string>;',
			'',
		].join('\n'),
	);

	// --- server ---
	writeFileSync(
		path.join(root, 'packages', 'server', 'package.json'),
		JSON.stringify({
			name: '@test/server',
			version: '1.0.0',
			dependencies: { '@test/runtime': '1.0.0' },
		}),
	);
	writeFileSync(
		path.join(root, 'packages', 'server', 'tsconfig.json'),
		JSON.stringify({
			extends: '../../tsconfig.base.json',
			compilerOptions: { rootDir: 'src', outDir: 'dist' },
			include: ['src/**/*.ts'],
			references: [{ path: '../runtime' }],
		}),
	);
	writeFileSync(
		path.join(root, 'packages', 'server', 'src', 'server-context.ts'),
		'export type ServerContext = { id: string };\n',
	);
	const serverAttach = path.join(
		root,
		'packages',
		'server',
		'src',
		'bridge',
		'attach.ts',
	);
	writeFileSync(
		serverAttach,
		[
			"import type { ServerContext } from '../server-context.js';",
			"import type { RuntimeEdge } from '@test/runtime';",
			'export const attach = (ctx: ServerContext, _edge: RuntimeEdge) => ctx;',
			'',
		].join('\n'),
	);

	// --- shared ---
	writeFileSync(
		path.join(root, 'packages', 'shared', 'package.json'),
		JSON.stringify({ name: '@test/shared', version: '1.0.0' }),
	);
	writeFileSync(
		path.join(root, 'packages', 'shared', 'tsconfig.json'),
		JSON.stringify({
			extends: '../../tsconfig.base.json',
			compilerOptions: { rootDir: 'src', outDir: 'dist' },
			include: ['src/**/*.ts'],
		}),
	);
	const sharedWorkflow = path.join(
		root,
		'packages',
		'shared',
		'src',
		'types',
		'app-workflow.ts',
	);
	writeFileSync(sharedWorkflow, 'export type Workflow = { id: string };\n');
	writeFileSync(
		path.join(root, 'packages', 'shared', 'src', 'types', 'config.ts'),
		'export type Config = { name: string };\n',
	);
	const missingWorkflow = path.join(
		root,
		'packages',
		'shared',
		'src',
		'types',
		'workflow.ts',
	);

	// --- fake-rxjs (large class surface) ---
	writeFileSync(
		path.join(root, 'node_modules', 'fake-rxjs', 'package.json'),
		JSON.stringify({
			name: 'fake-rxjs',
			version: '1.0.0',
			types: 'index.d.ts',
		}),
	);
	writeFileSync(
		path.join(root, 'node_modules', 'fake-rxjs', 'index.d.ts'),
		[
			'export declare class Observable<T> {',
			'  lift(operator?: unknown): Observable<T>;',
			'  subscribe(next?: (value: T) => void): void;',
			'  pipe(...ops: unknown[]): Observable<T>;',
			'  toPromise(): Promise<T | undefined>;',
			'  forEach(next: (value: T) => void): Promise<void>;',
			'}',
			'',
		].join('\n'),
	);

	// --- fake-stateful (external type alias with large RHS) ---
	mkdirSync(path.join(root, 'node_modules', 'fake-stateful'), {
		recursive: true,
	});
	writeFileSync(
		path.join(root, 'node_modules', 'fake-stateful', 'package.json'),
		JSON.stringify({
			name: 'fake-stateful',
			version: '1.0.0',
			types: 'index.d.ts',
		}),
	);
	writeFileSync(
		path.join(root, 'node_modules', 'fake-stateful', 'index.d.ts'),
		[
			'export type StatefulConnection<T = unknown, E = Error, Meta = unknown> =',
			'  { connect(source: T): void; disconnect(): void } &',
			'  { meta: Meta; error: E; payload: T; extra1: string; extra2: string };',
			'',
		].join('\n'),
	);

	// workspace link for @test/runtime
	try {
		symlinkSync(
			path.join(root, 'packages', 'runtime'),
			path.join(root, 'node_modules', '@test', 'runtime'),
			'junction',
		);
	} catch {
		mkdirSync(path.join(root, 'node_modules', '@test', 'runtime', 'src'), {
			recursive: true,
		});
		writeFileSync(
			path.join(root, 'node_modules', '@test', 'runtime', 'package.json'),
			JSON.stringify({
				name: '@test/runtime',
				version: '1.0.0',
				types: 'src/types.ts',
				exports: {
					'.': { types: './src/types.ts', default: './src/types.ts' },
				},
			}),
		);
		writeFileSync(
			path.join(root, 'node_modules', '@test', 'runtime', 'src', 'types.ts'),
			'export type RuntimeEdge = { readonly edgeId: string; readonly fromNodeId: string };\n',
		);
	}

	return {
		root,
		runtimeTypes,
		serverAttach,
		sharedWorkflow,
		missingWorkflow,
	};
};

describe('monorepo parity fixture', () => {
	it('issue1: check_type_errors has no TS6307 for runtime sibling .js import', () => {
		const { runtimeTypes } = createMonorepoParityFixture();
		const projectResult = getTsMorphProjectForFile(runtimeTypes);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = getFileErrors(runtimeTypes, projectResult.data.project);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).not.toContain('TS6307');
		expect(result.data).toBe('✅ Ok');
	});

	it('issue1: check_type_errors has no TS6307 cascade for server bridge siblings', () => {
		const { serverAttach } = createMonorepoParityFixture();
		const projectResult = getTsMorphProjectForFile(serverAttach);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = getFileErrors(serverAttach, projectResult.data.project);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).not.toContain('TS6307');
		expect(result.data).toBe('✅ Ok');
	});

	it('issue2: missing file says File does not exist (not opaque project message)', () => {
		const { missingWorkflow } = createMonorepoParityFixture();
		const result = resolveTsConfigForFile(missingWorkflow);

		expect(result.success).toBe(false);
		if (result.success) return;

		expect(result.error).toContain('File does not exist:');
		expect(result.error).not.toContain(
			'No configured TypeScript project includes',
		);
		expect(result.error).toContain('Nearest under');
		expect(result.error).toContain('app-workflow.ts');
	});

	it('issue3: list_exports does not emit export export', () => {
		const { runtimeTypes } = createMonorepoParityFixture();
		const projectResult = getTsMorphProjectForFile(runtimeTypes);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = getExportedSymbols(
			runtimeTypes,
			projectResult.data.project,
			['RuntimeEdge'],
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('export type RuntimeEdge');
		expect(result.data).not.toContain('export export');
	});

	it('issue4: resolve_symbol ranks package import over cross-package relative', () => {
		const { serverAttach } = createMonorepoParityFixture();
		const projectResult = getTsMorphProjectForFile(serverAttach);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = resolveSymbol(
			'RuntimeEdge',
			projectResult.data.project,
			projectResult.data.resolved,
			serverAttach,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		const output = result.data.formattedOutput;
		expect(output).toContain('Recommended import: @test/runtime');
		expect(output).toContain('Implementation path (cross-package)');
		expect(output.indexOf('Recommended import:')).toBeLessThan(
			output.indexOf('Implementation path (cross-package)'),
		);
		expect(output).not.toContain('export export');
	});

	it('issue5: list_imports compact truncates third-party and avoids T = T', () => {
		const { runtimeTypes } = createMonorepoParityFixture();
		const projectResult = getTsMorphProjectForFile(runtimeTypes);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = fetchImportedSymbols(
			runtimeTypes,
			projectResult.data.project,
			[],
			'compact',
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toContain('export class Observable /* from fake-rxjs */');
		expect(result.data).not.toContain('subscribe(');
		expect(result.data).not.toContain('pipe(');
		expect(result.data).toContain(
			'export type StatefulConnection /* from fake-stateful */',
		);
		expect(result.data).not.toMatch(
			/export type StatefulConnection\s*=\s*StatefulConnection/,
		);
		expect(result.data).toContain('export type GraphCluster = {');
		expect(result.data).not.toContain('export type GraphCluster = GraphCluster');
		expect(result.data.length).toBeLessThan(2500);
	});
});
