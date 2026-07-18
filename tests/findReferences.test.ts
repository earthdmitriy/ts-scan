import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import { findReferences } from '../src/tools/findReferences/findReferences.ts';
import { resolveProjectGraphForFile } from '../src/tools/projectGraph/resolveProjectGraphForFile.ts';

afterEach(() => {
	resetCurrentTsMorphProject();
});

const declarationFile = path.resolve(
	'samples/find-references/declaration.ts',
);
const readsWritesFile = path.resolve(
	'samples/find-references/reads-writes.ts',
);
const callsFile = path.resolve('samples/find-references/calls.ts');
const reExportFile = path.resolve('samples/find-references/re-export.ts');
const typesFile = path.resolve('samples/find-references/types-usage.ts');
const commentsFile = path.resolve('samples/find-references/comments.ts');
const testFile = path.resolve('samples/find-references/consumer.test.ts');
const unrelatedFile = path.resolve('samples/find-references/unrelated.ts');
const libraryApi = path.resolve(
	'samples/find-references/workspace/packages/library/src/api.ts',
);
const appConsumer = path.resolve(
	'samples/find-references/workspace/packages/app/src/consumer.ts',
);

const projectFor = (filePath: string) => {
	const result = getTsMorphProjectForFile(filePath);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
};

const cursorAt = (
	filePath: string,
	marker: string,
): { line: number; column: number } => {
	const text = readFileSync(filePath, 'utf8');
	const needle = `/*cursor:${marker}*/`;
	const idx = text.indexOf(needle);
	if (idx < 0) {
		throw new Error(`Marker not found: ${needle} in ${filePath}`);
	}

	let pos = idx + needle.length;
	while (pos < text.length && /\s/.test(text[pos]!)) {
		pos++;
	}

	const keywords = new Set([
		'const',
		'let',
		'var',
		'export',
		'return',
		'type',
		'function',
		'class',
		'interface',
		'import',
		'from',
		'async',
		'await',
		'new',
		'typeof',
		'void',
	]);

	while (pos < text.length) {
		while (pos < text.length && /\s/.test(text[pos]!)) {
			pos++;
		}
		if (text[pos] === '.') {
			pos++;
			continue;
		}
		const ident = text.slice(pos).match(/^[A-Za-z_$][\w$]*/);
		if (!ident) {
			throw new Error(`No token after marker ${marker} in ${filePath}`);
		}
		if (!keywords.has(ident[0]!)) {
			const line = text.slice(0, pos).split(/\r?\n/).length;
			const lineStart = text.lastIndexOf('\n', pos) + 1;
			return { line, column: pos - lineStart + 1 };
		}
		pos += ident[0]!.length;
	}

	throw new Error(`No identifier after marker ${marker} in ${filePath}`);
};

const refsAt = (filePath: string, marker: string, extras: object = {}) => {
	const { line, column } = cursorAt(filePath, marker);
	const { project, resolved } = projectFor(filePath);
	return findReferences(
		{ filePath, line, column, ...extras },
		project,
		resolved,
	);
};

const kindsIn = (
	result: Awaited<ReturnType<typeof findReferences>>,
): string[] => {
	if (!result.success) return [];
	return result.data.data.references.map((r) => r.kind);
};

describe('resolveProjectGraphForFile', () => {
	it('marks owner-and-dependencies when no solution root exists', () => {
		const graph = resolveProjectGraphForFile(declarationFile);
		expect(graph.success).toBe(true);
		if (!graph.success) return;
		expect(graph.data.scope).toBe('owner-and-dependencies');
		expect(graph.data.notes.some((n) => n.includes('No solution'))).toBe(
			true,
		);
	});

	it('discovers solution-wide graph for workspace package file', () => {
		const graph = resolveProjectGraphForFile(appConsumer);
		expect(graph.success).toBe(true);
		if (!graph.success) return;
		expect(graph.data.scope).toBe('solution-wide');
		expect(graph.data.configs.length).toBeGreaterThanOrEqual(2);
		const paths = graph.data.configs.map((c) =>
			c.tsConfigPath.replace(/\\/g, '/'),
		);
		expect(paths.some((p) => p.includes('/library/'))).toBe(true);
		expect(paths.some((p) => p.includes('/app/'))).toBe(true);
	});

	it('discovers workspace dependents via package.json when no TS references', () => {
		const libraryApi = path.resolve(
			'samples/workspace-deps/packages/library/src/api.ts',
		);
		const graph = resolveProjectGraphForFile(libraryApi);
		expect(graph.success).toBe(true);
		if (!graph.success) return;
		expect(graph.data.scope).toBe('workspace');
		const paths = graph.data.configs.map((c) =>
			c.tsConfigPath.replace(/\\/g, '/'),
		);
		expect(paths.some((p) => p.includes('/library/'))).toBe(true);
		expect(paths.some((p) => p.includes('/app/'))).toBe(true);
		expect(
			graph.data.notes.some((n) => n.includes('package.json dependency')),
		).toBe(true);
	});

	it('returns owner-only when crossPackage is false', () => {
		const graph = resolveProjectGraphForFile(appConsumer, {
			crossPackage: false,
		});
		expect(graph.success).toBe(true);
		if (!graph.success) return;
		expect(graph.data.scope).toBe('owner');
		expect(graph.data.configs).toHaveLength(1);
	});
});

describe('findReferences', () => {
	it('classifies declaration, read, and write for trackedMutable', () => {
		const result = refsAt(declarationFile, 'decl-write');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const kinds = new Set(kindsIn(result));
		expect(kinds.has('declaration')).toBe(true);
		expect(kinds.has('read') || kinds.has('write')).toBe(true);
		expect(kinds.has('write')).toBe(true);
		expect(result.data.data.symbol).toBe('trackedMutable');
	});

	it('classifies direct invocation as call', () => {
		const result = refsAt(callsFile, 'call-site');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(kindsIn(result)).toContain('call');
		expect(result.data.data.symbol).toBe('trackedFn');
	});

	it('classifies type annotation references as type', () => {
		const result = refsAt(typesFile, 'type-ref');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(kindsIn(result)).toContain('type');
		expect(result.data.data.symbol).toBe('TrackedId');
	});

	it('classifies import and named re-export', () => {
		const result = refsAt(declarationFile, 'decl-read');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const kinds = kindsIn(result);
		expect(kinds).toContain('import');
		expect(kinds).toContain('export');
		const files = result.data.data.references.map((r) =>
			r.file.replace(/\\/g, '/'),
		);
		expect(files.some((f) => f.endsWith('/re-export.ts'))).toBe(true);
		expect(files.some((f) => f.endsWith('/reads-writes.ts'))).toBe(true);
		void reExportFile;
		void readsWritesFile;
	});

	it('does not match the same text in comments or strings', () => {
		const result = refsAt(commentsFile, 'comment-real');
		expect(result.success).toBe(true);
		if (!result.success) return;
		for (const ref of result.data.data.references) {
			const snippet = ref.snippet ?? '';
			expect(snippet.includes('// trackedValue')).toBe(false);
			expect(snippet.includes("'trackedValue")).toBe(false);
		}
	});

	it('finds public alias references across workspace packages', () => {
		const text = readFileSync(libraryApi, 'utf8');
		const idx = text.indexOf('function sharedHelper');
		expect(idx).toBeGreaterThanOrEqual(0);
		const nameIdx = text.indexOf('sharedHelper', idx);
		const line = text.slice(0, nameIdx).split(/\r?\n/).length;
		const lineStart = text.lastIndexOf('\n', nameIdx) + 1;
		const column = nameIdx - lineStart + 1;
		const { project, resolved } = projectFor(libraryApi);
		const found = findReferences(
			{ filePath: libraryApi, line, column },
			project,
			resolved,
		);
		expect(found.success).toBe(true);
		if (!found.success) return;
		expect(found.data.data.scope).toBe('solution-wide');
		const files = found.data.data.references.map((r) =>
			r.file.replace(/\\/g, '/'),
		);
		expect(files.some((f) => f.endsWith('/consumer.ts'))).toBe(true);
		expect(files.some((f) => f.endsWith('/api.ts'))).toBe(true);
	});

	it('removes only declaration when includeDeclaration is false', () => {
		const withDecl = refsAt(declarationFile, 'decl-read');
		const without = refsAt(declarationFile, 'decl-read', {
			includeDeclaration: false,
		});
		expect(withDecl.success && without.success).toBe(true);
		if (!withDecl.success || !without.success) return;
		expect(kindsIn(withDecl)).toContain('declaration');
		expect(kindsIn(without)).not.toContain('declaration');
		expect(kindsIn(without).length).toBeGreaterThan(0);
		// Exports should still be present when declarations are excluded.
		expect(
			kindsIn(without).includes('export') ||
				kindsIn(without).includes('import') ||
				kindsIn(without).includes('read'),
		).toBe(true);
	});

	it('removes test entries when includeTests is false', () => {
		const withTests = refsAt(declarationFile, 'decl-read');
		const without = refsAt(declarationFile, 'decl-read', {
			includeTests: false,
		});
		expect(withTests.success && without.success).toBe(true);
		if (!withTests.success || !without.success) return;
		const testPath = testFile.replace(/\\/g, '/');
		expect(
			withTests.data.data.references.some((r) =>
				r.file.replace(/\\/g, '/').endsWith('/consumer.test.ts'),
			),
		).toBe(true);
		expect(
			without.data.data.references.some((r) =>
				r.file.replace(/\\/g, '/').includes(path.basename(testPath)),
			),
		).toBe(false);
	});

	it('truncates with stable ordering when maxResults is hit', () => {
		const full = refsAt(declarationFile, 'decl-read');
		expect(full.success).toBe(true);
		if (!full.success) return;
		expect(full.data.data.references.length).toBeGreaterThanOrEqual(3);

		const capped = refsAt(declarationFile, 'decl-read', {
			maxResults: 2,
		});
		expect(capped.success).toBe(true);
		if (!capped.success) return;
		expect(capped.data.data.references).toHaveLength(2);
		expect(capped.data.data.truncated).toBe(true);

		const expected = full.data.data.references.slice(0, 2);
		expect(capped.data.data.references.map((r) => `${r.file}:${r.line}`)).toEqual(
			expected.map((r) => `${r.file}:${r.line}`),
		);
	});

	it('does not merge unrelated same-named symbols', () => {
		const result = refsAt(unrelatedFile, 'unrelated-use');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const files = result.data.data.references.map((r) =>
			r.file.replace(/\\/g, '/'),
		);
		expect(files.every((f) => f.endsWith('/unrelated.ts'))).toBe(true);
		expect(files.some((f) => f.endsWith('/declaration.ts'))).toBe(false);
	});

	it('returns ambiguous_symbol for distinct same-named exports', () => {
		const { project, resolved } = projectFor(declarationFile);
		const result = findReferences(
			{
				symbol: 'ambiguousHelper',
				relativeTo: declarationFile,
			},
			project,
			resolved,
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error).toContain('ambiguous_symbol');
		expect(result.error).toContain('ambiguous-a');
		expect(result.error).toContain('ambiguous-b');
	});

	it('exposes owner-and-dependencies scope without a solution root', () => {
		const result = refsAt(declarationFile, 'decl-read');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.scope).toBe('owner-and-dependencies');
		expect(
			result.data.data.notes.some((n) =>
				n.includes('owner-and-dependencies'),
			),
		).toBe(true);
	});

	it('finds cross-package refs via workspace package edges (no TS references)', () => {
		const libraryApi = path.resolve(
			'samples/workspace-deps/packages/library/src/api.ts',
		);
		const result = refsAt(libraryApi, 'shared-helper', { maxResults: 50 });
		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error(result.error);
		}
		expect(result.data.data.scope).toBe('workspace');
		expect(
			result.data.data.references.some((r) =>
				r.file.replace(/\\/g, '/').includes('/app/src/consumer.ts'),
			),
		).toBe(true);
	});

	it('reports totalCount when truncated', () => {
		const result = refsAt(declarationFile, 'decl-read', {
			maxResults: 1,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.truncated).toBe(true);
		expect(result.data.data.totalCount).toBeGreaterThan(1);
		expect(result.data.data.references).toHaveLength(1);
		expect(result.data.formattedOutput).toMatch(
			/references: 1 of \d+/,
		);
	});

	it('supports symbol + relativeTo mode for a unique export', () => {
		const { project, resolved } = projectFor(declarationFile);
		const result = findReferences(
			{
				symbol: 'trackedFn',
				relativeTo: callsFile,
			},
			project,
			resolved,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.symbol).toBe('trackedFn');
		expect(kindsIn(result)).toContain('call');
	});

	it('rejects mixed position and symbol modes', () => {
		const { project, resolved } = projectFor(declarationFile);
		const result = findReferences(
			{
				filePath: declarationFile,
				line: 1,
				symbol: 'trackedValue',
				relativeTo: declarationFile,
			},
			project,
			resolved,
		);
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error).toMatch(/not both|cannot include/i);
	});
});
