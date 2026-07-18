import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandMap } from '../src/commands.ts';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import { reachability } from '../src/tools/reachability/reachability.ts';

afterEach(() => {
	resetCurrentTsMorphProject();
});

const root = path.resolve('samples/reachability/workspace');
const internalFile = path.join(root, 'src/internal.ts');
const deadFile = path.join(root, 'src/dead.ts');
const bridgeAttachFile = path.join(root, 'src/bridge-attach.ts');

const projectFor = (filePath: string) => {
	const result = getTsMorphProjectForFile(filePath);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
};

const nameOnLine = (
	filePath: string,
	exportName: string,
): { line: number; column: number } => {
	const text = readFileSync(filePath, 'utf8');
	const patterns = [
		new RegExp(`function\\s+${exportName}\\b`),
		new RegExp(`const\\s+${exportName}\\b`),
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (!match || match.index === undefined) continue;
		const nameIdx = text.indexOf(exportName, match.index);
		const line = text.slice(0, nameIdx).split(/\r?\n/).length;
		const lineStart = text.lastIndexOf('\n', nameIdx) + 1;
		return { line, column: nameIdx - lineStart + 1 };
	}
	throw new Error(`Export ${exportName} not found in ${filePath}`);
};

const reachAt = (
	filePath: string,
	exportName: string,
	extras: object = {},
) => {
	const { line, column } = nameOnLine(filePath, exportName);
	const { project } = projectFor(filePath);
	return reachability(
		{ filePath, line, column, ...extras },
		project,
	);
};

describe('reachability', () => {
	it(
		'finds outer export path createServer → attachAppBridge → leaf',
		() => {
			const result = reachAt(bridgeAttachFile, 'bridgeOnlyLeaf', {
				entrypointKinds: ['export', 'handler'],
				maxDepth: 3,
				maxPaths: 8,
			});
			expect(result.success).toBe(true);
			if (!result.success) return;
			const exportPath = result.data.data.paths.find(
				(p) =>
					p.entrypoint.kind === 'export' &&
					p.entrypoint.name === 'createServer',
			);
			expect(exportPath).toBeDefined();
			const names = exportPath!.steps.map((s) => s.name);
			expect(names[0]).toBe('createServer');
			expect(names).toContain('attachAppBridge');
			expect(names[names.length - 1]).toBe('bridgeOnlyLeaf');
			const handlerPath = result.data.data.paths.find(
				(p) =>
					p.entrypoint.kind === 'handler' &&
					p.entrypoint.name === 'attachAppBridge',
			);
			expect(handlerPath).toBeDefined();
		},
		20_000,
	);

	it('omitted column on export line resolves target (not ExportKeyword)', () => {
		const { line } = nameOnLine(internalFile, 'leafHelper');
		const { project } = projectFor(internalFile);
		const result = reachability(
			{ filePath: internalFile, line },
			project,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.target.name).toBe('leafHelper');
		expect(result.data.data.paths.length).toBeGreaterThanOrEqual(1);
		expect(result.data.formattedOutput).not.toMatch(/ExportKeyword/);
	});

	it(
		'finds high-confidence export path publicApi → midHelper → leafHelper',
		() => {
			const result = reachAt(internalFile, 'leafHelper');
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = result.data.data;
			expect(data.target.name).toBe('leafHelper');
			const exportPath = data.paths.find(
				(p) =>
					p.entrypoint.kind === 'export' &&
					p.entrypoint.name === 'publicApi',
			);
			expect(exportPath).toBeDefined();
			expect(exportPath!.confidence).toBe('high');
			const names = exportPath!.steps.map((s) => s.name);
			expect(names[0]).toBe('publicApi');
			expect(names[names.length - 1]).toBe('leafHelper');
			expect(names).toContain('midHelper');
			expect(result.data.formattedOutput).toMatch(/static approximation/i);
			expect(result.data.formattedOutput).toMatch(/never a runtime stack/i);
			expect(result.data.formattedOutput).not.toMatch(
				/\bis a runtime (stack|call stack)\b/i,
			);
		},
		20_000,
	);

	it('finds test path for onlyFromTest', () => {
		const result = reachAt(internalFile, 'onlyFromTest');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const testPath = result.data.data.paths.find(
			(p) => p.entrypoint.kind === 'test',
		);
		expect(testPath).toBeDefined();
		expect(testPath!.steps[testPath!.steps.length - 1]!.name).toBe(
			'onlyFromTest',
		);
		expect(
			testPath!.entrypoint.location.file.replace(/\\/g, '/'),
		).toMatch(/internal\.test\.ts$/);
	});

	it('finds high-confidence bin path via runCli', () => {
		const result = reachAt(internalFile, 'leafHelper', {
			entrypointKinds: ['bin'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const binPath = result.data.data.paths.find(
			(p) =>
				p.entrypoint.kind === 'bin' && p.entrypoint.name === 'runCli',
		);
		expect(binPath).toBeDefined();
		expect(binPath!.confidence).toBe('high');
		expect(binPath!.steps[0]!.name).toBe('runCli');
		expect(binPath!.entrypoint.location.file.replace(/\\/g, '/')).toMatch(
			/cli\.ts$/,
		);
	});

	it('finds medium handler path via wireEventHandlers', () => {
		const result = reachAt(internalFile, 'leafHelper', {
			entrypointKinds: ['handler'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const handlerPath = result.data.data.paths.find(
			(p) =>
				p.entrypoint.kind === 'handler' &&
				p.entrypoint.name === 'wireEventHandlers',
		);
		expect(handlerPath).toBeDefined();
		expect(handlerPath!.confidence).toBe('medium');
		expect(
			result.data.data.notes.some((n) => /handler heuristic/i.test(n)),
		).toBe(true);
	});

	it('returns two converging roots for leafHelper', () => {
		const result = reachAt(internalFile, 'leafHelper', {
			entrypointKinds: ['export', 'handler'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const viaA = result.data.data.paths.filter(
			(p) =>
				p.entrypoint.name === 'publicConverge' ||
				p.steps.some((s) => s.name === 'convergeA'),
		);
		const viaB = result.data.data.paths.filter(
			(p) =>
				p.entrypoint.name === 'wireConverge' ||
				p.steps.some((s) => s.name === 'convergeB'),
		);
		expect(viaA.length).toBeGreaterThanOrEqual(1);
		expect(viaB.length).toBeGreaterThanOrEqual(1);
		const signatures = new Set(
			result.data.data.paths.map((p) =>
				p.steps.map((s) => s.name).join('>'),
			),
		);
		expect(signatures.size).toBe(result.data.data.paths.length);
	});

	it('handles cycle before a valid export root', () => {
		const result = reachAt(internalFile, 'cycleTarget', {
			maxDepth: 8,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		const exportPath = result.data.data.paths.find(
			(p) =>
				p.entrypoint.kind === 'export' &&
				(p.entrypoint.name === 'publicCycle' ||
					p.steps.some((s) => s.name === 'cycleRoot')),
		);
		expect(exportPath).toBeDefined();
		expect(exportPath!.steps[exportPath!.steps.length - 1]!.name).toBe(
			'cycleTarget',
		);
		expect(exportPath!.steps.map((s) => s.name)).toContain('cyclePeer');
	});

	it('dead target with unknown enabled yields soft-root', () => {
		const result = reachAt(deadFile, 'deadFn', {
			entrypointKinds: ['unknown'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.paths).toHaveLength(1);
		expect(result.data.data.paths[0]!.entrypoint.kind).toBe('unknown');
		expect(result.data.data.paths[0]!.confidence).toBe('low');
		expect(result.data.data.notes.some((n) => /no_callers/i.test(n))).toBe(
			true,
		);
	});

	it('dead target with unknown filtered yields empty paths', () => {
		const result = reachAt(deadFile, 'deadFn', {
			entrypointKinds: ['export', 'test', 'handler', 'bin'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.paths).toHaveLength(0);
		expect(result.data.data.notes).toContain('no_callers_found');
	});

	it('maxDepth soft-root when unknown enabled', () => {
		const result = reachAt(internalFile, 'leafHelper', {
			maxDepth: 2,
			entrypointKinds: ['unknown'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(
			result.data.data.paths.some((p) => p.entrypoint.kind === 'unknown'),
		).toBe(true);
		expect(
			result.data.data.notes.some((n) => /max_depth|maxDepth/i.test(n)),
		).toBe(true);
	});

	it('maxPaths sets truncated and stable subset', () => {
		const result = reachAt(internalFile, 'leafHelper', {
			maxPaths: 1,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.paths.length).toBeLessThanOrEqual(1);
		expect(result.data.data.truncated).toBe(true);
		expect(
			result.data.data.notes.some((n) => /maxPaths/i.test(n)),
		).toBe(true);
	});

	it('analysis error is a hard error, not dead/unknown', () => {
		const missing = path.join(root, 'src/does-not-exist.ts');
		const { project } = projectFor(internalFile);
		const result = reachability(
			{ filePath: missing, line: 1, column: 1 },
			project,
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.length).toBeGreaterThan(0);
		expect(result.error).not.toMatch(/no_callers_found|unknown soft-root/i);
	});

	it('steps are ordered entry → target', () => {
		const result = reachAt(internalFile, 'leafHelper', {
			entrypointKinds: ['export'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		for (const p of result.data.data.paths) {
			expect(p.steps[p.steps.length - 1]!.name).toBe('leafHelper');
			expect(p.steps[0]!.name).toBe(p.entrypoint.name);
		}
	});

	it('filters entrypointKinds', () => {
		const result = reachAt(internalFile, 'leafHelper', {
			entrypointKinds: ['bin'],
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(
			result.data.data.paths.every((p) => p.entrypoint.kind === 'bin'),
		).toBe(true);
		expect(result.data.data.paths.length).toBeGreaterThanOrEqual(1);
	});

	it('CLI --reachability returns formatted static paths', () => {
		const { line, column } = nameOnLine(internalFile, 'leafHelper');
		const { project, resolved } = projectFor(internalFile);
		const cmd = commandMap['--reachability'];
		const result = cmd.action(
			internalFile,
			project,
			resolved,
			line,
			column,
			undefined,
			undefined,
			['export', 'bin'],
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toContain('target: leafHelper');
		expect(result.data).toMatch(/kind: export|kind: bin/);
		expect(result.data).toMatch(/static approximation/i);
		expect(result.data).toMatch(/never a runtime stack/i);
	});
});
