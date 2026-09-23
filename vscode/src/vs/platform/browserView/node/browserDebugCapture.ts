/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IBrowserDebugCaptureStatus, IBrowserDebugConsoleEntry, IBrowserDebugReport, IBrowserDebugRequestEntry } from '../common/playwrightService.js';

// eslint-disable-next-line local/code-import-patterns
import type { ConsoleMessage, Page, Request, Response } from 'playwright-core';

const MAX_REQUESTS = 100;
const MAX_CONSOLE_ENTRIES = 100;
const MAX_TEXT_LENGTH = 1000;

interface MutableRequestEntry extends IBrowserDebugRequestEntry {
	status?: number;
	durationMs?: number;
	failureText?: string;
}

/** Return empty counters without starting a browser connection or listeners. */
export function emptyBrowserDebugCaptureStatus(): IBrowserDebugCaptureStatus {
	return { active: false, requestCount: 0, consoleCount: 0, droppedRequestCount: 0, droppedConsoleCount: 0 };
}

/**
 * Collects bounded request metadata and console text only while explicitly active.
 * No request or response bodies, headers, or console arguments are read.
 */
export class BrowserDebugCapture extends Disposable {
	readonly startedAt = Date.now();
	private readonly requests: MutableRequestEntry[] = [];
	private readonly consoleEntries: IBrowserDebugConsoleEntry[] = [];
	private readonly requestsByObject = new WeakMap<Request, MutableRequestEntry>();
	private droppedRequestCount = 0;
	private droppedConsoleCount = 0;

	constructor(page: Page, onClose: () => void) {
		super();

		const onRequest = (request: Request) => this.recordRequest(request);
		page.on('request', onRequest);
		this._register(toDisposable(() => page.off('request', onRequest)));

		const onResponse = (response: Response) => this.recordResponse(response);
		page.on('response', onResponse);
		this._register(toDisposable(() => page.off('response', onResponse)));

		const onRequestFinished = (request: Request) => this.finishRequest(request);
		page.on('requestfinished', onRequestFinished);
		this._register(toDisposable(() => page.off('requestfinished', onRequestFinished)));

		const onRequestFailed = (request: Request) => this.failRequest(request);
		page.on('requestfailed', onRequestFailed);
		this._register(toDisposable(() => page.off('requestfailed', onRequestFailed)));

		const onConsole = (message: ConsoleMessage) => this.recordConsole(message);
		page.on('console', onConsole);
		this._register(toDisposable(() => page.off('console', onConsole)));

		const onPageError = (error: Error) => this.recordPageError(error);
		page.on('pageerror', onPageError);
		this._register(toDisposable(() => page.off('pageerror', onPageError)));

		page.on('close', onClose);
		this._register(toDisposable(() => page.off('close', onClose)));
	}

	status(): IBrowserDebugCaptureStatus {
		return {
			active: !this._store.isDisposed,
			startedAt: this.startedAt,
			requestCount: this.requests.length,
			consoleCount: this.consoleEntries.length,
			droppedRequestCount: this.droppedRequestCount,
			droppedConsoleCount: this.droppedConsoleCount,
		};
	}

	stop(): IBrowserDebugReport {
		const stoppedAt = Date.now();
		const report: IBrowserDebugReport = {
			...this.status(),
			active: false,
			startedAt: this.startedAt,
			stoppedAt,
			durationMs: Math.max(0, stoppedAt - this.startedAt),
			requests: this.requests.map(entry => ({ ...entry })),
			console: [...this.consoleEntries],
		};
		this.dispose();
		return report;
	}

	private recordRequest(request: Request): void {
		if (this.requests.length >= MAX_REQUESTS) {
			this.requests.shift();
			this.droppedRequestCount++;
		}
		const entry: MutableRequestEntry = {
			timestamp: Date.now(),
			method: boundText(request.method()),
			url: redactUrl(request.url()),
		};
		this.requests.push(entry);
		this.requestsByObject.set(request, entry);
	}

	private recordResponse(response: Response): void {
		const entry = this.requestsByObject.get(response.request());
		if (entry) {
			entry.status = response.status();
			entry.durationMs = Math.max(0, Date.now() - entry.timestamp);
		}
	}

	private finishRequest(request: Request): void {
		const entry = this.requestsByObject.get(request);
		if (entry) {
			entry.durationMs = Math.max(0, Date.now() - entry.timestamp);
		}
	}

	private failRequest(request: Request): void {
		const entry = this.requestsByObject.get(request);
		if (entry) {
			entry.durationMs = Math.max(0, Date.now() - entry.timestamp);
			const failureText = request.failure()?.errorText;
			if (failureText) {
				entry.failureText = boundText(redactUrlsInText(failureText));
			}
		}
	}

	private recordConsole(message: ConsoleMessage): void {
		const location = message.location();
		this.pushConsole({
			timestamp: Date.now(),
			type: boundText(message.type()),
			text: boundText(redactUrlsInText(message.text())),
			...(location.url ? { url: redactUrl(location.url) } : {}),
			lineNumber: location.lineNumber,
			columnNumber: location.columnNumber,
		});
	}

	private recordPageError(error: Error): void {
		this.pushConsole({ timestamp: Date.now(), type: 'pageerror', text: boundText(redactUrlsInText(error.stack ?? error.message)) });
	}

	private pushConsole(entry: IBrowserDebugConsoleEntry): void {
		if (this.consoleEntries.length >= MAX_CONSOLE_ENTRIES) {
			this.consoleEntries.shift();
			this.droppedConsoleCount++;
		}
		this.consoleEntries.push(entry);
	}
}

function boundText(value: string): string {
	return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH - 3)}...` : value;
}

function redactUrlsInText(value: string): string {
	return value.slice(0, MAX_TEXT_LENGTH * 4).replace(/\b(?:https?|wss?|file):\/\/[^\s"'<>]+/g, match => redactUrl(match));
}

/** Keep URL structure useful for debugging while removing credentials, query values, and fragments. */
function redactUrl(value: string): string {
	try {
		const url = new URL(value.slice(0, MAX_TEXT_LENGTH * 4));
		if (!['http:', 'https:', 'ws:', 'wss:', 'file:'].includes(url.protocol)) {
			return `${url.protocol}[redacted]`;
		}
		url.username = '';
		url.password = '';
		for (const key of new Set(url.searchParams.keys())) {
			url.searchParams.set(key, '[redacted]');
		}
		url.hash = '';
		return boundText(url.toString());
	} catch {
		return '[unparseable URL]';
	}
}
