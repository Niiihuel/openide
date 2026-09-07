/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IOpenideMcpEndpoint } from '../../common/openideAgentCliCatalog.js';
import { IOpenideMcpRegistration, IOpenideMcpRegistrationStore, OpenideMcpRegistrationManager, parseOpenideMcpRegistration } from '../../common/openideMcpRegistration.js';

suite('OpenIDE persistent CLI registration migration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const endpoint: IOpenideMcpEndpoint = { name: 'openide', url: 'http://127.0.0.1:32100/mcp', token: 'secret-for-first-window', tokenEnvVar: 'OPENIDE_MCP_TOKEN' };

	function fixture() {
		let id = 0;
		const records = new Map<string, unknown>();
		const store: IOpenideMcpRegistrationStore = { read: () => [...records.values()], write: record => records.set(record.id, record) };
		const newId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
		return { records, store, manager: () => new OpenideMcpRegistrationManager(store, newId) };
	}

	test('preserves legacy and unrelated entries and never persists bearer credentials', async () => {
		const { records, manager } = fixture();
		const legacy = { version: 0, name: 'openide', token: 'legacy-secret' };
		records.set('legacy', legacy);
		const entries = new Map([['openide', { url: 'http://old.invalid', token: 'user-edited-token' }], ['github', { url: 'https://github.invalid', token: 'unrelated' }]]);
		const original = [...entries.entries()];
		const registration = await manager().register('grok', 'workspace', () => endpoint, async value => {
			assert.ok(!entries.has(value.name), 'registration must allocate a new entry');
			entries.set(value.name, { url: value.url, token: value.token });
		});
		assert.deepStrictEqual(original.map(([name]) => [name, entries.get(name)]), original);
		assert.deepStrictEqual(records.get('legacy'), legacy);
		assert.strictEqual(entries.get(registration.registration.name)?.token, endpoint.token);
		assert.ok(!JSON.stringify(registration.registration).includes(endpoint.token));
		assert.ok(!JSON.stringify(registration.registration).includes(endpoint.url));
		assert.deepStrictEqual(parseOpenideMcpRegistration({ ...registration.registration, token: endpoint.token }), registration.registration);
	});

	test('coalesces concurrent clicks and remains idempotent for a live generation', async () => {
		const { manager } = fixture();
		const connection = manager();
		const gate = new DeferredPromise<void>();
		let calls = 0;
		const execute = async () => { calls++; await gate.p; };
		const first = connection.register('grok', 'workspace', () => endpoint, execute);
		const second = connection.register('grok', 'workspace', () => endpoint, execute);
		gate.complete();
		const results = await Promise.all([first, second]);
		const third = await connection.register('grok', 'workspace', () => endpoint, execute);
		assert.deepStrictEqual({ calls, reused: [...results, third].map(result => result.reused), names: new Set([...results, third].map(result => result.registration.name)).size },
			{ calls: 1, reused: [false, true, true], names: 1 });
	});

	test('identical workspaces in separate windows get different names and closing one preserves the other', async () => {
		const { records, manager } = fixture();
		const first = manager();
		const second = manager();
		const a = await first.register('grok', 'same-workspace', () => endpoint, async () => { });
		const b = await second.register('grok', 'same-workspace', () => ({ ...endpoint, token: 'second-window' }), async () => { });
		first.dispose();
		assert.notStrictEqual(a.registration.name, b.registration.name);
		assert.deepStrictEqual([parseOpenideMcpRegistration(records.get(a.registration.id))?.state, parseOpenideMcpRegistration(records.get(b.registration.id))?.state], ['expired', 'registered']);
	});

	test('reload reconnects through a new entry, leaving both expired and ambiguous registrations untouched', async () => {
		const { manager, records } = fixture();
		const previous = manager();
		const old = await previous.register('grok', 'workspace', () => endpoint, async () => { });
		previous.dispose();
		const reload = manager();
		assert.deepStrictEqual(reload.previous('workspace').map(record => record.state), ['expired']);
		const uncertain: IOpenideMcpRegistration = { ...old.registration, state: 'uncertain' };
		records.set('crash', uncertain);
		const next = await reload.register('grok', 'workspace', () => ({ ...endpoint, token: 'new-generation' }), async () => { });
		assert.notStrictEqual(old.registration.name, next.registration.name);
		assert.deepStrictEqual(records.get('crash'), uncertain);
		assert.strictEqual(parseOpenideMcpRegistration(records.get(old.registration.id))?.state, 'expired');
	});

	test('an endpoint replaced while the CLI command runs reports expiry instead of success', async () => {
		const { manager } = fixture();
		let current = endpoint;
		const result = await manager().register('grok', 'workspace', () => current, async () => { current = { ...endpoint, token: 'replacement' }; });
		assert.deepStrictEqual({ expired: result.expired, state: result.registration.state }, { expired: true, state: 'expired' });
	});

	test('a partially failed command retains uncertain metadata and retries with a separate entry', async () => {
		const { manager, records } = fixture();
		const connection = manager();
		const names: string[] = [];
		await assert.rejects(connection.register('grok', 'workspace', () => endpoint, async value => {
			names.push(value.name);
			throw new Error(`CLI failed after adding ${value.name}: Authorization: Bearer ${value.token}`);
		}), error => error instanceof Error && error.message.includes('[redacted]') && !error.message.includes(endpoint.token));
		const prior = [...records.values()];
		await connection.register('grok', 'workspace', () => endpoint, async value => { names.push(value.name); });
		assert.notStrictEqual(names[0], names[1]);
		assert.strictEqual(parseOpenideMcpRegistration(prior[0])?.state, 'uncertain');
	});

	test('version, provenance and name mismatches cannot establish ownership', async () => {
		const { manager } = fixture();
		const { registration } = await manager().register('grok', 'workspace', () => endpoint, async () => { });
		for (const value of [{ ...registration, version: 2 }, { ...registration, owner: 'another-app' }, { ...registration, name: 'openide' }, { ...registration, name: 'github' }, { ...registration, id: 'malformed' }]) {
			assert.strictEqual(parseOpenideMcpRegistration(value), undefined);
		}
	});
});
