/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { OpenideChatSessionEffects } from '../../browser/chat/openideChatSessionEffects.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { conversationSubagents } from '../../browser/openideSubagentPresentation.js';
import { createOpenideChatRequestItem } from '../../common/chat/openideChatItem.js';
import { applyAgentEvent } from '../../common/chat/openideChatReducer.js';
import { beginOpenideChatTurn, createOpenideChatReducerState } from '../../common/chat/openideChatReducerState.js';
import { AgentLoopEvent } from '../../common/openideAgentTypes.js';
import { ISubagentRun } from '../../common/openideSubagentTypes.js';

suite('OpenIDE subagent presentation', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const storage = disposables.add(new TestStorageService());
		const sessions = new OpenideChatSessions(storage);
		const parent = sessions.createBackground('Parent', []);
		const effects = disposables.add(new OpenideChatSessionEffects(sessions, { onDidChangePlanFollow: Event.None } as IOpenideAgentService));
		let state = beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'request', text: 'Review' }));
		const emit = (event: AgentLoopEvent) => {
			const step = applyAgentEvent(state, event); state = step.state;
			effects.apply({ conversationId: parent, messages: [] }, step.sessionEffects);
		};
		const start = { type: 'subagentStart', id: 'review', parentId: 'call', index: 0, total: 1, status: 'running', title: 'Reviewer 1/1', prompt: 'Review current changes', model: 'fixture' } as const;
		return { storage, sessions, parent, emit, start };
	}

	test('Reviewer events create a visible run, persist its result and keep it beside older runs', () => {
		const { storage, sessions, parent, emit, start } = fixture();
		sessions.createBackground('Old specialist', [{ role: 'assistant', content: 'Old result' }], 'old', parent);
		emit(start); emit(start);
		assert.strictEqual(conversationSubagents(sessions, parent, []).length, 2, 'replayed start does not duplicate the mirror');
		assert.strictEqual(conversationSubagents(sessions, parent, []).find(run => run.runId === 'review')?.status, 'running');
		emit({ type: 'subagentEvent', id: 'review', parentId: 'call', index: 0, total: 1, status: 'running', ev: { type: 'text', delta: 'Current review: ' } });
		emit({ type: 'subagentEvent', id: 'review', parentId: 'call', index: 0, total: 1, status: 'running', ev: { type: 'text', delta: 'VERDICT: PASS' } });
		emit({ type: 'subagentDone', id: 'review', parentId: 'call', index: 0, total: 1, status: 'completed' });
		const restored = new OpenideChatSessions(storage);
		const run = conversationSubagents(restored, parent, []).find(run => run.runId === 'review')!;
		assert.strictEqual(run.status, 'completed');
		assert.ok(run.startedAt && run.completedAt && run.completedAt >= run.startedAt);
		assert.strictEqual(restored.messagesOf(restored.sessionOfSubagentRun('review')).at(-1)?.content, 'Current review: VERDICT: PASS');
		assert.deepStrictEqual(conversationSubagents(restored, 'another-chat', []), []);
	});

	test('durable runs take precedence over their mirror and interrupted runs do not remain working after restart', () => {
		const { storage, sessions, parent, emit, start } = fixture();
		emit(start);
		const durable = { runId: 'review', status: 'failed', task: 'Authoritative durable run', createdAt: 1 } as ISubagentRun;
		assert.deepStrictEqual(conversationSubagents(sessions, parent, [durable]), [durable]);
		assert.strictEqual(conversationSubagents(new OpenideChatSessions(storage), parent, [])[0].status, 'interrupted');
	});

	test('explicit failure and cancellation status are persisted without legacy flags', () => {
		for (const status of ['failed', 'cancelled'] as const) {
			const { sessions, parent, emit, start } = fixture();
			emit(start);
			emit({ type: 'subagentDone', id: 'review', parentId: 'call', index: 0, total: 1, status });
			assert.strictEqual(conversationSubagents(sessions, parent, [])[0].status, status);
			assert.strictEqual(sessions.metaOf(sessions.sessionOfSubagentRun('review'))?.hasError, status === 'failed');
		}
	});
});
