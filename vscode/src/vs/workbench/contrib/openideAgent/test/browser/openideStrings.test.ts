/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getOpenideLanguage, onDidChangeOpenideLanguage, openideStringFor, openideStringKeys, resolveOpenideLanguage, setOpenideLanguage, t } from '../../common/openideStrings.js';

suite('OpenIDE strings — openide.language', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let initial: 'es' | 'en';
	setup(() => { initial = getOpenideLanguage(); });
	teardown(() => { setOpenideLanguage(initial); });

	test('every key carries both languages, non-empty and distinct from the key', () => {
		for (const key of openideStringKeys()) {
			for (const language of ['es', 'en'] as const) {
				const text = openideStringFor(key, language);
				assert.ok(text.trim().length > 0, `${key}/${language} is empty`);
				assert.notStrictEqual(text, key, `${key}/${language} is the key itself`);
			}
		}
	});

	test('placeholders line up between languages', () => {
		for (const key of openideStringKeys()) {
			const count = (language: 'es' | 'en') => (openideStringFor(key, language).match(/\{\d+\}/g) ?? []).length;
			assert.strictEqual(count('es'), count('en'), `${key} has a different number of placeholders per language`);
		}
	});

	test('the IDE locale is the only input: Spanish variants read Spanish, everything else English', () => {
		assert.strictEqual(resolveOpenideLanguage('es-AR'), 'es');
		assert.strictEqual(resolveOpenideLanguage('es'), 'es');
		assert.strictEqual(resolveOpenideLanguage('en-US'), 'en');
		assert.strictEqual(resolveOpenideLanguage('en'), 'en');
		// A language OpenIDE does not ship falls back to English, not to the product's old default.
		assert.strictEqual(resolveOpenideLanguage('de'), 'en');
		assert.strictEqual(resolveOpenideLanguage('fr'), 'en');
		assert.strictEqual(resolveOpenideLanguage(''), 'en');
	});

	test('t() switches instantly and substitutes placeholders', () => {
		setOpenideLanguage('es');
		assert.strictEqual(t('settings.search.results', 4), '4 resultados');
		setOpenideLanguage('en');
		assert.strictEqual(t('settings.search.results', 4), '4 results');
		assert.strictEqual(t('chat.header.deleteOne', 'x'), 'Delete the conversation "x"?');
	});

	test('the change event fires once per actual change', () => {
		setOpenideLanguage('es');
		const seen: string[] = [];
		const listener = onDidChangeOpenideLanguage(language => seen.push(language));
		try {
			setOpenideLanguage('es');
			setOpenideLanguage('en');
			setOpenideLanguage('en');
			setOpenideLanguage('es');
			assert.deepStrictEqual(seen, ['en', 'es']);
		} finally {
			listener.dispose();
		}
	});
});
