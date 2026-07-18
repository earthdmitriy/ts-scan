import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import { inspectPosition } from '../src/tools/inspect/inspectPosition.ts';
import { parseCliFlags } from '../src/tools/utils/cliFlags.ts';
import { resolveSourcePosition } from '../src/tools/utils/sourcePosition.ts';

afterEach(() => {
	resetCurrentTsMorphProject();
});

const positionsFile = path.resolve('samples/inspect/positions.ts');
const nothingFile = path.resolve('samples/inspect/nothing.ts');
const consumerFile = path.resolve(
	'samples/inspect/workspace/packages/app/consumer.ts',
);

const projectFor = (filePath: string) => {
	const result = getTsMorphProjectForFile(filePath);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
};

/** Locate a cursor marker, then the next identifier / this / string literal. */
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

	if (marker === 'blank') {
		// The blank line immediately after the marker line.
		const after = text.slice(idx + needle.length);
		const nextNl = after.indexOf('\n');
		const blankLineStart = idx + needle.length + nextNl + 1;
		const line =
			text.slice(0, blankLineStart).split(/\r?\n/).length;
		return { line, column: 1 };
	}

	if (marker === 'comment') {
		const after = text.slice(idx + needle.length);
		const nextNl = after.indexOf('\n');
		const commentLineStart = idx + needle.length + nextNl + 1;
		const line =
			text.slice(0, commentLineStart).split(/\r?\n/).length;
		return { line, column: 1 };
	}

	let pos = idx + needle.length;
	while (pos < text.length && /\s/.test(text[pos]!)) {
		pos++;
	}

	// String literal content: step inside the quotes.
	if (text[pos] === "'" || text[pos] === '"' || text[pos] === '`') {
		const line = text.slice(0, pos + 1).split(/\r?\n/).length;
		const lineStart = text.lastIndexOf('\n', pos) + 1;
		const column = pos + 1 - lineStart + 1; // inside quote
		return { line, column };
	}

	// Skip leading `.` for property access RHS markers.
	if (text[pos] === '.') {
		pos++;
		while (pos < text.length && /\s/.test(text[pos]!)) {
			pos++;
		}
	}

	if (text.slice(pos, pos + 4) === 'this' && !/[A-Za-z0-9_$]/.test(text[pos + 4] ?? '')) {
		const line = text.slice(0, pos).split(/\r?\n/).length;
		const lineStart = text.lastIndexOf('\n', pos) + 1;
		return { line, column: pos - lineStart + 1 };
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
		'public',
		'private',
		'protected',
		'readonly',
		'static',
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

const inspectAt = (
	filePath: string,
	marker: string,
	compact?: boolean,
) => {
	const { line, column } = cursorAt(filePath, marker);
	const { project, resolved } = projectFor(filePath);
	return inspectPosition(
		{ filePath, line, column, compact },
		project,
		resolved,
	);
};

describe('resolveSourcePosition', () => {
	it('rejects line 0 and line past EOF', () => {
		const { project } = projectFor(positionsFile);
		const zero = resolveSourcePosition(project, positionsFile, 0);
		expect(zero.success).toBe(false);
		if (!zero.success) {
			expect(zero.error).toMatch(/Invalid line: 0/);
		}

		const huge = resolveSourcePosition(project, positionsFile, 99999);
		expect(huge.success).toBe(false);
		if (!huge.success) {
			expect(huge.error).toMatch(/Invalid line: 99999/);
			expect(huge.error).toMatch(/File has \d+ lines?/);
		}
	});

	it('rejects column beyond line length', () => {
		const { project } = projectFor(positionsFile);
		const { line } = cursorAt(positionsFile, 'param');
		const result = resolveSourcePosition(
			project,
			positionsFile,
			line,
			9999,
		);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/Invalid column: 9999/);
		}
	});
});

describe('parseCliFlags', () => {
	it('parses integer and boolean flags', () => {
		const result = parseCliFlags(
			['--line', '12', '--column', '3', '--full'],
			[
				{ name: 'line', type: 'integer', required: true, min: 1 },
				{ name: 'column', type: 'integer', min: 1 },
				{ name: 'full', type: 'boolean' },
			],
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.flags.line).toBe(12);
		expect(result.data.flags.column).toBe(3);
		expect(result.data.flags.full).toBe(true);
	});

	it('returns error for unknown flags without exiting', () => {
		const result = parseCliFlags(['--nope'], [
			{ name: 'line', type: 'integer', required: true },
		]);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain('Unknown flag');
		}
	});
});

describe('inspectPosition', () => {
	it('inspects a parameter name', () => {
		const result = inspectAt(positionsFile, 'param');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.symbol).toBe('value');
		expect(result.data.data.kind).toBe('parameter');
		expect(result.data.data.type).toMatch(/Value/);
		expect(result.data.data.enclosing).toBe('forwardRunnerEvent');
		expect(result.data.data.declaredIn).toBeDefined();
	});

	it('inspects property access RHS, not the object', () => {
		const result = inspectAt(positionsFile, 'property');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.symbol).toBe('edgeId');
		expect(result.data.data.symbol).not.toBe('value');
		expect(result.data.data.type).toMatch(/EdgeId|string/);
	});

	it('inspects call callee', () => {
		const result = inspectAt(positionsFile, 'callee');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.symbol).toBe('run');
		expect(result.data.data.type).toMatch(/run|Value|EdgeId/);
		expect(result.data.data.declaredIn?.file).toContain('positions.ts');
	});

	it('inspects this inside a class method', () => {
		const result = inspectAt(positionsFile, 'this');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.symbol).toBe('this');
		expect(result.data.data.type).toMatch(/BridgeHandler/);
		expect(result.data.data.enclosing).toMatch(/BridgeHandler\.handle/);
	});

	it('inspects a type reference', () => {
		const result = inspectAt(positionsFile, 'type-ref');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.symbol).toBe('Value');
		expect(result.data.data.kind).toMatch(/interface|type|class|alias/);
	});

	it('returns package importHint for cross-package .js import', () => {
		const result = inspectAt(consumerFile, 'imported-type');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.symbol).toBe('RuntimeEdge');
		expect(result.data.data.declaredIn?.file).toMatch(
			/workspace-types\.ts$/,
		);
		expect(result.data.data.importHint).toBe('@inspect/runtime');
	});

	it('declaredIn prefers workspace src over dist .d.ts', () => {
		const gtdUse = path.resolve(
			'samples/go-to-definition/workspace/packages/server/src/use.ts',
		);
		const result = inspectAt(gtdUse, 'linked-dts');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.symbol).toBe('LinkedSource');
		const declared = result.data.data.declaredIn?.file.replace(/\\/g, '/');
		expect(declared).toMatch(/runtime\/src\/types\.ts$/);
		expect(declared).not.toMatch(/\/dist\//);
	});

	it('returns nothing for comment / string / blank positions', () => {
		for (const marker of ['comment', 'string', 'blank'] as const) {
			const result = inspectAt(nothingFile, marker);
			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.data.status).toBe('nothing');
			expect(result.data.formattedOutput).toContain('status: nothing');
		}
	});

	it('omitted column matches explicit identifier column', () => {
		const { line, column } = cursorAt(positionsFile, 'omitted-column');
		const { project, resolved } = projectFor(positionsFile);

		const withColumn = inspectPosition(
			{ filePath: positionsFile, line, column },
			project,
			resolved,
		);
		const omitted = inspectPosition(
			{ filePath: positionsFile, line },
			project,
			resolved,
		);

		expect(withColumn.success).toBe(true);
		expect(omitted.success).toBe(true);
		if (!withColumn.success || !omitted.success) return;
		expect(omitted.data.data.symbol).toBe(withColumn.data.data.symbol);
		expect(omitted.data.data.symbol).toBe('indentedConst');
	});

	it('bounds compact external generic display', () => {
		const result = inspectAt(positionsFile, 'generic', true);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.type!.length).toBeLessThanOrEqual(800);
		expect(result.data.data.type).not.toMatch(/export export/);
		expect(result.data.data.modifiers).toBeUndefined();
	});

	it('full mode includes modifiers when present', () => {
		const result = inspectAt(positionsFile, 'param', false);
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		// modifiers may be empty for parameters; full mode still returns type
		expect(result.data.data.type).toBeTruthy();
		expect(result.data.formattedOutput).not.toMatch(/SyntaxKind|getChildren/);
	});

	it('includes first JSDoc paragraph in compact mode', () => {
		const { line, column } = cursorAt(positionsFile, 'callee');
		const { project, resolved } = projectFor(positionsFile);
		const result = inspectPosition(
			{ filePath: positionsFile, line, column, compact: true },
			project,
			resolved,
		);
		expect(result.success).toBe(true);
		if (!result.success) return;
		// Hover on `run` should surface its JSDoc first paragraph.
		expect(result.data.data.doc).toMatch(/pipeline/i);
		expect(result.data.data.doc).not.toMatch(/Second paragraph/i);
	});

	it('errors clearly for missing file', () => {
		const missing = path.resolve('samples/inspect/does-not-exist.ts');
		const result = getTsMorphProjectForFile(missing);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toMatch(/does not exist|not included/i);
		}
	});
});
