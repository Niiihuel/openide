/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildDisplayLanguageOptions, isShippedLanguage, OPENIDE_SHIPPED_LANGUAGES, selectedDisplayLanguage } from '../../common/openideDisplayLanguages.js';

suite('OpenIDE — the display languages the Language section offers', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the two languages OpenIDE ships are listed before anything has been read', () => {
		const options = buildDisplayLanguageOptions('en', undefined);
		assert.deepStrictEqual(options.map(option => option.value), ['en', 'es']);
		assert.deepStrictEqual(options.map(option => option.label), ['English', 'Español']);
		assert.ok(options.every(option => !option.partial));
	});

	test('Spanish is offered with no pack installed — that is the whole point', () => {
		const options = buildDisplayLanguageOptions('en', [{ id: 'en', label: 'English' }]);
		const spanish = options.find(option => option.value === 'es');
		assert.ok(spanish);
		assert.strictEqual(spanish.needsInstall, true);
	});

	test('nothing is flagged as missing while the installed packs are still loading', () => {
		const spanish = buildDisplayLanguageOptions('en', undefined).find(option => option.value === 'es');
		assert.strictEqual(spanish?.needsInstall, false);
	});

	test('an installed shipped pack is not offered twice, and no longer needs installing', () => {
		const options = buildDisplayLanguageOptions('es', [{ id: 'es', label: 'español' }, { id: 'en', label: 'English' }]);
		assert.deepStrictEqual(options.map(option => option.value), ['en', 'es']);
		// The endonym from the constant wins over the pack's own label: one spelling everywhere.
		assert.strictEqual(options[1].label, 'Español');
		assert.strictEqual(options[1].needsInstall, false);
	});

	test('another installed pack follows, marked as translating only the native workbench', () => {
		const options = buildDisplayLanguageOptions('en', [{ id: 'de', label: 'Deutsch' }, { id: 'en', label: 'English' }]);
		assert.deepStrictEqual(options.map(option => option.value), ['en', 'es', 'de']);
		assert.strictEqual(options[2].partial, true);
	});

	test('two packs for one locale collapse into one choice', () => {
		const options = buildDisplayLanguageOptions('en', [
			{ id: 'zh-cn', label: '中文 (简体)' },
			{ id: 'ZH-CN', label: '中文 (简体)' },
		]);
		assert.deepStrictEqual(options.filter(option => option.value === 'zh-cn').length, 1);
	});

	test('a locale nobody knows about is still selectable, because it is what is on screen', () => {
		const options = buildDisplayLanguageOptions('qps-ploc', []);
		assert.strictEqual(options.at(-1)?.value, 'qps-ploc');
		assert.strictEqual(selectedDisplayLanguage('qps-ploc', options), 'qps-ploc');
	});

	test('a regional variant selects its base language', () => {
		const options = buildDisplayLanguageOptions('es-ar', [{ id: 'es', label: 'español' }]);
		assert.strictEqual(selectedDisplayLanguage('es-ar', options), 'es');
	});

	test('an exact locale wins over its base', () => {
		const options = buildDisplayLanguageOptions('zh-cn', [{ id: 'zh-cn', label: '中文 (简体)' }]);
		assert.strictEqual(selectedDisplayLanguage('zh-cn', options), 'zh-cn');
	});

	test('English is the fallback selection, never an empty one', () => {
		assert.strictEqual(selectedDisplayLanguage('', buildDisplayLanguageOptions('', [])), 'en');
	});

	test('every shipped language but English carries a Microsoft pack id', () => {
		for (const language of OPENIDE_SHIPPED_LANGUAGES) {
			assert.strictEqual(language.locale, language.locale.toLowerCase());
			if (language.locale === 'en') {
				assert.strictEqual(language.extensionId, undefined);
				continue;
			}
			// `ILocaleService.setLocale` installs `ms-ceintl` packs and bounces every other
			// publisher to the extensions view: a different id would silently break the flow.
			assert.ok(language.extensionId?.toLowerCase().startsWith('ms-ceintl.'), language.locale);
		}
		assert.ok(isShippedLanguage('ES'));
		assert.ok(!isShippedLanguage('de'));
	});
});
