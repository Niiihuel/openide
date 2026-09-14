/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { constants, Stats } from 'fs';
import { FileHandle, lstat, mkdir, open, readdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { IOpenideRunJournalEvent, IOpenideRunJournalRecord, openideJournalSnapshot, openideUnknownToolEvents } from '../common/openideRunJournal.js';

const kinds = new Set(['run/start', 'run/end', 'model/request', 'model/result', 'model/retry', 'tool/intent', 'tool/result', 'tool/unknown', 'compaction', 'memory/checkpoint']);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export interface IOpenideRunJournalLimits {
	readonly recordBytes?: number;
	/** Rotation thresholds, not a lifetime limit on a conversation. */
	readonly segmentBytes?: number;
	readonly segmentRecords?: number;
}

interface IJournalTip { readonly seq: number; readonly hash: string }
interface IVerifiedSegment {
	readonly start: IJournalTip;
	readonly tip: IJournalTip;
	readonly count: number;
	readonly stamp: string;
}
const stamp = (stat: Stats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

/** A main-process owned workspace directory; callers authenticate session ownership before access. */
export class OpenideRunJournalStore {
	private static readonly chains = new Map<string, Promise<unknown>>();
	private readonly directory: string;
	// Cache verification metadata only, never entire transcripts. Stat changes invalidate it.
	private readonly verified = new Map<string, IVerifiedSegment>();
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

	private async prepareDirectory(): Promise<void> {
		const created = await mkdir(this.directory, { recursive: true, mode: 0o700 });
		if (!(await lstat(this.directory)).isDirectory()) { throw new Error('OpenIDE journal directory must not be a symbolic link'); }
		if (created && process.platform !== 'win32') {
			for (let current = this.directory; ; current = dirname(current)) {
				const directory = await open(dirname(current), 'r'); try { await directory.sync(); } finally { await directory.close(); }
				if (current === created) { break; }
			}
		}
	}

	private async handle(path: string, create = false): Promise<FileHandle> {
		try { if ((await lstat(path)).isSymbolicLink()) { throw new Error('OpenIDE journal file must not be a symbolic link'); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
		let handle: FileHandle;
		try { handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW); }
		catch (error) {
			if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
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

	private async segments(sessionId: string): Promise<string[]> {
		await this.prepareDirectory();
		const base = this.path(sessionId);
		const prefix = hash(sessionId);
		const names = (await readdir(this.directory)).filter(name => name === `${prefix}.jsonl` || name.startsWith(`${prefix}.`) && name.endsWith('.jsonl'));
		if (!names.length) { const handle = await this.handle(base, true); await handle.close(); return [base]; }
		const numbered = names.filter(name => name !== `${prefix}.jsonl`).sort();
		if (!names.includes(`${prefix}.jsonl`) || numbered.some((name, index) => name !== `${prefix}.${String(index + 1).padStart(8, '0')}.jsonl`)) {
			throw new Error('OpenIDE journal segments are missing or invalid; refusing to replay or append');
		}
		return [base, ...numbered.map(name => join(this.directory, name))];
	}

	private remember(path: string, entry: IVerifiedSegment): void {
		this.verified.delete(path);
		if (this.verified.size >= 64) { this.verified.delete(this.verified.keys().next().value!); }
		this.verified.set(path, entry);
	}

	private async readHandle(path: string, handle: FileHandle, start: IJournalTip, final: boolean, collect?: IOpenideRunJournalRecord[]): Promise<IVerifiedSegment> {
		const before = await handle.stat();
		const cached = this.verified.get(path);
		if (!collect && cached?.stamp === stamp(before) && cached.start.seq === start.seq && cached.start.hash === start.hash && (final || cached.count > 0)) { return cached; }
		// Legacy single-file journals used a 128 MiB bound. Keep accepting those unchanged.
		const size = before.size;
		if (size > Math.max(this.limits.segmentBytes ?? 32 * 1024 * 1024, 128 * 1024 * 1024)) { throw new Error('OpenIDE journal segment limit exceeded'); }
		const bytes = Buffer.alloc(size);
		let offset = 0;
		while (offset < size) { const { bytesRead } = await handle.read(bytes, offset, size - offset, offset); if (!bytesRead) { throw new Error('OpenIDE journal changed while reading'); } offset += bytesRead; }
		const end = bytes.lastIndexOf(10) + 1;
		let tip = start;
		let count = 0;
		for (const line of bytes.subarray(0, end).toString('utf8').split('\n').slice(0, -1)) {
			if (Buffer.byteLength(line) > (this.limits.recordBytes ?? 16 * 1024 * 1024)) { throw new Error('OpenIDE journal record limit exceeded'); }
			const record = JSON.parse(line) as IOpenideRunJournalRecord;
			const { hash: digest, ...body } = record;
			if (record.version !== 1 || record.seq !== tip.seq || record.previousHash !== tip.hash || digest !== hash(JSON.stringify(body)) || !kinds.has(record.event?.kind) || typeof record.event.runId !== 'string' || !record.event.payload || Array.isArray(record.event.payload) || typeof record.event.payload !== 'object') { throw new Error('OpenIDE journal is corrupt; refusing to replay or append'); }
			collect?.push(record);
			tip = { seq: record.seq + 1, hash: digest };
			count++;
			if (count > Math.max(this.limits.segmentRecords ?? 10000, 10000)) { throw new Error('OpenIDE journal segment record count exceeded'); }
		}
		if (stamp(await handle.stat()) !== stamp(before)) { throw new Error('OpenIDE journal changed while reading'); }
		// Only the final segment can have an incomplete crash tail. Never repair archives.
		if (!final && (end !== size || !count)) { throw new Error('OpenIDE journal archived segment is corrupt'); }
		if (end !== size) { await handle.truncate(end); await handle.sync(); }
		const entry = { start, tip, count, stamp: stamp(await handle.stat()) };
		this.remember(path, entry);
		return entry;
	}

	private async load(paths: readonly string[], collect?: IOpenideRunJournalRecord[]): Promise<IVerifiedSegment> {
		let state: IVerifiedSegment = { start: { seq: 0, hash: '' }, tip: { seq: 0, hash: '' }, count: 0, stamp: '' };
		for (const [index, path] of paths.entries()) {
			const handle = await this.handle(path);
			try { state = await this.readHandle(path, handle, state.tip, index === paths.length - 1, collect); }
			finally { await handle.close(); }
		}
		return state;
	}

	private async appendEvent(sessionId: string, event: IOpenideRunJournalEvent): Promise<IOpenideRunJournalRecord> {
		if (!kinds.has(event.kind) || typeof event.runId !== 'string' || !event.runId || event.runId.length > 256 || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) { throw new Error('Invalid OpenIDE journal event'); }
		const paths = await this.segments(sessionId);
		let state = await this.load(paths);
		const body = { version: 1 as const, seq: state.tip.seq, time: Date.now(), event, previousHash: state.tip.hash };
		const record = { ...body, hash: hash(JSON.stringify(body)) };
		const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
		if (bytes.length > (this.limits.recordBytes ?? 16 * 1024 * 1024)) { throw new Error('OpenIDE journal record capacity exceeded. Existing history was retained.'); }
		let path = paths.at(-1)!;
		let handle = await this.handle(path);
		try {
			let size = (await handle.stat()).size;
			if (state.count && (size + bytes.length > (this.limits.segmentBytes ?? 32 * 1024 * 1024) || state.count >= (this.limits.segmentRecords ?? 10000))) {
				await handle.close();
				path = join(this.directory, `${hash(sessionId)}.${String(paths.length).padStart(8, '0')}.jsonl`);
				handle = await this.handle(path, true);
				state = await this.readHandle(path, handle, state.tip, true);
				size = (await handle.stat()).size;
			}
			try {
				let offset = 0;
				while (offset < bytes.length) { const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, size + offset); if (!bytesWritten) { throw new Error('OpenIDE journal write made no progress'); } offset += bytesWritten; }
				await this.checkpoint(handle);
			} catch (error) { this.verified.delete(path); await handle.truncate(size); await handle.sync(); throw error; }
			this.remember(path, { start: state.start, tip: { seq: record.seq + 1, hash: record.hash }, count: state.count + 1, stamp: stamp(await handle.stat()) });
			return record;
		} finally { await handle.close(); }
	}

	append(sessionId: string, event: IOpenideRunJournalEvent): Promise<void> {
		const snapshot = openideJournalSnapshot(event) as unknown as IOpenideRunJournalEvent;
		return this.serialize(sessionId, async () => { await this.appendEvent(sessionId, snapshot); });
	}

	read(sessionId: string): Promise<IOpenideRunJournalRecord[]> {
		return this.serialize(sessionId, async () => { const records: IOpenideRunJournalRecord[] = []; await this.load(await this.segments(sessionId), records); return records; });
	}

	/** Call only after the prior session owner has stopped. This records uncertainty, never executes work. */
	recover(sessionId: string): Promise<IOpenideRunJournalRecord[]> {
		return this.serialize(sessionId, async () => {
			const records: IOpenideRunJournalRecord[] = [];
			await this.load(await this.segments(sessionId), records);
			for (const event of openideUnknownToolEvents(records)) { records.push(await this.appendEvent(sessionId, event)); }
			return records;
		});
	}
}
