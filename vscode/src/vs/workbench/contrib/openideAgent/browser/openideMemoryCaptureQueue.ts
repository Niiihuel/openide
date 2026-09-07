/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IOpenideMemoryCheckpointState } from '../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { IOpenideCheckpointMemory, OpenideMemoryCheckpoint } from './openideMemoryCheckpoint.js';

type CaptureFactory = (id: string, state: IOpenideMemoryCheckpointState, token: CancellationToken) => Pick<OpenideMemoryCheckpoint, 'capture'>;
interface CaptureDrain { readonly task: Promise<void>; revision: number }

/** Disk acknowledges the job before the turn closes; each conversation drains independently. */
export class OpenideMemoryCaptureQueue extends Disposable {
	private readonly running = new Map<string, CaptureDrain>();
	private readonly persisting = new Map<string, Promise<void>>();
	private cancellation = new CancellationTokenSource();

	async enqueue(memory: IOpenideCheckpointMemory, session: string, state: IOpenideMemoryCheckpointState | undefined, factory: CaptureFactory, start = true): Promise<boolean> {
		if (!state || memory.captureMode !== 'automatic' || this._store.isDisposed) { return false; }
		const token = this.cancellation.token;
		// Serialize the check-and-create pair. Two concurrent enqueues of the same delta
		// must never overwrite a capture that the first enqueue already completed.
		const previous = this.persisting.get(session) ?? Promise.resolve();
		const result = previous.then(async () => {
			const existing = (await memory.request({ action: 'checkpoint', session, checkpointId: state.watermark })).checkpoint;
			if (!existing) { await memory.request({ action: 'checkpoint', session, checkpointId: state.watermark, checkpoint: state }); }
			return !existing || existing.status === 'pending' || existing.status === 'deferred';
		});
		const tail = result.then(() => undefined, () => undefined); this.persisting.set(session, tail);
		void tail.then(() => { if (this.persisting.get(session) === tail) { this.persisting.delete(session); } });
		const pending = await result;
		// A reset may happen during disk IO. Keep the durable receipt, but never start
		// an old workspace's job with the new workspace's cancellation generation.
		if (start && pending && !token.isCancellationRequested && !this._store.isDisposed) { this.drain(memory, session, factory); }
		return pending;
	}

	/** Returns true when memory remains pending, including failures and an expired barrier. */
	async resume(memory: IOpenideCheckpointMemory, session: string, factory: CaptureFactory, budgetMs = 250): Promise<boolean> {
		if (memory.captureMode !== 'automatic' || this._store.isDisposed) { return false; }
		const task = this.drain(memory, session, factory);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const settled = async () => {
				try {
					await task;
					// A completed drain may leave deferred jobs, or receive an enqueue while
					// its completion callback is running. Inspect durable state, not task status.
					return !!(await memory.request({ action: 'checkpoint-list', session })).checkpoints?.length;
				} catch { return true; }
			};
			return await Promise.race([settled(), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), Math.max(0, budgetMs)); })]);
		} finally { if (timer !== undefined) { clearTimeout(timer); } }
	}

	private drain(memory: IOpenideCheckpointMemory, session: string, factory: CaptureFactory): Promise<void> {
		const current = this.running.get(session);
		if (current) { current.revision++; return current.task; }
		const token = this.cancellation.token;
		let observedRevision = 0;
		// Defer execution until the entry is installed, including for synchronous test adapters.
		const task = Promise.resolve().then(async () => {
			const attempted = new Set<string>();
			while (!token.isCancellationRequested && memory.captureMode === 'automatic') {
				observedRevision = entry.revision;
				const jobs = (await memory.request({ action: 'checkpoint-list', session })).checkpoints ?? [];
				if (token.isCancellationRequested) { break; }
				const next = jobs.find(job => !attempted.has(job.id));
				if (!next) { if (observedRevision !== entry.revision) { continue; } break; }
				attempted.add(next.id);
				// A failed job remains durable and gets one attempt per drain. Other jobs
				// can still complete; resume or a later enqueue may retry the failed job.
				try { await factory(next.id, next.state, token).capture([], token, 'background'); } catch { /* Retain durable pending state. */ }
			}
		});
		const entry: CaptureDrain = { task, revision: 0 }; this.running.set(session, entry);
		void task.finally(() => {
			if (this.running.get(session) !== entry) { return; }
			this.running.delete(session);
			// An enqueue can arrive after the last empty scan but before this callback.
			if (entry.revision !== observedRevision && !token.isCancellationRequested && memory.captureMode === 'automatic') { this.drain(memory, session, factory); }
		}).catch(() => undefined);
		return task;
	}

	/** Root/trust changes cancel active work; pending files remain available after recovery. */
	reset(): void {
		this.cancellation.cancel(); this.cancellation.dispose();
		this.cancellation = new CancellationTokenSource(); this.running.clear(); this.persisting.clear();
	}

	override dispose(): void {
		this.cancellation.cancel(); this.cancellation.dispose(); this.running.clear(); this.persisting.clear(); super.dispose();
	}
}
