/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { lstat, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { IOpenideMemoryWriteReceipt } from '../../openideCodebase/common/openideMemoryRecord.js';

interface CaptureEntry { readonly message: string; cancelled: boolean; receipts: IOpenideMemoryWriteReceipt[] }
type CaptureIO = { validate(path: string): Promise<void>; write(path: string, text: string, before: string | undefined): Promise<void> };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const maxBytes = 4 * 1024 * 1024;

/** Runs under MemoryOwner's workspace queue. An intent is durable before Markdown commits. */
export class OpenideMemoryCaptureJournal {
	constructor(private readonly stateRoot: string, private readonly io: CaptureIO) { }
	private directory(session: string): string {
		if (!session || session.length > 256) { throw new Error('Invalid memory capture session.'); }
		return join(this.stateRoot, 'captures', digest(session));
	}
	private async read(session: string, message: string): Promise<{ path: string; before?: string; entry: CaptureEntry }> {
		if (!message || message.length > 256) { throw new Error('Invalid memory capture message.'); }
		const path = join(this.directory(session), `${digest(message)}.json`);
		await this.io.validate(path);
		let before: string;
		try { if ((await lstat(path)).size > maxBytes) { throw new Error('Memory capture receipt exceeds its limit.'); } before = await readFile(path, 'utf8'); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return { path, entry: { message, cancelled: false, receipts: [] } }; } throw error; }
		const entry: CaptureEntry = JSON.parse(before);
		if (entry.message !== message || typeof entry.cancelled !== 'boolean' || !Array.isArray(entry.receipts) || entry.receipts.length > 64 || entry.receipts.some(receipt =>
			receipt.message !== message || typeof receipt.operationId !== 'string' || !receipt.operationId || receipt.operationId.length > 256 ||
			!/^\.openide\/memory\/(?:notes|sessions)\/mem_[a-zA-Z0-9_-]{8,80}\.md$/.test(receipt.path) ||
			typeof receipt.afterContent !== 'string' || receipt.beforeContent !== undefined && typeof receipt.beforeContent !== 'string' || !Number.isFinite(receipt.time))) {
			throw new Error('Invalid memory capture receipt.');
		}
		return { path, before, entry };
	}
	private async persist(session: string, state: Awaited<ReturnType<OpenideMemoryCaptureJournal['read']>>): Promise<void> {
		if (state.before === undefined) {
			const directory = this.directory(session); await this.io.validate(directory);
			let count = 0;
			try { count = (await readdir(directory)).length; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
			if (count >= 5000) { throw new Error('Memory capture history is full; no untracked memory will be written.'); }
		}
		const text = JSON.stringify(state.entry);
		if (state.entry.receipts.length > 64 || Buffer.byteLength(text) > maxBytes) { throw new Error('Memory capture receipt limit reached; no untracked memory will be written.'); }
		await this.io.write(state.path, text, state.before);
	}
	async isCancelled(session: string, message: string | undefined): Promise<boolean> {
		return !!message && (await this.read(session, message)).entry.cancelled;
	}
	async record(session: string, receipt: IOpenideMemoryWriteReceipt): Promise<void> {
		const state = await this.read(session, receipt.message);
		if (state.entry.cancelled) { throw new Error('Memory capture belongs to a rolled back message.'); }
		const index = state.entry.receipts.findIndex(item => item.operationId === receipt.operationId);
		if (index >= 0) { state.entry.receipts[index] = receipt; } else { state.entry.receipts.push(receipt); }
		await this.persist(session, state);
	}
	async cancel(session: string, messages: readonly string[]): Promise<readonly IOpenideMemoryWriteReceipt[]> {
		if (!Array.isArray(messages) || messages.length > 2000 || messages.some(message => typeof message !== 'string' || !message || message.length > 256)) { throw new Error('Invalid memory rollback messages.'); }
		const receipts: IOpenideMemoryWriteReceipt[] = [];
		let size = 0;
		for (const message of new Set(messages)) {
			const state = await this.read(session, message);
			if (!state.entry.cancelled) { state.entry.cancelled = true; await this.persist(session, state); }
			size += JSON.stringify(state.entry.receipts).length;
			if (size > 16 * 1024 * 1024) { throw new Error('Memory rollback exceeds its safe transaction size.'); }
			receipts.push(...state.entry.receipts);
		}
		return receipts.sort((a, b) => a.time - b.time);
	}
}
