/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE AppImage atomic updater tests.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createHash } from 'crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
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
	test('refuses immutable nix store paths', () => assert.throws(() => getOpenideAppImagePaths('/nix/store/hash-openide/bin/openide'), /no puede/));
});
