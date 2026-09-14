/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { OpenideDiffSnapshotProvider } from '../../browser/openideDiffSnapshot.js';

suite('OpenIDE pending diff ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('pending files are scoped durably and shared baselines cannot be bulk resolved by either chat', () => {
		const storage = store.add(new TestStorageService());
		const create = () => new OpenideDiffSnapshotProvider(upcastPartial<IModelService>({ getModel: () => null }), upcastPartial<ILanguageService>({}), storage);
		const provider = create();
		provider.setBaselineOnce('a.ts', 'before A', true, 'A'); provider.markPending('a.ts', true, 2, 1);
		provider.setBaselineOnce('b.ts', 'before B', true, 'B'); provider.markPending('b.ts', true, 3, 1);
		assert.deepStrictEqual(provider.pendingDiffs('A').map(f => f.path), ['a.ts']);
		assert.deepStrictEqual(create().pendingDiffs('B').map(f => f.path), ['b.ts']);
		provider.overwriteBaseline('a.ts', 'partially accepted A');
		assert.strictEqual(create().pendingDiffs('A').length, 1);
		provider.setBaselineOnce('a.ts', 'after A', true, 'B'); provider.markPending('a.ts', true, 4, 1);
		assert.deepStrictEqual(provider.pendingDiffs('A'), []);
		assert.deepStrictEqual(provider.pendingDiffs('B').map(f => f.path), ['b.ts']);
		assert.strictEqual(provider.getBaseline('a.ts'), 'partially accepted A');
		assert.strictEqual(create().pendingDiffs().length, 2, 'manual inline review retains shared pending baselines');
	});
});
