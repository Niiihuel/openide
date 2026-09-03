/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildDiffPreview, countDiff, textLines } from '../../common/openideDiffPreview.js';

suite('OpenIDE — the compact diff shared by the chat and Agent Changes', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('empty text has zero lines, not one empty one', () => {
		assert.deepStrictEqual(textLines(''), []);
		assert.deepStrictEqual(textLines('a\r\nb\nc'), ['a', 'b', 'c']);
	});

	suite('countDiff', () => {
		test('a created file removes nothing', () => {
			assert.deepStrictEqual(countDiff('', 'a\nb\nc'), { added: 3, removed: 0 });
		});

		test('an emptied file adds nothing', () => {
			assert.deepStrictEqual(countDiff('a\nb', ''), { added: 0, removed: 2 });
		});

		test('it counts the changed lines on each side', () => {
			assert.deepStrictEqual(countDiff('a\nb\nc', 'a\nB\nc\nd'), { added: 2, removed: 1 });
		});
	});

	suite('buildDiffPreview', () => {
		test('a creation is all adds, without the ghost of the empty line', () => {
			assert.deepStrictEqual(buildDiffPreview('', 'a\nb'), [{ t: 'add', x: 'a' }, { t: 'add', x: 'b' }]);
		});

		test('a deletion is all dels', () => {
			assert.deepStrictEqual(buildDiffPreview('a\nb', ''), [{ t: 'del', x: 'a' }, { t: 'del', x: 'b' }]);
		});

		test('two lines of context, and a gap between distant hunks', () => {
			const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n');
			const after = before.replace('l3', 'L3').replace('l18', 'L18');
			const rows = buildDiffPreview(before, after);
			assert.deepStrictEqual(rows.map(r => r.t), ['ctx', 'ctx', 'del', 'add', 'gap', 'ctx', 'ctx', 'del', 'add']);
			assert.deepStrictEqual(rows.filter(r => r.t === 'del').map(r => r.x), ['l3', 'l18']);
			assert.deepStrictEqual(rows.filter(r => r.t === 'add').map(r => r.x), ['L3', 'L18']);
		});

		test('no gap when the hunks touch', () => {
			const rows = buildDiffPreview('a\nb\nc\nd', 'A\nb\nc\nD');
			assert.ok(!rows.some(r => r.t === 'gap'));
		});

		test('it respects the line ceiling and says so with a gap', () => {
			const before = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
			const rows = buildDiffPreview('', before, 10);
			assert.strictEqual(rows.length, 11);
			assert.strictEqual(rows[10].t, 'gap');
		});

		test('it shortens very long lines', () => {
			const long = 'x'.repeat(500);
			const [row] = buildDiffPreview('', long);
			assert.strictEqual(row.x.length, 241);
			assert.ok(row.x.endsWith('…'));
		});
	});
});
