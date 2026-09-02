/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildSnippetContext, IComposerSnippet, sameSnippet, snippetLabel } from '../../common/chat/openideChatSnippet.js';

suite('OpenIDE — fragmentos del editor enviados al chat', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const snippet: IComposerSnippet = { path: 'src/a/b.ts', startLine: 12, endLine: 40, text: 'const x = 1;', languageId: 'typescript' };

	test('la etiqueta es nombre + rango, como el context item de Continue', () => {
		assert.strictEqual(snippetLabel(snippet), 'b.ts (12-40)');
		assert.strictEqual(snippetLabel({ ...snippet, endLine: 12 }), 'b.ts (12)');
	});

	test('dos fragmentos son el mismo por archivo y rango, no por texto', () => {
		assert.ok(sameSnippet(snippet, { ...snippet, text: 'otro' }));
		assert.ok(!sameSnippet(snippet, { ...snippet, endLine: 41 }));
	});

	test('se serializa como fence con lenguaje, ruta y líneas', () => {
		const context = buildSnippetContext([snippet]);
		assert.ok(context?.startsWith('[Fragmentos que el usuario seleccionó en el editor'));
		assert.ok(context?.includes('```typescript src/a/b.ts (12-40)\nconst x = 1;\n```'));
	});

	test('sin fragmentos no hay contexto', () => {
		assert.strictEqual(buildSnippetContext([]), undefined);
	});

	test('un fragmento con backticks triples no cierra su propio fence', () => {
		const context = buildSnippetContext([{ ...snippet, languageId: undefined, text: 'a\n```\nb\n````\nc' }])!;
		assert.ok(context.includes('`````src/a/b.ts (12-40)\n'));
		assert.ok(context.endsWith('\n`````'));
	});
});
