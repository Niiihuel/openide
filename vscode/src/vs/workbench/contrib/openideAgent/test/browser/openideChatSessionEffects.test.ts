/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { OpenideChatSessionEffects } from '../../browser/chat/openideChatSessionEffects.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { ISubagentRun } from '../../common/openideSubagentTypes.js';

suite('OpenIDE subagent mirror persistence', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const sessions = new OpenideChatSessions(store.add(new InMemoryStorageService()));
		const effects = store.add(new OpenideChatSessionEffects(sessions, upcastPartial<IOpenideAgentService>({ onDidChangePlanFollow: Event.None })));
		return { sessions, effects };
	}
	test('keeps reasoning separate from prose and flushes batched deltas on completion', () => {
		const { sessions, effects } = fixture();
		const target = { conversationId: 'parent', messages: [] };
		effects.apply(target, [{ type: 'subagentSessionStart', runId: 'run', title: 'Build', prompt: 'Build chat', inLoop: true }]);
		for (const message of [{ role: 'assistant' as const, content: '', reasoning: 'Check ' }, { role: 'assistant' as const, content: '', reasoning: 'styles' }, { role: 'assistant' as const, content: 'Done' }]) {
			effects.apply(target, [{ type: 'subagentSessionMessage', runId: 'run', message, mergeText: true }, { type: 'subagentSessionSave', runId: 'run', isError: false }]);
		}
		effects.apply(target, [{ type: 'subagentSessionEnd', runId: 'run', isError: false, cancelled: false }]);
		const id = effects.mirrorSessionOf('run')!;
		assert.deepStrictEqual(sessions.messagesOf(id).map(message => [message.content, message.reasoning]), [['Build chat', undefined], ['', 'Check styles'], ['Done', undefined]]);
		assert.strictEqual(sessions.metaOf(id)?.subagentStatus, 'completed');
	});
	test('durable snapshots update the same mirror even when a streamed block keeps its sequence', () => {
		const { sessions, effects } = fixture();
		const run = upcastPartial<ISubagentRun>({ runId: 'run', definitionName: 'Build', task: 'Build chat', parentConversationId: 'parent', status: 'running', timeline: [{ type: 'reasoning', sequence: 1, timestamp: 1, message: 'First' }] });
		effects.syncSubagentRun(run);
		const id = effects.mirrorSessionOf('run')!;
		effects.syncSubagentRun({ ...run, status: 'completed', timeline: [{ ...run.timeline[0], message: 'Final' }], result: { summary: 'Done' } });
		assert.strictEqual(effects.mirrorSessionOf('run'), id);
		assert.deepStrictEqual(sessions.messagesOf(id).map(message => message.reasoning || message.content), ['Build chat', 'Final', 'Done']);
		assert.strictEqual(sessions.metaOf(id)?.subagentStatus, 'completed');
	});
});
