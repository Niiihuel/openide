/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IRegisteredCodeWindow } from '../../../base/browser/dom.js';
import { CodeWindow, mainWindow } from '../../../base/browser/window.js';
import { DisposableStore, GCBasedDisposableTracker, IDisposable, setDisposableTracker } from '../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { BaseWindow } from '../../browser/window.js';
import { TestContextMenuService, TestEnvironmentService, TestHostService, TestLayoutService } from './workbenchTestServices.js';

suite('Window', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	class TestWindow extends BaseWindow {

		constructor(window: CodeWindow, dom: { getWindowsCount: () => number; getWindows: () => Iterable<IRegisteredCodeWindow> }) {
			super(window, dom, new TestHostService(), TestEnvironmentService, new TestContextMenuService(), new TestLayoutService());
		}

		protected override enableWindowFocusOnElementFocus(): void { }
	}

	test('multi window timeouts remain disposed after completion, cancellation and window cleanup', () => {
		class TimeoutTracker extends GCBasedDisposableTracker {
			readonly disposed = new WeakSet<IDisposable>();
			readonly trackedAfterDisposal: IDisposable[] = [];

			override trackDisposable(disposable: IDisposable): void {
				if (this.disposed.has(disposable)) { this.trackedAfterDisposal.push(disposable); }
				super.trackDisposable(disposable);
			}

			override markAsDisposed(disposable: IDisposable): void {
				this.disposed.add(disposable);
				super.markAsDisposed(disposable);
			}
		}

		// Observe GC registrations directly instead of relying on nondeterministic finalization.
		const tracker = new TimeoutTracker();
		setDisposableTracker(tracker);
		const disposables = new DisposableStore();
		try {
			const callbacks = new Map<number, () => void>();
			const cleared: number[] = [];
			let nextHandle = 0;
			const windows: IRegisteredCodeWindow[] = [];
			const dom = { getWindowsCount: () => windows.length, getWindows: () => windows };
			for (let index = 0; index < 2; index++) {
				const window = {
					setTimeout(callback: () => void): number { const handle = ++nextHandle; callbacks.set(handle, callback); return handle; },
					clearTimeout(handle: number): void { cleared.push(handle); callbacks.delete(handle); }
				} as unknown as CodeWindow;
				disposables.add(new TestWindow(window, dom));
				windows.push({ window, disposables });
			}
			const window = windows[0].window;
			let calls = 0;
			window.setTimeout(() => { calls++; }, 1);
			const scheduled = [...callbacks.values()];
			assert.strictEqual(scheduled.length, 2);
			scheduled[0]();
			scheduled[1](); // Simulate a callback arriving after clearTimeout in an unfocused window.
			assert.strictEqual(calls, 1);
			assert.strictEqual(callbacks.size, 0);
			assert.deepStrictEqual(cleared, [1, 2]);
			assert.strictEqual(tracker.trackedAfterDisposal.length, 0, 'completed timeouts must not be registered again');

			const cancelled = window.setTimeout(() => { calls++; }, 1);
			window.clearTimeout(cancelled);
			assert.strictEqual(callbacks.size, 0);
			assert.deepStrictEqual(cleared, [1, 2, 3, 4]);
			assert.strictEqual(tracker.trackedAfterDisposal.length, 0, 'cancelled timeouts must not be registered again');

			const pending = window.setTimeout(() => { calls++; }, 1);
			disposables.dispose();
			window.clearTimeout(pending); // Release the shared timeout handle after both windows close.
			assert.strictEqual(calls, 1);
			assert.strictEqual(callbacks.size, 0);
			assert.deepStrictEqual(cleared, [1, 2, 3, 4, 5, 6], 'each native timeout is cleared exactly once');
			assert.strictEqual(tracker.trackedAfterDisposal.length, 0, 'window cleanup must not register disposed timeouts again');
		} finally {
			disposables.dispose();
			setDisposableTracker(null);
		}
	});

	test('multi window aware setTimeout()', async function () {
		return runWithFakedTimers({ useFakeTimers: true }, async () => {
			const disposables = new DisposableStore();

			let windows: IRegisteredCodeWindow[] = [];
			const dom = {
				getWindowsCount: () => windows.length,
				getWindows: () => windows
			};

			const setTimeoutCalls: number[] = [];
			const clearTimeoutCalls: number[] = [];

			function createWindow(id: number, slow?: boolean) {
				// eslint-disable-next-line local/code-no-any-casts
				const res = {
					setTimeout: function (callback: Function, delay: number, ...args: unknown[]): number {
						setTimeoutCalls.push(id);

						return mainWindow.setTimeout(() => callback(id), slow ? delay * 2 : delay, ...args);
					},
					clearTimeout: function (timeoutId: number): void {
						clearTimeoutCalls.push(id);

						return mainWindow.clearTimeout(timeoutId);
					}
				} as any;

				disposables.add(new TestWindow(res, dom));

				return res;
			}

			const window1 = createWindow(1);
			windows = [{ window: window1, disposables }];

			// Window Count: 1

			let called = false;
			await new Promise<void>((resolve, reject) => {
				window1.setTimeout(() => {
					if (!called) {
						called = true;
						resolve();
					} else {
						reject(new Error('timeout called twice'));
					}
				}, 1);
			});

			assert.strictEqual(called, true);
			assert.deepStrictEqual(setTimeoutCalls, [1]);
			assert.deepStrictEqual(clearTimeoutCalls, []);
			called = false;
			setTimeoutCalls.length = 0;
			clearTimeoutCalls.length = 0;

			await new Promise<void>((resolve, reject) => {
				window1.setTimeout(() => {
					if (!called) {
						called = true;
						resolve();
					} else {
						reject(new Error('timeout called twice'));
					}
				}, 0);
			});

			assert.strictEqual(called, true);
			assert.deepStrictEqual(setTimeoutCalls, [1]);
			assert.deepStrictEqual(clearTimeoutCalls, []);
			called = false;
			setTimeoutCalls.length = 0;
			clearTimeoutCalls.length = 0;

			// Window Count: 3

			let window2 = createWindow(2);
			const window3 = createWindow(3);
			windows = [
				{ window: window2, disposables },
				{ window: window1, disposables },
				{ window: window3, disposables }
			];

			await new Promise<void>((resolve, reject) => {
				window1.setTimeout(() => {
					if (!called) {
						called = true;
						resolve();
					} else {
						reject(new Error('timeout called twice'));
					}
				}, 1);
			});

			assert.strictEqual(called, true);
			assert.deepStrictEqual(setTimeoutCalls, [2, 1, 3]);
			assert.deepStrictEqual(clearTimeoutCalls, [2, 1, 3]);
			called = false;
			setTimeoutCalls.length = 0;
			clearTimeoutCalls.length = 0;

			// Window Count: 2 (1 fast, 1 slow)

			window2 = createWindow(2, true);
			windows = [
				{ window: window2, disposables },
				{ window: window1, disposables },
			];

			await new Promise<void>((resolve, reject) => {
				window1.setTimeout((windowId: number) => {
					if (!called && windowId === 1) {
						called = true;
						resolve();
					} else if (called) {
						reject(new Error('timeout called twice'));
					} else {
						reject(new Error('timeout called for wrong window'));
					}
				}, 1);
			});

			assert.strictEqual(called, true);
			assert.deepStrictEqual(setTimeoutCalls, [2, 1]);
			assert.deepStrictEqual(clearTimeoutCalls, [2, 1]);
			called = false;
			setTimeoutCalls.length = 0;
			clearTimeoutCalls.length = 0;

			disposables.dispose();
		});
	});
});
