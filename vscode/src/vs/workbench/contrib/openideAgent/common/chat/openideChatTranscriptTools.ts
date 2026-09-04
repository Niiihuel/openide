/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage, IPersistedFileDiff, IPersistedFlowVideo, ITodoItem, IToolCall, TodoStatus } from '../openideAgentTypes.js';
import { IOpenideChatDelegationContent, IOpenideChatSubagentContent, OpenideChatSubagentStatus } from './openideChatContent.js';
import { ISubagentRun } from '../openideSubagentTypes.js';
import {
	getOpenideChatContentAt, IOpenideChatDraft, pushOpenideChatContent, setOpenideChatContentAt,
} from './openideChatReducerState.js';
import {
	applyOpenideChatVideo,
	applyOpenideChatFileDiff, applyOpenideChatToolResult, applyOpenideChatToolStart, ensureOpenideChatDelegation, parseOpenideChatAskAnswers,
} from './openideChatReducerTools.js';
import { parseToolArguments } from './openideChatToolMeta.js';

/**
 * Rebuilds the content of ONE persisted tool call.
 *
 * Ported from the five special cases inside `restoreThread` (the removed chat webview)
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
	/** Only browser_record_stop persists one; it is what brings the video card back. */
	readonly video?: IPersistedFlowVideo;
}

/**
 * A tool message whose text starts with `Error` failed.
 *
 * This is the webview's own test (`res.indexOf('Error') === 0`, the removed chat webview) and not a
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
		results.set(message.toolCallId, { content, isError: isRestoredToolError(content), fileDiff: message.fileDiff, video: message.video });
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
 * The webview appends one card per `update_todos` instead (the removed chat webview live,
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

/**
 * Rebuilds the ask stepper from the call's questions and the single blob the tool returned.
 * The blob is split by `parseOpenideChatAskAnswers`, the same function the live settle uses.
 */
function restoreAsk(draft: IOpenideChatDraft, call: IToolCall, result: string): void {
	const args = parseToolArguments(call.argumentsJson);
	const raw = args['questions'];
	const questions = Array.isArray(raw)
		? raw.map(entry => ({ question: String((entry as { question?: unknown } ?? {}).question ?? '') }))
		: args['question'] !== undefined ? [{ question: String(args['question']) }] : [];
	if (!questions.length) { return; }
	const answers = parseOpenideChatAskAnswers(questions.length, result);
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

/** The webview shows at most four children per delegation. */
const MAX_RESTORED_SUBAGENTS = 4;

/**
 * Rebuilds the delegation envelope and one card per task.
 *
 * Every child comes back as `completed` because the per-task outcome was never persisted — only the
 * delegation's own tool result was. The webview makes exactly the same admission
 *; inventing a failed child from a non-existent record would be worse
 * than a uniformly optimistic one.
 */
/**
 * A durable specialist, rebuilt after a reload.
 *
 * The transcript keeps only what the tool ANSWERED, which is a sentence for the model, so the row
 * is reassembled from two sources: the call's arguments say which specialist was asked for, and the
 * run store — looked up by the runId in that sentence — supplies everything the row actually shows.
 * When the run is gone (the store keeps 300, and a purge is normal on an old conversation) the card
 * degrades to the arguments instead of disappearing: "this happened, and the trace is gone" is true
 * and useful, while dropping the row rewrites history.
 */
function restoreSubagentRun(draft: IOpenideChatDraft, call: IToolCall, result: string, runs?: ReadonlyMap<string, ISubagentRun>): void {
	const args = parseToolArguments(call.argumentsJson);
	const runId = subagentRunIdFrom(result);
	const run = runId ? runs?.get(runId) : undefined;
	const content: IOpenideChatSubagentContent = {
		kind: 'subagent',
		// Falling back to the call id keeps the row identifiable within the turn; it will not match
		// a stored run, which is exactly right — there is none to open.
		runId: runId ?? call.id,
		parentId: call.id,
		index: 0,
		total: 1,
		title: run?.definitionName || String(args['agent'] ?? '') || 'Especialista',
		model: run?.model,
		// The same mapping the live path uses, or a reloaded row would disagree with the one that
		// was on screen a second ago: a run interrupted by the window closing reads as cancelled.
		status: run ? restoredSubagentStatus(run.status) : (result.startsWith('Error') ? 'failed' : 'completed'),
		run,
		timeline: run?.timeline ?? [],
	};
	draft.subagents.set(content.runId, pushOpenideChatContent(draft, content));
}

function restoredSubagentStatus(status: ISubagentRun['status']): OpenideChatSubagentStatus {
	if (status === 'completed' || status === 'failed' || status === 'cancelled') { return status; }
	return status === 'interrupted' ? 'cancelled' : 'running';
}

/**
 * The runId out of what `delegate_to_subagent` reported.
 *
 * Two shapes, because the tool answers differently for a background run ("…runId=abc") and a
 * foreground one (JSON). Conversations saved before the runId was added to the foreground answer
 * carry neither, and those simply have no run to find — hence the undefined.
 */
function subagentRunIdFrom(result: string): string | undefined {
	const inline = /runId=(\S+)/.exec(result);
	if (inline) { return inline[1]; }
	try {
		const parsed = JSON.parse(result);
		const runId = parsed && typeof parsed === 'object' ? parsed['runId'] : undefined;
		return typeof runId === 'string' && runId ? runId : undefined;
	} catch {
		return undefined;
	}
}

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
 * that order, exactly as the webview does it. Restore therefore
 * inherits the explore folding, the line-span rewriting, the terminal card and the plan-update line
 * for free, and cannot drift away from what the stream produces.
 */
export function applyOpenideChatRestoredToolCall(
	draft: IOpenideChatDraft,
	call: IToolCall,
	results: ReadonlyMap<string, IOpenideChatRestoredToolResult>,
	runs?: ReadonlyMap<string, ISubagentRun>,
): void {
	const settled = results.get(call.id);
	const result = settled?.content ?? '';
	switch (call.name) {
		case 'update_todos': restoreTodos(draft, call); return;
		case 'ask_user': restoreAsk(draft, call, result); return;
		case 'plan_save': restorePlan(draft, call, result); return;
		case 'canvas_write': restoreCanvas(draft, call, result); return;
		case 'delegate_task': restoreDelegation(draft, call); return;
		case 'delegate_to_subagent': restoreSubagentRun(draft, call, result, runs); return;
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
	if (settled?.video) {
		applyOpenideChatVideo(draft, call.id, settled.video);
	}
}
