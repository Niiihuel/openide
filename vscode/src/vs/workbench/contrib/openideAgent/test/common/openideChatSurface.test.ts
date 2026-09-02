/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { applyAgentEvent } from '../../common/chat/openideChatReducer.js';
import { createOpenideChatReducerState, IOpenideChatReducerState } from '../../common/chat/openideChatReducerState.js';
import { applyOpenideChatSurfaceEvent, IOpenideChatSurfaceEvent } from '../../common/chat/openideChatSurface.js';
import { IOpenideChatCanvasContent, IOpenideChatContent, IOpenideChatPlanContent, IOpenideChatSubagentContent } from '../../common/chat/openideChatContent.js';
import { createOpenideChatRequestItem, isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { beginOpenideChatTurn } from '../../common/chat/openideChatReducerState.js';
import { ISubagentRun } from '../../common/openideSubagentTypes.js';
import { AgentLoopEvent } from '../../common/openideAgentTypes.js';

/**
 * The rows the native chat could not paint.
 *
 * Plans and canvases reach the transcript from the plan/canvas stores, not from the run's event
 * stream, and the native chat listened only to the stream. The content kinds existed all along —
 * `restorePlan` and `restoreCanvas` build them — so the symptom was a plan you could only see by
 * reloading the window, which is why these asserts are about the LIVE path specifically.
 */
suite('OpenIDE chat surface events', () => {

	const NOW = 1_000;

	function fold(events: readonly (IOpenideChatSurfaceEvent | AgentLoopEvent)[]): IOpenideChatReducerState {
		let state = createOpenideChatReducerState();
		for (const event of events) {
			state = isSurface(event)
				? applyOpenideChatSurfaceEvent(state, event, { now: NOW }).state
				: applyAgentEvent(state, event, { now: NOW }).state;
		}
		return state;
	}

	function isSurface(event: IOpenideChatSurfaceEvent | AgentLoopEvent): event is IOpenideChatSurfaceEvent {
		return event.type === 'planDraft' || event.type === 'planCard' || event.type === 'canvasCard' || event.type === 'subagentRunUpdate';
	}

	function contentOf(state: IOpenideChatReducerState): readonly IOpenideChatContent[] {
		const item = state.items.at(-1);
		return item && isOpenideChatResponseItem(item) ? item.content : [];
	}

	function plansOf(state: IOpenideChatReducerState): IOpenideChatPlanContent[] {
		return contentOf(state).filter((content): content is IOpenideChatPlanContent => content.kind === 'plan');
	}

	const PATH = '.openide/plans/refactor.md';

	test('a draft paints one skeleton card and keeps updating it', () => {
		const state = fold([
			{ type: 'planDraft', path: PATH, title: 'Refa', done: false },
			{ type: 'planDraft', path: PATH, title: 'Refactor del store', done: false },
		]);
		const plans = plansOf(state);
		assert.strictEqual(plans.length, 1, 'a growing draft is one card, not one per delta');
		assert.strictEqual(plans[0].state, 'draft');
		assert.strictEqual(plans[0].title, 'Refactor del store');
		assert.strictEqual(plans[0].planId, PATH);
		// The skeleton never shows the half-written markdown: the plan editor already does.
		assert.strictEqual(plans[0].body.value, '');
	});

	test('the finished card takes the draft\'s place instead of stacking under it', () => {
		const state = fold([
			{ type: 'planDraft', path: PATH, title: 'Refa', done: false },
			{ type: 'planCard', path: PATH, title: 'Refactor', markdown: '# Refactor\n\n## Tareas\n- [ ] uno' },
		]);
		const plans = plansOf(state);
		assert.strictEqual(plans.length, 1, 'the promotion must reuse the row, or the skeleton blinks out');
		assert.strictEqual(plans[0].state, 'final');
		assert.ok(plans[0].body.value.includes('## Tareas'));
	});

	test('a draft cut short leaves nothing behind', () => {
		// `done` is "stop waiting", not "the plan is ready": a run cancelled mid-plan ends here, and
		// promoting the skeleton would offer Build for a plan that was never written.
		const state = fold([
			{ type: 'planDraft', path: PATH, title: 'Refa', done: false },
			{ type: 'planDraft', path: PATH, title: 'Refa', done: true },
		]);
		assert.strictEqual(plansOf(state).length, 0);
	});

	test('a card with no draft before it still lands', () => {
		// plan_save can close before any draft delta was parsed.
		const state = fold([{ type: 'planCard', path: PATH, title: 'Refactor', markdown: '# Refactor' }]);
		assert.strictEqual(plansOf(state).length, 1);
		assert.strictEqual(plansOf(state)[0].state, 'final');
	});

	test('un plan de un agente EXTERNO queda marcado como tal', () => {
		// Without this flag the card offers Build, which runs OUR agent on a plan another CLI asked
		// for: two approvals for one decision, and one of them does the wrong thing.
		const externo = plansOf(fold([{ type: 'planCard', path: PATH, title: 'Refactor', markdown: '# Refactor', external: true }]));
		assert.strictEqual(externo[0].external, true);

		const propio = plansOf(fold([{ type: 'planCard', path: PATH, title: 'Refactor', markdown: '# Refactor' }]));
		assert.strictEqual(propio[0].external, false);
	});

	test('two different plans get two cards', () => {
		const other = '.openide/plans/otro.md';
		const state = fold([
			{ type: 'planCard', path: PATH, title: 'Uno', markdown: '# Uno' },
			{ type: 'planCard', path: other, title: 'Dos', markdown: '# Dos' },
		]);
		assert.deepStrictEqual(plansOf(state).map(plan => plan.planId), [PATH, other]);
	});

	test('a card closes the prose so the next delta starts a new paragraph', () => {
		const state = fold([
			{ type: 'text', delta: 'Voy a preparar un plan.' },
			{ type: 'planCard', path: PATH, title: 'Refactor', markdown: '# Refactor' },
			{ type: 'text', delta: 'Listo.' },
		]);
		const kinds = contentOf(state).map(content => content.kind);
		// Without the interruption the second delta appends to the first paragraph and the card ends
		// up printed after text that was written before it.
		assert.deepStrictEqual(kinds, ['markdown', 'plan', 'markdown']);
	});

	test('a canvas card says whether it created the file', () => {
		const state = fold([
			{ type: 'canvasCard', path: '.openide/canvases/Home.canvas.tsx', title: 'Home', created: true },
		]);
		const canvas = contentOf(state).at(-1) as IOpenideChatCanvasContent;
		assert.strictEqual(canvas.kind, 'canvas');
		assert.strictEqual(canvas.created, true);
		assert.strictEqual(canvas.resource, '.openide/canvases/Home.canvas.tsx');
		// Keyed by path so the identity survives a reload, where there is no live call id to reuse.
		assert.strictEqual(canvas.canvasId, '.openide/canvases/Home.canvas.tsx');
	});

	test('writing the same canvas twice is two rows', () => {
		const path = '.openide/canvases/Home.canvas.tsx';
		const state = fold([
			{ type: 'canvasCard', path, title: 'Home', created: true },
			{ type: 'canvasCard', path, title: 'Home', created: false },
		]);
		const canvases = contentOf(state).filter(content => content.kind === 'canvas');
		assert.strictEqual(canvases.length, 2, 'two writes are two things that happened');
	});

	test('a surface event with no run open still gets a reply to live in', () => {
		// The canvas editor saving outside a turn: the row has to appear somewhere.
		const state = fold([{ type: 'canvasCard', path: '.openide/canvases/A.canvas.tsx', title: 'A', created: false }]);
		assert.strictEqual(state.items.length, 1);
		assert.strictEqual(contentOf(state).length, 1);
	});

	/**
	 * A delegated specialist reports its run to the loop ONCE. For a background run that report is
	 * the clone `delegate()` returns before routing has run, so the card is born holding the
	 * definition's literal `'default'` — everything real about the run lands afterwards, on the run
	 * service's own emitter, which is not the loop.
	 */
	suite('a specialist run that keeps moving after it was reported', () => {

		const RUN: ISubagentRun = {
			runId: 'run_1', definitionId: 'explore', definitionVersion: 1, definitionName: 'explore',
			parentConversationId: 'hook-uuid', parentMessageId: 'msg', depth: 1, task: 'buscar',
			status: 'queued', createdAt: NOW, model: 'default', readonly: true, background: true,
			metrics: { inputTokens: 0, outputTokens: 0, toolCalls: 0, filesRead: 0, filesModified: 0, searches: 0, errors: 0, cancellations: 0, routingAttempts: 0, fallbacks: 0 },
			timeline: [], childRunIds: [], deliveryState: 'pending', generation: 1, attemptCount: 1,
		};

		function armed(): IOpenideChatReducerState {
			return beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'req_1', text: 'dale', modelId: 'gpt-5.6-luna' }));
		}

		function cardOf(state: IOpenideChatReducerState): IOpenideChatSubagentContent | undefined {
			const last = state.items[state.items.length - 1];
			const content = last && isOpenideChatResponseItem(last) ? last.content : [];
			return content.find((row): row is IOpenideChatSubagentContent => row.kind === 'subagent');
		}

		test('the routed model replaces the placeholder the card was born with', () => {
			let state = applyAgentEvent(armed(), { type: 'subagentRun', run: RUN }, { now: NOW }).state;
			assert.strictEqual(cardOf(state)?.model, 'default');
			const routed: ISubagentRun = { ...RUN, status: 'running', model: 'grok-4.6', providerId: 'xai' };
			state = applyOpenideChatSurfaceEvent(state, { type: 'subagentRunUpdate', run: routed }, { now: NOW }).state;
			assert.strictEqual(cardOf(state)?.model, 'grok-4.6');
			assert.strictEqual(cardOf(state)?.status, 'running');
		});

		test('the card records the model of the turn that delegated it', () => {
			// Without the parent's model the row cannot decide whether naming the specialist's model
			// says anything: repeating the model you are already running is noise.
			const state = applyAgentEvent(armed(), { type: 'subagentRun', run: RUN }, { now: NOW }).state;
			assert.strictEqual(cardOf(state)?.parentModel, 'gpt-5.6-luna');
		});

		test('updating twice with the same run leaves one card, not two', () => {
			let state = applyAgentEvent(armed(), { type: 'subagentRun', run: RUN }, { now: NOW }).state;
			const routed: ISubagentRun = { ...RUN, status: 'running', model: 'grok-4.6' };
			state = applyOpenideChatSurfaceEvent(state, { type: 'subagentRunUpdate', run: routed }, { now: NOW }).state;
			state = applyOpenideChatSurfaceEvent(state, { type: 'subagentRunUpdate', run: routed }, { now: NOW }).state;
			const last = state.items[state.items.length - 1];
			const content = last && isOpenideChatResponseItem(last) ? last.content : [];
			assert.strictEqual(content.filter(row => row.kind === 'subagent').length, 1);
		});

		test('an update for a run with no card on screen is dropped, never appended', () => {
			// THE invariant. `draft.subagents` is a per-turn cursor, so a background run finishing
			// three turns later finds nothing — and pushing there would append a second card of a
			// specialist nobody delegated into that reply. The result still reaches the user through
			// the controller's terminal delivery, which is the path that survives a turn.
			const state = armed();
			const step = applyOpenideChatSurfaceEvent(state, { type: 'subagentRunUpdate', run: { ...RUN, status: 'completed' } }, { now: NOW });
			assert.strictEqual(step.items, state.items);
			assert.strictEqual(cardOf(step.state), undefined);
		});

		test('an empty timeline never wipes the one the card already accumulated', () => {
			// The nested-frame path builds synthetic events numbered off `timeline.length`; letting a
			// run snapshot with no timeline overwrite them would renumber the next one onto a hole.
			let state = applyAgentEvent(armed(), { type: 'subagentRun', run: { ...RUN, timeline: [{ sequence: 0, timestamp: NOW, type: 'toolStart', toolName: 'read_file' }] } }, { now: NOW }).state;
			assert.strictEqual(cardOf(state)?.timeline.length, 1);
			state = applyOpenideChatSurfaceEvent(state, { type: 'subagentRunUpdate', run: { ...RUN, timeline: [] } }, { now: NOW }).state;
			assert.strictEqual(cardOf(state)?.timeline.length, 1);
		});
	});

	test('a no-op event does not move the items', () => {
		// `done` arrives for plans that never opened a card, and the controller repaints on the
		// ITEMS changing — not on the state object, which `commitOpenideChatDraft` rebuilds on every
		// call to carry the cursor. Asserting on the state here would pass while the list still
		// rebuilt its whole tree per event.
		const state = createOpenideChatReducerState();
		const step = applyOpenideChatSurfaceEvent(state, { type: 'planDraft', path: PATH, title: '', done: true }, { now: NOW });
		assert.strictEqual(step.items, state.items);
		assert.strictEqual(step.state.items.length, 0);
	});
});
