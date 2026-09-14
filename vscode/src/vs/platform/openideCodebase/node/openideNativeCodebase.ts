/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { dirname, join } from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { IProviderExtraction, IProviderSourceFile } from '../common/openideCodebaseMemoryProviders.js';

export interface INativeCodebaseSource extends IProviderSourceFile { readonly knownHash?: string; readonly knownExtractionMode?: 'treeSitter' | 'regex' | 'text' }
export interface INativeCodebaseResult {
	readonly uri: string;
	readonly hash: string;
	readonly extractionMode?: 'treeSitter' | 'regex' | 'text';
	readonly unchanged?: boolean;
	readonly extraction?: IProviderExtraction;
}
interface NativeReply { readonly version: number; readonly id: number; readonly files?: INativeCodebaseResult[]; readonly result?: unknown; readonly error?: string }
const MAX_FRAME = 16 * 1024 * 1024;

/** One lazy child per indexer. Requests are serialized, bounded and cancelled by terminating work. */
export class NativeCodebase extends Disposable {
	private child: ChildProcessWithoutNullStreams | undefined;
	private idle: ReturnType<typeof setTimeout> | undefined;
	private sequence = 0;
	private processEpoch = 0;
	get epoch(): number { return this.processEpoch; }
	private queue: Promise<void> = Promise.resolve();
	private stopped = false;
	private retryAfter = 0;
	private nativeBatches = 0;
	private fallbackBatches = 0;
	private lastFailure: string | undefined;

	constructor(private readonly executable?: string) { super(); }

	getMetrics(): { nativeBatches: number; fallbackBatches: number; lastFailure?: string } {
		return { nativeBatches: this.nativeBatches, fallbackBatches: this.fallbackBatches, lastFailure: this.lastFailure };
	}

	extract(files: readonly INativeCodebaseSource[], regex: boolean, token: CancellationToken, treeSitter = false): Promise<readonly INativeCodebaseResult[] | undefined> {
		if (!files.length) { return Promise.resolve([]); }
		return this.perform(async () => {
			if (files.length > 40) { throw new Error('Native request exceeds batch limits'); }
			const reply = await this.request({ files, regex, treeSitter, indexedAt: Date.now() }, token);
			if (!Array.isArray(reply.files) || reply.files.length !== files.length) { throw new Error('Invalid native extraction response'); }
			for (let i = 0; i < files.length; i++) {
				const result = reply.files[i];
				if (result.extractionMode !== undefined && !['treeSitter', 'regex', 'text'].includes(result.extractionMode)) { throw new Error('Invalid native extraction mode'); }
				if (result.uri !== files[i].uri || !/^[0-9a-z]+$/.test(result.hash) || (result.unchanged ? result.hash !== files[i].knownHash || (result.extractionMode !== undefined && files[i].knownExtractionMode !== undefined && result.extractionMode !== files[i].knownExtractionMode) : !Array.isArray(result.extraction?.nodes) || !Array.isArray(result.extraction?.edges))) { throw new Error('Invalid native file result'); }
			}
			this.nativeBatches++;
			return reply.files;
		}, token, true);
	}

	call<T>(method: string, params: unknown, token: CancellationToken = CancellationToken.None): Promise<T | undefined> {
		return this.perform(async () => {
			const reply = await this.request({ method, params }, token);
			if (!Object.prototype.hasOwnProperty.call(reply, 'result')) { throw new Error('Missing native result'); }
			return reply.result as T;
		}, token, false);
	}

	private perform<T>(run: () => Promise<T>, token: CancellationToken, extraction: boolean): Promise<T | undefined> {
		const operation = this.queue.then(async () => {
			if (token.isCancellationRequested || this.stopped) { throw new CancellationError(); }
			if (Date.now() < this.retryAfter) { if (extraction) { this.fallbackBatches++; } return undefined; }
			try {
				const result = await run(); this.lastFailure = undefined; return result;
			} catch (error) {
				this.stopChild();
				if (token.isCancellationRequested || this.stopped) { throw new CancellationError(); }
				if (extraction) { this.fallbackBatches++; }
				this.lastFailure = error instanceof Error ? error.message : 'Native indexer failed';
				this.retryAfter = Date.now() + 30_000;
				return undefined;
			}
		});
		this.queue = operation.then(() => undefined, () => undefined);
		return operation;
	}

	private request(payload: object, token: CancellationToken): Promise<NativeReply> {
		const id = ++this.sequence;
		const frame = Buffer.from(JSON.stringify({ ...payload, version: 1, id }) + '\n');
		if (frame.length > MAX_FRAME) { return Promise.reject(new Error('Native request exceeds batch limits')); }
		if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
		const executable = this.executable ?? join(FileAccess.asFileUri('').fsPath, '..', 'native', 'bin', `openide-codebase${isWindows ? '.exe' : ''}`);
		if (!this.child) {
			this.processEpoch++;
			this.child = spawn(executable, [], { cwd: dirname(executable), stdio: 'pipe', windowsHide: true, shell: false });
			const spawned = this.child;
			// Keep error listeners between requests, including after timeout/cancellation cleanup.
			spawned.on('error', () => { if (this.child === spawned) { this.stopChild(); } });
			spawned.stdin.on('error', () => { if (this.child === spawned) { this.stopChild(); } });
			spawned.on('exit', () => { if (this.child === spawned) { this.stopChild(); } });
		}
		const child = this.child;
		// Never inherit a workspace cwd, arguments or executable path from the renderer.
		return new Promise((resolve, reject) => {
			let done = false;
			let size = 0;
			const chunks: Buffer[] = [];
			const finish = (error?: Error, result?: NativeReply) => {
				if (done) { return; } done = true;
				clearTimeout(timer); cancellation.dispose();
				child.stdout.off('data', onData); child.off('error', onError); child.off('exit', onExit); child.stdin.off('error', onError);
				if (error) { reject(error); } else {
					this.idle = setTimeout(() => this.stopChild(), 30_000);
					resolve(result!);
				}
			};
			const onError = (error: Error) => finish(error);
			const onExit = () => finish(new Error('Native indexer exited before replying'));
			const onData = (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_FRAME) { finish(new Error('Native response exceeds limits')); return; }
				chunks.push(chunk);
				if (!chunk.includes(10)) { return; }
				try {
					const reply = JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as NativeReply;
					if (reply.version !== 1 || reply.id !== id || reply.error) { throw new Error(reply.error || 'Invalid native response'); }
					finish(undefined, reply);
				} catch { finish(new Error('Invalid native extraction response')); }
			};
			const timer = setTimeout(() => finish(new Error('Native indexer timed out')), 15_000);
			const cancellation = token.onCancellationRequested(() => finish(new CancellationError()));
			child.stdout.on('data', onData); child.on('error', onError); child.on('exit', onExit); child.stdin.on('error', onError);
			child.stderr.resume();
			child.stdin.write(frame, error => { if (error) { finish(error); } });
		});
	}

	reset(): void { this.stopChild(); this.retryAfter = 0; }

	private stopChild(): void {
		if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
		const child = this.child; this.child = undefined;
		if (child) { this.processEpoch++; child.kill(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
	}

	override dispose(): void { this.stopped = true; this.stopChild(); super.dispose(); }
}
