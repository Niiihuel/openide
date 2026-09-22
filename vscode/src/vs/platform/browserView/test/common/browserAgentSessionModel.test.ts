/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BrowserAgentEvent } from '../../common/browserAgentEvents.js';
import { BrowserAgentSessionModel } from '../../common/browserAgentSessionModel.js';

suite('BrowserAgentSessionModel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const event = (sequence: number, fields: Partial<BrowserAgentEvent> = {}): BrowserAgentEvent => ({ sessionId: 'browser', sequence, timestamp: 100 + sequence, action: 'click', phase: 'started', ...fields });

	test('consumes a fake runtime-independent action sequence and retains the last action per step', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		const events: BrowserAgentEvent[] = [
			event(1, { action: 'navigate', step: 1, url: 'https://example.test', viewport: { width: 800, height: 600 } }),
			event(2, { action: 'navigate', step: 1, phase: 'completed' }),
			event(3, { step: 2, point: { x: 100, y: 200 }, target: { x: 90, y: 190, width: 100, height: 30, label: 'Search' } }),
			event(4, { action: 'type', step: 3 }),
			event(5, { action: 'scroll', step: 4, scrollDelta: { x: 0, y: 300 }, target: null }),
			event(6, { action: 'success', step: 4, phase: 'completed' }),
		];
		for (const item of events) {
			assert.strictEqual(model.acceptEvent(item), true);
		}
		assert.deepStrictEqual({ status: model.state.status, url: model.state.url, cursor: model.state.cursor, target: model.state.target, viewport: model.state.viewport, history: model.state.previousSteps.map(item => [item.action, item.phase]), started: model.state.startedAt, completed: model.state.completedAt }, {
			status: 'completed', url: 'https://example.test', cursor: { x: 100, y: 200 }, target: undefined, viewport: { width: 800, height: 600 },
			history: [['navigate', 'completed'], ['click', 'started'], ['type', 'started']], started: 101, completed: 106,
		});
	});

	test('rejects stale sequences and events from simultaneous other sessions', () => {
		const first = store.add(new BrowserAgentSessionModel('browser', 100));
		const second = store.add(new BrowserAgentSessionModel('other', 100));
		first.acceptEvent(event(2));
		assert.deepStrictEqual({ duplicate: first.acceptEvent(event(2)), stale: first.acceptEvent(event(1)), other: first.acceptEvent(event(3, { sessionId: 'other' })), acceptedByOther: second.acceptEvent(event(1, { sessionId: 'other', action: 'wait' })), first: first.state.currentAction?.action, second: second.state.currentAction?.action }, {
			duplicate: false, stale: false, other: false, acceptedByOther: true, first: 'click', second: 'wait',
		});
	});

	test('keeps completion time stable while idle viewport geometry changes', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		model.acceptEvent(event(1, { action: 'success', phase: 'completed', viewport: { width: 800, height: 600 } }));
		model.acceptEvent(event(2, { action: 'success', phase: 'updated', viewport: { width: 500, height: 400 }, point: { x: 20, y: 30 } }));
		assert.deepStrictEqual({ status: model.state.status, completedAt: model.state.completedAt, updatedAt: model.state.updatedAt, viewport: model.state.viewport, history: model.state.previousSteps }, {
			status: 'completed', completedAt: 101, updatedAt: 102, viewport: { width: 500, height: 400 }, history: [],
		});
	});

	test('newer invocations fence delayed completion and restarted actions from replaced invocations', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		model.acceptEvent(event(1, { executionId: 'first', executionSequence: 1 }));
		model.acceptEvent(event(2, { executionId: 'second', executionSequence: 2, action: 'type' }));
		assert.deepStrictEqual({ lateCompletion: model.acceptEvent(event(3, { executionId: 'first', executionSequence: 1, phase: 'completed', action: 'success' })), lateStart: model.acceptEvent(event(4, { executionId: 'first', executionSequence: 1, phase: 'started' })), current: model.state.currentAction?.action, status: model.state.status }, {
			lateCompletion: false, lateStart: false, current: 'type', status: 'running',
		});
	});

	test('pause and resume preserve viewport feedback, cancellation fences remaining events', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		model.acceptEvent(event(1, { point: { x: 1, y: 2 } }));
		model.pause(105);
		model.acceptEvent(event(2, { phase: 'completed' }));
		const paused = model.state.status;
		model.resume(106);
		const resumed = model.state.status;
		model.cancel(107);
		assert.deepStrictEqual({ paused, resumed, accepted: model.acceptEvent(event(3)), status: model.state.status, cancelled: model.state.cancelled, current: model.state.currentAction, cursor: model.state.cursor }, {
			paused: 'paused', resumed: 'running', accepted: false, status: 'idle', cancelled: true, current: undefined, cursor: { x: 1, y: 2 },
		});
	});

	test('invocation ordinals fence old executions in arbitrarily long sessions', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		for (let index = 0; index < 1000; index++) {
			model.acceptEvent(event(index, { executionId: `execution-${index}`, executionSequence: index }));
		}
		assert.deepStrictEqual({ oldStarted: model.acceptEvent(event(1001, { executionId: 'execution-0', executionSequence: 0 })), oldCompleted: model.acceptEvent(event(1002, { executionId: 'execution-500', executionSequence: 500, phase: 'completed', action: 'success' })), current: model.state.currentAction?.executionId, history: model.state.previousSteps.length }, {
			oldStarted: false, oldCompleted: false, current: 'execution-999', history: 40,
		});
	});

	test('closing and disposing prevent further event delivery and retain a readable snapshot', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		let changes = 0;
		store.add(model.onDidChange(() => changes++));
		model.acceptEvent(event(1));
		model.close(102);
		model.dispose();
		assert.deepStrictEqual({ accepted: model.acceptEvent(event(3)), changes, closed: model.state.closed, status: model.state.status, current: model.state.currentAction }, { accepted: false, changes: 2, closed: true, status: 'completed', current: undefined });
	});

	test('accepts runtime lifecycle state and explicit close', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		model.acceptEvent(event(1, { status: 'paused' }));
		const paused = model.state.status;
		model.acceptEvent(event(2, { action: 'success', status: 'completed', closed: true }));
		assert.deepStrictEqual({ paused, closed: model.state.closed, current: model.state.currentAction, accepted: model.acceptEvent(event(3)) }, { paused: 'paused', closed: true, current: undefined, accepted: false });
	});

	test('sensitive input removes accessible labels, descriptions, and error contents', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		model.acceptEvent(event(1, { action: 'type', description: 'secret value', error: 'secret failed', target: { x: 1, y: 2, width: 3, height: 4, label: 'secret field value', sensitive: true } }));
		assert.deepStrictEqual({ description: model.state.currentAction?.description, error: model.state.currentAction?.error, sensitive: model.state.currentAction?.sensitive, label: model.state.target?.label }, { description: undefined, error: undefined, sensitive: true, label: undefined });
	});

	test('snapshots do not retain mutable producer geometry', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		const point = { x: 10, y: 20 };
		const viewport = { width: 800, height: 600 };
		model.acceptEvent(event(1, { point, viewport }));
		const previous = model.state;
		point.x = 200;
		viewport.width = 400;
		model.acceptEvent(event(2, { point: { x: 30, y: 40 } }));
		assert.deepStrictEqual({ old: previous.cursor, current: model.state.cursor, viewport: model.state.viewport }, { old: { x: 10, y: 20 }, current: { x: 30, y: 40 }, viewport: { width: 800, height: 600 } });
	});

	test('sensitive typing also redacts an existing target and subsequent keypress feedback', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		model.acceptEvent(event(1, { action: 'focus', target: { x: 1, y: 2, width: 3, height: 4, label: 'Personal value' } }));
		model.acceptEvent(event(2, { action: 'type', sensitive: true }));
		model.acceptEvent(event(3, { action: 'keypress', description: 'Personal value' }));
		assert.deepStrictEqual({ label: model.state.target?.label, description: model.state.currentAction?.description, sensitive: model.state.currentAction?.sensitive }, { label: undefined, description: undefined, sensitive: true });
	});

	test('bounds previous steps and does not accumulate high-frequency pointer moves', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100, 3));
		for (let index = 0; index < 200; index++) {
			model.acceptEvent(event(index, { action: 'move', phase: 'updated', point: { x: index, y: 0 } }));
		}
		const movementHistory = model.state.previousSteps.length;
		for (let index = 200; index < 210; index++) {
			model.acceptEvent(event(index, { step: index }));
		}
		assert.deepStrictEqual({ movementHistory, steps: model.state.previousSteps.map(item => item.step) }, { movementHistory: 0, steps: [206, 207, 208] });
	});

	test('rejects invalid geometry before advancing the sequence and never regresses timestamps', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		assert.deepStrictEqual([
			model.acceptEvent(event(1, { viewport: { width: 0, height: 600 } })),
			model.acceptEvent(event(1, { point: { x: NaN, y: 0 } })),
			model.acceptEvent(event(1, { target: { x: 0, y: 0, width: -1, height: 1 } })),
			model.acceptEvent(event(1, { executionId: 'missing-ordinal' })),
			model.acceptEvent(event(1, { timestamp: 90 })),
			model.state.updatedAt,
		], [false, false, false, false, true, 100]);
	});

	test('navigation clears a stale target and errors can recover through a later action', () => {
		const model = store.add(new BrowserAgentSessionModel('browser', 100));
		model.acceptEvent(event(1, { target: { x: 1, y: 2, width: 3, height: 4 } }));
		model.acceptEvent(event(2, { action: 'error' }));
		const error = model.state.status;
		model.acceptEvent(event(3, { action: 'navigate', url: 'https://example.test/retry' }));
		assert.deepStrictEqual({ error, status: model.state.status, target: model.state.target, completedAt: model.state.completedAt }, { error: 'error', status: 'running', target: undefined, completedAt: undefined });
	});
});
