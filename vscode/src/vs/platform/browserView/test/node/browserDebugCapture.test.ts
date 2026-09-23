/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EventEmitter } from 'events';
import { BrowserDebugCapture } from '../../node/browserDebugCapture.js';

// eslint-disable-next-line local/code-import-patterns
import type { ConsoleMessage, Page, Request, Response } from 'playwright-core';

suite('BrowserDebugCapture', () => {
	test('collects metadata and redacts URL credentials, query values, and fragments', () => {
		const events = new EventEmitter();
		const capture = new BrowserDebugCapture(events as unknown as Page, () => { });
		const request = {
			method: () => 'POST',
			url: () => 'https://name:password@example.com/api?token=secret&mode=private#fragment',
		} as Request;
		events.emit('request', request);
		events.emit('response', { request: () => request, status: () => 403 } as Response);
		events.emit('requestfinished', request);
		events.emit('console', {
			type: () => 'error',
			text: () => 'Failed at https://example.com/api?credential=hidden#fragment',
			location: () => ({ url: 'https://name:password@example.com/app?token=secret#fragment', lineNumber: 12, columnNumber: 3 }),
		} as ConsoleMessage);
		const pageError = new Error('Crash at https://example.com/app?session=secret#fragment');
		pageError.stack = 'Error: Crash at https://example.com/app?session=secret#fragment\n    at https://example.com/app.js?token=secret#frame:12:3';
		events.emit('pageerror', pageError);
		const report = capture.stop();

		assert.deepStrictEqual({
			status: { active: report.active, requestCount: report.requestCount, consoleCount: report.consoleCount },
			request: { method: report.requests[0].method, url: report.requests[0].url, status: report.requests[0].status, hasDuration: typeof report.requests[0].durationMs === 'number' },
			console: report.console.map(entry => ({ type: entry.type, text: entry.text, url: entry.url })),
			timesOrdered: report.startedAt <= report.stoppedAt,
			leaked: /password|secret|private|hidden|fragment/.test(JSON.stringify(report)),
		}, {
			status: { active: false, requestCount: 1, consoleCount: 2 },
			request: { method: 'POST', url: 'https://example.com/api?token=%5Bredacted%5D&mode=%5Bredacted%5D', status: 403, hasDuration: true },
			console: [
				{ type: 'error', text: 'Failed at https://example.com/api?credential=%5Bredacted%5D', url: 'https://example.com/app?token=%5Bredacted%5D' },
				{ type: 'pageerror', text: 'Error: Crash at https://example.com/app?session=%5Bredacted%5D\n    at https://example.com/app.js?token=%5Bredacted%5D', url: undefined },
			],
			timesOrdered: true,
			leaked: false,
		});
	});

	test('redacts websocket and file URLs in failures and console text', () => {
		const events = new EventEmitter();
		const capture = new BrowserDebugCapture(events as unknown as Page, () => { });
		const request = {
			method: () => 'GET',
			url: () => 'wss://name:password@example.com/socket?token=secret#fragment',
			failure: () => ({ errorText: 'Failed ws://example.com/socket?key=secret#fragment' }),
		} as Request;
		events.emit('request', request);
		events.emit('requestfailed', request);
		events.emit('request', { method: () => 'GET', url: () => 'data:text/plain,private-data?token=secret' } as Request);
		events.emit('console', {
			type: () => 'warning',
			text: () => 'See file:///tmp/debug.log?token=secret and wss://example.com/live?key=private',
			location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }),
		} as ConsoleMessage);
		const report = capture.stop();

		assert.deepStrictEqual({
			requestUrl: report.requests[0].url,
			failureText: report.requests[0].failureText,
			failedDuration: typeof report.requests[0].durationMs === 'number',
			dataUrl: report.requests[1].url,
			consoleText: report.console[0].text,
			leaked: /password|secret|private|fragment/.test(JSON.stringify(report)),
		}, {
			requestUrl: 'wss://example.com/socket?token=%5Bredacted%5D',
			failureText: 'Failed ws://example.com/socket?key=%5Bredacted%5D',
			failedDuration: true,
			dataUrl: 'data:[redacted]',
			consoleText: 'See file:///tmp/debug.log?token=%5Bredacted%5D and wss://example.com/live?key=%5Bredacted%5D',
			leaked: false,
		});
	});

	test('keeps the newest bounded entries, leaves unfinished latency unset, and detaches listeners', () => {
		const events = new EventEmitter();
		const capture = new BrowserDebugCapture(events as unknown as Page, () => { });
		const longText = 'x'.repeat(1100);
		for (let index = 0; index < 101; index++) {
			events.emit('request', { method: () => 'GET', url: () => `https://example.com/${index}` } as Request);
			events.emit('console', { type: () => 'log', text: () => `${index}:${longText}`, location: () => ({ url: '', lineNumber: 0, columnNumber: 0 }) } as ConsoleMessage);
		}
		const report = capture.stop();
		events.emit('pageerror', new Error('after stop'));
		assert.deepStrictEqual({
			requestCount: report.requestCount,
			consoleCount: report.consoleCount,
			droppedRequestCount: report.droppedRequestCount,
			droppedConsoleCount: report.droppedConsoleCount,
			firstUrl: report.requests[0].url,
			lastUrl: report.requests.at(-1)?.url,
			unfinishedDuration: report.requests[0].durationMs,
			firstConsolePrefix: report.console[0].text.slice(0, 2),
			textLength: report.console[0].text.length,
			requestListeners: events.listenerCount('request'),
			consoleListeners: events.listenerCount('console'),
			closeListeners: events.listenerCount('close'),
		}, {
			requestCount: 100,
			consoleCount: 100,
			droppedRequestCount: 1,
			droppedConsoleCount: 1,
			firstUrl: 'https://example.com/1',
			lastUrl: 'https://example.com/100',
			unfinishedDuration: undefined,
			firstConsolePrefix: '1:',
			textLength: 1000,
			requestListeners: 0,
			consoleListeners: 0,
			closeListeners: 0,
		});
	});
});
