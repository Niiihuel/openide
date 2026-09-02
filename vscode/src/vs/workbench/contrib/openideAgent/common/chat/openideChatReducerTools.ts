/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideChatAskContent, IOpenideChatDelegationContent, IOpenideChatEditContent, IOpenideChatExploreContent, IOpenideChatTerminalContent, IOpenideChatToolContent, OpenideChatToolState } from './openideChatContent.js';
import { appendOpenideChatExploreEntry, createOpenideChatExploreContent, createOpenideChatExploreEntry, enrichOpenideChatExploreEntry, settleOpenideChatExploreEntry } from './openideChatExploreGroup.js';
import {
	closeOpenideChatMarkdown, finalizeOpenideChatExplore, finalizeOpenideChatThinking, getOpenideChatContentAt,
	IOpenideChatDraft, nextOpenideChatId, OPENIDE_CHAT_NO_INDEX, pushOpenideChatContent, removeOpenideChatRetry, setOpenideChatContentAt,
} from './openideChatReducerState.js';
import { basenameForChat, getOpenideToolMeta, isOpenidePlanPath, parseToolArguments, routeToolCall, toolDetailFor } from './openideChatToolMeta.js';

/**
 * Tool half of the reducer: `toolStart`, `toolResult`, `terminalData`, `fileDiff` and `screenshot`.
 *
 * These five events are ~60% of the webview's dispatch switch and all of them share the same
 * routing decision (`routeToolCall`), so they live together and the main reducer stays readable.
 * Everything mutates the draft in place; the caller owns the commit.
 */

/** The full payload is already in the tool message the model sees; the row only conveys state. */
const MAX_RESULT_CHARS = 6000;
/** The embedded terminal is a preview, not a scrollback: the real one lives in the panel. */
const MAX_TERMINAL_LINES = 400;
const LINE_RANGE_SUFFIX = /\s+L\d+(?:-\d+)?$/;

function truncateResult(result: string): string {
	const value = String(result ?? '');
	return value.length > MAX_RESULT_CHARS ? `${value.slice(0, MAX_RESULT_CHARS)}\n…` : value;
}

/** What an unanswered question contributes to the blob; every ask surface writes the same word. */
export const OPENIDE_CHAT_ASK_SKIPPED = '(omitida)';
const ASK_ANSWER_PREFIX = /R:\s*([\s\S]*)$/;

/**
 * Splits the single blob `ask_user` returns back into one answer per question.
 *
 * One question: the whole result IS the answer. Several: `P: …\nR: …` blocks separated by a blank
 * line — the only separator there is, because the answers were never persisted individually. Shared
 * by the live settle below and by the transcript restore path, so the two can never disagree.
 */
export function parseOpenideChatAskAnswers(questionCount: number, result: string): string[] {
	if (questionCount <= 1) {
		return [result || OPENIDE_CHAT_ASK_SKIPPED];
	}
	const blocks = String(result ?? '').split('\n\n');
	return Array.from({ length: questionCount }, (_unused, index) =>
		ASK_ANSWER_PREFIX.exec(blocks[index] ?? '')?.[1].trim() || OPENIDE_CHAT_ASK_SKIPPED);
}

/**
 * Live settle of the ask card: `ask_user` routes as silent (no activity row), so its `toolResult`
 * used to change nothing and `isComplete` stayed false for the whole session — the card's answered
 * state lived in a part-local flag that a list re-render lost. The pending card is found by scan
 * because the content's `requestId` is the ask's own uuid, not the tool call id.
 */
function settleOpenideChatAsk(draft: IOpenideChatDraft, result: string): void {
	for (let index = draft.content.length - 1; index >= 0; index--) {
		const content = draft.content[index];
		if (content.kind !== 'ask' || content.isComplete) { continue; }
		const ask = content as IOpenideChatAskContent;
		setOpenideChatContentAt(draft, index, {
			...ask,
			answers: parseOpenideChatAskAnswers(ask.questions.length, result),
			isComplete: true,
		} satisfies IOpenideChatAskContent);
		return;
	}
}

/**
 * The delegation envelope is created by whichever arrives first — `delegate_task`'s `toolStart` or
 * the `delegationStart` event — because the order is not guaranteed and creating it twice would
 * split one delegation into two groups.
 */
export function ensureOpenideChatDelegation(draft: IOpenideChatDraft, delegationId: string, total: number): number {
	const known = draft.delegations.get(delegationId);
	if (known !== undefined) {
		const existing = getOpenideChatContentAt<IOpenideChatDelegationContent>(draft, known, 'delegation');
		if (existing && total > existing.total) {
			setOpenideChatContentAt(draft, known, { ...existing, total });
		}
		return known;
	}
	const index = pushOpenideChatContent(draft, { kind: 'delegation', delegationId, total, status: 'running' });
	draft.delegations.set(delegationId, index);
	return index;
}

function startExploreEntry(draft: IOpenideChatDraft, callId: string, name: string, argumentsJson: string): number {
	let explore = getOpenideChatContentAt<IOpenideChatExploreContent>(draft, draft.exploreIndex, 'explore');
	if (!explore) {
		explore = createOpenideChatExploreContent(nextOpenideChatId(draft, 'explore'));
		draft.exploreIndex = pushOpenideChatContent(draft, explore);
	}
	const entry = createOpenideChatExploreEntry(callId, name, argumentsJson);
	setOpenideChatContentAt(draft, draft.exploreIndex, appendOpenideChatExploreEntry(explore, entry));
	return draft.exploreIndex;
}

function startTerminal(draft: IOpenideChatDraft, callId: string, argumentsJson: string): number {
	const args = parseToolArguments(argumentsJson);
	const description = typeof args['description'] === 'string' && args['description'].trim() ? args['description'].trim() : undefined;
	return pushOpenideChatContent(draft, {
		kind: 'terminal',
		callId,
		command: String(args['command'] ?? ''),
		// Only when the model gave one: the card falls back to the command's first executable.
		...(description ? { description } : {}),
		background: false,
		output: '',
		state: 'running',
	});
}

function startEdit(draft: IOpenideChatDraft, path: string, name: string): number {
	const index = pushOpenideChatContent(draft, {
		kind: 'edit',
		diff: { path, created: name === 'write_file' || undefined },
		added: 0,
		removed: 0,
	});
	if (path) { draft.edits.set(path, index); }
	return index;
}

/**
 * Opens the row for a tool call.
 *
 * Every tool closes the prose and reasoning blocks first: the model has stopped writing and
 * started acting, and leaving the paragraph open makes the next `text` delta land under the tool
 * instead of above it. Explorations are the only calls that do NOT close the "Exploring" group —
 * that is the whole point of the group.
 */
export function applyOpenideChatToolStart(draft: IOpenideChatDraft, callId: string, name: string, argumentsJson: string): void {
	removeOpenideChatRetry(draft);
	closeOpenideChatMarkdown(draft);
	finalizeOpenideChatThinking(draft);
	const meta = getOpenideToolMeta(name);
	const route = routeToolCall(name, argumentsJson);
	const detail = toolDetailFor(meta, argumentsJson);
	if (route !== 'explore') { finalizeOpenideChatExplore(draft); }

	let index = OPENIDE_CHAT_NO_INDEX;
	switch (route) {
		case 'silent':
			// update_todos, ask_user and background commands already own a richer surface.
			break;
		case 'delegation':
			index = ensureOpenideChatDelegation(draft, callId, 0);
			break;
		case 'terminal':
			index = startTerminal(draft, callId, argumentsJson);
			break;
		case 'planUpdate':
			index = pushOpenideChatContent(draft, { kind: 'planUpdate', path: detail.replace(LINE_RANGE_SUFFIX, '') });
			break;
		case 'edit':
			index = startEdit(draft, detail.replace(LINE_RANGE_SUFFIX, ''), name);
			break;
		case 'explore':
			index = startExploreEntry(draft, callId, name, argumentsJson);
			break;
		case 'tool':
			index = pushOpenideChatContent(draft, { kind: 'tool', callId, name, argumentsJson, state: 'running' });
			break;
	}
	draft.tools.set(callId, { name, route, index, argumentsJson, detail });
}

/**
 * Settles the row a call opened.
 *
 * A result with no matching start is not dropped: providers do cancel and replay, and a row that
 * never appears is indistinguishable from a bug. The start is synthesized instead.
 */
/**
 * The call is queued behind another conversation, or has just stopped being.
 *
 * Only the edit card carries it: a write is the only call that queues, and its card is where the
 * user is already looking to see what is happening to that file. Everything else ignores the event
 * rather than inventing a row for it.
 */
export function applyOpenideChatToolWaiting(draft: IOpenideChatDraft, callId: string, holder: string | undefined): void {
	const cursor = draft.tools.get(callId);
	if (!cursor || cursor.route !== 'edit') {
		return;
	}
	const edit = getOpenideChatContentAt<IOpenideChatEditContent>(draft, cursor.index, 'edit');
	if (!edit || edit.waitingFor === holder) {
		return;
	}
	setOpenideChatContentAt(draft, cursor.index, { ...edit, waitingFor: holder });
}

export function applyOpenideChatToolResult(draft: IOpenideChatDraft, callId: string, name: string, result: string, isError: boolean): void {
	if (name === 'ask_user' && !isError) {
		settleOpenideChatAsk(draft, result);
	}
	if (!draft.tools.has(callId)) {
		applyOpenideChatToolStart(draft, callId, name, '');
	}
	const cursor = draft.tools.get(callId);
	if (!cursor) { return; }
	const state: OpenideChatToolState = isError ? 'error' : 'success';

	switch (cursor.route) {
		case 'explore': {
			const explore = getOpenideChatContentAt<IOpenideChatExploreContent>(draft, cursor.index, 'explore');
			if (!explore) { break; }
			const enriched = isError ? explore : enrichOpenideChatExploreEntry(explore, callId, cursor.argumentsJson, result);
			setOpenideChatContentAt(draft, cursor.index, settleOpenideChatExploreEntry(enriched, callId, state));
			break;
		}
		case 'terminal': {
			const terminal = getOpenideChatContentAt<IOpenideChatTerminalContent>(draft, cursor.index, 'terminal');
			if (!terminal) { break; }
			// `awaiting-input` means the process is ALIVE and blocked on a prompt (y/N). Marking it
			// exited would remove the stdin line the user needs to unblock it.
			const awaiting = !isError && String(result ?? '').startsWith('awaiting-input');
			setOpenideChatContentAt(draft, cursor.index, {
				...terminal,
				state: awaiting ? 'awaiting-input' : 'exited',
				exitCode: awaiting ? undefined : (isError ? 1 : 0),
			});
			break;
		}
		case 'tool': {
			const tool = getOpenideChatContentAt<IOpenideChatToolContent>(draft, cursor.index, 'tool');
			if (!tool) { break; }
			setOpenideChatContentAt(draft, cursor.index, { ...tool, state, resultText: truncateResult(result) });
			break;
		}
		case 'edit':
		case 'planUpdate':
		case 'delegation':
		case 'silent':
			// The card is its own status: an edit card shows the diff, a plan line shows the plan
			// advanced, a delegation shows its children. "OK: edited…" on top of that is noise.
			break;
	}
}

/**
 * Feeds the embedded terminal.
 *
 * `\r` without `\n` is a progress bar overwriting its own line, not a newline: appending it
 * verbatim turns a 2-line npm install into 4000 lines of garbage.
 */
export function applyOpenideChatTerminalData(draft: IOpenideChatDraft, callId: string, data: string): void {
	const cursor = draft.tools.get(callId);
	if (!cursor || cursor.route !== 'terminal') { return; }
	const terminal = getOpenideChatContentAt<IOpenideChatTerminalContent>(draft, cursor.index, 'terminal');
	if (!terminal) { return; }
	const lines = terminal.output ? terminal.output.split('\n') : [''];
	const chunks = String(data ?? '').replace(/\r\n/g, '\n').split('\n');
	for (let i = 0; i < chunks.length; i++) {
		let segment = chunks[i];
		const carriage = segment.lastIndexOf('\r');
		if (carriage >= 0) {
			lines[lines.length - 1] = '';
			segment = segment.slice(carriage + 1);
		}
		lines[lines.length - 1] += segment;
		if (i < chunks.length - 1) { lines.push(''); }
	}
	const trimmed = lines.length > MAX_TERMINAL_LINES ? lines.slice(lines.length - MAX_TERMINAL_LINES) : lines;
	setOpenideChatContentAt(draft, cursor.index, { ...terminal, output: trimmed.join('\n') });
}

function findEditIndex(draft: IOpenideChatDraft, path: string): number {
	const exact = draft.edits.get(path);
	if (exact !== undefined) { return exact; }
	// Restore and out-of-order diffs only agree on the basename. Preferring the LAST card that has
	// no diff yet stops several edits of the same file in one turn from all landing on the first.
	const base = basenameForChat(path);
	for (let index = draft.content.length - 1; index >= 0; index--) {
		const content = draft.content[index];
		if (content.kind !== 'edit' || content.diff.diffLines) { continue; }
		if (!content.diff.path || basenameForChat(content.diff.path) === base) { return index; }
	}
	return OPENIDE_CHAT_NO_INDEX;
}

export interface IOpenideChatFileDiffEvent {
	readonly path: string;
	readonly added: number;
	readonly removed: number;
	readonly created?: boolean;
	readonly editAdded?: number;
	readonly editRemoved?: number;
	readonly diffLines?: { t: 'add' | 'del' | 'ctx' | 'gap'; x: string }[];
}

/**
 * Completes the edit card with the real diff.
 *
 * Without `diffLines` the event is a tray-only update (a block edit outside a run): it moves the
 * modified-files counters and must not invent a transcript card. The plan has no card either — its
 * editor already shows the same change, animated and in context.
 */
export function applyOpenideChatFileDiff(draft: IOpenideChatDraft, ev: IOpenideChatFileDiffEvent): void {
	if (!ev.diffLines) { return; }
	// The plan's compact line must never become a diff card: the plan editor already shows the same
	// change, and the raw markdown of a ticked checkbox is noise in the transcript.
	if (isOpenidePlanPath(ev.path)) { return; }
	const index = findEditIndex(draft, ev.path);
	const existing = getOpenideChatContentAt<IOpenideChatEditContent>(draft, index, 'edit');
	const content: IOpenideChatEditContent = {
		kind: 'edit',
		diff: {
			path: ev.path,
			created: ev.created,
			editAdded: ev.editAdded,
			editRemoved: ev.editRemoved,
			diffLines: ev.diffLines,
		},
		added: ev.added,
		removed: ev.removed,
	};
	if (existing) {
		setOpenideChatContentAt(draft, index, content);
		draft.edits.set(ev.path, index);
		return;
	}
	draft.edits.set(ev.path, pushOpenideChatContent(draft, content));
}

export function applyOpenideChatScreenshot(draft: IOpenideChatDraft, callId: string, mimeType: string, data: string): void {
	closeOpenideChatMarkdown(draft);
	finalizeOpenideChatThinking(draft);
	finalizeOpenideChatExplore(draft);
	pushOpenideChatContent(draft, { kind: 'screenshot', callId, image: { mimeType, data } });
}
