import path from 'path';
import { describe, expect, it } from 'vitest';
import {
	findFileInRoots,
	resolveLocalExport,
	searchWithGrep,
	searchWithRipgrep,
} from '../src/tools/resolve/resolveLocalExport.ts';
import { resolveTsConfigForFile } from '../src/tools/resolveTsConfig.ts';

const sampleDir = path.resolve('samples');

const configFor = (filePath: string) => {
	const absolute = path.resolve(filePath);
	const result = resolveTsConfigForFile(absolute);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
};

const toPosix = (value: string) => value.replace(/\\/g, '/');

describe('Search strategies unit tests', () => {
	const pattern = /export\s+(const|function|class)\s+localResolveSymbol\b/;
	const patternMissing = /export\s+(const|function|class)\s+missingSymbol\b/;
	// Narrow root: avoid scanning the whole samples tree under suite load.
	const exportSearchRoot = path.resolve('samples');

	it(
		'searchWithRipgrep finds symbol when rg is available',
		() => {
			const result = searchWithRipgrep([exportSearchRoot], pattern);
			if (result.success) {
				expect(result.data[0]).toContain('sample-export.ts');
			}
		},
		10_000,
	);

	it(
		'searchWithRipgrep returns null for missing symbol when rg is available',
		() => {
			const result = searchWithRipgrep([exportSearchRoot], patternMissing);
			expect(result).toEqual({ success: true, data: [] });
		},
		10_000,
	);

	it('searchWithGrep finds symbol when grep is available', () => {
		const result = searchWithGrep(
			[exportSearchRoot],
			'localResolveSymbol',
			pattern,
		);
		if (result.success) {
			expect(result.data[0]).toContain('sample-export.ts');
		}
	});

	it('searchWithGrep returns [] for missing symbol when grep is available', () => {
		const result = searchWithGrep(
			[exportSearchRoot],
			'missingSymbol',
			patternMissing,
		);
		expect(result).toEqual({ success: true, data: [] });
	});

	it('findFileInRoots finds symbol via filesystem walk', () => {
		const result = findFileInRoots([sampleDir], pattern);
		if (result.success) {
			expect(result.data[0]).toContain('sample-export.ts');
		}
	});

	it('findFileInRoots returns null for missing symbol via filesystem walk', () => {
		const result = findFileInRoots([sampleDir], patternMissing);
		expect(result).toEqual({ success: true, data: [] });
	});

	it('search strategies return same file path for existing symbol', () => {
		const rgResult = searchWithRipgrep([sampleDir], pattern);
		const grepResult = searchWithGrep(
			[sampleDir],
			'localResolveSymbol',
			pattern,
		);
		const fsResult = findFileInRoots([sampleDir], pattern);

		if (!rgResult.success || !grepResult.success || !fsResult.success) {
			throw new Error(
				'One of the search strategies failed to find the symbol, cannot compare results',
			);
		}

		expect(rgResult).toEqual(fsResult);
		expect(grepResult).toEqual(fsResult);
	});

	it('search strategies all return null for missing symbol', () => {
		const rgResult = searchWithRipgrep([sampleDir], patternMissing);
		const grepResult = searchWithGrep(
			[sampleDir],
			'missingSymbol',
			patternMissing,
		);
		const fsResult = findFileInRoots([sampleDir], patternMissing);

		expect(rgResult).toEqual({ success: true, data: [] });
		expect(grepResult).toEqual({ success: true, data: [] });
		expect(fsResult).toEqual({ success: true, data: [] });
	});
});

describe('resolveLocalExport (integration)', () => {
	it('returns the correct import path for a local export in samples', () => {
		const relativeTo = path.resolve('samples/check/ok.ts');
		const result = resolveLocalExport(
			'localResolveSymbol',
			configFor(relativeTo),
			relativeTo,
		);

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('samples/sample-export.ts')),
				relative: '../sample-export',
			},
		]);
	});

	it('returns empty success for a missing symbol', () => {
		const relativeTo = path.resolve('src/cli.ts');
		const result = resolveLocalExport(
			'missingSymbol',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toEqual([]);
	});
});

describe('relativeTo path calculation', () => {
	it('finds getFileErrors from src/cli.ts', () => {
		const relativeTo = path.resolve('src/cli.ts');
		const result = resolveLocalExport(
			'getFileErrors',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('src/tools/check/getFileErrors.ts')),
				relative: './tools/check/getFileErrors',
			},
		]);
	});

	it('finds createTsMorphProject from src/cli.ts', () => {
		const relativeTo = path.resolve('src/cli.ts');
		const result = resolveLocalExport(
			'createTsMorphProject',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('src/tools/createTsMorphProject.ts')),
				relative: './tools/createTsMorphProject',
			},
		]);
	});

	it('finds getFileErrors from src/router.ts', () => {
		const relativeTo = path.resolve('src/router.ts');
		const result = resolveLocalExport(
			'getFileErrors',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('src/tools/check/getFileErrors.ts')),
				relative: './tools/check/getFileErrors',
			},
		]);
	});

	it('finds resolveLocalExport from src/router.ts', () => {
		const relativeTo = path.resolve('src/router.ts');
		const result = resolveLocalExport(
			'resolveLocalExport',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual([
			{
				path: toPosix(
					path.resolve('src/tools/resolve/resolveLocalExport.ts'),
				),
				relative: './tools/resolve/resolveLocalExport',
			},
		]);
	});

	it('finds success from src/cli.ts', () => {
		const relativeTo = path.resolve('src/cli.ts');
		const result = resolveLocalExport(
			'success',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);

		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('src/types.ts')),
				relative: './types',
			},
		]);
	});

	it('finds startMcp from src/cli.ts', () => {
		const relativeTo = path.resolve('src/cli.ts');
		const result = resolveLocalExport(
			'startMcp',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('src/tools/mcp/startMcp.ts')),
				relative: './tools/mcp/startMcp',
			},
		]);
	});

	it('finds getExportedSymbols from nested src/tools/check/getFileErrors.ts', () => {
		const relativeTo = path.resolve('src/tools/check/getFileErrors.ts');
		const result = resolveLocalExport(
			'getExportedSymbols',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(
					path.resolve('src/tools/exports/getExportedSymbols.ts'),
				),
				relative: '../exports/getExportedSymbols',
			},
		]);
	});

	it('finds success from deeply nested src/tools/check/getFileErrors.ts', () => {
		const relativeTo = path.resolve('src/tools/check/getFileErrors.ts');
		const result = resolveLocalExport(
			'success',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);

		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('src/types.ts')),
				relative: '../../types',
			},
		]);
	});

	it('calculates relative path correctly from src/tools/resolve/resolveLocalExport.ts', () => {
		const relativeTo = path.resolve(
			'src/tools/resolve/resolveLocalExport.ts',
		);
		const result = resolveLocalExport(
			'getFileErrors',
			configFor(relativeTo),
			relativeTo,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data).toEqual([
			{
				path: toPosix(path.resolve('src/tools/check/getFileErrors.ts')),
				relative: '../check/getFileErrors',
			},
		]);
	});

	it('returns empty string when symbol not found regardless of relativeTo', () => {
		const relativeTo1 = path.resolve('src/cli.ts');
		const relativeTo2 = path.resolve('src/tools/check/getFileErrors.ts');
		const result1 = resolveLocalExport(
			'nonExistentSymbol',
			configFor(relativeTo1),
			relativeTo1,
		);
		const result2 = resolveLocalExport(
			'nonExistentSymbol',
			configFor(relativeTo2),
			relativeTo2,
		);
		expect(result1.success).toBe(true);
		expect(result2.success).toBe(true);

		if (!result1.success) return;
		if (!result2.success) return;

		expect(result1.data).toEqual([]);
		expect(result2.data).toEqual([]);
	});
});
