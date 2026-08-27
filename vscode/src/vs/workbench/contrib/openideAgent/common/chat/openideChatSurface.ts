/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideChatCanvasContent, IOpenideChatContent, IOpenideChatPlanContent } from './openideChatContent.js';
import { IOpenideChatReducerStep } from './openideChatReducer.js';
import {
	closeOpenideChatMarkdown, commitOpenideChatDraft, createOpenideChatDraft, finalizeOpenideChatExplore,
	finalizeOpenideChatThinking, IOpenideChatDraft, IOpenideChatReducerState, OPENIDE_CHAT_NO_INDEX,
	pushOpenideChatContent, removeOpenideChatContentAt, setOpenideChatContentAt,
} from './openideChatReducerState.js';

/**
 * Transcript rows that do NOT come from the run's event stream.
 *
 * `AgentLoopEvent` is everything the engine reports while answering. These three are reported by
 * services the engine merely triggers — the plan store and the canvas store — and they reach the
 * chat through their own emitters (`onDidCreatePlan`, `onDidChangePlanDraft`, `onDidChangeCanvas`)
 * because their timing is not the run's: a plan draft streams while `plan_save`'s arguments are
 * still being parsed, and a canvas can be written by a command with no run at all.
 *
 * The webview host translated them into `postMessage`s (openideChatView.ts:662-670) and the webview
 * painted them with DOM helpers of its own. That is why the native chat showed a bare `plan_save`
 * tool row where the webview showed a reviewable plan: the rows were never missing from the content
 * model — `restorePlan` and `restoreCanvas` build exactly these kinds — they were only missing from
 * the LIVE path, so a plan you had to reload the window to see.
 *
 * Kept pure and out of `openideChatReducer.ts` on purpose: that file's contract is "one
 * `AgentLoopEvent` in, one step out", and widening it to a union of two unrelated event families
 * would make every caller pattern-match on which kind it holds.
 */
export type IOpenideChatSurfaceEvent =
	/** The plan being written. `done` closes the skeleton without leaving anything behind. */
	| { readonly type: 'planDraft'; readonly path: string; readonly title: string; readonly done: boolean }
	/** `plan_save` closed: the reviewable card, in the place the draft was holding. */
	| { readonly type: 'planCard'; readonly path: string; readonly title: string; readonly markdown: string; readonly external?: boolean }
	| { readonly type: 'canvasCard'; readonly path: string; readonly title: string; readonly created: boolean };

/**
 * Folds one surface event into the transcript.
 *
 * Same shape as `applyAgentEvent`, and deliberately so: the controller applies both through one
 * code path and neither the list nor the effects runner can tell which family a step came from.
 */
export function applyOpenideChatSurfaceEvent(
	state: IOpenideChatReducerState,
	ev: IOpenideChatSurfaceEvent,
	options?: { readonly now?: number },
): IOpenideChatReducerStep {
	const draft = createOpenideChatDraft(state, options?.now ?? Date.now());
	switch (ev.type) {
		case 'planDraft': applyPlanDraft(draft, ev.path, ev.title, ev.done); break;
		case 'planCard': applyPlanCard(draft, ev.path, ev.title, ev.markdown, ev.external === true); break;
		case 'canvasCard': applyCanvasCard(draft, ev.path, ev.title, ev.created); break;
	}
	const next = commitOpenideChatDraft(state, draft);
	return { state: next, items: next.items, sessionEffects: draft.effects };
}

/**
 * Every card below interrupts the prose the same way a tool call does: the model stopped writing
 * and produced an artefact, and leaving the paragraph open makes the next `text` delta land under
 * the card instead of above it. The webview says this as `assistant = null; finalizeReasoning();`
 * at the top of all three renderers (openideChatHtml.ts:3831, :3862, :3931).
 */
function interruptProse(draft: IOpenideChatDraft): void {
	closeOpenideChatMarkdown(draft);
	finalizeOpenideChatThinking(draft);
	finalizeOpenideChatExplore(draft);
}

/**
 * The plan being written, keyed by its PATH.
 *
 * The path and not a call id, for the same reason `restorePlan` uses it: the card's every action
 * resolves that file, and the draft and the final card are two states of one plan — the whole point
 * of `renderPlanCard` starting with `removePlanDraft()` is that the finished card does not appear
 * out of nowhere, the skeleton you were reading fills in.
 */
function findPlanIndex(draft: IOpenideChatDraft, path: string, state?: IOpenideChatPlanContent['state']): number {
	for (let index = draft.content.length - 1; index >= 0; index--) {
		const content = draft.content[index];
		if (content.kind === 'plan' && content.planId === path && (state === undefined || content.state === state)) {
			return index;
		}
	}
	return OPENIDE_CHAT_NO_INDEX;
}

function applyPlanDraft(draft: IOpenideChatDraft, path: string, title: string, done: boolean): void {
	const existing = findPlanIndex(draft, path, 'draft');
	if (done) {
		// `done` is NOT "the plan is ready" — `plan_save` fires its own `planCard` for that. It is
		// "stop waiting", which also covers a run cut mid-plan, so the skeleton is removed rather
		// than promoted. Promoting it would leave a card offering Build for a plan never written.
		if (existing !== OPENIDE_CHAT_NO_INDEX) {
			removeOpenideChatContentAt(draft, existing);
		}
		return;
	}
	interruptProse(draft);
	const content: IOpenideChatPlanContent = {
		kind: 'plan',
		planId: path,
		title,
		// The draft card paints a skeleton, never the half-written markdown: the plan editor is
		// already showing that same text growing, in context and with its checkboxes rendered.
		body: { value: '' },
		state: 'draft',
	};
	if (existing === OPENIDE_CHAT_NO_INDEX) {
		pushOpenideChatContent(draft, content);
		return;
	}
	setOpenideChatContentAt(draft, existing, content);
}

function applyPlanCard(draft: IOpenideChatDraft, path: string, title: string, markdown: string, external = false): void {
	interruptProse(draft);
	const content: IOpenideChatPlanContent = {
		kind: 'plan', planId: path, title, body: { value: markdown }, state: 'final', external,
	};
	// The draft is REPLACED in place, not removed and re-appended: the part absorbs the promotion
	// through `tryUpdate` (same `planId`), so the skeleton fills in instead of blinking out.
	const existing = findPlanIndex(draft, path, 'draft');
	if (existing === OPENIDE_CHAT_NO_INDEX) {
		pushOpenideChatContent(draft, content);
		return;
	}
	setOpenideChatContentAt(draft, existing, content);
}

function applyCanvasCard(draft: IOpenideChatDraft, path: string, title: string, created: boolean): void {
	interruptProse(draft);
	const content: IOpenideChatCanvasContent = {
		// Keyed by path: unlike a plan there is no draft to promote, but the identity still has to
		// survive a reload, where `restoreCanvas` has no call id from the live run to reuse.
		kind: 'canvas', canvasId: path, title, resource: path, created,
	};
	// A second write APPENDS a second card, exactly as the webview does (`renderCanvasCard` always
	// builds a new node). Two writes of one canvas are two things that happened, not one.
	pushOpenideChatContent(draft, content satisfies IOpenideChatContent);
}
