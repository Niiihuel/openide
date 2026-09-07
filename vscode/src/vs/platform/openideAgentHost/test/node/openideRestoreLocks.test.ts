/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenideRestoreLocks } from '../../node/openideRestoreLocks.js';

suite('OpenIDE restore ownership', () => {
	let root: string;
	const owners: OpenideRestoreLocks[] = [];
	function owner() { const result = new OpenideRestoreLocks(); owners.push(result); return result; }
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-restore-locks-')); });
	teardown(async () => { for (const item of owners.splice(0)) { item.dispose(); } await rm(root, { recursive: true, force: true }); });

	test('another window on the same root prevents restore until it disconnects', async () => {
		const a = owner(); const b = owner();
		await Promise.all([a.setWorkspace([root]), b.setWorkspace([root])]);
		assert.strictEqual(await a.acquire([join(root, 'new.txt')]), undefined);
		b.dispose();
		const lease = await a.acquire([join(root, 'new.txt')]);
		assert.ok(lease);
		assert.strictEqual(await a.acquire([join(root, 'new.txt')]), undefined);
		a.release(lease);
		assert.ok(await a.acquire([join(root, 'new.txt')]));
	});

	test('different roots work independently and a foreign owner cannot release a lease', async () => {
		const ra = join(root, 'a'); const rb = join(root, 'b');
		await Promise.all([mkdir(ra), mkdir(rb)]);
		const a = owner(); const b = owner();
		await Promise.all([a.setWorkspace([ra]), b.setWorkspace([rb])]);
		const lease = await a.acquire([join(ra, 'file')]); assert.ok(lease);
		b.release(lease);
		assert.strictEqual(await a.acquire([join(ra, 'file')]), undefined);
		assert.ok(await b.acquire([join(rb, 'file')]));
		assert.strictEqual(await a.acquire([join(rb, 'file')]), undefined);
	});

	test('symlink aliases cannot bypass another owner or escape workspace membership', async function () {
		if (process.platform === 'win32') { this.skip(); }
		const real = join(root, 'real'); const alias = join(root, 'alias'); const outside = join(root, 'outside');
		await Promise.all([mkdir(real), mkdir(outside)]); await symlink(real, alias); await writeFile(join(real, 'file'), 'text');
		const a = owner(); const b = owner();
		await Promise.all([a.setWorkspace([real]), b.setWorkspace([alias])]);
		assert.strictEqual(await a.acquire([join(alias, 'file')]), undefined);
		b.dispose(); await symlink(outside, join(real, 'escape'));
		assert.strictEqual(await a.acquire([join(real, 'escape', 'new')]), undefined);
	});

	test('disposed owner cannot obtain a lease after asynchronous path resolution', async () => {
		const a = owner(); await a.setWorkspace([root]);
		const pending = a.acquire([join(root, 'file')]); a.dispose();
		assert.strictEqual(await pending, undefined);
	});
	test('a connected owner with unregistered roots prevents restore until its workspace is known', async () => {
		const a = owner(); const b = owner();
		await a.setWorkspace([root]);
		assert.strictEqual(await a.acquire([join(root, 'file')]), undefined);
		await b.setWorkspace([]);
		assert.ok(await a.acquire([join(root, 'file')]));
	});

});
