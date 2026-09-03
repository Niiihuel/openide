/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { filterProviderModels, orderProviderModels } from '../../common/openideProviderModels.js';

suite('OpenIDE provider model list', () => {

	test('the default model is pinned first, catalog order preserved, duplicates dropped', () => {
		assert.deepStrictEqual(
			orderProviderModels(['a', 'b', 'default-x', 'c', 'b'], 'default-x'),
			['default-x', 'a', 'b', 'c'],
		);
	});

	test('a default the catalog does not publish still leads the list', () => {
		assert.deepStrictEqual(orderProviderModels(['a', 'b'], 'mine'), ['mine', 'a', 'b']);
	});

	test('no default: the catalog order stands as-is', () => {
		assert.deepStrictEqual(orderProviderModels(['b', 'a'], ''), ['b', 'a']);
	});

	test('blank ids never make it into the list', () => {
		assert.deepStrictEqual(orderProviderModels(['a', ' ', ''], ''), ['a']);
	});

	test('filtering matches the human name AND the raw id, case-insensitively', () => {
		const models = [
			{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
			{ id: 'gpt-5.2', name: 'GPT-5.2' },
		];
		assert.deepStrictEqual(filterProviderModels(models, 'SONNET').map(m => m.id), ['claude-sonnet-4-5']);
		assert.deepStrictEqual(filterProviderModels(models, 'gpt-5').map(m => m.id), ['gpt-5.2']);
		assert.strictEqual(filterProviderModels(models, '').length, 2);
		assert.strictEqual(filterProviderModels(models, 'gemini').length, 0);
	});
});
