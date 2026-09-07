/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { constants } from 'fs';
import { FileHandle, lstat, mkdir, open } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { IOpenideRunJournalEvent, IOpenideRunJournalRecord, openideJournalSnapshot, openideUnknownToolEvents } from '../common/openideRunJournal.js';

const kinds = new Set(['run/start', 'run/end', 'model/request', 'model/result', 'model/retry', 'tool/intent', 'tool/result', 'tool/unknown', 'compaction', 'memory/checkpoint']);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export interface IOpenideRunJournalLimits {
	readonly recordBytes?: number;
	readonly sessionBytes?: number;
	readonly records?: number;
}

/** A main-process owned workspace directory; callers authenticate session ownership before access. */
export class OpenideRunJournalStore {
	private static readonly chains = new Map<string, Promise<unknown>>();
	private readonly directory: string;
	constructor(directory: string, private readonly limits: IOpenideRunJournalLimits = {}, private readonly checkpoint: (handle: FileHandle) => Promise<void> = handle => handle.sync()) { this.directory = resolve(directory); }

	private path(sessionId: string): string {
		if (!sessionId || sessionId.length > 256) { throw new Error('Invalid OpenIDE journal session identity'); }
		return join(this.directory, `${hash(sessionId)}.jsonl`);
	}

	private async serialize<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		const path = this.path(sessionId);
		const previous = OpenideRunJournalStore.chains.get(path) ?? Promise.resolve();
		const active = previous.catch(() => undefined).then(operation);
		OpenideRunJournalStore.chains.set(path, active);
		try { return await active; } finally { if (OpenideRunJournalStore.chains.get(path) === active) { OpenideRunJournalStore.chains.delete(path); } }
	}

	private async handle(sessionId: string): Promise<FileHandle> {
		const created = await mkdir(this.directory, { recursive: true, mode: 0o700 });
		if (!(await lstat(this.directory)).isDirectory()) { throw new Error('OpenIDE journal directory must not be a symbolic link'); }
		if (created && process.platform !== 'win32') {
			for (let current = this.directory; ; current = dirname(current)) {
				const directory = await open(dirname(current), 'r'); try { await directory.sync(); } finally { await directory.close(); }
				if (current === created) { break; }
			}
		}
		const path = this.path(sessionId);
		try { if ((await lstat(path)).isSymbolicLink()) { throw new Error('OpenIDE journal file must not be a symbolic link'); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
		let handle: FileHandle;
		try { handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
			handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
			try {
				await handle.sync();
				if (process.platform !== 'win32') { const directory = await open(this.directory, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
			} catch (error) { await handle.close(); throw error; }
		}
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1) { await handle.close(); throw new Error('OpenIDE journal requires a private regular file'); }
		return handle;
	}

	private async readHandle(handle: FileHandle): Promise<IOpenideRunJournalRecord[]> {
		const size = (await handle.stat()).size;
		if (size > (this.limits.sessionBytes ?? 128 * 1024 * 1024)) { throw new Error('OpenIDE journal session limit exceeded'); }
		const bytes = Buffer.alloc(size);
		let offset = 0;
		while (offset < size) { const { bytesRead } = await handle.read(bytes, offset, size - offset, offset); if (!bytesRead) { throw new Error('OpenIDE journal changed while reading'); } offset += bytesRead; }
		const end = bytes.lastIndexOf(10) + 1;
		const records: IOpenideRunJournalRecord[] = [];
		let previousHash = '';
		for (const line of bytes.subarray(0, end).toString('utf8').split('\n').slice(0, -1)) {
			if (Buffer.byteLength(line) > (this.limits.recordBytes ?? 16 * 1024 * 1024)) { throw new Error('OpenIDE journal record limit exceeded'); }
			const record = JSON.parse(line) as IOpenideRunJournalRecord;
			const { hash: digest, ...body } = record;
			if (record.version !== 1 || record.seq !== records.length || record.previousHash !== previousHash || digest !== hash(JSON.stringify(body)) || !kinds.has(record.event?.kind) || typeof record.event.runId !== 'string' || !record.event.payload || Array.isArray(record.event.payload) || typeof record.event.payload !== 'object') { throw new Error('OpenIDE journal is corrupt; refusing to replay or append'); }
			records.push(record); previousHash = digest;
			if (records.length > (this.limits.records ?? 10000)) { throw new Error('OpenIDE journal record count exceeded'); }
		}
		// Only an incomplete last line is a recoverable crash tail; complete corrupt records fail closed.
		if (end !== size) { await handle.truncate(end); await handle.sync(); }
		return records;
	}

	private async appendHandle(handle: FileHandle, records: IOpenideRunJournalRecord[], event: IOpenideRunJournalEvent): Promise<void> {
		if (!kinds.has(event.kind) || typeof event.runId !== 'string' || !event.runId || event.runId.length > 256 || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) { throw new Error('Invalid OpenIDE journal event'); }
		const body = { version: 1 as const, seq: records.length, time: Date.now(), event, previousHash: records.at(-1)?.hash ?? '' };
		const record = { ...body, hash: hash(JSON.stringify(body)) };
		const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
		const size = (await handle.stat()).size;
		if (bytes.length > (this.limits.recordBytes ?? 16 * 1024 * 1024) || size + bytes.length > (this.limits.sessionBytes ?? 128 * 1024 * 1024) || records.length >= (this.limits.records ?? 10000)) { throw new Error('OpenIDE journal capacity exceeded; start a new session to continue. Existing history was retained.'); }
		try {
			let offset = 0;
			while (offset < bytes.length) { const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, size + offset); if (!bytesWritten) { throw new Error('OpenIDE journal write made no progress'); } offset += bytesWritten; }
			await this.checkpoint(handle);
		} catch (error) { await handle.truncate(size); await handle.sync(); throw error; }
		records.push(record);
	}

	append(sessionId: string, event: IOpenideRunJournalEvent): Promise<void> {
		const snapshot = openideJournalSnapshot(event) as unknown as IOpenideRunJournalEvent;
		return this.serialize(sessionId, async () => { const handle = await this.handle(sessionId); try { await this.appendHandle(handle, await this.readHandle(handle), snapshot); } finally { await handle.close(); } });
	}

	read(sessionId: string): Promise<IOpenideRunJournalRecord[]> {
		return this.serialize(sessionId, async () => { const handle = await this.handle(sessionId); try { return await this.readHandle(handle); } finally { await handle.close(); } });
	}

	/** Call only after the prior session owner has stopped. This records uncertainty, never executes work. */
	recover(sessionId: string): Promise<IOpenideRunJournalRecord[]> {
		return this.serialize(sessionId, async () => {
			const handle = await this.handle(sessionId);
			try { const records = await this.readHandle(handle); for (const event of openideUnknownToolEvents(records)) { await this.appendHandle(handle, records, event); } return records; } finally { await handle.close(); }
		});
	}
}
