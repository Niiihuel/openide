/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from '../openideAgentTypes.js';
import { IOpenideChatCompactionContent, IOpenideChatContent } from './openideChatContent.js';
import { pushOpenideChatMarkdownBlock } from './openideChatDiagramSplit.js';
import { createOpenideChatRequestItem, IOpenideChatItem, IOpenideChatRequestItem } from './openideChatItem.js';
import {
	beginOpenideChatTurn, closeOpenideChatMarkdown, commitOpenideChatDraft, createOpenideChatDraft,
	createOpenideChatReducerState, finalizeOpenideChatExplore, finalizeOpenideChatThinking,
	IOpenideChatDraft, IOpenideChatReducerState, OPENIDE_CHAT_NO_INDEX, pushOpenideChatContent,
} from './openideChatReducerState.js';
import { applyOpenideChatRestoredToolCall, indexOpenideChatToolResults, IOpenideChatRestoredToolResult } from './openideChatTranscriptTools.js';

/**
 * `IChatMessage[]` → `IOpenideChatItem[]`: the persisted conversation turned back into rows.
 *
 * This is a BUG FIX, not a feature. `OpenideChatSessions` has always persisted the full thread
 * (browser/openideChatSessions.ts:36) and the native chat never read it back, so opening an
 * existing conversation showed an empty transcript and the only way out was to start a new chat.
 * The webview did this all along in `restoreThread` (browser/openideChatHtml.ts:5556-5628); that
 * function is the specification this file implements.
 *
 * The rebuild deliberately runs through the SAME draft primitives and the SAME tool handlers the
 * live reducer uses. Any other approach produces a transcript that looks subtly different after a
 * reload than it did while it streamed, and that difference is invisible until a user reports it.
 */

export interface IOpenideChatTranscriptOptions {
	/** Injected clock, for the durations the draft stamps. Restore never has real timings anyway. */
	readonly now?: number;
}

/** Compaction rewrote history before the snapshot carried metadata; the summary must not look like
 *  a user's request. Same literal the webview matches on (openideChatHtml.ts:5574). */
const LEGACY_COMPACTION_PREFIX = '[Resumen histórico compacto]';
const LEGACY_COMPACTION_MESSAGE = 'Resumen histórico conservado para continuar la conversación.';

/**
 * Rebuilds every row of a persisted conversation.
 *
 * Hidden messages never appear: they are operational turns (a mode change, a plan build) that
 * travel to the model and were never part of the transcript — the webview view filters them before
 * posting `restore` (browser/openideChatView.ts:1802).
 */
export function buildOpenideChatTranscript(
	messages: readonly IChatMessage[],
	options: IOpenideChatTranscriptOptions = {},
): readonly IOpenideChatItem[] {
	const now = options.now ?? Date.now();
	const results = indexOpenideChatToolResults(messages);
	let state = createOpenideChatReducerState();

	for (const message of messages) {
		if (message.hidden || message.role === 'tool' || message.role === 'system') {
			continue;
		}
		const compaction = compactionContentFor(message);
		if (compaction) {
			state = appendContent(state, compaction, now);
			continue;
		}
		if (message.role === 'user') {
			state = closeTurn(state, now);
			state = beginOpenideChatTurn(state, requestItemFor(message, state.items.length));
			continue;
		}
		state = restoreAssistantMessage(state, message, results, now);
	}
	return closeTurn(state, now).items;
}

/**
 * The user's row.
 *
 * `text` and `displayText` both travel: the transcript shows what was TYPED, while rollback and
 * edit-and-resend need the expanded body the model actually received. The webview only ever saw
 * one of the two because the host collapsed them before posting (openideChatView.ts:1804) — reading
 * the store directly is what lets the native row keep both.
 *
 * A turn saved before message ids existed falls back to a positional id. Ids must be unique for the
 * list's identity provider, and two rows sharing one makes the tree render only the first.
 */
function requestItemFor(message: IChatMessage, position: number): IOpenideChatRequestItem {
	return createOpenideChatRequestItem({
		id: message.messageId ?? `restored_request_${position}`,
		messageId: message.messageId,
		text: message.content ?? '',
		displayText: message.displayText,
		images: message.images,
		capabilities: message.capabilities,
		mode: message.executionMode,
		providerId: message.providerId,
		modelId: message.modelId,
	});
}

/**
 * The compaction card, from the snapshot the message carries or from the legacy text marker.
 *
 * Always `completed`: a conversation can only be reloaded once the compaction that produced it
 * finished, so restoring a spinning "Compactando…" card would animate forever.
 */
function compactionContentFor(message: IChatMessage): IOpenideChatCompactionContent | undefined {
	if (message.compaction) {
		return { kind: 'compaction', status: 'completed', origin: message.compaction.origin, snapshot: message.compaction };
	}
	if (message.role === 'user' && String(message.content ?? '').startsWith(LEGACY_COMPACTION_PREFIX)) {
		return { kind: 'compaction', status: 'completed', origin: 'automatic', message: LEGACY_COMPACTION_MESSAGE };
	}
	return undefined;
}

/** Something that is not prose takes over: seal the blocks the previous message left open. */
function interrupt(draft: IOpenideChatDraft): void {
	closeOpenideChatMarkdown(draft);
	finalizeOpenideChatThinking(draft);
	finalizeOpenideChatExplore(draft);
}

/**
 * Appends one standalone content to the turn in flight, creating the reply row if there is none.
 *
 * A compaction card can legitimately be the FIRST thing in a conversation (compaction replaces the
 * history that came before it), so the reply it lands in may answer no request at all. That is why
 * `commitOpenideChatDraft` creates the response lazily instead of the caller doing it.
 */
function appendContent(state: IOpenideChatReducerState, content: IOpenideChatContent, now: number): IOpenideChatReducerState {
	const draft = createOpenideChatDraft(state, now);
	interrupt(draft);
	pushOpenideChatContent(draft, content);
	return commitOpenideChatDraft(state, draft);
}

/**
 * One persisted assistant message: its prose, then its tool calls in order.
 *
 * Several assistant messages in a row belong to the SAME turn — the engine writes one per model
 * round trip — so they accumulate into a single reply row. `createOpenideChatDraft` reopens the
 * active response and `commitOpenideChatDraft` advances it, which is exactly how the live stream
 * grows one reply across dozens of events.
 */
function restoreAssistantMessage(
	state: IOpenideChatReducerState,
	message: IChatMessage,
	results: ReadonlyMap<string, IOpenideChatRestoredToolResult>,
	now: number,
): IOpenideChatReducerState {
	const draft = createOpenideChatDraft(state, now);
	if (message.content) {
		// Each message is its own paragraph block, like the webview's one `.msg.assistant` per
		// message. `markdownIndex` is deliberately left closed so the next one cannot fold into it.
		interrupt(draft);
		// Same split as the live path: a reloaded conversation has to show the DIAGRAM it showed
		// while it streamed, not the mermaid source it was drawn from.
		pushOpenideChatMarkdownBlock(draft, message.content);
	}
	for (const call of message.toolCalls ?? []) {
		applyOpenideChatRestoredToolCall(draft, call, results);
	}
	return commitOpenideChatDraft(state, draft);
}

/**
 * Settles the reply of the turn that just ended.
 *
 * Without this every restored reply keeps `isComplete: false`, and an incomplete reply is what the
 * renderer paints the streaming caret on — a reloaded conversation would show a whole history of
 * turns that all look like they are still thinking.
 */
function closeTurn(state: IOpenideChatReducerState, now: number): IOpenideChatReducerState {
	if (state.activeIndex === OPENIDE_CHAT_NO_INDEX) {
		return state;
	}
	const draft = createOpenideChatDraft(state, now);
	interrupt(draft);
	draft.complete = true;
	return commitOpenideChatDraft(state, draft);
}
