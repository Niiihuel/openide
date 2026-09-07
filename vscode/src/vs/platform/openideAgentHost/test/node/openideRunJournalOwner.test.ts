/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { OpenideRunJournalOwner } from '../../node/openideRunJournalOwner.js';

suite('OpenIDE run journal connection ownership', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-journal-owner-')); });
	teardown(async () => { await rm(root, { recursive: true, force: true }); });
	const event = { kind: 'run/start' as const, runId: 'run', payload: { messages: [] } };

	test('another connection cannot recover or append a live session; disposal releases it', async () => {
		const first = disposables.add(new OpenideRunJournalOwner(root));
		const second = disposables.add(new OpenideRunJournalOwner(root));
		await Promise.all([first.setWorkspace('workspace', [root]), second.setWorkspace('workspace', [root])]);
		await first.open('session');
		await assert.rejects(second.open('session'), /active journal owner/);
		await assert.rejects(second.append('session', event), /not owned/);
		await first.append('session', event);
		first.dispose();
		assert.strictEqual((await second.open('session')).length, 1);
		await assert.rejects(first.append('session', event));
		second.close('session');
	});

	test('an old open continuation cannot release its replacement on the same connection', async () => {
		const owner = disposables.add(new OpenideRunJournalOwner(root));
		await owner.setWorkspace('workspace', []);
		const old = assert.rejects(owner.open('session'), /replaced/);
		owner.close('session');
		await owner.open('session');
		await old;
		await owner.append('session', event);
		owner.close('session');
		assert.strictEqual((await owner.open('session')).length, 1);
		owner.close('session');
	});

	test('disposal during opening rejects the old continuation without taking the replacement lease', async () => {
		const first = disposables.add(new OpenideRunJournalOwner(root));
		const second = disposables.add(new OpenideRunJournalOwner(root));
		await Promise.all([first.setWorkspace('workspace', []), second.setWorkspace('workspace', [])]);
		const old = assert.rejects(first.open('session'), /disconnected/);
		first.dispose();
		await second.open('session');
		await old;
		await second.append('session', event);
		second.close('session');
	});

	test('a superseded workspace lookup cannot replace the newer registered scope', async () => {
		const owner = disposables.add(new OpenideRunJournalOwner(root));
		const other = disposables.add(new OpenideRunJournalOwner(root));
		const old = assert.rejects(owner.setWorkspace('old', [root]), /superseded/);
		await owner.setWorkspace('new', []);
		await old;
		await other.setWorkspace('new', []);
		await owner.open('session');
		await assert.rejects(other.open('session'), /active journal owner/);
		await assert.rejects(owner.setWorkspace('changed', []), /active run/);
		owner.close('session');
		await owner.setWorkspace('changed', []);
		assert.deepStrictEqual(await owner.open('session'), []);
		owner.close('session');
	});
});
