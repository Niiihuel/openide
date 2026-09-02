/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildAutocompletePrompt, extractCompletion, HOLE, IOpenideAutocompleteInput, postprocessCompletion, pruneFromBottom, pruneFromTop, reuseCompletion, shouldCompleteMultiline } from '../../common/autocomplete/openideAutocompleteEngine.js';

suite('OpenIDE — motor de autocompletado', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const input = (prefix: string, suffix = '', extra: Partial<IOpenideAutocompleteInput> = {}): IOpenideAutocompleteInput =>
		({ path: 'src/a.ts', languageId: 'typescript', prefix, suffix, multiline: 'auto', ...extra });

	suite('poda', () => {
		test('el prefijo se corta al principio de una línea', () => {
			const text = 'aaaa\nbbbb\ncccc\ndddd';
			assert.strictEqual(pruneFromTop(text, 9), 'cccc\ndddd');
			assert.strictEqual(pruneFromTop(text, 100), text);
		});

		test('el sufijo se corta al final de una línea', () => {
			assert.strictEqual(pruneFromBottom('aaaa\nbbbb\ncccc', 7), 'aaaa');
		});
	});

	suite('multilínea', () => {
		test('always y never mandan', () => {
			assert.strictEqual(shouldCompleteMultiline(input('x', 'y', { multiline: 'always' })), true);
			assert.strictEqual(shouldCompleteMultiline(input('x', '', { multiline: 'never' })), false);
		});

		test('con código a la derecha del caret es una sola línea', () => {
			assert.strictEqual(shouldCompleteMultiline(input('const a = ', ' + 1;\nnext')), false);
			assert.strictEqual(shouldCompleteMultiline(input('const a = ', '\nnext')), true);
		});

		test('un comentario de línea no se vuelve bloque', () => {
			assert.strictEqual(shouldCompleteMultiline(input('  // TODO: ')), false);
			assert.strictEqual(shouldCompleteMultiline(input('# ', '', { languageId: 'python' })), false);
		});
	});

	suite('prompt', () => {
		test('lleva el archivo con el hueco y pide sólo el hueco', () => {
			const p = buildAutocompletePrompt(input('function f() {\n  return ', '\n}'));
			assert.ok(p.prompt.includes(`  return ${HOLE}\n}`));
			assert.ok(p.prompt.includes('file: src/a.ts, language: typescript'));
			assert.ok(p.system.includes('<COMPLETION></COMPLETION>'));
			assert.strictEqual(p.multiline, true);
		});
	});

	suite('respuesta', () => {
		test('saca el contenido de las etiquetas y de un fence', () => {
			assert.strictEqual(extractCompletion('Sure!\n<COMPLETION>a + b;</COMPLETION>\nDone'), 'a + b;');
			assert.strictEqual(extractCompletion('```ts\na + b;\n```'), 'a + b;');
		});

		test('quita el eco de la línea actual', () => {
			const p = buildAutocompletePrompt(input('  const total = ', ''));
			assert.strictEqual(postprocessCompletion('<COMPLETION>const total = a + b;</COMPLETION>', p), 'a + b;');
		});

		test('se detiene donde empieza el sufijo', () => {
			const p = buildAutocompletePrompt(input('function f() {\n  return ', '\n}\n\nexport const next = 1;'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>a + b;\n}\n\nexport const next = 1;</COMPLETION>', p), 'a + b;');
		});

		test('una respuesta que es sólo el sufijo no vale', () => {
			const p = buildAutocompletePrompt(input('x = ', '\nexport const next = 1;'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>export const next = 1;</COMPLETION>', p), undefined);
		});

		test('una sola línea cuando corresponde', () => {
			const p = buildAutocompletePrompt(input('const a = ', ' + 1;'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>b\nconst c = 2;</COMPLETION>', p), 'b');
		});

		test('un bloque termina en la primera línea en blanco', () => {
			const p = buildAutocompletePrompt(input('function f() {\n  ', '\n}'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>const a = 1;\n  return a;\n\nfunction g() {}</COMPLETION>', p), 'const a = 1;\n  return a;');
		});

		test('vacío, la línea de arriba otra vez o un bucle no se muestran', () => {
			const p = buildAutocompletePrompt(input('foo();\n', ''));
			assert.strictEqual(postprocessCompletion('<COMPLETION>   </COMPLETION>', p), undefined);
			assert.strictEqual(postprocessCompletion('<COMPLETION>foo();</COMPLETION>', p), undefined);
			assert.strictEqual(postprocessCompletion('<COMPLETION>bar();\nbar();\nbar();</COMPLETION>', p), undefined);
		});
	});

	suite('reuso desde la caché', () => {
		test('lo que el usuario tipeó de la predicción se descuenta', () => {
			assert.strictEqual(reuseCompletion('const x = ', 'a + b;', 'const x = a +'), ' b;');
			assert.strictEqual(reuseCompletion('const x = ', 'a + b;', 'const x = z'), undefined);
			assert.strictEqual(reuseCompletion('const x = ', 'a + b;', 'const x = a + b;'), undefined);
			assert.strictEqual(reuseCompletion('other', 'a', 'const x = '), undefined);
		});
	});
});
