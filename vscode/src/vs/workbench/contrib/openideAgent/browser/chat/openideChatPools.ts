/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../base/common/lifecycle.js';

/**
 * Handle over a pooled item. Disposing returns the item to the pool instead of destroying it,
 * which is the whole point: a row scrolling out of view must not throw away an editor.
 */
export interface IOpenideChatPoolReference<T> extends IDisposable {
	readonly object: T;
	/** True once released, so a part that kept the reference too long can notice. */
	isStale(): boolean;
}

export interface IOpenideChatPoolOptions {
	/** Idle items kept alive. Undefined means unbounded, which is the safe default while typing. */
	readonly maxIdleSize?: number;
	/** Debounce before trimming. Streaming acquires and releases many times per second. */
	readonly trimIdleDelay?: number;
}

/**
 * Reuses expensive per-row resources across list rows.
 *
 * Adapted from `ResourcePool` (contrib/chat/browser/widget/chatContentParts/chatCollections.ts:24)
 * — that file is genuinely copyable, it only imports `IDisposable`. Trimmed to what the native
 * transcript needs and given a reference handle so callers cannot forget to release.
 */
export class OpenideChatResourcePool<T extends IDisposable> implements IDisposable {

	private readonly _idle: T[] = [];
	private readonly _inUse = new Set<T>();
	private _trimTimer: ReturnType<typeof setTimeout> | undefined;

	get inUse(): ReadonlySet<T> {
		return this._inUse;
	}

	constructor(
		private readonly _itemFactory: () => T,
		private readonly _options?: IOpenideChatPoolOptions,
	) { }

	acquire(): IOpenideChatPoolReference<T> {
		const item = this._idle.pop() ?? this._itemFactory();
		this._inUse.add(item);

		let released = false;
		return {
			object: item,
			isStale: () => released,
			dispose: () => {
				if (released) {
					return;
				}
				released = true;
				this._release(item);
			},
		};
	}

	private _release(item: T): void {
		this._inUse.delete(item);
		this._idle.push(item);
		this._scheduleTrim();
	}

	private _scheduleTrim(): void {
		const maxIdle = this._options?.maxIdleSize;
		if (maxIdle === undefined || this._idle.length <= maxIdle) {
			return;
		}

		// Reset on every release: a burst of acquire/release during streaming must not churn.
		if (this._trimTimer !== undefined) {
			clearTimeout(this._trimTimer);
		}
		this._trimTimer = setTimeout(() => {
			this._trimTimer = undefined;
			while (this._idle.length > maxIdle) {
				this._idle.pop()!.dispose();
			}
		}, this._options?.trimIdleDelay ?? 10_000);
	}

	/** Disposes idle items only; anything still on screen survives. */
	clear(): void {
		if (this._trimTimer !== undefined) {
			clearTimeout(this._trimTimer);
			this._trimTimer = undefined;
		}
		for (const item of this._idle) {
			item.dispose();
		}
		this._idle.length = 0;
	}

	dispose(): void {
		this.clear();
		for (const item of this._inUse) {
			item.dispose();
		}
		this._inUse.clear();
	}
}
