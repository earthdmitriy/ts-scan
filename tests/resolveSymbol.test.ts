import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import {
	findNearestPackageName,
	resolveSymbol,
} from '../src/tools/resolve/resolveSymbol.ts';
import { resetExportCaches } from '../src/tools/exportCache/exportCache.ts';

const tempDirs: string[] = [];

afterEach(() => {
	resetCurrentTsMorphProject();
	resetExportCaches();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const createWorkspaceFixture = () => {
	const root = path.join(tmpdir(), `ts-scan-resolve-rank-${Date.now()}`);
	tempDirs.push(root);

	mkdirSync(path.join(root, 'packages', 'runtime', 'src'), { recursive: true });
	mkdirSync(path.join(root, 'packages', 'server', 'src'), { recursive: true });
	mkdirSync(path.join(root, 'node_modules', '@test'), { recursive: true });

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
			],
		}),
	);

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
		path.join(root, 'packages', 'runtime', 'src', 'types.ts'),
		'export type RuntimeEdge = { id: string };\n',
	);

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
	const serverFile = path.join(root, 'packages', 'server', 'src', 'app.ts');
	writeFileSync(serverFile, 'export const app = 1;\n');

	try {
		symlinkSync(
			path.join(root, 'packages', 'runtime'),
			path.join(root, 'node_modules', '@test', 'runtime'),
			'junction',
		);
	} catch {
		// Fallback: copy package.json pointer via nested files for resolve.
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
					'.': {
						types: './src/types.ts',
						default: './src/types.ts',
					},
				},
			}),
		);
		writeFileSync(
			path.join(root, 'node_modules', '@test', 'runtime', 'src', 'types.ts'),
			'export type RuntimeEdge = { id: string };\n',
		);
	}

	return { root, serverFile };
};

describe('findNearestPackageName', () => {
	it('returns package name from nearest package.json', () => {
		const { serverFile } = createWorkspaceFixture();
		expect(findNearestPackageName(serverFile)).toBe('@test/server');
	});
});

describe('resolveSymbol ranking', () => {
	it('prefers package import over cross-package relative path', () => {
		const { serverFile } = createWorkspaceFixture();
		const projectResult = getTsMorphProjectForFile(serverFile);
		expect(projectResult.success).toBe(true);
		if (!projectResult.success) return;

		const result = resolveSymbol(
			'RuntimeEdge',
			projectResult.data.project,
			projectResult.data.resolved,
			serverFile,
		);

		expect(result.success).toBe(true);
		if (!result.success) return;

		const output = result.data.formattedOutput;
		expect(output).toContain('Recommended import: @test/runtime');
		expect(output).toContain('Implementation path (cross-package)');

		const recommendedIdx = output.indexOf('Recommended import:');
		const implementationIdx = output.indexOf(
			'Implementation path (cross-package)',
		);
		expect(recommendedIdx).toBeGreaterThanOrEqual(0);
		expect(implementationIdx).toBeGreaterThan(recommendedIdx);
	});
});
