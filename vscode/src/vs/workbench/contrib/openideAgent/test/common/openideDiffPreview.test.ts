/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildDiffPreview, countDiff, textLines } from '../../common/openideDiffPreview.js';

suite('OpenIDE — el diff compacto que comparten el chat y Agent Changes', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('el texto vacío tiene cero líneas, no una vacía', () => {
		assert.deepStrictEqual(textLines(''), []);
		assert.deepStrictEqual(textLines('a\r\nb\nc'), ['a', 'b', 'c']);
	});

	suite('countDiff', () => {
		test('un archivo creado no quita nada', () => {
			assert.deepStrictEqual(countDiff('', 'a\nb\nc'), { added: 3, removed: 0 });
		});

		test('un archivo vaciado no agrega nada', () => {
			assert.deepStrictEqual(countDiff('a\nb', ''), { added: 0, removed: 2 });
		});

		test('cuenta las líneas cambiadas de cada lado', () => {
			assert.deepStrictEqual(countDiff('a\nb\nc', 'a\nB\nc\nd'), { added: 2, removed: 1 });
		});
	});

	suite('buildDiffPreview', () => {
		test('una creación es todo add, sin el fantasma de la línea vacía', () => {
			assert.deepStrictEqual(buildDiffPreview('', 'a\nb'), [{ t: 'add', x: 'a' }, { t: 'add', x: 'b' }]);
		});

		test('un borrado es todo del', () => {
			assert.deepStrictEqual(buildDiffPreview('a\nb', ''), [{ t: 'del', x: 'a' }, { t: 'del', x: 'b' }]);
		});

		test('dos líneas de contexto y un gap entre hunks lejanos', () => {
			const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n');
			const after = before.replace('l3', 'L3').replace('l18', 'L18');
			const rows = buildDiffPreview(before, after);
			assert.deepStrictEqual(rows.map(r => r.t), ['ctx', 'ctx', 'del', 'add', 'gap', 'ctx', 'ctx', 'del', 'add']);
			assert.deepStrictEqual(rows.filter(r => r.t === 'del').map(r => r.x), ['l3', 'l18']);
			assert.deepStrictEqual(rows.filter(r => r.t === 'add').map(r => r.x), ['L3', 'L18']);
		});

		test('sin gap cuando los hunks se tocan', () => {
			const rows = buildDiffPreview('a\nb\nc\nd', 'A\nb\nc\nD');
			assert.ok(!rows.some(r => r.t === 'gap'));
		});

		test('respeta el tope de líneas y lo dice con un gap', () => {
			const before = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
			const rows = buildDiffPreview('', before, 10);
			assert.strictEqual(rows.length, 11);
			assert.strictEqual(rows[10].t, 'gap');
		});

		test('acorta las líneas larguísimas', () => {
			const long = 'x'.repeat(500);
			const [row] = buildDiffPreview('', long);
			assert.strictEqual(row.x.length, 241);
			assert.ok(row.x.endsWith('…'));
		});
	});
});
