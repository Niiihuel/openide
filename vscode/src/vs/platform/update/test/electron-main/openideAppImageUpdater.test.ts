/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE AppImage atomic updater tests.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createHash } from 'crypto';
import { chmod, copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { acquireOpenideUpdateLock } from '../../node/openideUpdateLock.js';
import { getOpenideAppImageLauncher, getOpenideAppImagePaths, markOpenideAppImageHealthy, readOpenideAppImageMarker, recoverOpenideAppImage, stageOpenideAppImage } from '../../electron-main/openideAppImageUpdater.js';

suite('OpenIDE AppImage updater', () => {
	test('atomically stages and recovers previous AppImage', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'openide-appimage-'));
		try {
			const current = join(dir, 'OpenIDE.AppImage'); const downloaded = join(dir, 'download');
			await writeFile(current, 'old'); await writeFile(downloaded, 'new');
			const paths = getOpenideAppImagePaths(current); const sha = createHash('sha256').update('new').digest('hex');
			await stageOpenideAppImage(downloaded, paths, '1.2.3', 3, sha);
			assert.strictEqual(await readFile(current, 'utf8'), 'new'); assert.strictEqual((await readOpenideAppImageMarker(paths))?.version, '1.2.3');
			assert.strictEqual(await recoverOpenideAppImage(paths), true); assert.strictEqual(await readFile(current, 'utf8'), 'old');
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	test('confirms only the running version after verifying the staged binary', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'openide-health-'));
		try {
			const paths = getOpenideAppImagePaths(join(dir, 'OpenIDE.AppImage'));
			const download = join(dir, 'download');
			await writeFile(paths.current, 'old'); await writeFile(download, 'new');
			await stageOpenideAppImage(download, paths, '1.2.0', 3, createHash('sha256').update('new').digest('hex'));
			assert.strictEqual(await markOpenideAppImageHealthy(paths, '1.1.0'), false);
			assert.strictEqual(await readFile(paths.previous, 'utf8'), 'old');
			await writeFile(paths.current, 'bad');
			await assert.rejects(markOpenideAppImageHealthy(paths, '1.2.0'));
			assert.ok(await readOpenideAppImageMarker(paths));
			await writeFile(paths.current, 'new');
			assert.strictEqual(await markOpenideAppImageHealthy(paths, '1.2.0'), true);
			assert.strictEqual(await readOpenideAppImageMarker(paths), undefined);
			await assert.rejects(readFile(paths.previous), { code: 'ENOENT' });
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	test('relaunches the installed wrapper when available and otherwise the AppImage', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'openide-launcher-'));
		try {
			const current = join(dir, 'OpenIDE.AppImage');
			assert.strictEqual(getOpenideAppImageLauncher(current, 'openide'), current);
			const wrapper = join(dir, 'openide');
			await writeFile(wrapper, '#!/bin/sh\n'); await chmod(wrapper, 0o755);
			assert.strictEqual(getOpenideAppImageLauncher(current, 'openide'), wrapper);
			assert.strictEqual(getOpenideAppImageLauncher(current, 'openide', './untrusted-relative'), wrapper);
		} finally { await rm(dir, { recursive: true, force: true }); }
	});
	for (const scenario of ['second install', 'copy mutation', 'replace failure', 'recovery interruption', 'stale lock', 'active lock'] as const) {
		test(`preserves the last healthy executable: ${scenario}`, async () => {
			const dir = await mkdtemp(join(tmpdir(), 'openide-rollback-'));
			const paths = getOpenideAppImagePaths(join(dir, 'OpenIDE.AppImage'));
			const download = join(dir, 'download');
			const sha = createHash('sha256').update('new').digest('hex');
			try {
				await writeFile(paths.current, 'healthy');
				await writeFile(download, 'new');
				if (scenario === 'copy mutation') {
					await assert.rejects(stageOpenideAppImage(download, paths, '1.2.0', 3, sha, CancellationToken.None, {
						rename,
						copyFile: async (source, target) => { await writeFile(source, 'bad'); await copyFile(source, target); }
					}));
					assert.strictEqual(await readFile(paths.current, 'utf8'), 'healthy');
					await assert.rejects(readFile(paths.pending), { code: 'ENOENT' });
					return;
				}
				if (scenario === 'replace failure') {
					await assert.rejects(stageOpenideAppImage(download, paths, '1.2.0', 3, sha, CancellationToken.None, {
						copyFile, rename: async () => { throw new Error('interrupted replacement'); }
					}));
					assert.strictEqual(await readFile(paths.current, 'utf8'), 'healthy');
					await recoverOpenideAppImage(paths);
					assert.strictEqual(await readFile(paths.current, 'utf8'), 'healthy');
					return;
				}
				if (scenario === 'active lock') {
					const release = await acquireOpenideUpdateLock(paths.lock);
					try {
						await assert.rejects(stageOpenideAppImage(download, paths, '1.2.0', 3, sha));
						await assert.rejects(recoverOpenideAppImage(paths));
						assert.strictEqual(await readFile(paths.current, 'utf8'), 'healthy');
					} finally { await release(); }
				}
				if (scenario === 'stale lock') { await writeFile(paths.lock, ''); }
				await stageOpenideAppImage(download, paths, '1.2.0', 3, sha);
				if (scenario === 'second install') {
					await assert.rejects(stageOpenideAppImage(download, paths, '1.3.0', 3, sha), /Restart OpenIDE/);
					assert.strictEqual((await readOpenideAppImageMarker(paths))?.version, '1.2.0');
				}
				if (scenario === 'recovery interruption') {
					await assert.rejects(recoverOpenideAppImage(paths, { copyFile, rename: async () => { throw new Error('interrupted recovery'); } }));
					assert.deepStrictEqual([await readFile(paths.current, 'utf8'), await readFile(paths.previous, 'utf8')], ['new', 'healthy']);
				}
				await recoverOpenideAppImage(paths);
				assert.strictEqual(await readFile(paths.current, 'utf8'), 'healthy');
			} finally { await rm(dir, { recursive: true, force: true }); }
		});
	}
	test('refuses immutable nix store paths', () => assert.throws(() => getOpenideAppImagePaths('/nix/store/hash-openide/bin/openide'), /no puede/));
});
