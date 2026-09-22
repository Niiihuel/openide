/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICredentialSourcesSnapshot } from '../../../../../platform/openideAgentHost/common/openideCredentialSources.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { OpenideAuthManager } from '../../browser/openideAuth.js';
import { OpenideOAuthManager } from '../../browser/openideOAuth.js';

suite('OpenIDE credential discovery', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const snapshot = (value: string): ICredentialSourcesSnapshot => ({ env: { TEST_KEY: value }, sources: [] });
	const createAuth = () => new OpenideAuthManager(store.add(new TestSecretStorageService()), upcastPartial<OpenideOAuthManager>({}));

	test('shares one external scan across providers, without copying credentials into storage', async () => {
		const auth = createAuth();
		let scans = 0;
		auth.useRegistry(() => ({ envNames: ['TEST_KEY'] }), () => ['TEST_KEY'], async () => { scans++; return snapshot('external'); });
		const values = await Promise.all(['a', 'b', 'c'].map(id => auth.lookup(id)));
		assert.deepStrictEqual({ scans, origins: values.map(value => value?.origin.kind), stored: await auth.hasStoredApiKey('a') }, { scans: 1, origins: ['env', 'env', 'env'], stored: false });
	});

	test('refresh during a pending scan neither returns nor caches the stale result', async () => {
		const auth = createAuth();
		const started = new DeferredPromise<void>();
		const first = new DeferredPromise<ICredentialSourcesSnapshot>();
		let scans = 0;
		auth.useRegistry(() => ({ envNames: ['TEST_KEY'] }), () => ['TEST_KEY'], async () => {
			if (++scans === 1) { await started.complete(); return first.p; }
			return snapshot('current');
		});
		const oldLookup = auth.lookup('a');
		await started.p;
		auth.forgetExternalCredentials();
		const fresh = await auth.lookup('a');
		await first.complete(snapshot('stale'));
		assert.deepStrictEqual({ scans, current: fresh?.values.key, waiting: (await oldLookup)?.values.key, cached: (await auth.lookup('a'))?.values.key },
			{ scans: 2, current: 'current', waiting: 'current', cached: 'current' });
	});

	test('new catalog environment names invalidate a previously empty machine snapshot', async () => {
		const auth = createAuth();
		let names: string[] = [];
		const scans: string[][] = [];
		auth.useRegistry(() => ({ envNames: ['TEST_KEY'] }), () => names, async requested => {
			scans.push([...requested]);
			return requested.includes('TEST_KEY') ? snapshot('external') : { env: {}, sources: [] };
		});
		assert.strictEqual(await auth.lookup('a'), undefined);
		names = ['TEST_KEY'];
		assert.deepStrictEqual({ scans, found: (await auth.lookup('a'))?.origin.kind }, { scans: [[], ['TEST_KEY']], found: 'env' });
	});

	test('trims pasted keys and leaves the previous key intact after an invalid replacement', async () => {
		const auth = createAuth();
		await auth.setApiKey('a', '  valid-value\n');
		for (const invalid of ['', '   ', 'two words', 'header\r\ninjection', 'nul\x00value', 'del\x7fvalue']) { await assert.rejects(auth.setApiKey('a', invalid)); }
		assert.deepStrictEqual((await auth.lookup('a'))?.values, { key: 'valid-value' });
	});
});
