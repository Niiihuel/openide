/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { AgentLoopEvent } from '../../common/openideAgentTypes.js';
import { ISubagentRun } from '../../common/openideSubagentTypes.js';
import { IOpenideChatContent, OpenideChatContentKind } from '../../common/chat/openideChatContent.js';
import { createOpenideChatRequestItem, isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { applyAgentEvent, applyAgentEvents, IOpenideChatReducerStep } from '../../common/chat/openideChatReducer.js';
import { beginOpenideChatTurn, closeOpenideChatTurn, createOpenideChatReducerState, IOpenideChatReducerState, openOpenideChatReply } from '../../common/chat/openideChatReducerState.js';

/**
 * The reducer is the only thing standing between `AgentLoopEvent` and what the user sees. Before
 * it existed the translation lived inside the webview's JavaScript string, so none of this could
 * be asserted and the native transcript degraded every non-text event to a generic line.
 */
suite('OpenIDE chat reducer', () => {

	const NOW = 1_000_000;

	function armed(): IOpenideChatReducerState {
		return beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'req_1', text: 'dale' }));
	}

	function run(events: readonly AgentLoopEvent[], now = NOW): IOpenideChatReducerStep {
		return applyAgentEvents(armed(), events, { now });
	}

	function contentOf(step: IOpenideChatReducerStep): readonly IOpenideChatContent[] {
		const last = step.items[step.items.length - 1];
		return last && isOpenideChatResponseItem(last) ? last.content : [];
	}

	function kinds(step: IOpenideChatReducerStep): OpenideChatContentKind[] {
		return contentOf(step).map(content => content.kind);
	}

	const subagentRun: ISubagentRun = {
		runId: 'run_1', definitionId: 'reviewer', definitionVersion: 1, definitionName: 'Reviewer',
		parentConversationId: 'conv', parentMessageId: 'msg', depth: 1, task: 'review',
		status: 'completed', createdAt: NOW, model: 'gpt', readonly: true, background: false,
		metrics: { inputTokens: 0, outputTokens: 0, toolCalls: 0, filesRead: 0, filesModified: 0, searches: 0, errors: 0, cancellations: 0, routingAttempts: 0, fallbacks: 0 },
		timeline: [], childRunIds: [], deliveryState: 'delivered', generation: 1, attemptCount: 1,
	};

	test('text deltas accumulate into ONE markdown row', () => {
		// A row per token is the failure mode an index-less reducer produces, and it is invisible
		// until the transcript is 300 rows long.
		const step = run([{ type: 'text', delta: 'Hola' }, { type: 'text', delta: ' mundo' }]);
		assert.deepStrictEqual(kinds(step), ['markdown']);
		assert.strictEqual((contentOf(step)[0] as { value: { value: string } }).value.value, 'Hola mundo');
	});

	test('the reply version moves on every delta, or the list never repaints', () => {
		const first = applyAgentEvent(armed(), { type: 'text', delta: 'a' }, { now: NOW });
		const second = applyAgentEvent(first.state, { type: 'text', delta: 'b' }, { now: NOW });
		const before = first.items[first.items.length - 1];
		const after = second.items[second.items.length - 1];
		assert.notStrictEqual(before.dataId, after.dataId);
	});

	test('reasoning collapses into one thinking block and closes with its duration', () => {
		const step = run([
			{ type: 'reasoning', delta: 'pensando' },
			{ type: 'reasoning', delta: ' mas' },
			{ type: 'text', delta: 'listo' },
		], NOW);
		const thinking = contentOf(step)[0] as { kind: string; text: string; isComplete: boolean; durationMs?: number };
		assert.strictEqual(thinking.kind, 'thinking');
		assert.strictEqual(thinking.text, 'pensando mas');
		assert.strictEqual(thinking.isComplete, true);
		assert.strictEqual(thinking.durationMs, 0);
		assert.deepStrictEqual(kinds(step), ['thinking', 'markdown']);
	});

	test('agentLocation produces no row, only a declared follow effect', () => {
		const step = run([{ type: 'agentLocation', location: { kind: 'file', path: 'a.ts', activity: 'edit' } }]);
		assert.deepStrictEqual(kinds(step), []);
		assert.deepStrictEqual(step.sessionEffects.map(effect => effect.type), ['followLocation']);
	});

	test('a file the agent only READ never moves the editor', () => {
		// Following reads turns the editor into a slideshow of every file a run greps through.
		const step = run([{ type: 'agentLocation', location: { kind: 'file', path: 'a.ts', activity: 'read' } }]);
		assert.deepStrictEqual(kinds(step), []);
		assert.deepStrictEqual(step.sessionEffects, []);
	});

	test('every other activity still moves it, terminals and browser included', () => {
		for (const location of [
			{ kind: 'file', path: 'a.ts', activity: 'edit' },
			{ kind: 'file', path: 'a.ts', activity: 'create' },
			{ kind: 'file', path: 'a.ts', activity: 'write' },
			{ kind: 'file', path: 'a.ts', activity: 'delete' },
			{ kind: 'terminal', command: 'ls', background: false },
			{ kind: 'browser', activity: 'open' },
		] as const) {
			const step = run([{ type: 'agentLocation', location }]);
			assert.deepStrictEqual(step.sessionEffects.map(effect => effect.type), ['followLocation'], JSON.stringify(location));
		}
	});

	test('read/search/list fold into a single Exploring group with a counter', () => {
		const step = run([
			{ type: 'toolStart', id: 't1', name: 'read_file', argumentsJson: '{"path":"src/a.ts"}' },
			{ type: 'toolResult', id: 't1', name: 'read_file', result: 'l1\nl2', isError: false },
			{ type: 'toolStart', id: 't2', name: 'search_text', argumentsJson: '{"query":"foo"}' },
			{ type: 'toolResult', id: 't2', name: 'search_text', result: 'hit', isError: false },
		]);
		assert.deepStrictEqual(kinds(step), ['explore']);
		const explore = contentOf(step)[0] as { entries: readonly { target: string }[]; isComplete: boolean };
		assert.strictEqual(explore.entries.length, 2);
		assert.strictEqual(explore.isComplete, true);
		// read_file declares lineSpan, so the row is rewritten with the range that came BACK.
		assert.strictEqual(explore.entries[0].target, 'a.ts L1-2');
	});

	test('a generic tool keeps its icon-bearing identity and its result', () => {
		const step = run([
			{ type: 'toolStart', id: 't1', name: 'git_commit', argumentsJson: '{"message":"wip"}' },
			{ type: 'toolResult', id: 't1', name: 'git_commit', result: 'ok', isError: false },
		]);
		const tool = contentOf(step)[0] as { kind: string; name: string; state: string; resultText?: string };
		assert.strictEqual(tool.kind, 'tool');
		assert.strictEqual(tool.name, 'git_commit');
		assert.strictEqual(tool.state, 'success');
		assert.strictEqual(tool.resultText, 'ok');
	});

	test('a result with no start still produces a row instead of vanishing', () => {
		const step = run([{ type: 'toolResult', id: 't9', name: 'git_status', result: 'clean', isError: false }]);
		assert.deepStrictEqual(kinds(step), ['tool']);
	});

	test('run_command becomes an embedded terminal and terminalData feeds it', () => {
		const step = run([
			{ type: 'toolStart', id: 't1', name: 'run_command', argumentsJson: '{"command":"npm test"}' },
			{ type: 'terminalData', id: 't1', data: 'line one\nprogress' },
			{ type: 'terminalData', id: 't1', data: '\rdone' },
			{ type: 'toolResult', id: 't1', name: 'run_command', result: 'exit 0', isError: false },
		]);
		const terminal = contentOf(step)[0] as { kind: string; command: string; output: string; state: string };
		assert.strictEqual(terminal.kind, 'terminal');
		assert.strictEqual(terminal.command, 'npm test');
		// \r overwrites the line in progress; appending it verbatim is what turned an npm install
		// into thousands of junk lines.
		assert.strictEqual(terminal.output, 'line one\ndone');
		assert.strictEqual(terminal.state, 'exited');
	});

	test('awaiting-input keeps the terminal alive so stdin stays reachable', () => {
		const step = run([
			{ type: 'toolStart', id: 't1', name: 'run_command', argumentsJson: '{"command":"rm -i x"}' },
			{ type: 'toolResult', id: 't1', name: 'run_command', result: 'awaiting-input y/N', isError: false },
		]);
		assert.strictEqual((contentOf(step)[0] as { state: string }).state, 'awaiting-input');
	});

	test('background commands stay in the tray and never duplicate a card', () => {
		const step = run([{ type: 'toolStart', id: 't1', name: 'run_command', argumentsJson: '{"command":"npm run dev","background":true}' }]);
		assert.deepStrictEqual(kinds(step), []);
	});

	test('edit_file opens a card that fileDiff completes in place', () => {
		const step = run([
			{ type: 'toolStart', id: 't1', name: 'edit_file', argumentsJson: '{"path":"src/a.ts"}' },
			{ type: 'fileDiff', path: 'src/a.ts', added: 3, removed: 1, editAdded: 3, editRemoved: 1, diffLines: [{ t: 'add', x: 'x' }] },
		]);
		assert.deepStrictEqual(kinds(step), ['edit']);
		const edit = contentOf(step)[0] as { added: number; diff: { diffLines?: unknown[] } };
		assert.strictEqual(edit.added, 3);
		assert.strictEqual(edit.diff.diffLines?.length, 1);
	});

	test('a fileDiff without diffLines is tray-only and invents no card', () => {
		const step = run([{ type: 'fileDiff', path: 'src/a.ts', added: 1, removed: 0 }]);
		assert.deepStrictEqual(kinds(step), []);
	});

	test('editing a plan is one line, not a diff of raw markdown', () => {
		const step = run([
			{ type: 'toolStart', id: 't1', name: 'edit_file', argumentsJson: '{"path":".openide/plans/x.md"}' },
			{ type: 'fileDiff', path: '.openide/plans/x.md', added: 1, removed: 0, diffLines: [{ t: 'add', x: '- [x] a' }] },
		]);
		assert.deepStrictEqual(kinds(step), ['planUpdate']);
	});

	test('update_todos and ask_user stay silent because they own a richer surface', () => {
		const step = run([
			{ type: 'toolStart', id: 't1', name: 'update_todos', argumentsJson: '{}' },
			{ type: 'toolStart', id: 't2', name: 'ask_user', argumentsJson: '{"question":"?"}' },
		]);
		assert.deepStrictEqual(kinds(step), []);
	});

	test('usage never renders; it feeds the context panel as an effect', () => {
		const step = run([{ type: 'usage', inputTokens: 10, outputTokens: 4, contextUsed: 14, contextLimit: 100 }]);
		assert.deepStrictEqual(kinds(step), []);
		assert.strictEqual(step.sessionEffects[0].type, 'usage');
	});

	test('granting a permission leaves no trace; only denials do', () => {
		const granted = run([{ type: 'approval', name: 'run_command', decision: 'once' }]);
		assert.deepStrictEqual(kinds(granted), []);
		const denied = run([{ type: 'approval', name: 'run_command', decision: 'deny' }]);
		assert.deepStrictEqual(kinds(denied), ['decision']);
	});

	test('approvalRequest, ask and suggestMode survive as blocking cards with their id', () => {
		const step = run([
			{ type: 'approvalRequest', id: 'a1', tool: 'run_command', title: 'Run', risk: 'exec' },
			{ type: 'ask', id: 'q1', questions: [{ question: '¿cual?' }], allowFreeText: true },
			{ type: 'suggestMode', id: 's1', mode: 'plan', reason: 'complejo' },
		]);
		assert.deepStrictEqual(kinds(step), ['confirmation', 'ask', 'modeSuggestion']);
		assert.deepStrictEqual(contentOf(step).map(content => (content as { requestId?: string }).requestId), ['a1', 'q1', 's1']);
	});

	test('the ask card settles live when ask_user returns, one answer per question', () => {
		const step = run([
			{ type: 'ask', id: 'q1', questions: [{ question: '¿color?' }, { question: '¿tema?', allowMultiple: true }], allowFreeText: true },
			{ type: 'toolResult', id: 't9', name: 'ask_user', result: 'P: ¿color?\nR: Verde\n\nP: ¿tema?\nR: Oscuro, Compacto', isError: false },
		]);
		const ask = contentOf(step)[0] as { isComplete: boolean; answers?: readonly string[] };
		assert.strictEqual(ask.isComplete, true);
		assert.deepStrictEqual(ask.answers, ['Verde', 'Oscuro, Compacto']);
	});

	test('a single-question ask settles with the whole result as the answer', () => {
		const step = run([
			{ type: 'ask', id: 'q1', questions: [{ question: '¿cual?' }], allowFreeText: true },
			{ type: 'toolResult', id: 't9', name: 'ask_user', result: 'La segunda', isError: false },
		]);
		const ask = contentOf(step)[0] as { isComplete: boolean; answers?: readonly string[] };
		assert.strictEqual(ask.isComplete, true);
		assert.deepStrictEqual(ask.answers, ['La segunda']);
	});

	test('info renders as a warning notice, not as prose', () => {
		const step = run([{ type: 'info', message: 'ojo' }]);
		assert.deepStrictEqual(contentOf(step), [{ kind: 'notice', severity: 'warning', message: 'ojo' }]);
	});

	test('compaction is ONE card that changes state, and completion asks for a save', () => {
		const step = run([
			{ type: 'compaction', status: 'started', origin: 'automatic', beforeTokens: 100 },
			{ type: 'compaction', status: 'completed', origin: 'automatic', beforeTokens: 100, afterTokens: 40, savingsPercent: 60 },
		]);
		assert.deepStrictEqual(kinds(step), ['compaction']);
		assert.strictEqual((contentOf(step)[0] as { status: string }).status, 'completed');
		assert.ok(step.sessionEffects.some(effect => effect.type === 'saveConversation'));
	});

	test('retry is a single countdown row that disappears when the stream resumes', () => {
		const retrying = run([
			{ type: 'retry', kind: 'rate-limit', attempt: 1, max: 3, delayMs: 2000 },
			{ type: 'retry', kind: 'rate-limit', attempt: 2, max: 3, delayMs: 4000 },
		]);
		assert.deepStrictEqual(kinds(retrying), ['notice']);
		assert.strictEqual((contentOf(retrying)[0] as { retry?: { attempt: number } }).retry?.attempt, 2);
		const resumed = applyAgentEvent(retrying.state, { type: 'text', delta: 'sigo' }, { now: NOW });
		assert.deepStrictEqual(kinds(resumed), ['markdown']);
	});

	test('todos replace the snapshot instead of stacking one row per update', () => {
		const step = run([
			{ type: 'todos', items: [{ id: '1', title: 'a', status: 'pending' }] },
			{ type: 'todos', items: [{ id: '1', title: 'a', status: 'completed' }] },
		]);
		assert.deepStrictEqual(kinds(step), ['todos']);
		assert.strictEqual((contentOf(step)[0] as { items: readonly { status: string }[] }).items[0].status, 'completed');
	});

	test('screenshot becomes an inline image card', () => {
		const step = run([{ type: 'screenshot', id: 's1', mimeType: 'image/png', data: 'AAA' }]);
		assert.deepStrictEqual(kinds(step), ['screenshot']);
	});

	test('delegation and its specialists keep one envelope and one card each', () => {
		const step = run([
			{ type: 'delegationStart', id: 'd1', total: 2 },
			{ type: 'subagentStart', id: 's1', parentId: 'd1', index: 0, total: 2, status: 'running', title: 'A', prompt: 'p', model: 'm' },
			{ type: 'subagentStart', id: 's1', parentId: 'd1', index: 0, total: 2, status: 'running', title: 'A', prompt: 'p', model: 'm' },
			{ type: 'subagentDone', id: 's1', parentId: 'd1', index: 0, total: 2, status: 'completed' },
			{ type: 'delegationDone', id: 'd1', total: 2, status: 'completed' },
		]);
		assert.deepStrictEqual(kinds(step), ['delegation', 'subagent']);
		assert.strictEqual((contentOf(step)[0] as { status: string }).status, 'completed');
		assert.strictEqual((contentOf(step)[1] as { status: string }).status, 'completed');
	});

	test('durable subagent runs render from the run itself and accept later timeline events', () => {
		const step = run([
			{ type: 'subagentRun', run: subagentRun },
			{ type: 'subagentTimeline', runId: 'run_1', event: { sequence: 0, timestamp: NOW, type: 'result', message: 'ok' } },
		]);
		assert.deepStrictEqual(kinds(step), ['subagent']);
		assert.strictEqual((contentOf(step)[0] as { timeline: readonly unknown[] }).timeline.length, 1);
	});

	test('done completes the reply; error paints a notice and marks the failure', () => {
		const finished = run([{ type: 'text', delta: 'ok' }, { type: 'done' }]);
		const reply = finished.items[finished.items.length - 1];
		assert.strictEqual(reply.isComplete, true);
		assert.ok(finished.sessionEffects.some(effect => effect.type === 'runComplete'));

		const failed = run([{ type: 'error', message: 'sin credencial', action: 'connect' }]);
		assert.deepStrictEqual(contentOf(failed), [{ kind: 'notice', severity: 'error', message: 'sin credencial', action: 'connect' }]);
		assert.ok(failed.sessionEffects.some(effect => effect.type === 'runFailed'));
	});

	test('an incomplete turn is an invitation to continue, not a red error', () => {
		const step = run([{ type: 'error', message: 'sin ciclos', action: 'continue' }]);
		assert.strictEqual((contentOf(step)[0] as { severity: string }).severity, 'info');
		const reply = step.items[step.items.length - 1];
		assert.strictEqual(isOpenideChatResponseItem(reply) && reply.errorMessage, undefined);
	});

	test('a turn that emits nothing renderable leaves no empty assistant bubble', () => {
		const step = run([{ type: 'usage', inputTokens: 1 }]);
		assert.strictEqual(step.items.length, 1);
		assert.strictEqual(step.items[0].kind, 'request');
	});

	test('an eagerly opened reply that settles without content is withdrawn on done', () => {
		const armed = openOpenideChatReply(beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'r1', text: 'hola' })));
		const step = applyAgentEvent(armed, { type: 'done' } as AgentLoopEvent);
		assert.deepStrictEqual(step.items.map(item => item.kind), ['request']);
	});
});

suite('OpenIDE ChatReducer — eager working reply', () => {

	test('openOpenideChatReply opens an empty reply immediately, so the live transcript is never blank', () => {
		const state = openOpenideChatReply(beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'r1', text: 'hola' })));
		const last = state.items.at(-1)!;
		assert.ok(isOpenideChatResponseItem(last));
		assert.strictEqual(last.isComplete, false);
		assert.strictEqual(last.content.length, 0);
	});

	test('cancelling before the first token withdraws the empty reply', () => {
		const armed = openOpenideChatReply(beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'r1', text: 'hola' })));
		const closed = closeOpenideChatTurn(armed, { isCanceled: true });
		assert.strictEqual(closed.items.length, 1, 'only the request survives');
		assert.ok(!isOpenideChatResponseItem(closed.items[0]));
	});

	test('an error before the first token keeps the reply so the failure is visible', () => {
		const armed = openOpenideChatReply(beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'r1', text: 'hola' })));
		const closed = closeOpenideChatTurn(armed, { errorMessage: 'boom' });
		const last = closed.items.at(-1)!;
		assert.ok(isOpenideChatResponseItem(last));
		assert.strictEqual(last.errorMessage, 'boom');
	});

	test('a write queued behind another conversation says so on its card, and stops saying it', () => {
		let state = createOpenideChatReducerState();
		state = applyAgentEvent(state, { type: 'toolStart', id: 'c1', name: 'write_file', argumentsJson: JSON.stringify({ path: 'src/a.ts' }) } as AgentLoopEvent).state;
		state = applyAgentEvent(state, { type: 'toolWaiting', id: 'c1', holder: 'Migración de schema' } as AgentLoopEvent).state;
		const waiting = state.items.flatMap(item => item.kind === 'response' ? item.content : []).find(content => content.kind === 'edit');
		assert.strictEqual(waiting && waiting.kind === 'edit' ? waiting.waitingFor : undefined, 'Migración de schema');

		state = applyAgentEvent(state, { type: 'toolWaiting', id: 'c1', holder: undefined } as AgentLoopEvent).state;
		const granted = state.items.flatMap(item => item.kind === 'response' ? item.content : []).find(content => content.kind === 'edit');
		assert.strictEqual(granted && granted.kind === 'edit' ? granted.waitingFor : undefined, undefined);
	});
});
