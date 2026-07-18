import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getFileErrors } from '../src/tools/check/getFileErrors.ts';
import { getDiagnostics } from '../src/tools/diagnostics/getDiagnostics.ts';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';

const require = createRequire(import.meta.url);

afterEach(() => {
	resetCurrentTsMorphProject();
});

const cleanFile = path.resolve('samples/diagnostics/clean.ts');
const errorsFile = path.resolve('samples/diagnostics/errors.ts');
const warningsFile = path.resolve('samples/diagnostics/warnings.ts');
const relatedFile = path.resolve('samples/diagnostics/related.ts');
const compositeMain = path.resolve(
	'samples/diagnostics/composite/src/main.ts',
);

const projectFor = (filePath: string) => {
	const result = getTsMorphProjectForFile(filePath);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
};

/** Locate a marker comment, then return 1-based line of the next non-empty line. */
const markerLine = (filePath: string, marker: string): number => {
	const text = readFileSync(filePath, 'utf8');
	const needle = `/*${marker}*/`;
	const idx = text.indexOf(needle);
	if (idx < 0) {
		throw new Error(`Marker not found: ${needle} in ${filePath}`);
	}
	return text.slice(0, idx).split(/\r?\n/).length;
};

describe('getDiagnostics', () => {
	it('clean file with defaults returns exactly ✅ Ok', () => {
		const { project } = projectFor(cleanFile);
		const result = getDiagnostics({ filePath: cleanFile }, project);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.diagnostics).toEqual([]);
		expect(result.data.formattedOutput).toBe('✅ Ok');
	});

	it('file with two semantic errors returns two ordered items', () => {
		const { project } = projectFor(errorsFile);
		const result = getDiagnostics({ filePath: errorsFile }, project);
		expect(result.success).toBe(true);
		if (!result.success) return;

		const diags = result.data.data.diagnostics;
		expect(diags.length).toBe(2);
		expect(diags[0]!.code).toBe(2322);
		expect(diags[1]!.code).toBe(2322);
		expect(diags[0]!.category).toBe('error');
		expect(diags[1]!.category).toBe('error');
		expect(diags[0]!.line).toBeLessThan(diags[1]!.line);
		expect(diags[0]!.file.replace(/\\/g, '/')).toMatch(/errors\.ts$/);
		expect(result.data.formattedOutput).toContain('diagnostics:');
		expect(result.data.formattedOutput).toContain('TS2322');
	});

	it('range overlapping one error keeps only that diagnostic', () => {
		const { project } = projectFor(errorsFile);
		const firstLine = markerLine(errorsFile, 'error:first');
		const result = getDiagnostics(
			{
				filePath: errorsFile,
				startLine: firstLine,
				endLine: firstLine,
			},
			project,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.diagnostics.length).toBe(1);
		expect(result.data.data.diagnostics[0]!.line).toBe(firstLine);
		expect(result.data.data.diagnostics[0]!.code).toBe(2322);
	});

	it('range ending before diagnostic returns ✅ Ok', () => {
		const { project } = projectFor(errorsFile);
		const firstLine = markerLine(errorsFile, 'error:first');
		const result = getDiagnostics(
			{
				filePath: errorsFile,
				startLine: 1,
				endLine: Math.max(1, firstLine - 1),
			},
			project,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Line 1 is the first error line in our fixture — use a range before it.
		// If first error is on line 1, end before that span via columns.
		if (firstLine === 1) {
			const colResult = getDiagnostics(
				{
					filePath: errorsFile,
					startLine: 1,
					startColumn: 1,
					endLine: 1,
					endColumn: 2,
				},
				project,
			);
			expect(colResult.success).toBe(true);
			if (!colResult.success) return;
			expect(colResult.data.formattedOutput).toBe('✅ Ok');
		} else {
			expect(result.data.formattedOutput).toBe('✅ Ok');
		}
	});

	it('warning/suggestion excluded with default severity', () => {
		const { project } = projectFor(warningsFile);
		const result = getDiagnostics({ filePath: warningsFile }, project);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.diagnostics).toEqual([]);
		expect(result.data.formattedOutput).toBe('✅ Ok');
	});

	it('severity: all includes warning/suggestion with category', () => {
		const { project } = projectFor(warningsFile);
		const result = getDiagnostics(
			{ filePath: warningsFile, severity: 'all' },
			project,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		const diags = result.data.data.diagnostics;
		expect(diags.length).toBeGreaterThanOrEqual(1);
		const nonError = diags.find(
			(d) => d.category === 'suggestion' || d.category === 'warning',
		);
		expect(nonError).toBeDefined();
		expect(result.data.formattedOutput).toMatch(/suggestion|warning/);
	});

	it('codes.include keeps only matching codes', () => {
		const { project } = projectFor(errorsFile);
		const result = getDiagnostics(
			{
				filePath: errorsFile,
				codes: { include: [2322] },
			},
			project,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.diagnostics.length).toBe(2);
		expect(
			result.data.data.diagnostics.every((d) => d.code === 2322),
		).toBe(true);

		const none = getDiagnostics(
			{
				filePath: errorsFile,
				codes: { include: [9999] },
			},
			project,
		);
		expect(none.success).toBe(true);
		if (!none.success) return;
		expect(none.data.formattedOutput).toBe('✅ Ok');
	});

	it('include then matching exclude yields empty result', () => {
		const { project } = projectFor(errorsFile);
		const result = getDiagnostics(
			{
				filePath: errorsFile,
				codes: { include: [2322], exclude: [2322] },
			},
			project,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.diagnostics).toEqual([]);
		expect(result.data.formattedOutput).toBe('✅ Ok');
	});

	it('diagnostic with related info includes compact related location', () => {
		const { project } = projectFor(relatedFile);
		const result = getDiagnostics({ filePath: relatedFile }, project);
		expect(result.success).toBe(true);
		if (!result.success) return;
		const diags = result.data.data.diagnostics;
		expect(diags.length).toBeGreaterThanOrEqual(1);
		const withRelated = diags.find((d) => d.related.length > 0);
		expect(withRelated).toBeDefined();
		expect(withRelated!.related[0]!.message.length).toBeGreaterThan(0);
		expect(result.data.formattedOutput).toContain('related:');
	});

	it('composite .js sibling import has no TS6307 (tsc -p parity)', () => {
		const { project } = projectFor(compositeMain);
		const result = getDiagnostics({ filePath: compositeMain }, project);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(
			result.data.data.diagnostics.some((d) => d.code === 6307),
		).toBe(false);
		expect(result.data.formattedOutput).toBe('✅ Ok');

		const check = getFileErrors(compositeMain, project);
		expect(check.success).toBe(true);
		if (!check.success) return;
		expect(check.data).not.toContain('TS6307');
		expect(check.data).toBe('✅ Ok');

		let tscCombined = '';
		try {
			tscCombined = execFileSync(
				process.execPath,
				[
					require.resolve('typescript/lib/tsc.js'),
					'-p',
					path.resolve('samples/diagnostics/composite/tsconfig.json'),
					'--pretty',
					'false',
					'--noEmit',
				],
				{ encoding: 'utf8' },
			);
		} catch (err) {
			const failed = err as {
				stdout?: string;
				stderr?: string;
			};
			tscCombined = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
		}
		expect(tscCombined).not.toContain('TS6307');
	});

	it('reversed/partial-invalid range fails before LS results', () => {
		const { project } = projectFor(errorsFile);

		const noStart = getDiagnostics(
			{ filePath: errorsFile, endLine: 2 },
			project,
		);
		expect(noStart.success).toBe(false);
		if (noStart.success) return;
		expect(noStart.error).toContain('endLine requires startLine');

		const badCol = getDiagnostics(
			{ filePath: errorsFile, endColumn: 1 },
			project,
		);
		expect(badCol.success).toBe(false);
		if (badCol.success) return;
		expect(badCol.error).toContain('endColumn requires endLine');

		const reversed = getDiagnostics(
			{
				filePath: errorsFile,
				startLine: 3,
				startColumn: 10,
				endLine: 3,
				endColumn: 2,
			},
			project,
		);
		expect(reversed.success).toBe(false);
		if (reversed.success) return;
		expect(reversed.error).toContain('Invalid range');
	});

	it('missing/excluded file uses shared discovery messages', () => {
		const missing = path.resolve('samples/diagnostics/does-not-exist.ts');
		const projectResult = getTsMorphProjectForFile(missing);
		expect(projectResult.success).toBe(false);
		if (projectResult.success) return;
		expect(projectResult.error.length).toBeGreaterThan(0);
	});

	it('check_type_errors adapter still returns ✅ Ok / colored errors', () => {
		const { project: cleanProject } = projectFor(cleanFile);
		const ok = getFileErrors(cleanFile, cleanProject);
		expect(ok.success).toBe(true);
		if (!ok.success) return;
		expect(ok.data).toBe('✅ Ok');

		const { project: errProject } = projectFor(errorsFile);
		const bad = getFileErrors(errorsFile, errProject);
		expect(bad.success).toBe(true);
		if (!bad.success) return;
		expect(bad.data).toContain('TS');
		expect(bad.data).toMatch(/type|string|number/i);
	});
});
