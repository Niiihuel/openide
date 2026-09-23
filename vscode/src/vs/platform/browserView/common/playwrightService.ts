/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { BrowserAgentEvent } from './browserAgentEvents.js';

export const IPlaywrightService = createDecorator<IPlaywrightService>('playwrightService');

/**
 * Identifies the workbench window served by a shared-process Playwright service.
 */
export interface IPlaywrightServiceInitializeOptions {
	readonly windowId: number;
}

export interface IInvokeFunctionResult {
	result?: unknown;
	error?: string;
	summary: string;
	/** When present the function did not complete within the timeout. Pass this ID to {@link IPlaywrightService.waitForDeferredResult} to keep waiting. */
	deferredResultId?: string;
}

/** Correlation only; presentation never receives the executed source or arguments. */
export interface IPlaywrightExecutionContext {
	readonly toolCallId?: string;
	readonly executionId?: string;
}

/** State of an opt-in, page-scoped browser debug capture. */
export interface IBrowserDebugCaptureStatus {
	readonly active: boolean;
	readonly startedAt?: number;
	readonly requestCount: number;
	readonly consoleCount: number;
	readonly droppedRequestCount: number;
	readonly droppedConsoleCount: number;
}

/** Request metadata only; request and response bodies and headers are never captured. */
export interface IBrowserDebugRequestEntry {
	readonly timestamp: number;
	readonly method: string;
	readonly url: string;
	readonly status?: number;
	readonly durationMs?: number;
	readonly failureText?: string;
}

/** Console output or an uncaught page error (`type: 'pageerror'`). */
export interface IBrowserDebugConsoleEntry {
	readonly timestamp: number;
	readonly type: string;
	readonly text: string;
	readonly url?: string;
	readonly lineNumber?: number;
	readonly columnNumber?: number;
}

/** Bounded, serializable result returned when a page's debug capture stops. */
export interface IBrowserDebugReport extends IBrowserDebugCaptureStatus {
	readonly active: false;
	readonly startedAt: number;
	readonly stoppedAt: number;
	readonly durationMs: number;
	readonly requests: readonly IBrowserDebugRequestEntry[];
	readonly console: readonly IBrowserDebugConsoleEntry[];
}

/**
 * A service for using Playwright to connect to and automate the integrated browser.
 *
 * The service maintains a separate Playwright browser instance per session. Callers
 * must pass a {@link sessionId} to every method so operations are routed to the
 * correct instance. Main-process audience selectors determine which pages each
 * session can interact with.
 */
export interface IPlaywrightService {
	readonly _serviceBrand: undefined;

	/** Actual execution lifetime, including deferred runs; scoped to the target browser view. */
	readonly onDidChangeActivity: Event<{ pageId: string; active: boolean }>;
	/** Runtime-independent, sanitized browser activity for native presentation. */
	readonly onDidBrowserAgentEvent: Event<BrowserAgentEvent>;
	/** Begin collecting bounded request and console metadata for one page. Repeated starts preserve the active capture. */
	startDebugCapture(sessionId: string, pageId: string): Promise<IBrowserDebugCaptureStatus>;
	/** Read counters without starting a capture or creating a session. */
	getDebugCaptureStatus(sessionId: string, pageId: string): Promise<IBrowserDebugCaptureStatus>;
	/** Stop collecting, detach listeners, and return the collected metadata. */
	stopDebugCapture(sessionId: string, pageId: string): Promise<IBrowserDebugReport>;
	/** Reports a native capture that intentionally bypasses Playwright's screenshot implementation. */
	reportBrowserAgentAction(sessionId: string, pageId: string, action: 'screenshot', phase: 'started' | 'completed' | 'error', context: IPlaywrightExecutionContext): Promise<void>;

	/** Waits for a newly created browser view to become available and returns its initial summary. */
	waitForPageAndGetSummary(sessionId: string, pageId: string, expectedUrl: string, discoveryTimeoutMs: number): Promise<string>;

	/**
	 * Gets a summary of the page's current state, including its DOM and visual representation.
	 * @param sessionId Identifies the session making the request.
	 * @param pageId The browser view ID identifying the page to read.
	 * @returns The summary of the page's current state.
	 */
	getSummary(sessionId: string, pageId: string): Promise<string>;

	/**
	 * Run a function with access to a Playwright page and return its raw result, or throw an error.
	 * The first function argument is always the Playwright `page` object, and additional arguments can be passed after.
	 * @param sessionId Identifies the session making the request.
	 * @param pageId The browser view ID identifying the page to operate on.
	 * @param fnDef The function code to execute. Should contain the function definition but not its invocation, e.g. `async (page, arg1, arg2) => { ... }`.
	 * @param args Additional arguments to pass to the function after the `page` object.
	 * @returns The result of the function execution.
	 */
	invokeFunctionRaw<T>(sessionId: string, pageId: string, fnDef: string, ...args: unknown[]): Promise<T>;
	/** The explicit context variant keeps metadata separate from the function's variadic arguments. */
	invokeFunctionRawWithContext<T>(sessionId: string, pageId: string, fnDef: string, context: IPlaywrightExecutionContext | undefined, ...args: unknown[]): Promise<T>;

	/**
	 * Run a function with access to a Playwright page and return a result for tool output, including error handling.
	 * The first function argument is always the Playwright `page` object, and additional arguments can be passed after.
	 *
	 * When {@link timeoutMs} is provided, the call races against that timeout.
	 * If the timeout fires before the function completes, or the function is otherwise interrupted,
	 * the in-flight promise is stored as a *deferred result* and the returned object includes a
	 * {@link deferredResultId} that can be passed to {@link waitForDeferredResult} to resume waiting.
	 * When {@link timeoutMs} is omitted the function runs to completion with no deferral.
	 *
	 * @param sessionId Identifies the session making the request.
	 * @param pageId The browser view ID identifying the page to operate on.
	 * @param fnDef The function code to execute. Should contain the function definition but not its invocation, e.g. `async (page, arg1, arg2) => { ... }`.
	 * @param args Additional arguments to pass to the function after the `page` object.
	 * @param timeoutMs Maximum time (in ms) to wait for the function to complete before deferring. When omitted the call awaits indefinitely.
	 * @returns The result of the function execution, including a page summary and optionally a deferredResultId if the call did not complete.
	 */
	invokeFunction(sessionId: string, pageId: string, fnDef: string, args?: unknown[], timeoutMs?: number, context?: IPlaywrightExecutionContext): Promise<IInvokeFunctionResult>;

	/**
	 * Continue waiting for a previously deferred function invocation.
	 *
	 * @param sessionId Identifies the session making the request.
	 * @param deferredResultId The ID returned from a timed-out {@link invokeFunction} call.
	 * @param timeoutMs Maximum time (in ms) to wait before returning a deferred result again.
	 * @returns The same shape as {@link invokeFunction}. If the result is still not
	 * available after the timeout, {@link deferredResultId} is returned again.
	 */
	waitForDeferredResult(sessionId: string, deferredResultId: string, timeoutMs: number): Promise<IInvokeFunctionResult>;

	/**
	 * Responds to a file chooser dialog on the given page.
	 * @param sessionId Identifies the session making the request.
	 * @param pageId The browser view ID identifying the page.
	 * @param files The list of files to select in the file chooser. Empty to dismiss the dialog without selecting files.
	 * @returns An object with the page summary afterwards.
	 */
	replyToFileChooser(sessionId: string, pageId: string, files: string[]): Promise<{ summary: string }>;

	/**
	 * Responds to a dialog (alert, confirm, prompt) on the given page.
	 * @param sessionId Identifies the session making the request.
	 * @param pageId The browser view ID identifying the page.
	 * @param accept Whether to accept or dismiss the dialog.
	 * @param promptText Optional text to enter into a prompt dialog.
	 * @returns An object with the page summary afterwards.
	 */
	replyToDialog(sessionId: string, pageId: string, accept: boolean, promptText?: string): Promise<{ summary: string }>;

	/**
	 * Dispose a session's Playwright browser connection and release its resources.
	 * The session will be lazily recreated if needed.
	 * @param sessionId Identifies the session to dispose.
	 */
	disposeSession(sessionId: string): Promise<void>;
}
