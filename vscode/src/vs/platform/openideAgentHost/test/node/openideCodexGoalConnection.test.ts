/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IOpenideCodexGoalEvent } from '../../common/openideCodexGoal.js';
import { OpenideCodexGoalConnection } from '../../node/openideCodexGoalConnection.js';

suite('OpenIDE structured Codex goal ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(delayed = false, nativeGoal = false) {
		const calls: string[] = [], replies: { id: string | number; result: unknown }[] = [], denied: (string | number)[] = [], events: IOpenideCodexGoalEvent[] = [];
		const deferred = new Map<string, Promise<unknown>>();
		let resolveStart!: (value: { turn: { id: string } }) => void;
		const started = new Promise<{ turn: { id: string } }>(resolve => { resolveStart = resolve; });
		const connection = store.add(new OpenideCodexGoalConnection('session', 'thread', {
			request: async method => {
				calls.push(method);
				if (deferred.has(method)) { return deferred.get(method); }
				if (method === 'thread/goal/get') { return { goal: nativeGoal ? { status: 'active' } : null }; }
				if (method === 'thread/backgroundTerminals/list') { return { data: [], nextCursor: null }; }
				if (method === 'thread/read') { return { thread: { status: { type: 'idle' } } }; }
				if (method === 'turn/start') { return delayed ? started : { turn: { id: 'owned' } }; }
				return {};
			}, respond: (id, result) => { replies.push({ id, result }); }, deny: id => { denied.push(id); },
		}));
		store.add(connection.onDidChange(event => events.push(event)));
		return { connection, calls, replies, denied, events, resolveStart, deferred };
	}
	const tick = () => new Promise(resolve => setTimeout(resolve, 0));

	test('only the acknowledged thread and turn can finish; early notifications are correlated after acknowledgement', async () => {
		const f = fixture(true); const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ method: 'turn/completed', params: { threadId: 'foreign', turn: { id: 'owned', status: 'completed' } } });
		f.connection.accept({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'owned', delta: 'verified report' } });
		f.connection.accept({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'owned', status: 'completed' } } });
		f.resolveStart({ turn: { id: 'owned' } });
		assert.deepStrictEqual(await result, { report: 'verified report' });
	});

	test('a manual terminal turn stops automatic work without interrupting the manual turn', async () => {
		const f = fixture(); const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'manual' } } });
		assert.strictEqual((await result).stop, true);
		assert.deepStrictEqual(f.calls, ['thread/goal/get', 'thread/read', 'turn/start', 'turn/interrupt']);
		assert.strictEqual(f.events[0].kind, 'manualTurn');
		await assert.rejects(f.connection.start('other', 'goal'), /controlled/);
	});

	test('cancellation before the start acknowledgement interrupts only the acknowledged turn', async () => {
		const f = fixture(true); const result = f.connection.start('run', 'goal'); await tick();
		await f.connection.interrupt('foreign-run');
		await f.connection.interrupt('run');
		f.resolveStart({ turn: { id: 'owned' } });
		assert.strictEqual((await result).stop, true);
		assert.strictEqual(f.calls.filter(call => call === 'turn/interrupt').length, 1);
	});

	test('disconnect never fabricates a completed turn', async () => {
		const f = fixture(); const result = f.connection.start('run', 'goal'); await tick(); f.connection.disconnect();
		assert.deepStrictEqual(await result, { report: '', error: 'Codex connection closed; no turn completion was confirmed.', stop: true });
	});

	test('approval is explicit, scoped to the owned turn, and cannot be replayed', async () => {
		const f = fixture(); const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'manual', command: 'foreign' } });
		f.connection.accept({ id: 2, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'owned', command: 'echo fixture', cwd: '/fixture', availableDecisions: ['accept', 'decline'] } });
		assert.strictEqual(f.replies.length, 0);
		const approval = f.events.find(event => event.kind === 'approval'); assert.ok(approval?.kind === 'approval');
		f.connection.respond(approval.approvalId, true);
		assert.throws(() => f.connection.respond(approval.approvalId, true), /no longer active/);
		assert.deepStrictEqual(f.replies, [{ id: 2, result: { decision: 'accept' } }]);
		await f.connection.interrupt('run'); await result;
	});

	test('unsupported permission escalation stops and cannot silently grant access', async () => {
		const f = fixture(); const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ id: 3, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', turnId: 'owned', command: 'fixture', additionalPermissions: { fileSystem: { write: ['/'] } } } });
		assert.strictEqual((await result).stop, true);
		assert.deepStrictEqual({ denied: f.denied, replies: f.replies }, { denied: [3], replies: [] });
	});

	test('a Codex-native goal prevents a second continuation controller', async () => {
		const f = fixture(false, true);
		assert.match((await f.connection.start('run', 'goal')).error ?? '', /Codex-native goal/);
		assert.deepStrictEqual(f.calls, ['thread/goal/get']);
	});
	test('cancellation during read-only preflight cannot start a turn later', async () => {
		const f = fixture(); let resolveRead!: (value: unknown) => void;
		f.deferred.set('thread/read', new Promise(resolve => { resolveRead = resolve; }));
		const result = f.connection.start('run', 'goal'); await tick();
		await f.connection.interrupt('run');
		resolveRead({ thread: { status: { type: 'idle' } } });
		assert.strictEqual((await result).stop, true);
		assert.ok(!f.calls.includes('turn/start'));
	});

	test('provider goal activation during preflight prevents the OpenIDE turn', async () => {
		const f = fixture(); let resolveRead!: (value: unknown) => void;
		f.deferred.set('thread/read', new Promise(resolve => { resolveRead = resolve; }));
		const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ method: 'thread/goal/updated', params: { threadId: 'thread', goal: { status: 'active' } } });
		resolveRead({ thread: { status: { type: 'idle' } } });
		assert.strictEqual((await result).stop, true);
		assert.ok(!f.calls.includes('turn/start'));
	});

	test('cancellation during background verification wins over a late successful list', async () => {
		const f = fixture(); let resolveList!: (value: unknown) => void, resolveInterrupt!: (value: unknown) => void;
		f.deferred.set('thread/backgroundTerminals/list', new Promise(resolve => { resolveList = resolve; }));
		f.deferred.set('turn/interrupt', new Promise(resolve => { resolveInterrupt = resolve; }));
		const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'owned', status: 'completed' } } });
		await tick(); const interrupted = f.connection.interrupt('run'); resolveList({ data: [], nextCursor: null });
		assert.strictEqual((await result).stop, true);
		resolveInterrupt({}); await interrupted;
	});

	test('a completed turn with an unconfirmed command cannot finish the goal', async () => {
		const f = fixture(); const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ method: 'item/completed', params: { threadId: 'thread', turnId: 'owned', item: { type: 'commandExecution', id: 'command', status: 'completed', exitCode: null } } });
		f.connection.accept({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'owned', status: 'completed' } } });
		assert.match((await result).error ?? '', /unconfirmed command/);
	});

	test('file approval requires the actual bounded file diff', async () => {
		const f = fixture(); const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ method: 'item/started', params: { threadId: 'thread', turnId: 'owned', item: { type: 'fileChange', id: 'file', changes: [{ path: 'src/a.ts', diff: '-old\n+new' }] } } });
		f.connection.accept({ id: 4, method: 'item/fileChange/requestApproval', params: { threadId: 'thread', turnId: 'owned', itemId: 'file' } });
		const approval = f.events.find(event => event.kind === 'approval'); assert.ok(approval?.kind === 'approval');
		assert.match(approval.detail, /src\/a.ts\n-old\n\+new/);
		f.connection.respond(approval.approvalId, false);
		await f.connection.interrupt('run'); await result;
	});

	test('a manual turn during the final background check is never interrupted', async () => {
		const f = fixture(); let resolveBackground!: (value: unknown) => void;
		f.deferred.set('thread/backgroundTerminals/list', new Promise(resolve => { resolveBackground = resolve; }));
		const result = f.connection.start('run', 'goal'); await tick();
		f.connection.accept({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'owned', status: 'completed' } } });
		f.connection.accept({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'manual' } } });
		assert.strictEqual((await result).stop, true);
		assert.ok(!f.calls.includes('turn/interrupt'));
		assert.strictEqual(f.connection.isConnected, true);
		resolveBackground({ data: [], nextCursor: null });
	});

});
