/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentLocation, IChatMessage, IContextBreakdown, IMessageChangeSet } from '../openideAgentTypes.js';
import { IOpenideChatContent, IOpenideChatExploreContent, IOpenideChatThinkingContent } from './openideChatContent.js';
import { finalizeOpenideChatExploreContent } from './openideChatExploreGroup.js';
import { advanceOpenideChatResponseItem, createOpenideChatResponseItem, IOpenideChatItem, IOpenideChatRequestItem, IOpenideChatResponseItem, isOpenideChatResponseItem } from './openideChatItem.js';
import { OpenideChatToolRoute } from './openideChatToolMeta.js';

/**
 * State, declared effects and the mutable draft the reducer works on.
 *
 * This file exists so `openideChatReducer.ts` and `openideChatReducerTools.ts` can share the same
 * shapes without importing each other (the tool handlers are a leaf of the reducer, not a peer).
 * The 400-line cap is what forced the split; the dependency direction is
 * reducer → tools → state, with no cycles.
 */

/**
 * Something the reducer REFUSES to do itself.
 *
 * `trackSubagentEvent` (browser/openideChatView.ts:256-308) is not UI: it creates mirror chat
 * sessions and accumulates the messages that get persisted for them. A pure reducer that consumed
 * `AgentLoopEvent` directly would skip all of it and the specialists' conversations would silently
 * stop being saved. So the reducer DECLARES what must happen and the controller performs it —
 * `OpenideChatSessions` is never reachable from common/.
 */
export type IOpenideChatSessionEffect =
	/** Root-conversation activity only. Subagents report in the chat but never move the editor. */
	| { readonly type: 'followLocation'; readonly location: IAgentLocation }
	| { readonly type: 'usage'; readonly usage: IOpenideChatUsageEffect }
	/** Immutable per-message file transaction. Host-only metadata: it must not reach the transcript. */
	| { readonly type: 'saveChangeSet'; readonly changeSet: IMessageChangeSet }
	/** Compaction rewrote the run's history: persist now or a provider switch loses the summary. */
	| { readonly type: 'saveConversation'; readonly reason: 'compaction' }
	/** Create the mirror session for a specialist and seed it with its prompt. */
	| { readonly type: 'subagentSessionStart'; readonly runId: string; readonly title: string; readonly prompt: string }
	/** `mergeText` reproduces the accumulation of consecutive assistant deltas into one message. */
	| { readonly type: 'subagentSessionMessage'; readonly runId: string; readonly message: IChatMessage; readonly mergeText: boolean }
	/** Flush to storage. Streamed text deliberately does not trigger one: it would write per token. */
	| { readonly type: 'subagentSessionSave'; readonly runId: string; readonly isError: boolean }
	| { readonly type: 'subagentSessionEnd'; readonly runId: string; readonly isError: boolean; readonly cancelled: boolean }
	/** `done { reason: 'mode-switch' }`: the same turn resumes under another mode, no row, no reset. */
	| { readonly type: 'modeHandoff' }
	| { readonly type: 'runComplete'; readonly reason?: string }
	| { readonly type: 'runFailed'; readonly message: string; readonly action?: 'connect' | 'continue' };

export interface IOpenideChatUsageEffect {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheReadTokens?: number;
	readonly cacheCreationTokens?: number;
	readonly contextUsed?: number;
	readonly contextLimit?: number;
	readonly breakdown?: IContextBreakdown;
}

/** No cursor. Numeric because content lives in an array and indexes survive immutable rebuilds. */
export const OPENIDE_CHAT_NO_INDEX = -1;

export interface IOpenideChatToolCursor {
	readonly name: string;
	readonly route: OpenideChatToolRoute;
	/** Index in the response's content array, or OPENIDE_CHAT_NO_INDEX for silent tools. */
	readonly index: number;
	readonly argumentsJson: string;
	readonly detail: string;
}

/**
 * Where the open blocks of the CURRENT turn are. Streaming appends to the block that is still
 * open; a new event kind closes it. Without this the transcript would grow one markdown row per
 * token.
 */
export interface IOpenideChatReducerCursor {
	readonly markdownIndex: number;
	readonly thinkingIndex: number;
	readonly thinkingStartedAt: number;
	readonly exploreIndex: number;
	readonly retryIndex: number;
	readonly compactionIndex: number;
	readonly todosIndex: number;
	readonly tools: ReadonlyMap<string, IOpenideChatToolCursor>;
	readonly subagents: ReadonlyMap<string, number>;
	readonly delegations: ReadonlyMap<string, number>;
	readonly edits: ReadonlyMap<string, number>;
}

export const OPENIDE_CHAT_EMPTY_CURSOR: IOpenideChatReducerCursor = {
	markdownIndex: OPENIDE_CHAT_NO_INDEX,
	thinkingIndex: OPENIDE_CHAT_NO_INDEX,
	thinkingStartedAt: 0,
	exploreIndex: OPENIDE_CHAT_NO_INDEX,
	retryIndex: OPENIDE_CHAT_NO_INDEX,
	compactionIndex: OPENIDE_CHAT_NO_INDEX,
	todosIndex: OPENIDE_CHAT_NO_INDEX,
	tools: new Map(),
	subagents: new Map(),
	delegations: new Map(),
	edits: new Map(),
};

export interface IOpenideChatReducerState {
	readonly items: readonly IOpenideChatItem[];
	/** Index into `items` of the reply events flow into; OPENIDE_CHAT_NO_INDEX between turns. */
	readonly activeIndex: number;
	/** Request the current reply answers. Kept on the state because the reply is created lazily. */
	readonly requestId: string;
	readonly cursor: IOpenideChatReducerCursor;
	/** Monotonic id source. Generated ids must be deterministic or restore and tests disagree. */
	readonly seq: number;
}

export function createOpenideChatReducerState(items: readonly IOpenideChatItem[] = []): IOpenideChatReducerState {
	return { items, activeIndex: OPENIDE_CHAT_NO_INDEX, requestId: '', cursor: OPENIDE_CHAT_EMPTY_CURSOR, seq: 0 };
}

/**
 * Pushes the user's row and arms a fresh turn. The reply is NOT created here: a turn that produces
 * no event at all (rejected send, instant mode handoff) must leave no empty assistant bubble.
 */
export function beginOpenideChatTurn(state: IOpenideChatReducerState, request: IOpenideChatRequestItem): IOpenideChatReducerState {
	return {
		items: [...state.items, request],
		activeIndex: OPENIDE_CHAT_NO_INDEX,
		requestId: request.id,
		cursor: OPENIDE_CHAT_EMPTY_CURSOR,
		seq: state.seq,
	};
}

/**
 * Opens the reply row EMPTY, before the engine's first event.
 *
 * Between Send and the first delta there are whole provider round-trips in which a lazily-created
 * reply meant the transcript showed nothing at all — this empty open row is what the renderer
 * hangs the "Pensando…" shimmer on (Cursor does the same). It is a LIVE-run affordance only:
 * `buildOpenideChatTranscript` replays `beginOpenideChatTurn` for restores and must keep its lazy
 * contract, or every unanswered turn in history would restore with a hollow bubble. A reply still
 * empty when the turn settles is withdrawn again in `commitOpenideChatDraft`/`closeOpenideChatTurn`.
 */
export function openOpenideChatReply(state: IOpenideChatReducerState): IOpenideChatReducerState {
	if (getOpenideChatActiveResponse(state)) {
		return state;
	}
	const response = createOpenideChatResponseItem({
		id: `response_${state.seq + 1}`,
		requestId: state.requestId,
		content: [],
		isComplete: false,
	});
	return {
		items: [...state.items, response],
		activeIndex: state.items.length,
		requestId: state.requestId,
		cursor: OPENIDE_CHAT_EMPTY_CURSOR,
		seq: state.seq + 1,
	};
}

/**
 * Arms a turn that has no user row.
 *
 * Approving a plan runs a real turn whose prompt (an instruction to run the approved plan at a
 * given path) the user never wrote and must not be shown: the decision they made was a click on
 * Build, and printing the instruction the chat sent on their behalf reads as a message they do
 * not remember typing. The webview host makes the same call — the message is pushed with
 * `hidden: true` and never rendered (openideChatView.ts:686-692) — which is also why
 * `buildOpenideChatTranscript` skips hidden messages on restore.
 *
 * Everything else is `beginOpenideChatTurn`: fresh cursor, new `requestId`, reply created lazily.
 */
export function beginOpenideChatHiddenTurn(state: IOpenideChatReducerState, requestId: string): IOpenideChatReducerState {
	return {
		items: state.items,
		activeIndex: OPENIDE_CHAT_NO_INDEX,
		requestId,
		cursor: OPENIDE_CHAT_EMPTY_CURSOR,
		seq: state.seq,
	};
}

export function getOpenideChatActiveResponse(state: IOpenideChatReducerState): IOpenideChatResponseItem | undefined {
	const item = state.activeIndex >= 0 ? state.items[state.activeIndex] : undefined;
	return item && isOpenideChatResponseItem(item) ? item : undefined;
}

/**
 * Closes the turn from OUTSIDE the event stream: the user cancelled, or the run's promise settled
 * without the engine ever emitting `done` (a transport error is the usual case).
 *
 * Two guards, both load-bearing. A turn with no reply yet is left alone, so cancelling before the
 * first token does not leave an empty assistant bubble in the transcript. An already closed reply
 * is returned untouched, which is what makes this idempotent — `done` and the run promise both
 * settle, and only the first one may stamp the outcome.
 */
export function closeOpenideChatTurn(
	state: IOpenideChatReducerState,
	update: { readonly isCanceled?: boolean; readonly errorMessage?: string },
	now: number = Date.now(),
): IOpenideChatReducerState {
	const response = getOpenideChatActiveResponse(state);
	if (!response || response.isComplete) {
		return state;
	}
	// The eagerly-created reply never got a single event: closing it would seal an empty bubble
	// into the transcript. It is withdrawn instead — unless it carries an error to show.
	if (!response.content.length && !update.errorMessage) {
		return {
			items: state.items.filter((_, index) => index !== state.activeIndex),
			activeIndex: OPENIDE_CHAT_NO_INDEX,
			requestId: state.requestId,
			cursor: OPENIDE_CHAT_EMPTY_CURSOR,
			seq: state.seq,
		};
	}
	const draft = createOpenideChatDraft(state, now);
	// The open blocks are sealed here too: a reply cancelled mid-reasoning would otherwise keep
	// shimmering "Thinking" forever, with no event left that could ever stop it.
	closeOpenideChatMarkdown(draft);
	finalizeOpenideChatThinking(draft);
	finalizeOpenideChatExplore(draft);
	draft.complete = true;
	draft.canceled = update.isCanceled;
	draft.errorMessage = update.errorMessage;
	return commitOpenideChatDraft(state, draft);
}

/**
 * Mutable working copy of one reducer step. Mutating a local draft and committing it into a brand
 * new state keeps the OUTSIDE pure while avoiding a spread per field per event; the alternative
 * was ~40 nested object literals whose only reader is `commitOpenideChatDraft`.
 */
export interface IOpenideChatDraft {
	content: IOpenideChatContent[];
	markdownIndex: number;
	thinkingIndex: number;
	thinkingStartedAt: number;
	exploreIndex: number;
	retryIndex: number;
	compactionIndex: number;
	todosIndex: number;
	tools: Map<string, IOpenideChatToolCursor>;
	subagents: Map<string, number>;
	delegations: Map<string, number>;
	edits: Map<string, number>;
	seq: number;
	effects: IOpenideChatSessionEffect[];
	/** Injected instead of read from `Date.now()`: durations must be assertable in a test. */
	readonly now: number;
	changed: boolean;
	complete?: boolean;
	canceled?: boolean;
	errorMessage?: string;
}

export function createOpenideChatDraft(state: IOpenideChatReducerState, now: number): IOpenideChatDraft {
	const response = getOpenideChatActiveResponse(state);
	return {
		content: response ? [...response.content] : [],
		markdownIndex: state.cursor.markdownIndex,
		thinkingIndex: state.cursor.thinkingIndex,
		thinkingStartedAt: state.cursor.thinkingStartedAt,
		exploreIndex: state.cursor.exploreIndex,
		retryIndex: state.cursor.retryIndex,
		compactionIndex: state.cursor.compactionIndex,
		todosIndex: state.cursor.todosIndex,
		tools: new Map(state.cursor.tools),
		subagents: new Map(state.cursor.subagents),
		delegations: new Map(state.cursor.delegations),
		edits: new Map(state.cursor.edits),
		seq: state.seq,
		effects: [],
		now,
		changed: false,
	};
}

/** Appends and returns the index, so the caller can park it in a cursor in one statement. */
export function pushOpenideChatContent(draft: IOpenideChatDraft, content: IOpenideChatContent): number {
	draft.content.push(content);
	draft.changed = true;
	return draft.content.length - 1;
}

export function setOpenideChatContentAt(draft: IOpenideChatDraft, index: number, content: IOpenideChatContent): void {
	if (index < 0 || index >= draft.content.length) { return; }
	draft.content[index] = content;
	draft.changed = true;
}

export function getOpenideChatContentAt<T extends IOpenideChatContent>(draft: IOpenideChatDraft, index: number, kind: T['kind']): T | undefined {
	const content = index >= 0 ? draft.content[index] : undefined;
	return content && content.kind === kind ? content as T : undefined;
}

/** Drops a row that must vanish rather than settle (the retry countdown is the only one today). */
export function removeOpenideChatContentAt(draft: IOpenideChatDraft, index: number): void {
	if (index < 0 || index >= draft.content.length) { return; }
	draft.content.splice(index, 1);
	draft.changed = true;
	shiftOpenideChatCursors(draft, index);
}

/** Every parked index after a removal points one slot too far; fix them in one pass. */
function shiftOpenideChatCursors(draft: IOpenideChatDraft, removedIndex: number): void {
	const shift = (value: number): number => value > removedIndex ? value - 1 : (value === removedIndex ? OPENIDE_CHAT_NO_INDEX : value);
	draft.markdownIndex = shift(draft.markdownIndex);
	draft.thinkingIndex = shift(draft.thinkingIndex);
	draft.exploreIndex = shift(draft.exploreIndex);
	draft.retryIndex = shift(draft.retryIndex);
	draft.compactionIndex = shift(draft.compactionIndex);
	draft.todosIndex = shift(draft.todosIndex);
	for (const [key, cursor] of draft.tools) { draft.tools.set(key, { ...cursor, index: shift(cursor.index) }); }
	for (const [key, index] of draft.subagents) { draft.subagents.set(key, shift(index)); }
	for (const [key, index] of draft.delegations) { draft.delegations.set(key, shift(index)); }
	for (const [key, index] of draft.edits) { draft.edits.set(key, shift(index)); }
}

/**
 * Closes the open prose block so the next delta starts a NEW row instead of appending to a
 * paragraph the model already finished. The webview did this with `assistant = null`.
 */
export function closeOpenideChatMarkdown(draft: IOpenideChatDraft): void {
	draft.markdownIndex = OPENIDE_CHAT_NO_INDEX;
}

/**
 * Seals the reasoning block and stamps how long it took. The duration is what turns the shimmering
 * "Thinking" into "Thought for Ns"; leaving it open animates forever after the turn ends.
 */
export function finalizeOpenideChatThinking(draft: IOpenideChatDraft): void {
	const thinking = getOpenideChatContentAt<IOpenideChatThinkingContent>(draft, draft.thinkingIndex, 'thinking');
	if (thinking && !thinking.isComplete) {
		const durationMs = Math.max(0, draft.now - draft.thinkingStartedAt);
		setOpenideChatContentAt(draft, draft.thinkingIndex, { ...thinking, isComplete: true, durationMs });
	}
	draft.thinkingIndex = OPENIDE_CHAT_NO_INDEX;
	draft.thinkingStartedAt = 0;
}

/** Collapses the "Exploring" block once something that is not an exploration takes over. */
export function finalizeOpenideChatExplore(draft: IOpenideChatDraft): void {
	const explore = getOpenideChatContentAt<IOpenideChatExploreContent>(draft, draft.exploreIndex, 'explore');
	if (explore) {
		setOpenideChatContentAt(draft, draft.exploreIndex, finalizeOpenideChatExploreContent(explore));
	}
	draft.exploreIndex = OPENIDE_CHAT_NO_INDEX;
}

/**
 * The retry countdown is the one row that DISAPPEARS instead of settling: it means "the provider
 * pushed back, waiting" and it stops being true the moment the stream resumes.
 */
export function removeOpenideChatRetry(draft: IOpenideChatDraft): void {
	if (draft.retryIndex < 0) { return; }
	removeOpenideChatContentAt(draft, draft.retryIndex);
	draft.retryIndex = OPENIDE_CHAT_NO_INDEX;
}

export function nextOpenideChatId(draft: IOpenideChatDraft, prefix: string): string {
	draft.seq += 1;
	return `${prefix}_${draft.seq}`;
}

export function addOpenideChatEffect(draft: IOpenideChatDraft, effect: IOpenideChatSessionEffect): void {
	draft.effects.push(effect);
}

function draftCursor(draft: IOpenideChatDraft): IOpenideChatReducerCursor {
	return {
		markdownIndex: draft.markdownIndex,
		thinkingIndex: draft.thinkingIndex,
		thinkingStartedAt: draft.thinkingStartedAt,
		exploreIndex: draft.exploreIndex,
		retryIndex: draft.retryIndex,
		compactionIndex: draft.compactionIndex,
		todosIndex: draft.todosIndex,
		tools: draft.tools,
		subagents: draft.subagents,
		delegations: draft.delegations,
		edits: draft.edits,
	};
}

/**
 * Turns the draft back into an immutable state.
 *
 * A reply is created lazily here rather than by the caller: events can arrive before any request
 * exists (restore, a background run reporting into the visible tab) and dropping them would be a
 * silent hole. `advanceOpenideChatResponseItem` bumps the version, which moves `dataId`, which is
 * the ONLY reason the list repaints.
 */
export function commitOpenideChatDraft(state: IOpenideChatReducerState, draft: IOpenideChatDraft): IOpenideChatReducerState {
	const cursor = draftCursor(draft);
	if (!draft.changed && draft.complete === undefined && draft.errorMessage === undefined && draft.canceled === undefined) {
		return { ...state, cursor, seq: draft.seq };
	}
	const existing = getOpenideChatActiveResponse(state);
	if (!existing) {
		const response = createOpenideChatResponseItem({
			id: `response_${draft.seq + 1}`,
			requestId: state.requestId,
			content: draft.content,
			isComplete: draft.complete ?? false,
			isCanceled: draft.canceled,
			errorMessage: draft.errorMessage,
		});
		return { ...state, items: [...state.items, response], activeIndex: state.items.length, cursor, seq: draft.seq + 1 };
	}
	// A reply opened eagerly for the shimmer that settles with nothing to show and nothing to say
	// is withdrawn, not sealed: an empty complete bubble is exactly what the lazy contract avoided.
	if ((draft.complete || draft.canceled) && !draft.content.length && !draft.errorMessage) {
		return {
			items: state.items.filter((_, index) => index !== state.activeIndex),
			activeIndex: OPENIDE_CHAT_NO_INDEX,
			requestId: state.requestId,
			cursor: OPENIDE_CHAT_EMPTY_CURSOR,
			seq: draft.seq,
		};
	}
	const advanced = advanceOpenideChatResponseItem(existing, {
		content: draft.content,
		isComplete: draft.complete,
		isCanceled: draft.canceled,
		errorMessage: draft.errorMessage,
	});
	const items = state.items.map((item, index) => index === state.activeIndex ? advanced : item);
	return { ...state, items, activeIndex: state.activeIndex, cursor, seq: draft.seq };
}
