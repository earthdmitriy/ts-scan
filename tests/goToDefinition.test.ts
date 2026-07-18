import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import {
	goToDefinition,
	preferWorkspaceSourceFile,
} from '../src/tools/goToDefinition/goToDefinition.ts';

afterEach(() => {
	resetCurrentTsMorphProject();
});

const definitionsFile = path.resolve(
	'samples/go-to-definition/definitions.ts',
);
const consumerFile = path.resolve('samples/go-to-definition/consumer.ts');
const overloadsFile = path.resolve('samples/go-to-definition/overloads.ts');
const serverUseFile = path.resolve(
	'samples/go-to-definition/workspace/packages/server/src/use.ts',
);
const runtimeTypesFile = path.resolve(
	'samples/go-to-definition/workspace/packages/runtime/src/types.ts',
);

const projectFor = (filePath: string) => {
	const result = getTsMorphProjectForFile(filePath);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
};

/** Locate a cursor marker, then the next identifier / string literal. */
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

	if (text[pos] === "'" || text[pos] === '"' || text[pos] === '`') {
		const line = text.slice(0, pos + 1).split(/\r?\n/).length;
		const lineStart = text.lastIndexOf('\n', pos) + 1;
		const column = pos + 1 - lineStart + 1;
		return { line, column };
	}

	if (text[pos] === '.') {
		pos++;
		while (pos < text.length && /\s/.test(text[pos]!)) {
			pos++;
		}
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

const defineAt = (filePath: string, marker: string) => {
	const { line, column } = cursorAt(filePath, marker);
	const { project, resolved } = projectFor(filePath);
	return goToDefinition(
		{ filePath, line, column },
		project,
		resolved,
	);
};

describe('goToDefinition', () => {
	it('resolves a local variable use to one .ts declaration span', () => {
		const result = defineAt(definitionsFile, 'local-use');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.definitions.length).toBeGreaterThanOrEqual(1);
		const top = result.data.data.definitions[0]!;
		expect(top.file.replace(/\\/g, '/')).toMatch(/definitions\.ts$/);
		expect(top.name).toBe('localValue');
		expect(top.external).toBe(false);
		expect(top.line).toBe(1);
		expect(top.column).toBeGreaterThanOrEqual(1);
		expect(top.endLine).toBeGreaterThanOrEqual(top.line);
		expect(top.endColumn).toBeGreaterThan(top.column);
	});

	it('follows type-only .js import to the original .ts type', () => {
		const result = defineAt(consumerFile, 'type-only-js');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const top = result.data.data.definitions[0]!;
		expect(top.file.replace(/\\/g, '/')).toMatch(/definitions\.ts$/);
		expect(top.name).toBe('LocalId');
		expect(top.kind).toMatch(/type|alias/);
	});

	it('prefers workspace .ts over linked .d.ts and adds importHint', () => {
		const result = defineAt(serverUseFile, 'linked-dts');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const primary = result.data.data.primary!;
		expect(primary.file.replace(/\\/g, '/')).toMatch(
			/runtime\/src\/types\.ts$/,
		);
		expect(primary.file.replace(/\\/g, '/')).not.toMatch(/\.d\.ts$/);
		expect(primary.importHint).toBe('@gtd/runtime');
		expect(primary.external).toBe(false);
		expect(
			result.data.data.definitions.some((d) =>
				d.file.replace(/\\/g, '/').includes('/dist/'),
			),
		).toBe(false);
		expect(result.data.formattedOutput).toMatch(/^primary:/m);
		expect(result.data.formattedOutput).not.toMatch(/:1:1-1:2/);
	});

	it('navigates RuntimeEdge via NodeNext .js import with importHint', () => {
		const result = defineAt(serverUseFile, 'runtime-edge');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const top = result.data.data.definitions[0]!;
		expect(path.resolve(top.file)).toBe(path.resolve(runtimeTypesFile));
		expect(top.name).toBe('RuntimeEdge');
		expect(top.importHint).toBe('@gtd/runtime');
	});

	it('primary is workspace export type, not test-file anonymous implementation', () => {
		const result = defineAt(serverUseFile, 'runner-event-import');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const primary = result.data.data.primary!;
		expect(primary).toBeDefined();
		expect(path.resolve(primary.file)).toBe(path.resolve(runtimeTypesFile));
		expect(primary.name).toBe('RuntimeRunnerEvent');
		expect(primary.kind).toMatch(/type/);
		expect(primary.file.replace(/\\/g, '/')).not.toMatch(
			/\.(test|spec)\./,
		);
		expect(primary.name).not.toBe('<anonymous>');
		expect(primary.importHint).toBe('@gtd/runtime');
		expect(
			result.data.data.definitions.some((d) =>
				d.file.replace(/\\/g, '/').includes('use.test.ts'),
			),
		).toBe(false);
	});

	it('marks external package symbols as external .d.ts', () => {
		const result = defineAt(consumerFile, 'external-symbol');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const top = result.data.data.definitions[0]!;
		expect(top.file.replace(/\\/g, '/')).toMatch(
			/node_modules\/definition-package\/index\.d\.ts$/,
		);
		expect(top.external).toBe(true);
		expect(top.name).toBe('ExternalWidget');
	});

	it('preserves stable overload / implementation results', () => {
		const result = defineAt(overloadsFile, 'overload-call');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const defs = result.data.data.definitions;
		expect(defs.length).toBeGreaterThanOrEqual(1);
		for (const def of defs) {
			expect(def.file.replace(/\\/g, '/')).toMatch(/overloads\.ts$/);
			expect(def.name).toMatch(/overloadTarget/);
		}
		const again = defineAt(overloadsFile, 'overload-call');
		expect(again.success).toBe(true);
		if (!again.success) return;
		expect(again.data.data.definitions.map((d) => [
			d.file,
			d.line,
			d.column,
			d.name,
		])).toEqual(
			defs.map((d) => [d.file, d.line, d.column, d.name]),
		);
	});

	it('returns multiple deduplicated definitions for merged interface', () => {
		const result = defineAt(definitionsFile, 'merged-interface');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const defs = result.data.data.definitions;
		expect(defs.length).toBeGreaterThanOrEqual(2);
		for (const def of defs) {
			expect(def.file.replace(/\\/g, '/')).toMatch(/definitions\.ts$/);
			expect(def.name).toBe('MergedShape');
		}
		const keys = new Set(
			defs.map((d) => `${d.file}:${d.line}:${d.column}`),
		);
		expect(keys.size).toBe(defs.length);
	});

	it('returns multiple definitions for merged namespace', () => {
		const result = defineAt(definitionsFile, 'merged-namespace');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const defs = result.data.data.definitions;
		expect(defs.length).toBeGreaterThanOrEqual(1);
		expect(defs.some((d) => d.name === 'MergedNS')).toBe(true);
	});

	it('resolves imported alias to underlying declaration before import', () => {
		const result = defineAt(consumerFile, 'imported-alias');
		expect(result.success).toBe(true);
		if (!result.success) return;
		const defs = result.data.data.definitions;
		expect(defs.length).toBeGreaterThanOrEqual(1);
		const top = defs[0]!;
		expect(top.file.replace(/\\/g, '/')).toMatch(/definitions\.ts$/);
		expect(top.name).toBe('localValue');
		// Import line in consumer must not rank above the underlying decl.
		expect(top.file.replace(/\\/g, '/')).not.toMatch(/consumer\.ts$/);
	});

	it('returns empty definitions for comment / string / unknown', () => {
		const comment = defineAt(consumerFile, 'comment');
		expect(comment.success).toBe(true);
		if (!comment.success) return;
		expect(comment.data.data.definitions).toEqual([]);
		expect(comment.data.data.reason).toBe('no_symbol');

		const literal = defineAt(consumerFile, 'string-literal');
		expect(literal.success).toBe(true);
		if (!literal.success) return;
		expect(literal.data.data.definitions).toEqual([]);
		expect(literal.data.data.reason).toBe('no_symbol');

		const unknown = defineAt(consumerFile, 'unknown-ident');
		expect(unknown.success).toBe(true);
		if (!unknown.success) return;
		expect(unknown.data.data.definitions).toEqual([]);
		expect(unknown.data.data.reason).toMatch(/no_symbol|no_definition/);
		expect(unknown.data.data.symbol).toBe('unknownIdentifier');
	});

	it('errors clearly for invalid position and missing file', () => {
		const { project, resolved } = projectFor(definitionsFile);
		const badLine = goToDefinition(
			{ filePath: definitionsFile, line: 99999, column: 1 },
			project,
			resolved,
		);
		expect(badLine.success).toBe(false);
		if (!badLine.success) {
			expect(badLine.error).toMatch(/Invalid line: 99999/);
			expect(badLine.error).toMatch(/File has \d+ lines?/);
		}

		const missing = path.resolve(
			'samples/go-to-definition/does-not-exist.ts',
		);
		const missingResult = getTsMorphProjectForFile(missing);
		expect(missingResult.success).toBe(false);
		if (!missingResult.success) {
			expect(missingResult.error).toMatch(/does not exist|not included/i);
		}
	});

	it('preferWorkspaceSourceFile maps dist .d.ts to src .ts', () => {
		const dts = path.resolve(
			'samples/go-to-definition/workspace/packages/runtime/dist/types.d.ts',
		);
		const preferred = preferWorkspaceSourceFile(dts);
		expect(preferred).toBeDefined();
		expect(path.resolve(preferred!)).toBe(path.resolve(runtimeTypesFile));
	});
});
