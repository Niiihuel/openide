/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE AppImage atomic updater tests.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getOpenideAppImagePaths, readOpenideAppImageMarker, recoverOpenideAppImage, stageOpenideAppImage } from '../../electron-main/openideAppImageUpdater.js';

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
	test('refuses immutable nix store paths', () => assert.throws(() => getOpenideAppImagePaths('/nix/store/hash-openide/bin/openide'), /no puede/));
});
