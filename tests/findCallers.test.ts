import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import { findCallers } from '../src/tools/findCallers/findCallers.ts';

afterEach(() => {
	resetCurrentTsMorphProject();
});

const targetsFile = path.resolve('samples/find-callers/targets.ts');
const directFile = path.resolve('samples/find-callers/direct.ts');
const constructorsFile = path.resolve('samples/find-callers/constructors.ts');
const callbacksFile = path.resolve('samples/find-callers/callbacks.ts');
const dynamicFile = path.resolve('samples/find-callers/dynamic.ts');
const cyclesFile = path.resolve('samples/find-callers/cycles.ts');
const taggedJsxFile = path.resolve('samples/find-callers/tagged-jsx.tsx');
const testFile = path.resolve('samples/find-callers/callers.test.ts');
const depthFile = path.resolve('samples/find-callers/depth-chain.ts');
const bridgeFile = path.resolve('samples/find-callers/bridge.ts');
const libraryApi = path.resolve(
	'samples/find-callers/workspace/packages/library/src/api.ts',
);
const appConsumer = path.resolve(
	'samples/find-callers/workspace/packages/app/src/consumer.ts',
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

const callersAt = (
	filePath: string,
	marker: string,
	extras: object = {},
) => {
	const { line, column } = cursorAt(filePath, marker);
	const { project, resolved } = projectFor(filePath);
	return findCallers(
		{ filePath, line, column, ...extras },
		project,
		resolved,
	);
};

const nameOnLine = (
	filePath: string,
	exportName: string,
): { line: number; column: number } => {
	const text = readFileSync(filePath, 'utf8');
	const patterns = [
		new RegExp(`function\\s+${exportName}\\b`),
		new RegExp(`const\\s+${exportName}\\b`),
		new RegExp(`class\\s+${exportName}\\b`),
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

const callersOfName = (
	filePath: string,
	exportName: string,
	extras: object = {},
) => {
	const { line, column } = nameOnLine(filePath, exportName);
	const { project, resolved } = projectFor(filePath);
	return findCallers(
		{ filePath, line, column, ...extras },
		project,
		resolved,
	);
};

describe('findCallers', () => {
	it(
		'finds depth-1 direct_call with high confidence',
		() => {
			const result = callersOfName(targetsFile, 'targetFn');
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = result.data.data;
			expect(data.target.name).toBe('targetFn');
			const direct = data.callers.filter(
				(c) => c.callerName === 'directCaller' && c.depth === 1,
			);
			expect(direct.length).toBeGreaterThanOrEqual(1);
			expect(direct[0]!.kind).toBe('direct_call');
			expect(direct[0]!.confidence).toBe('high');
		},
		15_000,
	);

	it(
		'omitted column on export function resolves callable (skips export)',
		() => {
			const { line, column } = nameOnLine(targetsFile, 'targetFn');
			const { project, resolved } = projectFor(targetsFile);
			const withColumn = findCallers(
				{ filePath: targetsFile, line, column },
				project,
				resolved,
			);
			const omitted = findCallers(
				{ filePath: targetsFile, line },
				project,
				resolved,
			);
			expect(withColumn.success).toBe(true);
			expect(omitted.success).toBe(true);
			if (!withColumn.success || !omitted.success) return;
			expect(omitted.data.data.target.name).toBe('targetFn');
			expect(omitted.data.data.target.name).toBe(
				withColumn.data.data.target.name,
			);
			expect(
				omitted.data.data.callers.some(
					(c) => c.callerName === 'directCaller',
				),
			).toBe(true);
		},
		15_000,
	);

	it(
		'omitted column on export const arrow resolves callable',
		() => {
			const { line } = nameOnLine(targetsFile, 'arrowTarget');
			const { project, resolved } = projectFor(targetsFile);
			const omitted = findCallers(
				{ filePath: targetsFile, line },
				project,
				resolved,
			);
			expect(omitted.success).toBe(true);
			if (!omitted.success) return;
			expect(omitted.data.data.target.name).toBe('arrowTarget');
			expect(omitted.data.formattedOutput).not.toMatch(/ExportKeyword/);
		},
		15_000,
	);

	it('classifies new TargetClass() as new', () => {
		const result = callersOfName(targetsFile, 'TargetClass');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const news = result.data.data.callers.filter((c) => c.kind === 'new');
		expect(news.length).toBeGreaterThanOrEqual(1);
		expect(news.some((c) => c.callerName === 'makeTarget')).toBe(true);
		expect(news.every((c) => c.confidence === 'high')).toBe(true);
	});

	it('classifies tagged template and JSX edges', () => {
		const tagged = callersOfName(targetsFile, 'taggedTarget');
		expect(tagged.success).toBe(true);
		if (!tagged.success) return;
		const taggedEdge = tagged.data.data.callers.find(
			(c) => c.kind === 'tagged_template',
		);
		expect(taggedEdge).toBeDefined();
		expect(taggedEdge!.callerName).toBe('useTagged');

		const jsx = callersOfName(targetsFile, 'JsxTarget');
		expect(jsx.success).toBe(true);
		if (!jsx.success) return;
		const jsxEdge = jsx.data.data.callers.find((c) => c.kind === 'jsx');
		expect(jsxEdge).toBeDefined();
		expect(jsxEdge!.callerName).toBe('useJsx');
	});

	it('resolves arrow assigned to const as stable target/caller name', () => {
		const result = callersOfName(targetsFile, 'arrowTarget');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.target.name).toBe('arrowTarget');
		expect(
			result.data.data.callers.some((c) => c.callerName === 'usesArrow'),
		).toBe(true);
	});

	it('selects enclosing callable when cursor is inside the body', () => {
		const result = callersAt(targetsFile, 'target-body');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.target.name).toBe('targetFn');
		expect(
			result.data.data.callers.some((c) => c.callerName === 'directCaller'),
		).toBe(true);
	});

	it('marks non-call reference as unknown_ref with low confidence', () => {
		const result = callersOfName(targetsFile, 'targetFn');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const unknown = result.data.data.callers.filter(
			(c) => c.kind === 'unknown_ref',
		);
		expect(unknown.length).toBeGreaterThanOrEqual(1);
		expect(unknown.every((c) => c.confidence === 'low')).toBe(true);
		expect(unknown.every((c) => c.kind !== 'direct_call')).toBe(true);
	});

	it('subscribe(handler) is unknown_ref, never direct_call', () => {
		const result = callersAt(callbacksFile, 'handler-decl');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const data = result.data.data;
		expect(data.target.name).toBe('handler');
		const subscribeEdge = data.callers.find(
			(c) =>
				c.snippet.includes('subscribe(handler)') ||
				(c.callerName === 'registerHandler' &&
					c.kind === 'unknown_ref'),
		);
		expect(subscribeEdge).toBeDefined();
		expect(subscribeEdge!.kind).toBe('unknown_ref');
		expect(subscribeEdge!.confidence).toBe('low');
		const badDirect = data.callers.filter(
			(c) =>
				c.kind === 'direct_call' &&
				c.snippet.includes('subscribe(handler)'),
		);
		expect(badDirect).toHaveLength(0);
	});

	it('handles recursive cycles with finite output and a note', () => {
		const result = callersOfName(cyclesFile, 'cycleA', { maxDepth: 3 });
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.callers.length).toBeGreaterThan(0);
		expect(result.data.data.callers.length).toBeLessThan(50);
		expect(
			result.data.data.notes.some((n) => /cycle/i.test(n)),
		).toBe(true);
	});

	it('keeps two distinct depth-1 sites without repeating deeper trees', () => {
		const result = callersOfName(targetsFile, 'targetFn', { maxDepth: 2 });
		expect(result.success).toBe(true);
		if (!result.success) return;
		const twoSites = result.data.data.callers.filter(
			(c) => c.callerName === 'twoSites' && c.depth === 1,
		);
		expect(twoSites.length).toBe(2);
		const deeperFromTwoSites = result.data.data.callers.filter(
			(c) =>
				c.depth === 2 &&
				c.parentId &&
				twoSites.some((t) => t.id === c.parentId),
		);
		// At most one expansion of twoSites definition.
		const parentIds = new Set(deeperFromTwoSites.map((c) => c.parentId));
		expect(parentIds.size).toBeLessThanOrEqual(1);
	});

	it('finds cross-package caller when enabled', () => {
		const result = callersOfName(libraryApi, 'sharedCallable', {
			crossPackage: true,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(
			result.data.data.callers.some(
				(c) =>
					c.callerName === 'runShared' &&
					canonicalizeIncludes(c.location.file, 'consumer.ts'),
			),
		).toBe(true);
	});

	it('removes test callers when includeTests is false', () => {
		const withTests = callersOfName(targetsFile, 'targetFn', {
			includeTests: true,
		});
		const withoutTests = callersOfName(targetsFile, 'targetFn', {
			includeTests: false,
		});
		expect(withTests.success && withoutTests.success).toBe(true);
		if (!withTests.success || !withoutTests.success) return;
		expect(
			withTests.data.data.callers.some((c) =>
				canonicalizeIncludes(c.location.file, 'callers.test.ts'),
			),
		).toBe(true);
		expect(
			withoutTests.data.data.callers.some((c) =>
				canonicalizeIncludes(c.location.file, 'callers.test.ts'),
			),
		).toBe(false);
		void testFile;
	});

	it('respects depth and result caps with truncated flag', () => {
		const depthLimited = callersOfName(targetsFile, 'targetFn', {
			maxDepth: 1,
		});
		expect(depthLimited.success).toBe(true);
		if (!depthLimited.success) return;
		expect(
			depthLimited.data.data.callers.every((c) => c.depth === 1),
		).toBe(true);

		const capped = callersOfName(targetsFile, 'targetFn', {
			maxResults: 2,
			maxDepth: 2,
		});
		expect(capped.success).toBe(true);
		if (!capped.success) return;
		expect(capped.data.data.callers.length).toBeLessThanOrEqual(2);
		expect(capped.data.data.truncated).toBe(true);
		void depthFile;
	});

	it('does not invent high-confidence callers for dynamic any calls', () => {
		const result = callersOfName(targetsFile, 'targetFn');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const dynamicHigh = result.data.data.callers.filter(
			(c) =>
				canonicalizeIncludes(c.location.file, 'dynamic.ts') &&
				c.confidence === 'high' &&
				c.kind === 'direct_call',
		);
		expect(dynamicHigh).toHaveLength(0);
		void dynamicFile;
		void constructorsFile;
		void directFile;
		void taggedJsxFile;
	});

	it('returns not_callable for non-callable targets with a hint', () => {
		const result = callersOfName(targetsFile, 'notCallable');
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error).toMatch(/not_callable/i);
		expect(result.error).toMatch(/found:/i);
	});

	it('supports symbol mode', () => {
		const { project, resolved } = projectFor(directFile);
		const result = findCallers(
			{ symbol: 'targetFn', relativeTo: directFile },
			project,
			resolved,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.target.name).toBe('targetFn');
		expect(result.data.data.callers.length).toBeGreaterThan(0);
	});

	it('rejects mixed position and symbol modes', () => {
		const { project, resolved } = projectFor(targetsFile);
		const result = findCallers(
			{
				filePath: targetsFile,
				line: 1,
				symbol: 'targetFn',
				relativeTo: directFile,
			},
			project,
			resolved,
		);
		expect(result.success).toBe(false);
	});

	it('workspace-shaped: emitBootstrap ← attachAppBridge', () => {
		const result = callersOfName(targetsFile, 'emitBootstrap');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(
			result.data.data.callers.some(
				(c) => c.callerName === 'attachAppBridge',
			),
		).toBe(true);
		void bridgeFile;
		void appConsumer;
		void callbacksFile;
		void cyclesFile;
	});
});

const canonicalizeIncludes = (file: string, fragment: string): boolean =>
	file.replace(/\\/g, '/').includes(fragment);
