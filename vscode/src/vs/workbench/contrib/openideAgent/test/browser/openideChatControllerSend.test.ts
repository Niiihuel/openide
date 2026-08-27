/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { OpenideChatController } from '../../browser/chat/openideChatController.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { AgentLoopEvent, IChatMessage } from '../../common/openideAgentTypes.js';
import { stubOpenideChatControllerHostServices } from './openideChatControllerTestServices.js';

/**
 * The send path of the native controller — everything the webview host's `prepareAndSend` did
 * before `runMessages` and that the native chat was skipping: `/command` expansion, the user-prompt
 * hooks, file references, `/compact`, the learning signal, and the run's lifecycle events.
 */
suite('OpenIDE ChatController — send path', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IRun { messages: IChatMessage[]; options: { mode?: string; messageId?: string; modeInstruction?: string }; emit: (event: AgentLoopEvent) => void; settle: (error?: Error) => void }

	function createHarness(overrides: Partial<IOpenideAgentService> = {}) {
		const runs: IRun[] = [];
		const compactions: IChatMessage[][] = [];
		const hooks: string[] = [];
		const references: string[][] = [];
		const agentService = {
			onDidCreatePlan: store.add(new Emitter()).event,
			onDidChangePlanDraft: store.add(new Emitter()).event,
			onDidChangeCanvas: store.add(new Emitter()).event,
			onDidRequestPlanBuild: store.add(new Emitter()).event,
			onDidRequestPlanBuildCancel: store.add(new Emitter()).event,
			getActiveProviderId: () => 'anthropic',
			getModel: () => 'claude',
			buildMentionContext: async () => undefined,
			buildFileReferenceContext: async (paths: string[]) => { references.push(paths); return `REF:${paths.join(',')}`; },
			buildComposerCapabilityContext: async (kind: string, name: string) => `CAP:${kind}/${name}`,
			hookUserPromptSubmit: async (text: string) => { hooks.push(text); return 'HOOK'; },
			finishPlanBuild: () => { },
			failPlanBuild: () => { },
			runMessages: (messages: IChatMessage[], onEvent: (e: AgentLoopEvent) => void, _token: unknown, options: IRun['options']) => {
				return new Promise<void>((resolve, reject) => {
					runs.push({ messages, options, emit: onEvent, settle: error => error ? reject(error) : resolve() });
				});
			},
			compactConversation: (messages: IChatMessage[], onEvent: (e: AgentLoopEvent) => void) => {
				compactions.push(messages);
				onEvent({ type: 'compaction', status: 'completed', beforeTokens: 100, afterTokens: 10, reason: 'manual' } as unknown as AgentLoopEvent);
				onEvent({ type: 'done' } as AgentLoopEvent);
				return Promise.resolve();
			},
			...overrides,
		} as unknown as IOpenideAgentService;

		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IOpenideAgentService, agentService);
		// No commands directory: `scan` swallows the failure and reports none, so only the native
		// workflow commands resolve.
		instantiationService.stub(IFileService, {
			onDidFilesChange: store.add(new Emitter()).event,
			stat: async () => { throw new Error('ENOENT'); },
			resolve: async () => { throw new Error('ENOENT'); },
			createFolder: async () => { throw new Error('read-only'); },
		} as unknown as IFileService);
		instantiationService.stub(INotificationService, { warn: () => { } } as unknown as INotificationService);
		const host = stubOpenideChatControllerHostServices(instantiationService, store);
		const sessions = new OpenideChatSessions(store.add(new TestStorageService()));
		const controller = store.add(instantiationService.createInstance(OpenideChatController, sessions));
		const notices: string[] = [];
		store.add(controller.onDidPublishNotice(n => notices.push(n.message)));
		const finished: boolean[] = [];
		store.add(controller.onDidFinishRun(e => finished.push(e.hadError)));
		return { controller, sessions, runs, compactions, hooks, references, notices, finished, host };
	}

	const settle = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); } };

	test('a native /command expands for the model and keeps what was typed for the transcript', async () => {
		const h = createHarness();
		h.controller.restore();
		assert.strictEqual(await h.controller.send({ text: '/plan migrar el login' }), true);
		assert.strictEqual(h.runs.length, 1);
		const turn = h.runs[0].messages.at(-1)!;
		assert.strictEqual(h.runs[0].options.mode, 'plan');
		assert.strictEqual(turn.displayText, '/plan migrar el login');
		assert.ok(turn.content.startsWith('Prepará un plan completo'));
		assert.ok(turn.content.endsWith('migrar el login'));
	});

	test('an unknown /command is rejected without spending a turn', async () => {
		const h = createHarness();
		h.controller.restore();
		assert.strictEqual(await h.controller.send({ text: '/nope algo' }), false);
		assert.strictEqual(h.runs.length, 0);
		assert.ok(h.notices[0]?.startsWith('Comando desconocido: /nope'));
	});

	test('hooks, references and capabilities travel in the turn context, never in the text', async () => {
		const h = createHarness();
		h.controller.restore();
		await h.controller.send({ text: 'hola', references: ['src/a.ts'], capabilities: [{ kind: 'skill', name: 'review' }] });
		const turn = h.runs[0].messages.at(-1)!;
		assert.strictEqual(turn.content, 'hola');
		assert.deepStrictEqual(h.hooks, ['hola']);
		assert.deepStrictEqual(h.references, [['src/a.ts']]);
		assert.ok(turn.context?.includes('REF:src/a.ts'));
		assert.ok(turn.context?.includes('CAP:skill/review'));
		assert.ok(turn.context?.includes('HOOK'));
		assert.deepStrictEqual(turn.capabilities, [{ kind: 'skill', name: 'review' }]);
	});

	test('bare /compact compacts without a user turn; /compact <msg> compacts then sends', async () => {
		const h = createHarness();
		h.controller.restore();
		assert.strictEqual(await h.controller.send({ text: '/compact' }), true);
		await settle();
		assert.strictEqual(h.compactions.length, 1);
		assert.strictEqual(h.runs.length, 0);
		assert.strictEqual(h.controller.isBusy, false);
		assert.strictEqual(await h.controller.send({ text: '/compact y ahora seguí' }), true);
		await settle();
		assert.strictEqual(h.compactions.length, 2);
		assert.strictEqual(h.runs.length, 1);
		assert.strictEqual(h.runs[0].messages.at(-1)!.content, 'y ahora seguí');
	});

	test('the run reports "finished" exactly once even though done and the promise both settle', async () => {
		const h = createHarness();
		h.controller.restore();
		await h.controller.send({ text: 'hola' });
		h.runs[0].emit({ type: 'done' } as AgentLoopEvent);
		h.runs[0].settle();
		await settle();
		assert.deepStrictEqual(h.finished, [false]);
		assert.strictEqual(h.controller.isBusy, false);
	});

	test('a failed run reports hadError and a manual abort reports nothing', async () => {
		const h = createHarness();
		h.controller.restore();
		await h.controller.send({ text: 'hola' });
		h.runs[0].settle(new Error('boom'));
		await settle();
		assert.deepStrictEqual(h.finished, [true]);
		await h.controller.send({ text: 'otra' });
		h.controller.abort();
		await settle();
		assert.deepStrictEqual(h.finished, [true]);
	});

	test('a mode handoff keeps the run busy until the suggestion is accepted, then re-runs in the new mode', async () => {
		const h = createHarness();
		h.controller.restore();
		await h.controller.send({ text: 'arreglá el bug' });
		const run = h.runs[0];
		// What the triage loop leaves behind before ending with mode-switch.
		run.messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'suggest_mode', argumentsJson: '{}' }] } as unknown as IChatMessage);
		run.messages.push({ role: 'tool', content: 'accepted', toolCallId: 't1' } as unknown as IChatMessage);
		run.emit({ type: 'done', reason: 'mode-switch' } as unknown as AgentLoopEvent);
		run.settle();
		await settle();
		assert.strictEqual(h.controller.isBusy, true, 'busy survives the handoff');
		assert.deepStrictEqual(h.finished, []);
		h.controller.resumeInMode('debug', 'reproducí primero');
		assert.strictEqual(h.runs.length, 2);
		assert.strictEqual(h.runs[1].options.mode, 'debug');
		assert.strictEqual(h.runs[1].options.modeInstruction, 'reproducí primero');
		assert.strictEqual(h.runs[1].messages.at(-1)!.role, 'user');
		h.runs[1].emit({ type: 'done' } as AgentLoopEvent);
		h.runs[1].settle();
		await settle();
		assert.deepStrictEqual(h.finished, [false]);
	});

	test('sending again credits the previous turn as survived', async () => {
		const h = createHarness();
		h.controller.restore();
		await h.controller.send({ text: 'uno' });
		const first = h.runs[0].messages.at(-1)!.messageId!;
		h.host.contextIds.add(first);
		h.runs[0].emit({ type: 'done' } as AgentLoopEvent);
		h.runs[0].settle();
		await settle();
		await h.controller.send({ text: 'dos' });
		assert.deepStrictEqual(h.host.learning, [{ ids: [first], signal: 'survived' }]);
	});

	test('a delivered subagent run lands in its parent conversation once', () => {
		const h = createHarness();
		h.controller.restore();
		const id = h.sessions.ensureActive();
		const run = { runId: 'r1', parentConversationId: id, status: 'completed', deliveryState: 'pending', result: { summary: 'listo' } };
		h.host.fireRun({ type: 'completed', run });
		h.host.fireRun({ type: 'completed', run });
		const delivered = h.sessions.messagesOf(id).filter(m => m.subagentRunId === 'r1');
		assert.strictEqual(delivered.length, 1);
		assert.strictEqual(delivered[0].content, 'listo');
		assert.deepStrictEqual(h.host.delivered, ['r1', 'r1']);
	});
});
