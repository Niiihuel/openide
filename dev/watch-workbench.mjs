#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { watch } from 'node:fs';
import { lstat, readdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mapWithConcurrency, transpileFile } from '../vscode/build/next/transpile.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repository, 'vscode/src');
const output = join(repository, 'vscode/out');
const force = process.argv.includes('--force');
const concurrency = 8;
const queued = new Set();
let running = true;
let processing = false;
let initial = true;
let timer;
const log = message => process.stdout.write(`[workbench-watch] ${message}\n`);

function destination(file) {
	return join(output, relative(source, file).replace(/\.ts$/, '.js'));
}

async function emit(file) {
	const target = destination(file);
	const metadata = await lstat(file).catch(error => { if (error.code === 'ENOENT') { return; } throw error; });
	if (!metadata) {
		await unlink(target).catch(error => { if (!['ENOENT', 'EISDIR', 'EPERM'].includes(error.code)) { throw error; } });
		return;
	}
	if (!metadata.isFile()) { return; }
	// Consumers keep the last complete file if a transform fails or the renderer reads mid-save.
	const temporary = `${target}.openide-watch-${process.pid}`;
	try {
		if (file.endsWith('.ts')) { await transpileFile(file, temporary); }
		else { await copyFile(file, temporary); }
		await rename(temporary, target);
	} finally {
		await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') { throw error; } });
	}
}

async function flush() {
	if (initial || processing || !running) { return; }
	processing = true;
	try {
		while (queued.size && running) {
			const files = [...queued]; queued.clear();
			let errors = 0;
			const start = Date.now();
			await mapWithConcurrency(files, concurrency, async file => {
				try { await emit(file); }
				catch (error) { errors++; log(`ERROR ${relative(source, file)}: ${error.message}`); }
			});
			log(`${files.length - errors}/${files.length} files updated in ${Date.now() - start} ms${errors ? `; ${errors} errors (last valid output preserved)` : ''}`);
		}
	} finally { processing = false; }
}

const watcher = watch(source, { recursive: true }, (_event, filename) => {
	if (!filename) { return; }
	const file = resolve(source, String(filename));
	if (!file.startsWith(source + sep) || file.endsWith('.d.ts')) { return; }
	queued.add(file);
	clearTimeout(timer);
	timer = setTimeout(() => { void flush(); }, 200);
});
watcher.on('error', error => { log(`Watcher failed: ${error.message}`); stop(); process.exitCode = 1; });

function stop() { running = false; clearTimeout(timer); watcher.close(); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

log('Synchronizing changed src files without deleting out. Type checks run separately.');
try {
	const entries = await readdir(source, { recursive: true, withFileTypes: true });
	await mapWithConcurrency(entries, concurrency, async entry => {
		if (!entry.isFile() || entry.name.endsWith('.d.ts')) { return; }
		const file = join(entry.parentPath ?? entry.path, entry.name);
		const [input, built] = await Promise.all([stat(file), stat(destination(file)).catch(error => { if (error.code === 'ENOENT') { return; } throw error; })]);
		if (force || !built || input.mtimeMs > built.mtimeMs) { queued.add(file); }
	});
	initial = false;
	await flush();
	log('Ready: watching src → out (TS, CSS and resources). Ctrl+C stops this watcher.');
} catch (error) { log(`Startup failed: ${error.message}`); stop(); process.exitCode = 1; }
