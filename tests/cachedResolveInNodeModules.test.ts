import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	cachedResolveExportInNodeModules,
	resetExportCaches,
} from '../src/tools/exportCache/exportCache.ts';
import { resolveTsConfigForFile } from '../src/tools/resolveTsConfig.ts';

const anchorFile = path.resolve('src/types.ts');
const resolvedConfig = (() => {
	const result = resolveTsConfigForFile(anchorFile);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
})();

afterEach(() => {
	resetExportCaches();
});

const resolve = (symbol: string) =>
	cachedResolveExportInNodeModules(symbol, {
		anchorFile,
		resolvedConfig,
	});

describe('cachedResolveExportInNodeModules', () => {
	it('returns a not-found message for an unknown symbol', () => {
		const result = resolve('NonExistentSymbol123');

		expect(result.success).toBe(false);
		if (result.success) return;

		expect(result.error).toContain('Symbol "NonExistentSymbol123" not found.');
	});

	it('finds Project from ts-morph', () => {
		const result = resolve('Project');

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data[0]).toContain('ts-morph');
	});

	it('finds ScriptTarget from ts-morph', () => {
		const result = resolve('ScriptTarget');

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.some((item) => item.includes('typescript'))).toBe(
			true,
		);
		expect(result.data.some((item) => item.includes('ts-morph'))).toBe(true);
	});

	it('finds createPipe from typed-pipe', () => {
		const result = resolve('createPipe');

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data[0]).toContain('typed-pipe');
	});

	it('finds ModuleKind from ts-morph', () => {
		const result = resolve('ModuleKind');

		expect(result.success).toBe(true);
		if (!result.success) return;

		expect(result.data.some((item) => item.includes('typescript'))).toBe(
			true,
		);
		expect(result.data.some((item) => item.includes('ts-morph'))).toBe(true);
	});

	it('finds symbols from different packages', () => {
		const zodResult = resolve('z');
		expect(zodResult.success).toBe(true);
		if (zodResult.success) {
			expect(zodResult.data[0]).toMatch(/zod/);
		}

		const tslibResult = resolve('__assign');
		expect(tslibResult.success).toBe(true);
		if (tslibResult.success) {
			expect(tslibResult.data[0]).toMatch(/tslib/);
		}
	});

	it('handles symbols that exist in multiple packages', () => {
		const result = resolve('default');
		expect(result.success).toBe(true);
		if (!result.success) return;
	});
});
