/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildAutocompletePrompt, extractCompletion, HOLE, IOpenideAutocompleteInput, postprocessCompletion, pruneFromBottom, pruneFromTop, reuseCompletion, shouldCompleteMultiline } from '../../common/autocomplete/openideAutocompleteEngine.js';

suite('OpenIDE — autocomplete engine', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const input = (prefix: string, suffix = '', extra: Partial<IOpenideAutocompleteInput> = {}): IOpenideAutocompleteInput =>
		({ path: 'src/a.ts', languageId: 'typescript', prefix, suffix, multiline: 'auto', ...extra });

	suite('trimming', () => {
		test('the prefix is cut at the start of a line', () => {
			const text = 'aaaa\nbbbb\ncccc\ndddd';
			assert.strictEqual(pruneFromTop(text, 9), 'cccc\ndddd');
			assert.strictEqual(pruneFromTop(text, 100), text);
		});

		test('the suffix is cut at the end of a line', () => {
			assert.strictEqual(pruneFromBottom('aaaa\nbbbb\ncccc', 7), 'aaaa');
		});
	});

	suite('multiline', () => {
		test('always and never win', () => {
			assert.strictEqual(shouldCompleteMultiline(input('x', 'y', { multiline: 'always' })), true);
			assert.strictEqual(shouldCompleteMultiline(input('x', '', { multiline: 'never' })), false);
		});

		test('with code to the right of the caret it is a single line', () => {
			assert.strictEqual(shouldCompleteMultiline(input('const a = ', ' + 1;\nnext')), false);
			assert.strictEqual(shouldCompleteMultiline(input('const a = ', '\nnext')), true);
		});

		test('a line comment does not become a block', () => {
			assert.strictEqual(shouldCompleteMultiline(input('  // TODO: ')), false);
			assert.strictEqual(shouldCompleteMultiline(input('# ', '', { languageId: 'python' })), false);
		});
	});

	suite('prompt', () => {
		test('it sends the file with the hole and asks only for the hole', () => {
			const p = buildAutocompletePrompt(input('function f() {\n  return ', '\n}'));
			assert.ok(p.prompt.includes(`  return ${HOLE}\n}`));
			assert.ok(p.prompt.includes('file: src/a.ts, language: typescript'));
			assert.ok(p.system.includes('<COMPLETION></COMPLETION>'));
			assert.strictEqual(p.multiline, true);
		});
	});

	suite('response', () => {
		test('it pulls the content out of the tags and out of a fence', () => {
			assert.strictEqual(extractCompletion('Sure!\n<COMPLETION>a + b;</COMPLETION>\nDone'), 'a + b;');
			assert.strictEqual(extractCompletion('```ts\na + b;\n```'), 'a + b;');
		});

		test('it strips the echo of the current line', () => {
			const p = buildAutocompletePrompt(input('  const total = ', ''));
			assert.strictEqual(postprocessCompletion('<COMPLETION>const total = a + b;</COMPLETION>', p), 'a + b;');
		});

		test('it stops where the suffix begins', () => {
			const p = buildAutocompletePrompt(input('function f() {\n  return ', '\n}\n\nexport const next = 1;'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>a + b;\n}\n\nexport const next = 1;</COMPLETION>', p), 'a + b;');
		});

		test('a reply that is nothing but the suffix does not count', () => {
			const p = buildAutocompletePrompt(input('x = ', '\nexport const next = 1;'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>export const next = 1;</COMPLETION>', p), undefined);
		});

		test('a single line when that is what fits', () => {
			const p = buildAutocompletePrompt(input('const a = ', ' + 1;'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>b\nconst c = 2;</COMPLETION>', p), 'b');
		});

		test('a block ends at the first blank line', () => {
			const p = buildAutocompletePrompt(input('function f() {\n  ', '\n}'));
			assert.strictEqual(postprocessCompletion('<COMPLETION>const a = 1;\n  return a;\n\nfunction g() {}</COMPLETION>', p), 'const a = 1;\n  return a;');
		});

		test('empty, the line above again, or a loop are never shown', () => {
			const p = buildAutocompletePrompt(input('foo();\n', ''));
			assert.strictEqual(postprocessCompletion('<COMPLETION>   </COMPLETION>', p), undefined);
			assert.strictEqual(postprocessCompletion('<COMPLETION>foo();</COMPLETION>', p), undefined);
			assert.strictEqual(postprocessCompletion('<COMPLETION>bar();\nbar();\nbar();</COMPLETION>', p), undefined);
		});
	});

	suite('reuse from the cache', () => {
		test('whatever the user typed of the prediction is subtracted', () => {
			assert.strictEqual(reuseCompletion('const x = ', 'a + b;', 'const x = a +'), ' b;');
			assert.strictEqual(reuseCompletion('const x = ', 'a + b;', 'const x = z'), undefined);
			assert.strictEqual(reuseCompletion('const x = ', 'a + b;', 'const x = a + b;'), undefined);
			assert.strictEqual(reuseCompletion('other', 'a', 'const x = '), undefined);
		});
	});
});
