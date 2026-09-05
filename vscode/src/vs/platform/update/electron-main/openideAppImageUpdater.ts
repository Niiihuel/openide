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
import { CancellationToken } from '../../../base/common/cancellation.js';

export interface IOpenideAppImagePaths { current: string; pending: string; previous: string; marker: string; lock: string }
export interface IOpenideAppImageMarker { version: string; sha256: string; attempts: number; installedAt: number }

export function getOpenideAppImagePaths(current: string): IOpenideAppImagePaths {
	if (!current || current.startsWith('/nix/store/')) { throw new Error('La instalación declarativa de Nix no puede auto-modificarse.'); }
	return { current, pending: `${current}.pending`, previous: `${current}.previous`, marker: `${current}.update.json`, lock: `${current}.update.lock` };
}

async function syncFile(path: string): Promise<void> { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function syncDirectory(path: string): Promise<void> { const handle = await open(dirname(path), 'r'); try { await handle.sync(); } finally { await handle.close(); } }

export async function stageOpenideAppImage(downloadedPath: string, paths: IOpenideAppImagePaths, version: string, size: number, sha256: string, token: CancellationToken = CancellationToken.None): Promise<boolean> {
	const lock = await open(paths.lock, 'wx', 0o600).catch(() => { throw new Error('Otra instancia de OpenIDE está actualizando este AppImage.'); });
	try {
	await verifyOpenideArtifact(downloadedPath, size, sha256);
	if (token.isCancellationRequested) { return false; }
	await rm(paths.pending, { force: true });
	await copyFile(downloadedPath, paths.pending); await chmod(paths.pending, 0o755); await syncFile(paths.pending);
	if (token.isCancellationRequested) { await rm(paths.pending, { force: true }); return false; }
	await rm(paths.previous, { force: true });
	try { await link(paths.current, paths.previous); } catch { await copyFile(paths.current, paths.previous); }
	await syncFile(paths.previous);
	const marker: IOpenideAppImageMarker = { version, sha256, attempts: 0, installedAt: Date.now() };
	const markerPending = `${paths.marker}.pending`;
	await writeFile(markerPending, JSON.stringify(marker), { mode: 0o600 }); await syncFile(markerPending);
	await rename(markerPending, paths.marker); await syncDirectory(paths.marker);
	try {
		// POSIX rename replaces current atomically; previous already holds the old inode.
		await rename(paths.pending, paths.current); await syncDirectory(paths.current);
	} catch (error) {
		const failed = `${paths.current}.failed-${Date.now()}`;
		await rename(paths.current, failed).catch(() => undefined);
		await rename(paths.previous, paths.current);
		await syncDirectory(paths.current);
		throw error;
	}
	return true;
	} finally { await lock.close(); await rm(paths.lock, { force: true }); }
}

export async function recoverOpenideAppImage(paths: IOpenideAppImagePaths): Promise<boolean> {
	try { await stat(paths.previous); } catch { return false; }
	await rm(paths.pending, { force: true });
	const failed = `${paths.current}.failed-${Date.now()}`; await rename(paths.current, failed).catch(() => undefined);
	await rename(paths.previous, paths.current); await rm(paths.marker, { force: true }); await syncDirectory(paths.current); return true;
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
	const lock = await open(paths.lock, 'wx', 0o600).catch(() => undefined);
	if (!lock) { return false; }
	try {
		const marker = await readOpenideAppImageMarker(paths);
		if (!marker || marker.version !== runningVersion) { return false; }
		await verifyOpenideArtifact(paths.current, (await stat(paths.current)).size, marker.sha256);
		await rm(paths.marker, { force: true });
		await rm(paths.previous, { force: true });
		await syncDirectory(paths.current);
		return true;
	} finally { await lock.close(); await rm(paths.lock, { force: true }); }
}

export async function readOpenideAppImageMarker(paths: IOpenideAppImagePaths): Promise<IOpenideAppImageMarker | undefined> {
	try {
		const marker = JSON.parse(await readFile(paths.marker, 'utf8'));
		if (!marker || typeof marker !== 'object' || Object.keys(marker).some(key => !['version', 'sha256', 'attempts', 'installedAt'].includes(key)) || typeof marker.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-insider\.\d{8}\.[1-9]\d*)?$/.test(marker.version) || !/^[a-f0-9]{64}$/.test(marker.sha256) || !Number.isSafeInteger(marker.attempts) || marker.attempts < 0 || !Number.isSafeInteger(marker.installedAt) || marker.installedAt <= 0) { return undefined; }
		return marker;
	} catch { return undefined; }
}
