/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Atomic AppImage updater for mutable OpenIDE installations (including NixOS appimage-run).
 *--------------------------------------------------------------------------------------------*/

import { chmod, copyFile, link, open, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join } from 'path';
import { accessSync, constants } from 'fs';
import { verifyOpenideArtifact } from '../node/openideUpdateVerifier.js';
import { acquireOpenideUpdateLock } from '../node/openideUpdateLock.js';
import { localize } from '../../../nls.js';
import { CancellationToken } from '../../../base/common/cancellation.js';

export interface IOpenideAppImagePaths { current: string; pending: string; previous: string; marker: string; lock: string }
export interface IOpenideAppImageFileOperations { copyFile: typeof copyFile; rename: typeof rename }
const fileOperations: IOpenideAppImageFileOperations = { copyFile, rename };

export interface IOpenideAppImageMarker { version: string; sha256: string; attempts: number; installedAt: number }

export function getOpenideAppImagePaths(current: string): IOpenideAppImagePaths {
	if (!current || current.startsWith('/nix/store/')) { throw new Error('La instalación declarativa de Nix no puede auto-modificarse.'); }
	return { current, pending: `${current}.pending`, previous: `${current}.previous`, marker: `${current}.update.json`, lock: `${current}.update.lock` };
}

async function syncFile(path: string): Promise<void> { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function syncDirectory(path: string): Promise<void> { const handle = await open(dirname(path), 'r'); try { await handle.sync(); } finally { await handle.close(); } }

export async function stageOpenideAppImage(downloadedPath: string, paths: IOpenideAppImagePaths, version: string, size: number, sha256: string, token: CancellationToken = CancellationToken.None, operations: IOpenideAppImageFileOperations = fileOperations): Promise<boolean> {
	const release = await acquireOpenideUpdateLock(paths.lock);
	const markerPending = `${paths.marker}.pending`;
	try {
		// An unacknowledged install owns the rollback copy, even after a crash.
		try {
			await stat(paths.marker);
			throw new Error(localize('openide.update.pendingStartup', "Restart OpenIDE to finish the pending update before installing another one."));
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
		if (token.isCancellationRequested) { return false; }
		await rm(paths.pending, { force: true });
		await operations.copyFile(downloadedPath, paths.pending);
		// Verify the actual candidate, after copying, before changing current or previous.
		await verifyOpenideArtifact(paths.pending, size, sha256);
		await chmod(paths.pending, 0o755);
		await syncFile(paths.pending);
		if (token.isCancellationRequested) { return false; }
		await rm(paths.previous, { force: true });
		try { await link(paths.current, paths.previous); } catch { await copyFile(paths.current, paths.previous); }
		await syncFile(paths.previous);
		const marker: IOpenideAppImageMarker = { version, sha256, attempts: 0, installedAt: Date.now() };
		await writeFile(markerPending, JSON.stringify(marker), { mode: 0o600 });
		await syncFile(markerPending);
		await rename(markerPending, paths.marker);
		await syncDirectory(paths.marker);
		// On failure leave the journal and backup intact for recovery; never move current away.
		await operations.rename(paths.pending, paths.current);
		await syncDirectory(paths.current);
		return true;
	} finally {
		try {
			await rm(paths.pending, { force: true });
			await rm(markerPending, { force: true });
		} finally { await release(); }
	}
}

export async function recoverOpenideAppImage(paths: IOpenideAppImagePaths, operations: IOpenideAppImageFileOperations = fileOperations): Promise<boolean> {
	const release = await acquireOpenideUpdateLock(paths.lock);
	const restore = `${paths.current}.restore`;
	try {
		try { await stat(paths.previous); } catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return false; }
			throw error;
		}
		await rm(restore, { force: true });
		try { await link(paths.previous, restore); } catch { await copyFile(paths.previous, restore); }
		await syncFile(restore);
		// Keep both current and previous until a single atomic replacement succeeds.
		await operations.rename(restore, paths.current);
		await syncDirectory(paths.current);
		await rm(paths.marker, { force: true });
		await syncDirectory(paths.marker);
		await rm(paths.previous, { force: true });
		await rm(paths.pending, { force: true });
		return true;
	} finally {
		try { await rm(restore, { force: true }); } finally { await release(); }
	}
}

/** Relaunch the mutable entry point, never the old binary in an extracted AppImage cache. */
export function getOpenideAppImageLauncher(current: string, applicationName: string, launcher?: string): string {
	for (const candidate of [launcher, join(dirname(current), applicationName)]) {
		if (!candidate || !isAbsolute(candidate)) { continue; }
		try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* Try the AppImage itself. */ }
	}
	return current;
}

/** An older running window must not acknowledge a newly staged binary as healthy. */
export async function markOpenideAppImageHealthy(paths: IOpenideAppImagePaths, runningVersion: string): Promise<boolean> {
	const release = await acquireOpenideUpdateLock(paths.lock, 5);
	try {
		const marker = await readOpenideAppImageMarker(paths);
		if (!marker || marker.version !== runningVersion) { return false; }
		await verifyOpenideArtifact(paths.current, (await stat(paths.current)).size, marker.sha256);
		await rm(paths.marker, { force: true });
		await syncDirectory(paths.marker);
		await rm(paths.previous, { force: true });
		await syncDirectory(paths.current);
		return true;
	} finally { await release(); }
}

export async function readOpenideAppImageMarker(paths: IOpenideAppImagePaths): Promise<IOpenideAppImageMarker | undefined> {
	try {
		const marker = JSON.parse(await readFile(paths.marker, 'utf8'));
		if (!marker || typeof marker !== 'object' || Object.keys(marker).some(key => !['version', 'sha256', 'attempts', 'installedAt'].includes(key)) || typeof marker.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-insider\.\d{8}\.[1-9]\d*)?$/.test(marker.version) || !/^[a-f0-9]{64}$/.test(marker.sha256) || !Number.isSafeInteger(marker.attempts) || marker.attempts < 0 || !Number.isSafeInteger(marker.installedAt) || marker.installedAt <= 0) { return undefined; }
		return marker;
	} catch { return undefined; }
}
