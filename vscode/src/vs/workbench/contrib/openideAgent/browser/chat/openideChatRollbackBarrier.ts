/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Global mutual exclusion between sending a turn and rolling one back.
 *
 * Extracted verbatim (semantics, not just shape) from the five fields the webview view pane keeps
 * alive — `_rollbackQueue`, `_rollbackOperations`, `_rollbackActive`, `_sendPreparations`,
 * `_sendPreparationWaiters` (browser/openideChatView.ts:107-112, 1241-1249, 1936-1953).
 *
 * It lives in Stage 1 and not in a later stage because a rollback MUTATES WORKSPACE FILES: it is
 * one transaction, global to the window, even across conversations. Without the barrier a send
 * whose preparation is already past its first `await` reaches `runMessages` in the middle of the
 * revert and its tools write over files that were just restored — silently, with no error.
 *
 * The barrier is deliberately a plain class with no lifecycle: it holds promises, not resources.
 */
export class OpenideChatRollbackBarrier {

	/** Serializes rollbacks against each other. Errors are swallowed so one failure does not
	 *  poison the chain for the next operation. */
	private _queue: Promise<void> = Promise.resolve();
	/** Monotonic id of the last accepted rollback; only the newest one may lower the flag. */
	private _operations = 0;
	private _active = false;
	/** Sends that have been admitted but have not reached `runMessages` yet. */
	private _preparations = 0;
	private readonly _waiters = new Set<() => void>();

	/**
	 * Raised synchronously the moment a rollback is accepted, so a send that has not started yet
	 * is rejected instead of racing. Callers MUST check this before `withSendPreparation`.
	 */
	get isActive(): boolean {
		return this._active;
	}

	/** True while at least one admitted send is still assembling its turn. */
	get hasPendingSends(): boolean {
		return this._preparations > 0;
	}

	/**
	 * Wraps the whole admission-to-launch window of a send.
	 *
	 * `prepare` must not resolve before the run promise is assigned: the rollback drains this
	 * counter and then cancels and awaits the active run, so a preparation that returns early
	 * leaves a run the rollback cannot see and therefore cannot stop.
	 *
	 * It never awaits the rollback itself — that is the caller's `isActive` check — because
	 * waiting here while the rollback waits for the counter to reach zero would deadlock both.
	 */
	async withSendPreparation<T>(prepare: () => Promise<T>): Promise<T> {
		this._preparations++;
		try {
			return await prepare();
		} finally {
			this._preparations--;
			if (!this._preparations) {
				for (const resolve of this._waiters) {
					resolve();
				}
				this._waiters.clear();
			}
		}
	}

	/**
	 * Runs a rollback with the barrier raised: queued behind any previous rollback, and started
	 * only once every in-flight send preparation has launched its run.
	 *
	 * `fallback` turns a thrown rollback into a value instead of a rejection, because the flag has
	 * to come down on every path — a rejected promise that skipped the flag would leave the window
	 * permanently unable to send.
	 */
	runExclusive<T>(operation: () => Promise<T>, fallback: (error: unknown) => T): Promise<T> {
		this._active = true;
		const operationId = ++this._operations;
		let result!: T;
		const running = this._queue.catch(() => undefined).then(async () => {
			try {
				if (this._preparations) {
					await new Promise<void>(resolve => this._waiters.add(resolve));
				}
				result = await operation();
			} catch (error) {
				result = fallback(error);
			}
		});
		this._queue = running.then(() => undefined, () => undefined);
		return running.then(() => result).finally(() => {
			// Only the newest operation resets the chain: an older one finishing late would clear a
			// barrier that a rollback still in flight depends on.
			if (operationId === this._operations) {
				this._queue = Promise.resolve();
				this._active = false;
			}
		});
	}
}
