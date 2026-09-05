/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { OpenideProviderAccountsService } from '../../browser/openideProviderAccounts.js';

suite('OpenIDE provider account removal', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const provider = 'test';
	const key = 'openide.agent.oauth.test';

	async function setup() {
		const secrets = store.add(new TestSecretStorageService());
		const accounts = new OpenideProviderAccountsService(secrets);
		await secrets.set(key, 'first-credential');
		await accounts.snapshot(provider, key, { id: 'first' });
		await secrets.set(key, 'second-credential');
		await accounts.snapshot(provider, key, { id: 'second' });
		return { secrets, accounts };
	}

	test('removing the active account restores the remaining account across restart', async () => {
		const { secrets, accounts } = await setup();
		await accounts.remove(provider, key, 'second');
		const restored = new OpenideProviderAccountsService(secrets);
		assert.deepStrictEqual({ active: await restored.getActiveId(provider), ids: (await restored.list(provider)).map(a => a.id), credential: await secrets.get(key), deleted: await secrets.get(`${key}::second`) },
			{ active: 'first', ids: ['first'], credential: 'first-credential', deleted: undefined });
	});

	test('removing an inactive account preserves the current refreshed credential', async () => {
		const { secrets, accounts } = await setup();
		await secrets.set(key, 'refreshed-second');
		await accounts.remove(provider, key, 'first');
		assert.deepStrictEqual([await accounts.getActiveId(provider), await secrets.get(key)], ['second', 'refreshed-second']);
	});

	test('removing the last account signs out', async () => {
		const { secrets, accounts } = await setup();
		await accounts.remove(provider, key, 'first');
		await accounts.remove(provider, key, 'second');
		assert.deepStrictEqual([await accounts.list(provider), await accounts.getActiveId(provider), await secrets.get(key)], [[], undefined, undefined]);
	});

	test('skips missing saved credentials instead of selecting a disconnected account', async () => {
		const { secrets, accounts } = await setup();
		await secrets.set(key, 'third-credential');
		await accounts.snapshot(provider, key, { id: 'third' });
		await secrets.delete(`${key}::first`);
		await accounts.remove(provider, key, 'third');
		assert.deepStrictEqual([await accounts.getActiveId(provider), await secrets.get(key)], ['second', 'second-credential']);
	});
});
