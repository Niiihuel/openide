/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { appendGeminiParts, GeminiPart, sanitizeGeminiParts } from '../../common/providers/geminiParts.js';

/**
 * The real failure behind this: `HTTP 400 … Invalid value at 'request.contents[801].parts[0]'
 * (oneof), oneof field 'data' is already set. Cannot set 'text'`. The conversation became
 * unusable because the invalid part was persisted and resent on every turn.
 */
suite('OpenIDE Gemini parts', () => {

	const DATA_KEYS = ['text', 'inlineData', 'functionCall', 'functionResponse', 'fileData', 'executableCode', 'codeExecutionResult'];
	function assertOneofValid(parts: readonly GeminiPart[]): void {
		parts.forEach((part, index) => {
			const present = DATA_KEYS.filter(key => part[key] !== undefined);
			assert.strictEqual(present.length <= 1, true, `parts[${index}] tiene ${present.length} miembros del oneof: ${present.join(', ')}`);
		});
	}

	test('streamed text is concatenated instead of overwritten', () => {
		let parts: GeminiPart[] = [];
		parts = appendGeminiParts(parts, [{ text: 'Hola ' }]);
		parts = appendGeminiParts(parts, [{ text: 'mundo' }]);
		assert.deepStrictEqual(parts, [{ text: 'Hola mundo' }]);
	});

	test('a functionCall after text opens a new part, it does not contaminate the text one', () => {
		// Exactly the sequence that produced the 400: same index, different oneof member.
		let parts: GeminiPart[] = [];
		parts = appendGeminiParts(parts, [{ text: 'voy a leer el archivo' }]);
		parts = appendGeminiParts(parts, [{ functionCall: { name: 'read_file', args: { path: 'a.ts' } }, thoughtSignature: 'sig-1' }]);
		assertOneofValid(parts);
		assert.strictEqual(parts.length, 2);
		assert.strictEqual(parts[0].text, 'voy a leer el archivo');
		assert.strictEqual((parts[1].functionCall as any).name, 'read_file');
		assert.strictEqual(parts[1].thoughtSignature, 'sig-1');
	});

	test('reasoning is not concatenated with the visible text', () => {
		let parts: GeminiPart[] = [];
		parts = appendGeminiParts(parts, [{ text: 'pensando…', thought: true }]);
		parts = appendGeminiParts(parts, [{ text: 'respuesta' }]);
		assert.strictEqual(parts.length, 2);
		assert.strictEqual(parts[0].thought, true);
		assert.strictEqual(parts[1].text, 'respuesta');
	});

	test('two calls in a row are two parts', () => {
		let parts: GeminiPart[] = [];
		parts = appendGeminiParts(parts, [{ functionCall: { name: 'read_file', args: {} } }]);
		parts = appendGeminiParts(parts, [{ functionCall: { name: 'list_dir', args: {} } }]);
		assert.strictEqual(parts.length, 2);
		assertOneofValid(parts);
	});

	test('a call split across two chunks completes in the same part', () => {
		let parts: GeminiPart[] = [];
		parts = appendGeminiParts(parts, [{ functionCall: { args: { path: 'a.ts' } } }]);
		parts = appendGeminiParts(parts, [{ functionCall: { name: 'read_file' }, thoughtSignature: 'sig' }]);
		assert.strictEqual(parts.length, 1);
		assert.deepStrictEqual(parts[0].functionCall, { args: { path: 'a.ts' }, name: 'read_file' });
		assert.strictEqual(parts[0].thoughtSignature, 'sig');
	});

	test('several chunks in a single SSE block keep their order', () => {
		const parts = appendGeminiParts([], [{ text: 'a' }, { functionCall: { name: 'x', args: {} } }, { text: 'b' }]);
		assert.deepStrictEqual(parts.map(part => Object.keys(part)[0]), ['text', 'functionCall', 'text']);
	});

	test('a corrupt part is sanitized by splitting it, losing neither the text nor the call', () => {
		// What is already stored in the damaged sessions.
		const sanitized = sanitizeGeminiParts([{ text: 'listo', functionCall: { name: 'edit_file', args: {} }, thoughtSignature: 'sig' }]);
		assertOneofValid(sanitized);
		assert.strictEqual(sanitized.length, 2);
		assert.strictEqual(sanitized[0].text, 'listo');
		assert.strictEqual(sanitized[0].thoughtSignature, undefined, 'la firma pertenece a la llamada');
		assert.strictEqual((sanitized[1].functionCall as any).name, 'edit_file');
		assert.strictEqual(sanitized[1].thoughtSignature, 'sig');
	});

	test('a valid part passes through intact', () => {
		const parts: GeminiPart[] = [{ functionCall: { name: 'read_file', args: { path: 'a.ts' } }, thoughtSignature: 'sig' }];
		assert.deepStrictEqual(sanitizeGeminiParts(parts), parts);
	});

	test('sanitizing keeps metadata that is not part of the oneof', () => {
		const sanitized = sanitizeGeminiParts([{ text: 'x', inlineData: { mimeType: 'image/png', data: 'AA' }, thought: true }]);
		assert.strictEqual(sanitized.length, 2);
		assert.strictEqual(sanitized[0].thought, true);
		assert.strictEqual(sanitized[1].thought, true);
		assertOneofValid(sanitized);
	});

	test('accumulating never produces an invalid part, whatever arrives', () => {
		// Adversarial chunks: the same index changes type over and over.
		const chunks: GeminiPart[][] = [
			[{ text: 'a' }],
			[{ functionCall: { name: 'f1', args: {} } }],
			[{ text: 'b' }],
			[{ inlineData: { mimeType: 'image/png', data: 'AA' } }],
			[{ text: 'c', functionCall: { name: 'f2', args: {} } }],
			[{ text: 'd', thought: true }],
		];
		let parts: GeminiPart[] = [];
		for (const chunk of chunks) { parts = appendGeminiParts(parts, chunk); }
		assertOneofValid(parts);
		const texto = parts.filter(part => typeof part.text === 'string' && part.thought !== true).map(part => part.text).join('');
		assert.strictEqual(texto.includes('a') && texto.includes('b') && texto.includes('c'), true, 'no text may be lost along the way');
	});
});
