/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BrowserAgentEvent } from '../../../../../platform/browserView/common/browserAgentEvents.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { BrowserAgentSessionService } from '../../electron-browser/browserAgentSessionService.js';

suite('BrowserAgentSessionService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const source = store.add(new Emitter<BrowserAgentEvent>());
		const service = store.add(new BrowserAgentSessionService(upcastPartial<IPlaywrightService>({ onDidBrowserAgentEvent: source.event })));
		const emit = (sessionId: string, pageId: string, sequence: number, options: Partial<BrowserAgentEvent> = {}) => source.fire({ sessionId, pageId, sequence, timestamp: sequence, action: 'click', phase: 'started', ...options });
		return { source, service, emit };
	}

	test('links multiple tool calls to a browser session while keeping simultaneous pages isolated', () => {
		const f = fixture();
		f.emit('first', 'page-a', 1, { toolCallId: 'navigate-call' });
		f.emit('second', 'page-b', 1, { toolCallId: 'other-call' });
		f.emit('first', 'page-a', 2, { toolCallId: 'type-call', action: 'type' });
		assert.deepStrictEqual({ first: f.service.sessionForPage('page-a')?.sessionId, second: f.service.sessionForPage('page-b')?.sessionId, calls: ['navigate-call', 'type-call', 'other-call'].map(call => f.service.sessionForToolCall(call)?.sessionId), firstAction: f.service.sessionForPage('page-a')?.state.currentAction?.action, secondAction: f.service.sessionForPage('page-b')?.state.currentAction?.action }, {
			first: 'first', second: 'second', calls: ['first', 'first', 'second'], firstAction: 'type', secondAction: 'click',
		});
	});

	test('late geometry updates, completion and close do not replace the new page owner', () => {
		const f = fixture();
		f.emit('old', 'page', 1, { toolCallId: 'old-call' });
		f.emit('new', 'page', 1, { toolCallId: 'new-call' });
		f.emit('old', 'page', 2, { phase: 'updated', status: 'running', point: { x: 1, y: 2 } });
		const afterUpdate = f.service.sessionForPage('page')?.sessionId;
		f.emit('old', 'page', 3, { action: 'success', phase: 'completed' });
		const afterCompletion = f.service.sessionForPage('page')?.sessionId;
		f.emit('old', 'page', 4, { action: 'wait', phase: 'completed', closed: true });
		assert.deepStrictEqual({ afterUpdate, afterCompletion, afterClose: f.service.sessionForPage('page')?.sessionId, oldCall: f.service.sessionForToolCall('old-call'), newCall: f.service.sessionForToolCall('new-call')?.sessionId, oldClosed: f.service.getSession('old')?.state.closed }, {
			afterUpdate: 'new', afterCompletion: 'new', afterClose: 'new', oldCall: undefined, newCall: 'new', oldClosed: true,
		});
	});

	test('a closed session is fenced and cannot recreate its page or tool-call links', () => {
		const f = fixture();
		let changes = 0;
		store.add(f.service.onDidChangeSession(() => changes++));
		f.emit('session', 'page', 1, { toolCallId: 'call' });
		f.emit('session', 'page', 2, { closed: true });
		f.emit('session', 'page', 3, { toolCallId: 'late-call' });
		assert.deepStrictEqual({ changes, page: f.service.sessionForPage('page'), call: f.service.sessionForToolCall('call'), lateCall: f.service.sessionForToolCall('late-call'), closed: f.service.getSession('session')?.state.closed }, {
			changes: 2, page: undefined, call: undefined, lateCall: undefined, closed: true,
		});
	});

	test('duplicate and invalid events never create correlation links or change notifications', () => {
		const f = fixture();
		let changes = 0;
		store.add(f.service.onDidChangeSession(() => changes++));
		f.emit('session', 'page', 2, { toolCallId: 'current-call' });
		f.emit('session', 'wrong-page', 1, { toolCallId: 'stale-call' });
		f.emit('session', 'wrong-page', 3, { toolCallId: 'invalid-call', point: { x: NaN, y: 0 } });
		f.emit('invalid-session', 'wrong-page', 1, { viewport: { width: 0, height: 0 } });
		assert.deepStrictEqual({ changes, page: f.service.sessionForPage('wrong-page'), stale: f.service.sessionForToolCall('stale-call'), invalid: f.service.sessionForToolCall('invalid-call'), invalidSession: f.service.getSession('invalid-session') }, { changes: 1, page: undefined, stale: undefined, invalid: undefined, invalidSession: undefined });
	});

	test('dispose detaches the source and rejects synthetic events after shutdown', () => {
		const f = fixture();
		let changes = 0;
		store.add(f.service.onDidChangeSession(() => changes++));
		f.emit('session', 'page', 1);
		f.service.dispose();
		f.emit('late-runtime', 'page', 1);
		f.service.acceptEvent({ sessionId: 'late-synthetic', sequence: 1, timestamp: 1, action: 'click' });
		assert.deepStrictEqual({ changes, runtime: f.service.getSession('late-runtime'), synthetic: f.service.getSession('late-synthetic'), page: f.service.sessionForPage('page') }, { changes: 1, runtime: undefined, synthetic: undefined, page: undefined });
	});

	test('closing releases transient step history while retaining a small closed-session fence', () => {
		const f = fixture();
		for (let sequence = 1; sequence <= 100; sequence++) {
			f.emit('session', 'page', sequence, { step: sequence });
		}
		const snapshot = f.service.getSession('session')!.state;
		f.emit('session', 'page', 101, { closed: true });
		assert.deepStrictEqual({ oldHistory: snapshot.previousSteps.length, closedHistory: f.service.getSession('session')?.state.previousSteps.length, closed: f.service.getSession('session')?.state.closed }, { oldHistory: 40, closedHistory: 0, closed: true });
	});

	test('a neutral close event without page metadata clears all ownership links before notifying', () => {
		const f = fixture();
		f.emit('session', 'page', 1, { toolCallId: 'call' });
		let pageOnClose: string | undefined;
		store.add(f.service.onDidChangeSession(model => { if (model.state.closed) { pageOnClose = f.service.sessionForPage('page')?.sessionId; } }));
		f.source.fire({ sessionId: 'session', sequence: 2, timestamp: 2, action: 'wait', closed: true });
		assert.deepStrictEqual({ pageOnClose, page: f.service.sessionForPage('page'), call: f.service.sessionForToolCall('call') }, { pageOnClose: undefined, page: undefined, call: undefined });
	});
});
