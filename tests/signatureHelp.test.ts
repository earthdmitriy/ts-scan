import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTsMorphProjectForFile,
	resetCurrentTsMorphProject,
} from '../src/tools/getTsMorphProject.ts';
import { getSignatureHelp } from '../src/tools/signatureHelp/getSignatureHelp.ts';

afterEach(() => {
	resetCurrentTsMorphProject();
});

const callsFile = path.resolve('samples/signature-help/calls.ts');
const overloadsFile = path.resolve('samples/signature-help/overloads.ts');
const genericsFile = path.resolve('samples/signature-help/generics.ts');
const callbacksFile = path.resolve('samples/signature-help/callbacks.ts');
const externalFile = path.resolve('samples/signature-help/external.ts');

const projectFor = (filePath: string) => {
	const result = getTsMorphProjectForFile(filePath);
	if (!result.success) {
		throw new Error(result.error);
	}
	return result.data;
};

/** Locate a sig marker comment and use the first non-whitespace after it. */
const sigAt = (
	filePath: string,
	marker: string,
): { line: number; column: number } => {
	const text = readFileSync(filePath, 'utf8');
	const needle = `/*sig:${marker}*/`;
	const idx = text.indexOf(needle);
	if (idx < 0) {
		throw new Error(`Marker not found: ${needle} in ${filePath}`);
	}

	let pos = idx + needle.length;
	while (pos < text.length && /\s/.test(text[pos]!)) {
		pos++;
	}

	const line = text.slice(0, pos).split(/\r?\n/).length;
	const lineStart = text.lastIndexOf('\n', pos) + 1;
	return { line, column: pos - lineStart + 1 };
};

const helpAt = (filePath: string, marker: string) => {
	const { line, column } = sigAt(filePath, marker);
	const { project, resolved } = projectFor(filePath);
	return getSignatureHelp(
		{ filePath, line, column },
		project,
		resolved,
	);
};

describe('getSignatureHelp', () => {
	it('reports active parameter 0/1/2 for successive arguments', () => {
		const a0 = helpAt(callsFile, 'arg0');
		expect(a0.success).toBe(true);
		if (!a0.success) return;
		expect(a0.data.data.status).toBe('found');
		expect(a0.data.data.activeParameter).toBe(0);
		expect(a0.data.data.signatures.length).toBeGreaterThanOrEqual(1);
		expect(a0.data.data.signatures[0]!.label).toMatch(/plainFn/);

		const a1 = helpAt(callsFile, 'arg1');
		expect(a1.success).toBe(true);
		if (!a1.success) return;
		expect(a1.data.data.activeParameter).toBe(1);

		const a2 = helpAt(callsFile, 'arg2');
		expect(a2.success).toBe(true);
		if (!a2.success) return;
		expect(a2.data.data.activeParameter).toBe(2);
	});

	it('lists overloads and marks the TS-selected active signature', () => {
		const stringCall = helpAt(overloadsFile, 'overload-string');
		expect(stringCall.success).toBe(true);
		if (!stringCall.success) return;
		expect(stringCall.data.data.status).toBe('found');
		expect(stringCall.data.data.signatures.length).toBeGreaterThanOrEqual(
			2,
		);
		expect(
			stringCall.data.data.signatures.some((s) =>
				s.label.includes('string'),
			),
		).toBe(true);
		expect(
			stringCall.data.data.signatures.some((s) =>
				s.label.includes('number'),
			),
		).toBe(true);
		expect(stringCall.data.data.activeSignature).toBeGreaterThanOrEqual(0);
		expect(stringCall.data.data.activeSignature).toBeLessThan(
			stringCall.data.data.signatures.length,
		);

		const numberCall = helpAt(overloadsFile, 'overload-number');
		expect(numberCall.success).toBe(true);
		if (!numberCall.success) return;
		expect(numberCall.data.data.status).toBe('found');
		expect(numberCall.data.data.signatures.length).toBeGreaterThanOrEqual(
			2,
		);
	});

	it('returns constructor signatures', () => {
		const result = helpAt(callsFile, 'ctor-arg0');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.activeParameter).toBe(0);
		const label = result.data.data.signatures[0]?.label ?? '';
		expect(label.toLowerCase()).toMatch(/box|constructor/);
		expect(label).toMatch(/width|number/);
	});

	it('returns method call signatures', () => {
		const result = helpAt(callsFile, 'method-arg1');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.activeParameter).toBe(1);
		expect(result.data.data.signatures[0]!.label).toMatch(/method/);
	});

	it('returns function-typed callback signatures', () => {
		const result = helpAt(callbacksFile, 'callback-arg0');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.activeParameter).toBe(0);
		const label = result.data.data.signatures[0]?.label ?? '';
		expect(label).toMatch(/event|string/);
		expect(label).toMatch(/count|number/);
	});

	it('shows instantiated generic display parts when TS provides them', () => {
		const result = helpAt(genericsFile, 'generic-arg1');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.activeParameter).toBe(1);
		const label = result.data.data.signatures[0]?.label ?? '';
		expect(label).toMatch(/identityPair/);
		// Instantiated args appear when TS substitutes display parts.
		expect(label).toMatch(/string|T/);
		expect(label).toMatch(/number|U/);
	});

	it('selects the innermost nested call', () => {
		const result = helpAt(callsFile, 'nested-inner');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		const label = result.data.data.signatures[0]?.label ?? '';
		expect(label).toMatch(/String/);
		expect(label).not.toMatch(/plainFn/);
	});

	it('returns help on callee, open paren, and trailing comma positions', () => {
		for (const marker of ['callee', 'open-paren', 'trailing'] as const) {
			const result = helpAt(callsFile, marker);
			expect(result.success, marker).toBe(true);
			if (!result.success) return;
			expect(result.data.data.status, marker).toBe('found');
			expect(
				result.data.data.signatures.length,
				marker,
			).toBeGreaterThanOrEqual(1);
			expect(
				result.data.data.activeSignature,
				marker,
			).toBeGreaterThanOrEqual(0);
			expect(
				result.data.data.activeParameter,
				marker,
			).toBeGreaterThanOrEqual(0);
		}
	});

	it('returns not_in_call outside any call', () => {
		const result = helpAt(callsFile, 'outside');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('not_in_call');
		expect(result.data.data.signatures).toEqual([]);
		expect(result.data.formattedOutput).toContain('status: not_in_call');
	});

	it('rejects missing column and out-of-bounds positions', () => {
		const { project, resolved } = projectFor(callsFile);
		const missing = getSignatureHelp(
			{ filePath: callsFile, line: 1, column: undefined as unknown as number },
			project,
			resolved,
		);
		expect(missing.success).toBe(false);
		if (missing.success) return;
		expect(missing.error).toMatch(/column|Invalid/i);

		const oob = getSignatureHelp(
			{ filePath: callsFile, line: 1, column: 99999 },
			project,
			resolved,
		);
		expect(oob.success).toBe(false);
		if (oob.success) return;
		expect(oob.error).toMatch(/Invalid column/);
	});

	it('compacts huge external JSDoc to the first paragraph / bound', () => {
		const result = helpAt(externalFile, 'client-emit');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.status).toBe('found');
		expect(result.data.data.signatures[0]!.label).toMatch(/clientEmit/);
		const doc = result.data.data.signatures[0]!.documentation;
		expect(doc).toMatch(/Huge external documentation/);
		expect(doc).not.toContain('Second paragraph');
		expect(doc.length).toBeLessThanOrEqual(300);
	});

	it('smoke: clientEmit-shaped bridge call', () => {
		const result = helpAt(externalFile, 'client-emit');
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.data.activeParameter).toBe(0);
		expect(result.data.formattedOutput).toContain('activeSignature:');
		expect(result.data.formattedOutput).toContain('activeParameter:');
	});
});
