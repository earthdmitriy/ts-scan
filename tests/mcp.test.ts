import { readFileSync } from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type TextContent = { type: 'text'; text: string };

const isTextContentArray = (value: unknown): value is TextContent[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every(
		(item): item is TextContent =>
			typeof item === 'object' &&
			item !== null &&
			(item as any).type === 'text' &&
			typeof (item as any).text === 'string',
	);

describe('MCP Server (integration)', () => {
	let client: Client;
	let transport: StdioClientTransport;

	beforeAll(async () => {
		transport = new StdioClientTransport({
			command: 'node',
			args: ['dist/cli.js', '--mcp'],
		});

		client = new Client({
			name: 'test-client',
			version: '1.0.0',
		});

		await client.connect(transport);
	}, 10000);

	afterAll(async () => {
		await client.close();
	});

	it('should connect to MCP server', async () => {
		expect(client).toBeDefined();
	});

	describe('Tools', () => {
		it('should list all available tools', async () => {
			const toolsResponse = await client.listTools();

			expect(toolsResponse.tools).toBeDefined();
			expect(toolsResponse.tools.length).toBeGreaterThan(0);

			const toolNames = toolsResponse.tools.map((t) => t.name);
			expect(toolNames).toContain('check_type_errors');
			expect(toolNames).toContain('list_imports');
			expect(toolNames).toContain('list_exports');
			expect(toolNames).toContain('resolve_symbol');
			expect(toolNames).toContain('inspect');
			expect(toolNames).toContain('go_to_definition');
			expect(toolNames).toContain('get_diagnostics');
			expect(toolNames).toContain('find_references');
			expect(toolNames).toContain('find_callers');
			expect(toolNames).toContain('reachability');
			expect(toolNames).toContain('signature_help');

			for (const name of ['find_references', 'find_callers'] as const) {
				const tool = toolsResponse.tools.find((t) => t.name === name);
				expect(tool).toBeDefined();
				const props = (tool!.inputSchema as { properties?: object })
					.properties;
				expect(props).toBeDefined();
				expect(Object.keys(props!)).toEqual(
					expect.arrayContaining([
						'file_path',
						'line',
						'column',
						'symbol',
						'relativeTo',
					]),
				);
			}
		});

		describe('check_type_errors', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'check_type_errors',
					arguments: {
						file_path: 'src/types.ts',
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('should check type errors in a file', async () => {
				const result = await client.callTool({
					name: 'check_type_errors',
					arguments: {
						file_path: path.resolve('src/types.ts'),
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].type).toBe('text');
				expect(typeof result.content[0].text).toBe('string');
			});

			it("should return 'Ok' for a file with no errors", async () => {
				const result = await client.callTool({
					name: 'check_type_errors',
					arguments: {
						file_path: path.resolve('src/types.ts'),
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const text = result.content[0].text;

				expect(text).toBe('✅ Ok');
			});
		});

		describe('get_diagnostics', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'get_diagnostics',
					arguments: {
						file_path: 'samples/diagnostics/clean.ts',
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('returns ✅ Ok for a clean file with default severity', async () => {
				const result = await client.callTool({
					name: 'get_diagnostics',
					arguments: {
						file_path: path.resolve('samples/diagnostics/clean.ts'),
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toBe('✅ Ok');
			});

			it('returns ranged diagnostics for one error', async () => {
				const filePath = path.resolve('samples/diagnostics/errors.ts');
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*error:first*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				const line = text.slice(0, idx).split(/\r?\n/).length;

				const result = await client.callTool({
					name: 'get_diagnostics',
					arguments: {
						file_path: filePath,
						startLine: line,
						endLine: line,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('diagnostics:');
				expect(out).toContain('TS2322');
				expect(out).not.toContain('✅ Ok');
			});

			it('schema defaults exclude warnings unless severity is widened', async () => {
				const filePath = path.resolve(
					'samples/diagnostics/warnings.ts',
				);
				const defaultResult = await client.callTool({
					name: 'get_diagnostics',
					arguments: { file_path: filePath },
				});
				expect(isTextContentArray(defaultResult.content)).toBe(true);
				if (!isTextContentArray(defaultResult.content)) return;
				expect(defaultResult.content[0].text).toBe('✅ Ok');

				const allResult = await client.callTool({
					name: 'get_diagnostics',
					arguments: {
						file_path: filePath,
						severity: 'all',
					},
				});
				expect(isTextContentArray(allResult.content)).toBe(true);
				if (!isTextContentArray(allResult.content)) return;
				expect(allResult.content[0].text).toMatch(
					/suggestion|warning/,
				);
			});
		});

		describe('list_exports', () => {
			it('should list exported symbols from a file', async () => {
				const result = await client.callTool({
					name: 'list_exports',
					arguments: {
						file_path: path.resolve('src/types.ts'),
					},
				});
				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].type).toBe('text');

				const text = result.content[0].text;
				expect(text).toContain('export type Result<T>');
				expect(text).not.toContain('export export type');
				expect(text.length).toBeGreaterThan(
					'export type Result<T>'.length,
				);
			});

			it('should include export names in output', async () => {
				const result = await client.callTool({
					name: 'list_exports',
					arguments: {
						file_path: path.resolve('src/types.ts'),
					},
				});
				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const text = result.content[0].text;
				expect(text).toMatch(/Result|success|error/);
			});
		});

		describe('list_imports', () => {
			it('should list imported symbols from a file', async () => {
				const result = await client.callTool({
					name: 'list_imports',
					arguments: {
						file_path: path.resolve('src/router.ts'),
					},
				});
				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].type).toBe('text');

				const text = result.content[0].text;
				expect(typeof text).toBe('string');
				expect(text.length).toBeGreaterThan(0);
			});

			it('should show imports with proper formatting', async () => {
				const result = await client.callTool({
					name: 'list_imports',
					arguments: {
						file_path: path.resolve('src/router.ts'),
					},
				});
				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const text = result.content[0].text;
				expect(text).toMatch(/Types and JSdoc:|import|from/);
			});
		});

		describe('inspect', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'inspect',
					arguments: {
						file_path: 'samples/inspect/positions.ts',
						line: 1,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('inspects a parameter at an absolute path', async () => {
				const filePath = path.resolve('samples/inspect/positions.ts');
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*cursor:param*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				let pos = idx + marker.length;
				while (pos < text.length && /\s/.test(text[pos]!)) pos++;
				const line = text.slice(0, pos).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', pos) + 1;
				const column = pos - lineStart + 1;

				const result = await client.callTool({
					name: 'inspect',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('symbol: value');
				expect(out).toContain('kind: parameter');
				expect(out).toContain('enclosing: forwardRunnerEvent');
			});
		});

		describe('go_to_definition', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'go_to_definition',
					arguments: {
						file_path: 'samples/go-to-definition/definitions.ts',
						line: 1,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('resolves a local definition at an absolute path', async () => {
				const filePath = path.resolve(
					'samples/go-to-definition/definitions.ts',
				);
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*cursor:local-use*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				let pos = idx + marker.length;
				while (pos < text.length && /\s/.test(text[pos]!)) pos++;
				const keywords = new Set([
					'const',
					'let',
					'var',
					'export',
					'return',
					'type',
					'function',
				]);
				while (pos < text.length) {
					while (pos < text.length && /\s/.test(text[pos]!)) pos++;
					const ident = text.slice(pos).match(/^[A-Za-z_$][\w$]*/);
					if (!ident) break;
					if (!keywords.has(ident[0]!)) break;
					pos += ident[0]!.length;
				}
				const line = text.slice(0, pos).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', pos) + 1;
				const column = pos - lineStart + 1;

				const result = await client.callTool({
					name: 'go_to_definition',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('symbol: localValue');
				expect(out).toMatch(/definitions\.ts/);
				expect(out).toMatch(/primary:/);
			});

			it('resolves workspace RuntimeEdge with importHint', async () => {
				const filePath = path.resolve(
					'samples/go-to-definition/workspace/packages/server/src/use.ts',
				);
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*cursor:runtime-edge*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				let pos = idx + marker.length;
				while (pos < text.length && /\s/.test(text[pos]!)) pos++;
				const ident = text.slice(pos).match(/^[A-Za-z_$][\w$]*/);
				expect(ident?.[0]).toBe('RuntimeEdge');
				const line = text.slice(0, pos).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', pos) + 1;
				const column = pos - lineStart + 1;

				const result = await client.callTool({
					name: 'go_to_definition',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('symbol: RuntimeEdge');
				expect(out.replace(/\\/g, '/')).toMatch(
					/runtime\/src\/types\.ts/,
				);
				expect(out).toContain('importHint=@gtd/runtime');
			});

			it('marks external package definitions', async () => {
				const filePath = path.resolve(
					'samples/go-to-definition/consumer.ts',
				);
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*cursor:external-symbol*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				let pos = idx + marker.length;
				while (pos < text.length && /\s/.test(text[pos]!)) pos++;
				const ident = text.slice(pos).match(/^[A-Za-z_$][\w$]*/);
				expect(ident?.[0]).toBe('ExternalWidget');
				const line = text.slice(0, pos).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', pos) + 1;
				const column = pos - lineStart + 1;

				const result = await client.callTool({
					name: 'go_to_definition',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('symbol: ExternalWidget');
				expect(out).toMatch(/definition-package/);
				expect(out).toContain('external');
			});
		});

		describe('find_references', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'find_references',
					arguments: {
						file_path: 'samples/find-references/declaration.ts',
						line: 1,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('finds references at an absolute position', async () => {
				const filePath = path.resolve(
					'samples/find-references/declaration.ts',
				);
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*cursor:decl-read*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				let pos = idx + marker.length;
				while (pos < text.length && /\s/.test(text[pos]!)) pos++;
				const keywords = new Set(['return']);
				while (pos < text.length) {
					while (pos < text.length && /\s/.test(text[pos]!)) pos++;
					const ident = text.slice(pos).match(/^[A-Za-z_$][\w$]*/);
					if (!ident) break;
					if (!keywords.has(ident[0]!)) break;
					pos += ident[0]!.length;
				}
				const line = text.slice(0, pos).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', pos) + 1;
				const column = pos - lineStart + 1;

				const result = await client.callTool({
					name: 'find_references',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('symbol: trackedValue');
				expect(out).toContain('references:');
				expect(out).toMatch(/scope:/);
			});

			it('supports symbol mode with absolute relativeTo', async () => {
				const result = await client.callTool({
					name: 'find_references',
					arguments: {
						symbol: 'trackedFn',
						relativeTo: path.resolve(
							'samples/find-references/calls.ts',
						),
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('symbol: trackedFn');
				expect(out).toMatch(/\[call\]/);
			});

			it('description steers agents away from grep', async () => {
				const toolsResponse = await client.listTools();
				const tool = toolsResponse.tools.find(
					(t) => t.name === 'find_references',
				);
				expect(tool).toBeDefined();
				expect(tool?.description ?? '').toMatch(/instead of/i);
				expect(tool?.description ?? '').toMatch(/grep/i);
			});
		});

		describe('find_callers', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'find_callers',
					arguments: {
						file_path: 'samples/find-callers/targets.ts',
						line: 1,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('finds callers at an absolute position', async () => {
				const filePath = path.resolve('samples/find-callers/targets.ts');
				const text = readFileSync(filePath, 'utf8');
				const match = text.match(/function\s+targetFn\b/);
				expect(match?.index).toBeDefined();
				const nameIdx = text.indexOf('targetFn', match!.index);
				const line = text.slice(0, nameIdx).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', nameIdx) + 1;
				const column = nameIdx - lineStart + 1;

				const result = await client.callTool({
					name: 'find_callers',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('target: targetFn');
				expect(out).toContain('callers:');
				expect(out).toMatch(/directCaller|direct_call/);
			});

			it('supports symbol mode with absolute relativeTo', async () => {
				const result = await client.callTool({
					name: 'find_callers',
					arguments: {
						symbol: 'targetFn',
						relativeTo: path.resolve('samples/find-callers/direct.ts'),
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('target: targetFn');
				expect(out).toMatch(/direct_call/);
			});

			it('description steers agents to static caller graph not runtime stack', async () => {
				const toolsResponse = await client.listTools();
				const tool = toolsResponse.tools.find(
					(t) => t.name === 'find_callers',
				);
				expect(tool).toBeDefined();
				expect(tool?.description ?? '').toMatch(/instead of/i);
				expect(tool?.description ?? '').toMatch(/static caller graph/i);
				expect(tool?.description ?? '').toMatch(/not a runtime stack/i);
				expect(tool?.name).not.toBe('call_stack');
			});
		});

		describe('reachability', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'reachability',
					arguments: {
						file_path:
							'samples/reachability/workspace/src/internal.ts',
						line: 1,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('finds static entrypoint paths at an absolute position', async () => {
				const filePath = path.resolve(
					'samples/reachability/workspace/src/internal.ts',
				);
				const text = readFileSync(filePath, 'utf8');
				const match = text.match(/function\s+leafHelper\b/);
				expect(match?.index).toBeDefined();
				const nameIdx = text.indexOf('leafHelper', match!.index);
				const line = text.slice(0, nameIdx).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', nameIdx) + 1;
				const column = nameIdx - lineStart + 1;

				const result = await client.callTool({
					name: 'reachability',
					arguments: {
						file_path: filePath,
						line,
						column,
						entrypointKinds: ['export', 'handler', 'bin'],
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('target: leafHelper');
				expect(out).toContain('paths:');
				expect(out).toMatch(/kind: export|kind: handler|kind: bin/);
				expect(out).toMatch(/static approximation/i);
				expect(out).toMatch(/never a runtime stack/i);
				expect(out).not.toMatch(/\bis a runtime stack\b/i);
			});

			it('description steers agents to static paths not runtime stacks', async () => {
				const toolsResponse = await client.listTools();
				const tool = toolsResponse.tools.find(
					(t) => t.name === 'reachability',
				);
				expect(tool).toBeDefined();
				expect(tool?.description ?? '').toMatch(/instead of/i);
				expect(tool?.description ?? '').toMatch(/static paths/i);
				expect(tool?.description ?? '').toMatch(/never claims runtime/i);
				expect(tool?.name).not.toBe('call_stack');
			});
		});

		describe('signature_help', () => {
			it('rejects relative file paths', async () => {
				const result = await client.callTool({
					name: 'signature_help',
					arguments: {
						file_path: 'samples/signature-help/calls.ts',
						line: 1,
						column: 1,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('returns signature help at an absolute call-site position', async () => {
				const filePath = path.resolve(
					'samples/signature-help/calls.ts',
				);
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*sig:arg1*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				let pos = idx + marker.length;
				while (pos < text.length && /\s/.test(text[pos]!)) pos++;
				const line = text.slice(0, pos).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', pos) + 1;
				const column = pos - lineStart + 1;

				const result = await client.callTool({
					name: 'signature_help',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const out = result.content[0].text;
				expect(out).toContain('status: found');
				expect(out).toContain('activeParameter: 1');
				expect(out).toMatch(/plainFn/);
			});

			it('returns not_in_call outside a call', async () => {
				const filePath = path.resolve(
					'samples/signature-help/calls.ts',
				);
				const text = readFileSync(filePath, 'utf8');
				const marker = '/*sig:outside*/';
				const idx = text.indexOf(marker);
				expect(idx).toBeGreaterThanOrEqual(0);
				let pos = idx + marker.length;
				while (pos < text.length && /\s/.test(text[pos]!)) pos++;
				const line = text.slice(0, pos).split(/\r?\n/).length;
				const lineStart = text.lastIndexOf('\n', pos) + 1;
				const column = pos - lineStart + 1;

				const result = await client.callTool({
					name: 'signature_help',
					arguments: {
						file_path: filePath,
						line,
						column,
					},
				});

				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('status: not_in_call');
			});

			it('description steers agents to call sites instead of opening callees', async () => {
				const toolsResponse = await client.listTools();
				const tool = toolsResponse.tools.find(
					(t) => t.name === 'signature_help',
				);
				expect(tool).toBeDefined();
				expect(tool?.description ?? '').toMatch(/instead of/i);
				expect(tool?.description ?? '').toMatch(/call site/i);
				expect(tool?.inputSchema).toBeDefined();
				const schema = tool?.inputSchema as {
					required?: string[];
					properties?: Record<string, unknown>;
				};
				expect(schema.required).toEqual(
					expect.arrayContaining(['file_path', 'line', 'column']),
				);
				expect(schema.properties?.column).toBeDefined();
			});

			it('supports method, overload, constructor, callback, and external calls', async () => {
				const cases: Array<{
					file: string;
					marker: string;
					expectMatch: RegExp;
				}> = [
					{
						file: 'samples/signature-help/calls.ts',
						marker: '/*sig:method-arg0*/',
						expectMatch: /method/,
					},
					{
						file: 'samples/signature-help/overloads.ts',
						marker: '/*sig:overload-string*/',
						expectMatch: /overloadTarget|string/,
					},
					{
						file: 'samples/signature-help/calls.ts',
						marker: '/*sig:ctor-arg0*/',
						expectMatch: /Box|constructor|width/i,
					},
					{
						file: 'samples/signature-help/callbacks.ts',
						marker: '/*sig:callback-arg0*/',
						expectMatch: /event|string/,
					},
					{
						file: 'samples/signature-help/external.ts',
						marker: '/*sig:client-emit*/',
						expectMatch: /clientEmit/,
					},
				];

				for (const testCase of cases) {
					const filePath = path.resolve(testCase.file);
					const text = readFileSync(filePath, 'utf8');
					const idx = text.indexOf(testCase.marker);
					expect(idx, testCase.marker).toBeGreaterThanOrEqual(0);
					let pos = idx + testCase.marker.length;
					while (pos < text.length && /\s/.test(text[pos]!)) pos++;
					const line = text.slice(0, pos).split(/\r?\n/).length;
					const lineStart = text.lastIndexOf('\n', pos) + 1;
					const column = pos - lineStart + 1;

					const result = await client.callTool({
						name: 'signature_help',
						arguments: {
							file_path: filePath,
							line,
							column,
						},
					});

					expect(isTextContentArray(result.content)).toBe(true);
					if (!isTextContentArray(result.content)) return;

					const out = result.content[0].text;
					expect(out, testCase.marker).toContain('status: found');
					expect(out, testCase.marker).toMatch(testCase.expectMatch);
				}
			});
		});

		describe('resolve_symbol', () => {
			it('requires absolute relativeTo', async () => {
				const result = await client.callTool({
					name: 'resolve_symbol',
					arguments: {
						symbol: 'success',
						relativeTo: 'src/cli.ts',
					},
				});
				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].text).toContain('absolute path');
			});

			it('should attempt to resolve a symbol', async () => {
				const result = await client.callTool({
					name: 'resolve_symbol',
					arguments: {
						symbol: 'NonExistentSymbol',
						relativeTo: path.resolve('src/cli.ts'),
					},
				});
				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				expect(result.content[0].type).toBe('text');
				const text = result.content[0].text;
				expect(typeof text).toBe('string');
			});

			it('should indicate when a symbol is not found', async () => {
				const result = await client.callTool({
					name: 'resolve_symbol',
					arguments: {
						symbol: 'NonExistentSymbol123',
						relativeTo: path.resolve('src/cli.ts'),
					},
				});
				expect(isTextContentArray(result.content)).toBe(true);
				if (!isTextContentArray(result.content)) return;

				const text = result.content[0].text;
				expect(text).toContain('not found');
			});
		});
	});
});
