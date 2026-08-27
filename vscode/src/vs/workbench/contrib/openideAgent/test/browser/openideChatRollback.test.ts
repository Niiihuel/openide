/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { runOpenideChatRollback } from '../../browser/chat/openideChatRollbackOperation.js';
import { IChatMessage, IMessageChangeSet, IMessageRollbackResult } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';

/**
 * The reliability gate over "volver a un mensaje" (`dev/reliability-gates.json`). Rolling back is
 * the one action in the chat that both TRUNCATES history and WRITES to the workspace, so the
 * invariant has three halves: the thread is cut exactly once at the right turn, the composer comes
 * back carrying that turn's own settings and nobody else's, and a workspace that could not be put
 * back is reported instead of silently swallowed.
 *
 * `runOpenideChatRollback` is a free function over injected collaborators, which is what lets this
 * run without a workbench: the fakes below are the smallest surface it actually touches.
 */

function userMessage(messageId: string, overrides: Partial<IChatMessage> = {}): IChatMessage {
	return { role: 'user', content: `contenido de ${messageId}`, messageId, ...overrides } as IChatMessage;
}

function assistantMessage(messageId: string): IChatMessage {
	return { role: 'assistant', content: `respuesta de ${messageId}`, messageId } as IChatMessage;
}

interface IFakeSessionsCalls {
	readonly removed: { id: string; messageIds: readonly string[] }[];
	readonly cleared: string[];
	readonly saved: { id: string; count: number; hasError: boolean }[];
}

function fakeSessions(messages: IChatMessage[], changeSet?: IMessageChangeSet): { sessions: OpenideChatSessions; calls: IFakeSessionsCalls } {
	const calls: IFakeSessionsCalls = { removed: [], cleared: [], saved: [] };
	const sessions = {
		messagesOf: () => messages,
		changeSetOf: () => changeSet,
		removeChangeSets: (id: string, messageIds: readonly string[]) => { calls.removed.push({ id, messageIds }); },
		clearUsage: (id: string) => { calls.cleared.push(id); },
		save: (id: string, saved: IChatMessage[], hasError: boolean) => { calls.saved.push({ id, count: saved.length, hasError }); },
	} as unknown as OpenideChatSessions;
	return { sessions, calls };
}

function fakeAgentService(results: IMessageRollbackResult[]): { agentService: IOpenideAgentService; attempts: boolean[] } {
	const attempts: boolean[] = [];
	let index = 0;
	const agentService = {
		rollbackMessage: async (_changeSet: IMessageChangeSet, includeNonConflicting = false) => {
			attempts.push(includeNonConflicting);
			return results[Math.min(index++, results.length - 1)];
		},
	} as unknown as IOpenideAgentService;
	return { agentService, attempts };
}

const CHANGE_SET = { messageId: 'u2' } as unknown as IMessageChangeSet;

suite('OpenIDE chat rollback', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('cuts the thread once at the target turn and reports what was discarded', async () => {
		const messages = [userMessage('u1'), assistantMessage('a1'), userMessage('u2'), assistantMessage('a2')];
		const { sessions, calls } = fakeSessions(messages);
		const { agentService } = fakeAgentService([]);

		const outcome = await runOpenideChatRollback({
			sessions, agentService, conversationId: 'c1', messageId: 'u2',
			restoreComposer: false, drainRun: async () => { },
		});

		assert.strictEqual(outcome.committed, true);
		// The target turn and everything after it go; everything before stays untouched.
		assert.deepStrictEqual(messages.map(message => message.messageId), ['u1', 'a1']);
		assert.deepStrictEqual(outcome.removedMessageIds, ['u2', 'a2']);
		// Exactly once: a duplicate save makes the transcript flicker and can clobber a fresh turn.
		assert.strictEqual(calls.saved.length, 1);
		assert.deepStrictEqual(calls.saved[0], { id: 'c1', count: 2, hasError: false });
		assert.deepStrictEqual(calls.removed, [{ id: 'c1', messageIds: ['u2', 'a2'] }]);
		assert.deepStrictEqual(calls.cleared, ['c1']);
	});

	test('the composer comes back with the rolled-back turn, not a neighbour turn', async () => {
		// The previous turn ran with a DIFFERENT provider, model and mode. That is exactly the bug
		// the gate watches for: restoring the right text but inheriting the wrong turn's settings.
		const target = userMessage('u2', {
			displayText: 'lo que el usuario escribió',
			content: 'lo que el usuario escribió\n\n<context>ruido</context>',
			images: [{ mimeType: 'image/png', data: 'AAA' }],
			capabilities: [{ kind: 'skill', name: 'web' }],
			executionMode: 'plan',
			providerId: 'anthropic-oauth',
			modelId: 'claude-x',
		} as Partial<IChatMessage>);
		const messages = [
			userMessage('u1', { executionMode: 'agent', providerId: 'openai-codex', modelId: 'gpt-y' } as Partial<IChatMessage>),
			assistantMessage('a1'),
			target,
		];
		const { sessions } = fakeSessions(messages);
		const { agentService } = fakeAgentService([]);

		const outcome = await runOpenideChatRollback({
			sessions, agentService, conversationId: 'c1', messageId: 'u2',
			restoreComposer: true, drainRun: async () => { },
		});

		// `displayText`, not `content`: the composer gets what the person typed, without the context
		// the engine had appended to it.
		assert.strictEqual(outcome.composer?.text, 'lo que el usuario escribió');
		assert.strictEqual(outcome.composer?.images?.length, 1);
		assert.strictEqual(outcome.composer?.capabilities?.length, 1);
		assert.strictEqual(outcome.mode, 'plan');
		assert.strictEqual(outcome.providerId, 'anthropic-oauth');
		assert.strictEqual(outcome.modelId, 'claude-x');
	});

	test('without restoreComposer the turn is discarded, not returned', async () => {
		const messages = [userMessage('u1', { displayText: 'texto' } as Partial<IChatMessage>)];
		const { sessions } = fakeSessions(messages);
		const { agentService } = fakeAgentService([]);

		const outcome = await runOpenideChatRollback({
			sessions, agentService, conversationId: 'c1', messageId: 'u1',
			restoreComposer: false, drainRun: async () => { },
		});

		assert.strictEqual(outcome.committed, true);
		assert.strictEqual(outcome.composer, undefined);
	});

	test('a conflict is retried once, surfaced, and never blocks the truncation', async () => {
		const messages = [userMessage('u1'), userMessage('u2')];
		const { sessions, calls } = fakeSessions(messages, CHANGE_SET);
		const { agentService, attempts } = fakeAgentService([
			{ messageId: 'u2', status: 'conflict', files: [{ uri: 'file:///a.ts', status: 'conflict' }] },
			{ messageId: 'u2', status: 'partial', files: [{ uri: 'file:///a.ts', status: 'conflict' }, { uri: 'file:///b.ts', status: 'reverted' }] },
		]);

		const outcome = await runOpenideChatRollback({
			sessions, agentService, conversationId: 'c1', messageId: 'u2',
			restoreComposer: false, drainRun: async () => { },
		});

		// A second attempt forcing the non-conflicting ones: reverting what it can beats nothing.
		assert.deepStrictEqual(attempts, [false, true]);
		// Navigating history ALWAYS works, even when the workspace cannot be put back exactly.
		assert.strictEqual(outcome.committed, true);
		assert.deepStrictEqual(messages.map(message => message.messageId), ['u1']);
		assert.strictEqual(calls.saved.length, 1);
		// And the conflict is stated, naming the files left out of sync.
		assert.strictEqual(typeof outcome.warning, 'string');
		assert.strictEqual(outcome.warning?.includes('file:///a.ts'), true);
		assert.strictEqual(outcome.warning?.includes('file:///b.ts'), false, 'un archivo revertido no es un conflicto');
	});

	test('a clean revert reports no warning', async () => {
		const messages = [userMessage('u1'), userMessage('u2')];
		const { sessions } = fakeSessions(messages, CHANGE_SET);
		const { agentService, attempts } = fakeAgentService([
			{ messageId: 'u2', status: 'reverted', files: [{ uri: 'file:///a.ts', status: 'reverted' }] },
		]);

		const outcome = await runOpenideChatRollback({
			sessions, agentService, conversationId: 'c1', messageId: 'u2',
			restoreComposer: false, drainRun: async () => { },
		});

		assert.deepStrictEqual(attempts, [false], 'sin conflicto no hay segundo intento');
		assert.strictEqual(outcome.warning, undefined);
	});

	test('a message that is gone does not truncate anything', async () => {
		const messages = [userMessage('u1')];
		const { sessions, calls } = fakeSessions(messages);
		const { agentService } = fakeAgentService([]);

		const outcome = await runOpenideChatRollback({
			sessions, agentService, conversationId: 'c1', messageId: 'inexistente',
			restoreComposer: true, drainRun: async () => { },
		});

		assert.strictEqual(outcome.committed, false);
		assert.deepStrictEqual(outcome.removedMessageIds, []);
		assert.deepStrictEqual(messages.map(message => message.messageId), ['u1']);
		assert.strictEqual(calls.saved.length, 0, 'nada que guardar si nada se cortó');
	});

	test('a turn admitted before the barrier went up aborts the rollback', async () => {
		// The race the module's own comment describes: `drainRun` waits, and meanwhile a turn that
		// had already been admitted is appended ahead and shifts the index. Cutting anyway would take
		// down a message the user never asked to delete.
		const messages = [userMessage('u1'), userMessage('u2')];
		const { sessions, calls } = fakeSessions(messages);
		const { agentService } = fakeAgentService([]);

		const outcome = await runOpenideChatRollback({
			sessions, agentService, conversationId: 'c1', messageId: 'u2',
			restoreComposer: true,
			drainRun: async () => { messages.unshift(userMessage('u0')); },
		});

		assert.strictEqual(outcome.committed, false);
		assert.strictEqual(typeof outcome.warning, 'string');
		assert.deepStrictEqual(messages.map(message => message.messageId), ['u0', 'u1', 'u2'], 'no se tocó nada');
		assert.strictEqual(calls.saved.length, 0);
	});
});
