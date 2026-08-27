/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage, IPersistedFileDiff, ITodoItem, IToolCall, TodoStatus } from '../openideAgentTypes.js';
import { IOpenideChatDelegationContent, IOpenideChatSubagentContent } from './openideChatContent.js';
import {
	getOpenideChatContentAt, IOpenideChatDraft, pushOpenideChatContent, setOpenideChatContentAt,
} from './openideChatReducerState.js';
import {
	applyOpenideChatFileDiff, applyOpenideChatToolResult, applyOpenideChatToolStart, ensureOpenideChatDelegation,
} from './openideChatReducerTools.js';
import { parseToolArguments } from './openideChatToolMeta.js';

/**
 * Rebuilds the content of ONE persisted tool call.
 *
 * Ported from the five special cases inside `restoreThread` (browser/openideChatHtml.ts:5594-5617)
 * plus its generic `addTool`/`upgradeEditCard`/`finishTool` tail. Those five tools are not restored
 * through the normal tool row because their live card is drawn by a message the HOST sends
 * (`planCard`, `canvasCard`, the todos snapshot, the ask stepper, the delegation envelope) and none
 * of those messages is an `AgentLoopEvent` — so the reducer can never produce them and restore is
 * the only path that can. Everything else goes through the very same functions the live stream uses,
 * which is what keeps a reloaded transcript identical to the one that was on screen.
 */

/** The `role: 'tool'` message that settled a call, indexed by `toolCallId`. */
export interface IOpenideChatRestoredToolResult {
	readonly content: string;
	readonly isError: boolean;
	/** Only write_file/edit_file persist one; it is what rebuilds the styled edit card. */
	readonly fileDiff?: IPersistedFileDiff;
}

/**
 * A tool message whose text starts with `Error` failed.
 *
 * This is the webview's own test (`res.indexOf('Error') === 0`, openideChatHtml.ts:5623) and not a
 * guess: the persisted thread stores no success flag at all, so the prefix the tools themselves
 * write is the only evidence left after a reload.
 */
function isRestoredToolError(result: string): boolean {
	return String(result ?? '').startsWith('Error');
}

export function indexOpenideChatToolResults(messages: readonly IChatMessage[]): ReadonlyMap<string, IOpenideChatRestoredToolResult> {
	const results = new Map<string, IOpenideChatRestoredToolResult>();
	for (const message of messages) {
		if (message.role !== 'tool' || !message.toolCallId) { continue; }
		const content = message.content ?? '';
		results.set(message.toolCallId, { content, isError: isRestoredToolError(content), fileDiff: message.fileDiff });
	}
	return results;
}

const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in-progress', 'completed'];

/**
 * The arguments are replayed from storage, so they are whatever the model emitted months ago —
 * possibly under an older schema. Normalizing keeps a malformed entry from typing as `ITodoItem`
 * and blowing up in the part that renders it.
 */
function restoredTodos(argumentsJson: string | undefined): readonly ITodoItem[] {
	const raw = parseToolArguments(argumentsJson)['todos'];
	if (!Array.isArray(raw)) { return []; }
	return raw.map((entry, index) => {
		const value = (entry ?? {}) as Partial<ITodoItem>;
		const status = TODO_STATUSES.includes(value.status as TodoStatus) ? value.status as TodoStatus : 'pending';
		return { id: String(value.id ?? index), title: String(value.title ?? ''), status };
	});
}

/**
 * The to-do list is a SNAPSHOT: the last call wins and replaces the previous row.
 *
 * The webview appends one card per `update_todos` instead (openideChatHtml.ts:4360-4361 live,
 * 5594-5598 on restore). Reproducing that here would make a reloaded turn show N cards where the
 * live reducer shows one, and a transcript that changes shape on reload is worse than either
 * choice. Replacement is deliberately implemented through the SAME `todosIndex` cursor the reducer
 * uses, so whichever behaviour wins later is one edit in `applyTodos`, not two.
 */
function restoreTodos(draft: IOpenideChatDraft, call: IToolCall): void {
	const items = restoredTodos(call.argumentsJson);
	if (draft.todosIndex >= 0 && getOpenideChatContentAt(draft, draft.todosIndex, 'todos')) {
		setOpenideChatContentAt(draft, draft.todosIndex, { kind: 'todos', items });
		return;
	}
	draft.todosIndex = pushOpenideChatContent(draft, { kind: 'todos', items });
}

const ANSWER_PREFIX = /R:\s*([\s\S]*)$/;
/** What the webview writes for a question the user skipped (openideChatHtml.ts:5643). */
const SKIPPED_ANSWER = '(omitida)';

/**
 * Rebuilds the ask stepper from the call's questions and the single blob the tool returned.
 *
 * With one question the whole result IS the answer; with several the tool joins them as
 * `P: …\nR: …` blocks separated by a blank line, and that shape is the only separator left — the
 * answers were never persisted individually.
 */
function restoreAsk(draft: IOpenideChatDraft, call: IToolCall, result: string): void {
	const args = parseToolArguments(call.argumentsJson);
	const raw = args['questions'];
	const questions = Array.isArray(raw)
		? raw.map(entry => ({ question: String((entry as { question?: unknown } ?? {}).question ?? '') }))
		: args['question'] !== undefined ? [{ question: String(args['question']) }] : [];
	if (!questions.length) { return; }
	const answers = questions.length <= 1
		? [result || SKIPPED_ANSWER]
		: (() => {
			const blocks = String(result ?? '').split('\n\n');
			return questions.map((_question, index) => ANSWER_PREFIX.exec(blocks[index] ?? '')?.[1].trim() || SKIPPED_ANSWER);
		})();
	pushOpenideChatContent(draft, { kind: 'ask', requestId: call.id, questions, answers, isComplete: true });
}

const PLAN_PATH_IN_RESULT = /en\s+(\.openide\/plans\/[^\s]+\.md)/;

/**
 * The plan card. `planId` carries the plan's PATH, not the call id: the card's only action is to
 * open that file, and the path is what the result carries back ("OK: plan guardado en …").
 */
function restorePlan(draft: IOpenideChatDraft, call: IToolCall, result: string): void {
	const args = parseToolArguments(call.argumentsJson);
	const title = String(args['title'] ?? '');
	const match = PLAN_PATH_IN_RESULT.exec(String(result ?? ''));
	const path = match ? match[1] : `.openide/plans/${(title || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
	pushOpenideChatContent(draft, {
		kind: 'plan', planId: path, title, body: { value: String(args['markdown'] ?? '') }, state: 'final',
	});
}

const CANVAS_PATH_IN_RESULT = /en\s+(\.openide\/canvases\/[^\s]+\.canvas\.tsx)/;

function restoreCanvas(draft: IOpenideChatDraft, call: IToolCall, result: string): void {
	const args = parseToolArguments(call.argumentsJson);
	const name = String(args['name'] ?? 'Canvas');
	const match = CANVAS_PATH_IN_RESULT.exec(String(result ?? ''));
	const resource = match ? match[1] : `.openide/canvases/${name.replace(/\.canvas\.tsx$/, '')}.canvas.tsx`;
	pushOpenideChatContent(draft, { kind: 'canvas', canvasId: call.id, title: name, resource });
}

/** The webview shows at most four children per delegation (openideChatHtml.ts:5528). */
const MAX_RESTORED_SUBAGENTS = 4;

/**
 * Rebuilds the delegation envelope and one card per task.
 *
 * Every child comes back as `completed` because the per-task outcome was never persisted — only the
 * delegation's own tool result was. The webview makes exactly the same admission
 * (openideChatHtml.ts:5530-5534); inventing a failed child from a non-existent record would be worse
 * than a uniformly optimistic one.
 */
function restoreDelegation(draft: IOpenideChatDraft, call: IToolCall): void {
	const raw = parseToolArguments(call.argumentsJson)['tasks'];
	const tasks = (Array.isArray(raw) ? raw : []).slice(0, MAX_RESTORED_SUBAGENTS);
	const index = ensureOpenideChatDelegation(draft, call.id, tasks.length);
	tasks.forEach((entry, position) => {
		const task = (entry ?? {}) as { title?: unknown };
		const runId = `${call.id}-${position}`;
		const content: IOpenideChatSubagentContent = {
			kind: 'subagent', runId, parentId: call.id, index: position, total: tasks.length,
			title: String(task.title ?? 'Subagente'), status: 'completed', timeline: [],
		};
		draft.subagents.set(runId, pushOpenideChatContent(draft, content));
	});
	const envelope = getOpenideChatContentAt<IOpenideChatDelegationContent>(draft, index, 'delegation');
	if (envelope) { setOpenideChatContentAt(draft, index, { ...envelope, status: 'completed' }); }
}

/**
 * Replays one persisted call onto the draft.
 *
 * The default branch is intentionally the live path — `toolStart` → `fileDiff` → `toolResult`, in
 * that order, exactly as the webview does it (openideChatHtml.ts:5619-5624). Restore therefore
 * inherits the explore folding, the line-span rewriting, the terminal card and the plan-update line
 * for free, and cannot drift away from what the stream produces.
 */
export function applyOpenideChatRestoredToolCall(
	draft: IOpenideChatDraft,
	call: IToolCall,
	results: ReadonlyMap<string, IOpenideChatRestoredToolResult>,
): void {
	const settled = results.get(call.id);
	const result = settled?.content ?? '';
	switch (call.name) {
		case 'update_todos': restoreTodos(draft, call); return;
		case 'ask_user': restoreAsk(draft, call, result); return;
		case 'plan_save': restorePlan(draft, call, result); return;
		case 'canvas_write': restoreCanvas(draft, call, result); return;
		case 'delegate_task': restoreDelegation(draft, call); return;
		default: break;
	}
	applyOpenideChatToolStart(draft, call.id, call.name, call.argumentsJson ?? '');
	const diff = settled?.fileDiff;
	if (diff) {
		// `added`/`removed` are the turn's running totals, which the thread never stored. Falling back
		// to this edit's own numbers keeps the card's counters honest instead of showing 0 changes.
		applyOpenideChatFileDiff(draft, {
			path: diff.path, created: diff.created,
			editAdded: diff.editAdded, editRemoved: diff.editRemoved,
			added: diff.editAdded ?? 0, removed: diff.editRemoved ?? 0,
			// A diff persisted without lines still has to reach the card: `applyOpenideChatFileDiff`
			// treats a MISSING `diffLines` as a tray-only update and would drop the card entirely.
			diffLines: diff.diffLines ?? [],
		});
	}
	applyOpenideChatToolResult(draft, call.id, call.name, result, settled?.isError ?? false);
}
