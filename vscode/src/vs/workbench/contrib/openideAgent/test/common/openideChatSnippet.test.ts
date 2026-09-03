/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildSnippetContext, IComposerSnippet, sameSnippet, snippetLabel } from '../../common/chat/openideChatSnippet.js';

suite('OpenIDE — editor snippets sent to the chat', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const snippet: IComposerSnippet = { path: 'src/a/b.ts', startLine: 12, endLine: 40, text: 'const x = 1;', languageId: 'typescript' };

	test('the label is name + range, like Continue\'s context item', () => {
		assert.strictEqual(snippetLabel(snippet), 'b.ts (12-40)');
		assert.strictEqual(snippetLabel({ ...snippet, endLine: 12 }), 'b.ts (12)');
	});

	test('two snippets are the same by file and range, not by text', () => {
		assert.ok(sameSnippet(snippet, { ...snippet, text: 'otro' }));
		assert.ok(!sameSnippet(snippet, { ...snippet, endLine: 41 }));
	});

	test('it serializes as a fence with language, path and lines', () => {
		const context = buildSnippetContext([snippet]);
		assert.ok(context?.startsWith('[Fragmentos que el usuario seleccionó en el editor'));
		assert.ok(context?.includes('```typescript src/a/b.ts (12-40)\nconst x = 1;\n```'));
	});

	test('with no snippets there is no context', () => {
		assert.strictEqual(buildSnippetContext([]), undefined);
	});

	test('a snippet with triple backticks does not close its own fence', () => {
		const context = buildSnippetContext([{ ...snippet, languageId: undefined, text: 'a\n```\nb\n````\nc' }])!;
		assert.ok(context.includes('`````src/a/b.ts (12-40)\n'));
		assert.ok(context.endsWith('\n`````'));
	});
});
