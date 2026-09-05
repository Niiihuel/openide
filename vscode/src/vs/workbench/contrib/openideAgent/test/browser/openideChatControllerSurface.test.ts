/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { OpenideChatController } from '../../browser/chat/openideChatController.js';
import { stubOpenideChatControllerHostServices } from './openideChatControllerTestServices.js';
import { IOpenideAgentService, IPlanDraftState } from '../../browser/openideAgentService.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { AgentLoopEvent, IChatMessage } from '../../common/openideAgentTypes.js';

/**
 * The wiring between the agent's SERVICES and the native transcript.
 *
 * The reducer that turns a plan or a canvas into a row is asserted in
 * `test/common/openideChatSurface.test.ts`, on pure data. What is asserted here is the part that
 * unit-testing the reducer can never reach and that was the actual bug: the native chat listened
 * only to the run's event stream, so `onDidCreatePlan`, `onDidChangeCanvas` and
 * `onDidRequestPlanBuild` — which are reported by the plan and canvas stores on their own schedule
 * — arrived nowhere, and a plan appeared only after reloading the window.
 */
suite('OpenIDE ChatController — plan and canvas wiring', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface IHarness {
		readonly controller: OpenideChatController;
		readonly sessions: OpenideChatSessions;
		readonly createPlan: (path: string, title: string, markdown: string) => void;
		readonly changePlanDraft: (draft: IPlanDraftState) => void;
		readonly changeCanvas: (path: string, title: string, created: boolean) => void;
		readonly requestPlanBuild: (path: string, resource: URI) => void;
		/** Every `runMessages` call the controller made. */
		readonly runs: { messages: IChatMessage[]; mode: string | undefined; messageId: string | undefined }[];
		/** Resolves the run in flight, as the engine finishing would. */
		readonly finishRun: (error?: Error) => Promise<void>;
		readonly finished: URI[];
		readonly failed: URI[];
		readonly warnings: string[];
	}

	function createHarness(): IHarness {
		const onDidCreatePlan = store.add(new Emitter<{ path: string; title: string; markdown: string }>());
		const onDidChangePlanDraft = store.add(new Emitter<IPlanDraftState>());
		const onDidChangeCanvas = store.add(new Emitter<{ path: string; title: string; created: boolean }>());
		const onDidRequestPlanBuild = store.add(new Emitter<{ path: string; title: string; resource: URI; owner: string; providerId: string; model: string }>());

		const runs: IHarness['runs'] = [];
		const finished: URI[] = [];
		const failed: URI[] = [];
		const warnings: string[] = [];
		let settleRun: ((error?: Error) => void) | undefined;

		const agentService = {
			onDidChangePlanFollow: store.add(new Emitter<boolean>()).event,
			isPlanFollowEnabled: () => false,
			onDidCreatePlan: onDidCreatePlan.event,
			onDidChangePlanDraft: onDidChangePlanDraft.event,
			onDidChangeCanvas: onDidChangeCanvas.event,
			onDidRequestPlanBuild: onDidRequestPlanBuild.event,
			onDidRequestPlanBuildCancel: store.add(new Emitter<URI>()).event,
			getActiveProviderId: () => 'anthropic',
			getModel: () => 'claude',
			buildMentionContext: async () => undefined,
			isPlanBuildRunning: () => false,
			finishPlanBuild: (resource: URI) => { finished.push(resource); },
			failPlanBuild: (resource: URI) => { failed.push(resource); },
			runMessages: (messages: IChatMessage[], _onEvent: (e: AgentLoopEvent) => void, _token: unknown, options: { mode?: string; messageId?: string }) => {
				runs.push({ messages: [...messages], mode: options?.mode, messageId: options?.messageId });
				return new Promise<void>((resolve, reject) => {
					settleRun = error => error ? reject(error) : resolve();
				});
			},
		} as unknown as IOpenideAgentService;

		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IOpenideAgentService, agentService);
		instantiationService.stub(IFileService, {} as IFileService);
		instantiationService.stub(INotificationService, { warn: (m: string) => warnings.push(String(m)) } as unknown as INotificationService);
		stubOpenideChatControllerHostServices(instantiationService, store);

		const storage = store.add(new TestStorageService());
		const sessions = new OpenideChatSessions(storage);
		const controller = store.add(instantiationService.createInstance(OpenideChatController, sessions));

		return {
			controller, sessions, runs, finished, failed, warnings,
			createPlan: (path, title, markdown) => onDidCreatePlan.fire({ path, title, markdown }),
			changePlanDraft: draft => onDidChangePlanDraft.fire(draft),
			changeCanvas: (path, title, created) => onDidChangeCanvas.fire({ path, title, created }),
			requestPlanBuild: (path, resource) => onDidRequestPlanBuild.fire({ path, title: 'Plan', resource, owner: 'editor', providerId: 'anthropic', model: 'claude' }),
			finishRun: async error => {
				settleRun?.(error);
				settleRun = undefined;
				// Two microtask turns: the run promise settles, then the controller's own handler runs.
				await Promise.resolve();
				await Promise.resolve();
				await Promise.resolve();
			},
		};
	}

	const contentOf = (harness: IHarness) => {
		const last = harness.controller.items.at(-1);
		return last && isOpenideChatResponseItem(last) ? last.content : [];
	};

	const PLAN = '.openide/plans/refactor.md';

	function draft(overrides: Partial<IPlanDraftState> = {}): IPlanDraftState {
		return { resource: URI.file('/w/' + PLAN), path: PLAN, title: 'Refactor', markdown: '# Ref', done: false, ...overrides };
	}

	test('a plan draft reaches the transcript as it is being written', () => {
		const harness = createHarness();
		harness.controller.restore();
		harness.changePlanDraft(draft());
		const plan = contentOf(harness).at(-1);
		assert.strictEqual(plan?.kind, 'plan');
		assert.strictEqual((plan as { state: string }).state, 'draft');
	});

	test('the saved plan replaces the draft in place', () => {
		const harness = createHarness();
		harness.controller.restore();
		harness.changePlanDraft(draft());
		harness.createPlan(PLAN, 'Refactor', '# Refactor\n\n## Tareas\n- [ ] uno');
		const plans = contentOf(harness).filter(c => c.kind === 'plan');
		assert.strictEqual(plans.length, 1, 'promotion must reuse the row, not stack a second card');
		assert.strictEqual((plans[0] as { state: string }).state, 'final');
	});

	test('a canvas write reaches the transcript', () => {
		const harness = createHarness();
		harness.controller.restore();
		harness.changeCanvas('.openide/canvases/Home.canvas.tsx', 'Home', true);
		const canvas = contentOf(harness).at(-1);
		assert.strictEqual(canvas?.kind, 'canvas');
		assert.strictEqual((canvas as { created?: boolean }).created, true);
	});

	test('items change events fire, so the list actually repaints', () => {
		const harness = createHarness();
		harness.controller.restore();
		let fired = 0;
		store.add(harness.controller.onDidChangeItems(() => fired++));
		harness.changeCanvas('.openide/canvases/Home.canvas.tsx', 'Home', false);
		assert.ok(fired > 0);
	});

	test('a draft that closes without a plan leaves no row and no repaint', () => {
		const harness = createHarness();
		harness.controller.restore();
		let fired = 0;
		store.add(harness.controller.onDidChangeItems(() => fired++));
		harness.changePlanDraft(draft({ done: true }));
		assert.strictEqual(contentOf(harness).filter(c => c.kind === 'plan').length, 0);
		assert.strictEqual(fired, 0, 'a no-op event must not rebuild the whole tree');
	});

	test('approving a plan runs a HIDDEN turn: no user bubble, but a real run', () => {
		const harness = createHarness();
		harness.controller.restore();
		const before = harness.controller.items.length;
		harness.requestPlanBuild(PLAN, URI.file('/w/' + PLAN));

		assert.strictEqual(harness.runs.length, 1, 'the plan has to actually execute');
		assert.strictEqual(harness.runs[0].mode, 'agent');
		// One MORE item than before, and it is the eagerly-opened reply (the "Pensando…" row) —
		// never a request bubble: the instruction is not a message the user wrote.
		assert.strictEqual(harness.controller.items.length, before + 1);
		assert.ok(isOpenideChatResponseItem(harness.controller.items.at(-1)!));
		assert.strictEqual(harness.controller.isBusy, true);

		// It travels to the model even though it is not shown, and it names the plan.
		const turn = harness.runs[0].messages.at(-1)!;
		assert.strictEqual(turn.role, 'user');
		assert.strictEqual(turn.hidden, true);
		assert.ok(turn.content.includes(PLAN));
		assert.strictEqual(turn.messageId, harness.runs[0].messageId);
	});

	test('the plan editor is told when the build finishes', async () => {
		const harness = createHarness();
		harness.controller.restore();
		const resource = URI.file('/w/' + PLAN);
		harness.requestPlanBuild(PLAN, resource);
		await harness.finishRun();
		assert.deepStrictEqual(harness.finished.map(u => u.toString()), [resource.toString()]);
		assert.deepStrictEqual(harness.failed, []);
		assert.strictEqual(harness.controller.isBusy, false);
	});

	test('a failed build releases the editor\'s button instead of spinning forever', async () => {
		const harness = createHarness();
		harness.controller.restore();
		const resource = URI.file('/w/' + PLAN);
		harness.requestPlanBuild(PLAN, resource);
		await harness.finishRun(new Error('boom'));
		assert.deepStrictEqual(harness.failed.map(u => u.toString()), [resource.toString()]);
		assert.deepStrictEqual(harness.finished, []);
	});

	test('cancelling a build releases it too', () => {
		// `launchRun`'s handlers bail out on the superseded token, so abort has to settle it itself.
		const harness = createHarness();
		harness.controller.restore();
		const resource = URI.file('/w/' + PLAN);
		harness.requestPlanBuild(PLAN, resource);
		harness.controller.abort();
		assert.deepStrictEqual(harness.failed.map(u => u.toString()), [resource.toString()]);
	});

	test('a second approval while one is running is refused, not queued', () => {
		const harness = createHarness();
		harness.controller.restore();
		const first = URI.file('/w/' + PLAN);
		const second = URI.file('/w/.openide/plans/otro.md');
		harness.requestPlanBuild(PLAN, first);
		harness.requestPlanBuild('.openide/plans/otro.md', second);

		assert.strictEqual(harness.runs.length, 1, 'two runs would fight over the same working tree');
		// The refused one is failed immediately: its button is parked on that promise.
		assert.deepStrictEqual(harness.failed.map(u => u.toString()), [second.toString()]);
		assert.strictEqual(harness.warnings.length, 1, 'and the user is told why');
	});

	test('the hidden turn is persisted, so a reload does not lose the run that produced the work', () => {
		const harness = createHarness();
		harness.controller.restore();
		harness.requestPlanBuild(PLAN, URI.file('/w/' + PLAN));
		const stored = harness.sessions.messagesOf(harness.controller.activeConversationId);
		assert.strictEqual(stored.at(-1)?.hidden, true);
		assert.ok(stored.at(-1)?.content.includes(PLAN));
	});
});
