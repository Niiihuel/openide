/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { compactSlashDescription, mentionTokenAt, slashTokenAt } from '../../browser/chat/openideChatComposerSuggest.js';
import { buildOpenideChatSlashSuggestions } from '../../common/chat/openideChatSlashCommands.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('OpenIDE ChatComposerSuggest', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('mention token: at start or after whitespace, up to the caret', () => {
		assert.deepStrictEqual(mentionTokenAt('@src', 4), { q: 'src', start: 0, end: 4 });
		assert.deepStrictEqual(mentionTokenAt('fix @ab cd', 7), { q: 'ab', start: 4, end: 7 });
		assert.strictEqual(mentionTokenAt('mail@x', 6), undefined);
		assert.strictEqual(mentionTokenAt('@a b', 4), undefined);
	});

	test('slash token: start or after whitespace, identifier chars only', () => {
		assert.deepStrictEqual(slashTokenAt('/rev', 4), { q: 'rev', start: 0, end: 4 });
		assert.deepStrictEqual(slashTokenAt('/review /te', 11), { q: 'te', start: 8, end: 11 });
		assert.strictEqual(slashTokenAt('a/b', 3), undefined);
	});

	test('compactSlashDescription trims to one sentence and ~62 chars', () => {
		assert.strictEqual(compactSlashDescription(''), '');
		assert.strictEqual(compactSlashDescription('Prepara un commit atómico. Luego hace push.'), 'Prepara un commit atómico.');
		const long = compactSlashDescription('x'.repeat(30) + ' ' + 'y'.repeat(40));
		assert.ok(long.endsWith('…'));
		assert.ok(long.length <= 63);
	});

	test('slash suggestions: skills, natives + compact, then markdown commands; tools hidden', () => {
		const items = buildOpenideChatSlashSuggestions('', [
			{ slug: 'mine', description: 'Mi comando', argumentHint: '<x>' },
			{ slug: 'plan', description: 'shadowed by the native one', argumentHint: '' },
		], [
			{ kind: 'skill', name: 'tests', description: 'Escribe tests' },
			{ kind: 'tool', name: 'run_command', description: 'Ejecuta', risk: 'exec' },
		]);
		assert.strictEqual(items[0].name, 'tests');
		assert.ok(items.some(item => item.name === 'compact'));
		assert.strictEqual(items.filter(item => item.name === 'plan').length, 1);
		assert.strictEqual(items[items.length - 1].name, 'mine');
		assert.ok(!items.some(item => item.kind === 'tool'));
		const filtered = buildOpenideChatSlashSuggestions('verif', [], []);
		assert.deepStrictEqual(filtered.map(item => item.name), ['verify']);
	});
});
