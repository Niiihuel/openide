/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync, spawn } from 'child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenideSubagentWorktrees } from '../../node/openideSubagentWorktrees.js';

suite('OpenIDE native subagent worktrees', () => {
	let root: string;
	let backend: OpenideSubagentWorktrees;
	const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	setup(async () => {
		root = await mkdtemp(join(tmpdir(), 'openide-worktree-test-'));
		backend = new OpenideSubagentWorktrees();
		git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
		await Promise.all([writeFile(join(root, 'file.txt'), 'base\n'), writeFile(join(root, 'delete.txt'), 'remove\n'), writeFile(join(root, 'unrelated.txt'), 'original\n')]);
		git('add', '.'); git('commit', '-qm', 'base');
	});
	teardown(async () => { await backend.discard('run').catch(() => undefined); await backend.dispose(); await rm(root, { recursive: true, force: true }); });

	test('creates a detached worktree without changing the source branch and rejects a dirty baseline', async () => {
		const branch = git('symbolic-ref', 'HEAD');
		await writeFile(join(root, 'file.txt'), 'user work\n');
		await assert.rejects(backend.create('run', root), /Commit or stash/);
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'user work\n');
		git('restore', 'file.txt');
		await writeFile(join(root, 'untracked.txt'), 'new work\n');
		await assert.rejects(backend.create('run', root), /Commit or stash/);
		await rm(join(root, 'untracked.txt'));
		const lease = await backend.create('run', root);
		assert.strictEqual(await readFile(join(lease.path, 'file.txt'), 'utf8'), 'base\n');
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'base\n');
		assert.strictEqual(git('symbolic-ref', 'HEAD'), branch);
		await assert.rejects(backend.create('run', root), /duplicate/);
	});

	test('native Git rejects external filter commands instead of executing outside confinement', async () => {
		git('config', 'filter.fixture.clean', 'touch FILTER_RAN');
		await assert.rejects(backend.create('run', root), /filter commands/);
		await assert.rejects(readFile(join(root, 'FILTER_RAN')));
		git('config', '--unset', 'filter.fixture.clean');
		const lease = await backend.create('run', root);
		await writeFile(join(lease.path, 'file.txt'), 'agent\n');
		git('config', 'filter.fixture.process', 'touch FILTER_RAN');
		await assert.rejects(backend.apply('run'), /filter commands/);
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'base\n');
	});

	test('explicit apply transfers edit/add/delete without touching the real index or unrelated dirty work', async () => {
		const head = git('rev-parse', 'HEAD');
		const lease = await backend.create('run', root);
		await writeFile(join(root, 'unrelated.txt'), 'user staged\n'); git('add', 'unrelated.txt');
		await writeFile(join(root, 'unrelated.txt'), 'user working\n');
		const originalIndex = git('write-tree');
		await writeFile(join(lease.path, 'file.txt'), 'agent edit\n');
		await writeFile(join(lease.path, 'new.txt'), 'agent addition\n');
		await rm(join(lease.path, 'delete.txt'));
		assert.deepStrictEqual((await backend.apply('run')).changedPaths, ['delete.txt', 'file.txt', 'new.txt']);
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'agent edit\n');
		assert.strictEqual(await readFile(join(root, 'new.txt'), 'utf8'), 'agent addition\n');
		await assert.rejects(readFile(join(root, 'delete.txt')));
		assert.strictEqual(await readFile(join(root, 'unrelated.txt'), 'utf8'), 'user working\n');
		assert.strictEqual(git('write-tree'), originalIndex);
		assert.strictEqual(git('rev-parse', 'HEAD'), head);
		await assert.rejects(backend.apply('run'), /already been applied/);
	});

	test('dirty touched files and untracked collisions are preserved', async () => {
		const lease = await backend.create('run', root);
		await writeFile(join(lease.path, 'file.txt'), 'agent\n');
		await writeFile(join(root, 'file.txt'), 'user\n');
		await assert.rejects(backend.apply('run'), /Local changes conflict/);
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'user\n');
		git('restore', 'file.txt');
		await writeFile(join(lease.path, 'new.txt'), 'agent\n'); await writeFile(join(root, 'new.txt'), 'user untracked\n');
		await assert.rejects(backend.apply('run'), /Local changes conflict/);
		assert.strictEqual(await readFile(join(root, 'new.txt'), 'utf8'), 'user untracked\n');
	});

	test('HEAD drift refuses apply and foreign owners cannot apply or discard leases', async () => {
		const lease = await backend.create('run', root);
		const foreign = new OpenideSubagentWorktrees();
		try { await assert.rejects(foreign.apply('run'), /belongs to this owner/); await assert.rejects(foreign.discard('run'), /belongs to this owner/); } finally { await foreign.dispose(); }
		await writeFile(join(lease.path, 'file.txt'), 'agent\n');
		git('commit', '--allow-empty', '-qm', 'new head');
		await assert.rejects(backend.apply('run'), /HEAD changed/);
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'base\n');
	});

	test('changed symlinks cannot import content outside the lease', async function () {
		if (process.platform === 'win32') { this.skip(); }
		const lease = await backend.create('run', root);
		await rm(join(lease.path, 'file.txt'));
		await symlink(join(root, 'unrelated.txt'), join(lease.path, 'file.txt'));
		await assert.rejects(backend.apply('run'), /symlinks/);
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'base\n');
	});

	test('disconnect preserves output and recovery refuses stealing an active owner', async () => {
		const lease = await backend.create('run', root);
		await writeFile(join(lease.path, 'file.txt'), 'recover me\n');
		const next = new OpenideSubagentWorktrees();
		assert.deepStrictEqual(await next.recoverable(root), []);
		await assert.rejects(next.recover('run', root), /abandoned/);
		await backend.dispose();
		assert.strictEqual(await readFile(join(lease.path, 'file.txt'), 'utf8'), 'recover me\n');
		assert.deepStrictEqual(await next.recoverable(root), [lease]);
		assert.deepStrictEqual(await next.recover('run', root), lease);
		backend = next;
		assert.deepStrictEqual((await backend.apply('run')).changedPaths, ['file.txt']);
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'recover me\n');
	});

	test('live recorded shell PIDs protect output across owner loss until the real process stops', async () => {
		const lease = await backend.create('run', root);
		await writeFile(join(lease.path, 'file.txt'), 'agent\n');
		const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'ignore' });
		await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
		const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
		try {
			await backend.trackShell(lease.path, child.pid!);
			await assert.rejects(backend.apply('run'), /may still be running/);
			await assert.rejects(backend.discard('run'), /may still be running/);
			await backend.dispose();
			backend = new OpenideSubagentWorktrees();
			assert.deepStrictEqual(await backend.recoverable(root), []);
			await assert.rejects(backend.recover('run', root), /abandoned/);
			child.kill(); await exited;
			await backend.recover('run', root);
			assert.deepStrictEqual((await backend.apply('run')).changedPaths, ['file.txt']);
		} finally { child.kill(); await exited; }
	});

	test('discard removes only the owned detached worktree and preserves source changes', async () => {
		const lease = await backend.create('run', root);
		await writeFile(join(lease.path, 'file.txt'), 'discard me\n');
		await writeFile(join(root, 'file.txt'), 'keep me\n');
		await backend.discard('run');
		await assert.rejects(readFile(join(lease.path, 'file.txt')));
		assert.strictEqual(await readFile(join(root, 'file.txt'), 'utf8'), 'keep me\n');
		assert.ok(!git('worktree', 'list', '--porcelain').includes(lease.path));
	});
});
