/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentLoopEvent, IChatMessage } from '../openideAgentTypes.js';
import { ISubagentTimelineEvent } from '../openideSubagentTypes.js';
import {
	IOpenideChatAskContent, IOpenideChatCompactionContent, IOpenideChatDelegationContent, IOpenideChatMarkdownContent,
	IOpenideChatSubagentContent, IOpenideChatThinkingContent, OpenideChatSubagentStatus,
} from './openideChatContent.js';
import { extractOpenideChatDiagrams } from './openideChatDiagramSplit.js';
import { IOpenideChatItem } from './openideChatItem.js';
import { filterAgentEvent, IOpenideChatEventEnvelope, OpenideChatDropReason } from './openideChatReducerFilters.js';
import {
	addOpenideChatEffect, closeOpenideChatMarkdown, commitOpenideChatDraft, createOpenideChatDraft, finalizeOpenideChatExplore,
	finalizeOpenideChatThinking, getOpenideChatContentAt, IOpenideChatDraft, IOpenideChatReducerState, IOpenideChatSessionEffect,
	OPENIDE_CHAT_NO_INDEX, pushOpenideChatContent, removeOpenideChatRetry, setOpenideChatContentAt,
} from './openideChatReducerState.js';
import {
	applyOpenideChatFileDiff, applyOpenideChatScreenshot, applyOpenideChatTerminalData, applyOpenideChatToolResult,
	applyOpenideChatToolStart, ensureOpenideChatDelegation,
} from './openideChatReducerTools.js';

/**
 * The pure translation of `AgentLoopEvent` into renderable content.
 *
 * Today this logic is split across a ~60-case `switch` living inside the webview's JavaScript
 * STRING (browser/openideChatHtml.ts:6220-6390) and three filters buried in a run callback
 * (browser/openideChatView.ts:1436-1478). Neither is reachable from a test, and the native
 * transcript — which only understood `text` — degraded every other event to a generic line. That
 * is the bullet and the "reasoning" label the user sees instead of cards.
 *
 * The reducer covers the 28 variants of `AgentLoopEvent` and returns DECLARED effects rather than
 * performing them: see `IOpenideChatSessionEffect`.
 */

export interface IOpenideChatReducerOptions {
	/** Injected clock. "Thought for Ns" is content, so it must be assertable without faking time. */
	readonly now?: number;
}

export interface IOpenideChatReducerStep {
	readonly state: IOpenideChatReducerState;
	/** `state.items`, surfaced so the controller can hand the list its children in one expression. */
	readonly items: readonly IOpenideChatItem[];
	readonly sessionEffects: readonly IOpenideChatSessionEffect[];
	/** Set when a passthrough filter swallowed the event. Nothing was rendered, on purpose. */
	readonly dropped?: OpenideChatDropReason;
}

export function applyAgentEvent(state: IOpenideChatReducerState, ev: AgentLoopEvent, options?: IOpenideChatReducerOptions): IOpenideChatReducerStep {
	const filtered = filterAgentEvent(ev);
	if (filtered.kind === 'drop') {
		return { state, items: state.items, sessionEffects: filtered.sessionEffects, dropped: filtered.reason };
	}
	const draft = createOpenideChatDraft(state, options?.now ?? Date.now());
	reduceEnvelope(draft, filtered.envelope);
	const next = commitOpenideChatDraft(state, draft);
	return { state: next, items: next.items, sessionEffects: [...filtered.sessionEffects, ...draft.effects] };
}

/** Folds a whole batch. Useful for restore and for tests that assert on a finished turn. */
export function applyAgentEvents(state: IOpenideChatReducerState, events: readonly AgentLoopEvent[], options?: IOpenideChatReducerOptions): IOpenideChatReducerStep {
	let current = state;
	const effects: IOpenideChatSessionEffect[] = [];
	for (const ev of events) {
		const step = applyAgentEvent(current, ev, options);
		current = step.state;
		effects.push(...step.sessionEffects);
	}
	return { state: current, items: current.items, sessionEffects: effects };
}

function reduceEnvelope(draft: IOpenideChatDraft, envelope: IOpenideChatEventEnvelope): void {
	if (envelope.depth > 0) {
		reduceNestedSubagentEvent(draft, envelope);
		return;
	}
	reduceRootEvent(draft, envelope.event);
}

function reduceRootEvent(draft: IOpenideChatDraft, ev: AgentLoopEvent): void {
	switch (ev.type) {
		case 'text': applyText(draft, ev.delta); return;
		case 'reasoning': applyReasoning(draft, ev.delta); return;
		case 'agentLocation':
			// Only the root conversation drives the editor. Specialists keep reporting their
			// activity in the chat, but they never make the user's workspace jump.
			addOpenideChatEffect(draft, { type: 'followLocation', location: ev.location });
			return;
		case 'toolStart': applyOpenideChatToolStart(draft, ev.id, ev.name, ev.argumentsJson); return;
		case 'toolResult': applyOpenideChatToolResult(draft, ev.id, ev.name, ev.result, ev.isError); return;
		case 'terminalData': applyOpenideChatTerminalData(draft, ev.id, ev.data); return;
		case 'screenshot': applyOpenideChatScreenshot(draft, ev.id, ev.mimeType, ev.data); return;
		case 'fileDiff': applyOpenideChatFileDiff(draft, ev); return;
		case 'usage':
			addOpenideChatEffect(draft, {
				type: 'usage',
				usage: {
					inputTokens: ev.inputTokens, outputTokens: ev.outputTokens,
					cacheReadTokens: ev.cacheReadTokens, cacheCreationTokens: ev.cacheCreationTokens,
					contextUsed: ev.contextUsed, contextLimit: ev.contextLimit, breakdown: ev.breakdown,
				},
			});
			return;
		case 'approval': applyApproval(draft, ev.name, ev.decision); return;
		case 'approvalRequest':
			interrupt(draft);
			pushOpenideChatContent(draft, {
				kind: 'confirmation', requestId: ev.id, tool: ev.tool, title: ev.title,
				detail: ev.detail, command: ev.command, risk: ev.risk, sensitive: ev.sensitive,
			});
			return;
		case 'info':
			// The engine's `info` is an advisory, not a status line: the webview paints it with the
			// warning glyph, and downgrading it to 'info' here would make it disappear into the prose.
			interrupt(draft);
			pushOpenideChatContent(draft, { kind: 'notice', severity: 'warning', message: ev.message });
			return;
		case 'compaction': applyCompaction(draft, ev); return;
		case 'retry': applyRetry(draft, ev); return;
		case 'todos': applyTodos(draft, ev.items); return;
		case 'ask':
			interrupt(draft);
			pushOpenideChatContent(draft, {
				kind: 'ask', requestId: ev.id, questions: ev.questions,
				allowFreeText: ev.allowFreeText, isComplete: false,
			} satisfies IOpenideChatAskContent);
			return;
		case 'suggestMode':
			interrupt(draft);
			pushOpenideChatContent(draft, {
				kind: 'modeSuggestion', requestId: ev.id, mode: ev.mode, reason: ev.reason,
				prompt: ev.prompt, autoAcceptSeconds: ev.autoAcceptSeconds,
			});
			return;
		case 'delegationStart': ensureOpenideChatDelegation(draft, ev.id, ev.total); return;
		case 'delegationDone': applyDelegationDone(draft, ev.id, ev.total, ev.status); return;
		case 'subagentStart': applySubagentStart(draft, ev); return;
		case 'subagentDone': applySubagentDone(draft, ev); return;
		case 'subagentRun': applySubagentRun(draft, ev.run); return;
		case 'subagentTimeline': appendSubagentTimeline(draft, ev.runId, ev.event); return;
		case 'done': applyDone(draft, ev.reason); return;
		case 'error': applyError(draft, ev.message, ev.action); return;
		case 'fileCheckpoint':
		case 'messageChangeSet':
			// Unreachable: `filterAgentEvent` drops both. Listed so adding a host-only event without
			// a filter rule is a compile error instead of a silent leak into the transcript.
			return;
		case 'subagentEvent':
			// Unreachable: the envelope is unwrapped before reducing.
			return;
	}
}

/** Something that is not prose is taking over the transcript: seal the streaming blocks. */
function interrupt(draft: IOpenideChatDraft): void {
	closeOpenideChatMarkdown(draft);
	finalizeOpenideChatThinking(draft);
}

function applyText(draft: IOpenideChatDraft, delta: string): void {
	removeOpenideChatRetry(draft);
	finalizeOpenideChatThinking(draft);
	finalizeOpenideChatExplore(draft);
	const existing = getOpenideChatContentAt<IOpenideChatMarkdownContent>(draft, draft.markdownIndex, 'markdown');
	if (existing) {
		setOpenideChatContentAt(draft, draft.markdownIndex, { kind: 'markdown', value: { ...existing.value, value: existing.value.value + delta } });
	} else {
		draft.markdownIndex = pushOpenideChatContent(draft, { kind: 'markdown', value: { value: delta } });
	}
	// A ```mermaid fence that just closed becomes its own row.
	//
	// Guarded on the delta carrying a backtick, and the guard is exact rather than a heuristic: a
	// fence closes on the delta that contributes the LAST of its three backticks, so a delta with
	// none cannot have closed one. Without it, prose would be re-scanned from the top of the block
	// on every token — quadratic in the length of a long answer, for a fence that is not there.
	if (delta.includes('`')) {
		extractOpenideChatDiagrams(draft);
	}
}

function applyReasoning(draft: IOpenideChatDraft, delta: string): void {
	removeOpenideChatRetry(draft);
	// The prose block is closed even though the webview leaves it open: with an immutable list a
	// later `text` delta would rewrite the row ABOVE the reasoning block and the turn would appear
	// to reorder itself as it streams.
	closeOpenideChatMarkdown(draft);
	const existing = getOpenideChatContentAt<IOpenideChatThinkingContent>(draft, draft.thinkingIndex, 'thinking');
	if (existing) {
		setOpenideChatContentAt(draft, draft.thinkingIndex, { ...existing, text: existing.text + delta });
		return;
	}
	draft.thinkingStartedAt = draft.now;
	draft.thinkingIndex = pushOpenideChatContent(draft, { kind: 'thinking', text: delta, isComplete: false });
}

/**
 * Granting a permission leaves NO trace: the tool card that follows is already the canonical record
 * of what ran. Only denials are written down, and as a flat line, never a card (commit 4146dda).
 */
function applyApproval(draft: IOpenideChatDraft, tool: string, decision: string): void {
	if (decision !== 'deny') { return; }
	interrupt(draft);
	pushOpenideChatContent(draft, { kind: 'decision', tool, decision: 'deny' });
}

function applyCompaction(draft: IOpenideChatDraft, ev: Extract<AgentLoopEvent, { type: 'compaction' }>): void {
	const snapshot = ev.beforeTokens !== undefined && ev.afterTokens !== undefined
		? { beforeTokens: ev.beforeTokens, afterTokens: ev.afterTokens, savingsPercent: ev.savingsPercent ?? 0, origin: ev.origin }
		: undefined;
	const content: IOpenideChatCompactionContent = { kind: 'compaction', status: ev.status, origin: ev.origin, snapshot, message: ev.message };
	// 'started' → 'completed' is ONE card changing state, not two cards. The webview reused the
	// live node; here the parked index plays that role.
	const open = getOpenideChatContentAt<IOpenideChatCompactionContent>(draft, draft.compactionIndex, 'compaction');
	if (open && open.status === 'started') {
		setOpenideChatContentAt(draft, draft.compactionIndex, content);
	} else {
		draft.compactionIndex = pushOpenideChatContent(draft, content);
	}
	if (ev.status !== 'started') { draft.compactionIndex = OPENIDE_CHAT_NO_INDEX; }
	if (ev.status === 'completed') {
		// Compaction replaced the run's operational history: persisting now is what stops a provider
		// switch from looking right live and losing the summary after a reload.
		addOpenideChatEffect(draft, { type: 'saveConversation', reason: 'compaction' });
	}
}

function applyRetry(draft: IOpenideChatDraft, ev: Extract<AgentLoopEvent, { type: 'retry' }>): void {
	// Exactly one countdown row at a time: attempt 2 replaces attempt 1 rather than stacking.
	removeOpenideChatRetry(draft);
	const label = ev.kind === 'rate-limit' ? 'Provider rate limit' : 'Transient provider error';
	draft.retryIndex = pushOpenideChatContent(draft, {
		kind: 'notice',
		severity: 'warning',
		message: `${label} — retry ${ev.attempt} of ${ev.max}`,
		retry: { kind: ev.kind, attempt: ev.attempt, max: ev.max, delayMs: ev.delayMs },
	});
}

function applyTodos(draft: IOpenideChatDraft, items: Extract<AgentLoopEvent, { type: 'todos' }>['items']): void {
	// The to-do list is a SNAPSHOT, not a log: every update replaces the previous row.
	if (draft.todosIndex >= 0 && getOpenideChatContentAt(draft, draft.todosIndex, 'todos')) {
		setOpenideChatContentAt(draft, draft.todosIndex, { kind: 'todos', items });
		return;
	}
	draft.todosIndex = pushOpenideChatContent(draft, { kind: 'todos', items });
}

function applyDelegationDone(draft: IOpenideChatDraft, delegationId: string, total: number, status: 'completed' | 'partial' | 'cancelled'): void {
	const index = ensureOpenideChatDelegation(draft, delegationId, total);
	const existing = getOpenideChatContentAt<IOpenideChatDelegationContent>(draft, index, 'delegation');
	if (existing && existing.status === 'running') {
		setOpenideChatContentAt(draft, index, { ...existing, status });
	}
}

function applySubagentStart(draft: IOpenideChatDraft, ev: Extract<AgentLoopEvent, { type: 'subagentStart' }>): void {
	if (draft.subagents.has(ev.id)) { return; }
	interrupt(draft);
	ensureOpenideChatDelegation(draft, ev.parentId, ev.total);
	const index = pushOpenideChatContent(draft, {
		kind: 'subagent', runId: ev.id, parentId: ev.parentId, index: ev.index, total: ev.total,
		title: ev.title, model: ev.model, status: 'running', timeline: [],
	});
	draft.subagents.set(ev.id, index);
	// R7: the mirror session is created by the controller. The reducer only says it must exist.
	addOpenideChatEffect(draft, { type: 'subagentSessionStart', runId: ev.id, title: ev.title, prompt: ev.prompt });
}

function applySubagentDone(draft: IOpenideChatDraft, ev: Extract<AgentLoopEvent, { type: 'subagentDone' }>): void {
	const index = draft.subagents.get(ev.id);
	const existing = index === undefined ? undefined : getOpenideChatContentAt<IOpenideChatSubagentContent>(draft, index, 'subagent');
	const status: OpenideChatSubagentStatus = ev.status ?? (ev.cancelled ? 'cancelled' : (ev.isError ? 'failed' : 'completed'));
	if (existing && index !== undefined && existing.status === 'running') {
		setOpenideChatContentAt(draft, index, { ...existing, status });
	}
	if (ev.cancelled) {
		addOpenideChatEffect(draft, {
			type: 'subagentSessionMessage', runId: ev.id, mergeText: false,
			message: { role: 'assistant', content: 'Subagente cancelado por el usuario.' } satisfies IChatMessage,
		});
	}
	addOpenideChatEffect(draft, { type: 'subagentSessionEnd', runId: ev.id, isError: !!ev.isError, cancelled: !!ev.cancelled });
	addOpenideChatEffect(draft, { type: 'subagentSessionSave', runId: ev.id, isError: !!ev.isError });
}

/** Durable subagent runs carry their own timeline, so the card is rebuilt from the run itself. */
function applySubagentRun(draft: IOpenideChatDraft, run: Extract<AgentLoopEvent, { type: 'subagentRun' }>['run']): void {
	const status: OpenideChatSubagentStatus =
		run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' ? run.status
			: run.status === 'interrupted' ? 'cancelled' : 'running';
	const content: IOpenideChatSubagentContent = {
		kind: 'subagent', runId: run.runId, parentId: run.parentRunId, index: 0, total: 1,
		title: run.definitionName, model: run.model, status, run, timeline: run.timeline,
	};
	const known = draft.subagents.get(run.runId);
	if (known !== undefined && getOpenideChatContentAt(draft, known, 'subagent')) {
		setOpenideChatContentAt(draft, known, content);
		return;
	}
	interrupt(draft);
	draft.subagents.set(run.runId, pushOpenideChatContent(draft, content));
}

function appendSubagentTimeline(draft: IOpenideChatDraft, runId: string, event: ISubagentTimelineEvent): void {
	const index = draft.subagents.get(runId);
	const existing = index === undefined ? undefined : getOpenideChatContentAt<IOpenideChatSubagentContent>(draft, index, 'subagent');
	if (!existing || index === undefined) { return; }
	setOpenideChatContentAt(draft, index, { ...existing, timeline: [...existing.timeline, event] });
}

/**
 * A specialist's own events.
 *
 * They never reach the main transcript — that is what the specialist's card is for — but they do
 * two things: they feed the card's timeline, and they rebuild the mirror session's message list.
 * The second one is R7: `trackSubagentEvent` accumulates real `IChatMessage`s that get persisted,
 * so a reducer that ignored nested events would quietly stop saving specialists' conversations.
 */
function reduceNestedSubagentEvent(draft: IOpenideChatDraft, envelope: IOpenideChatEventEnvelope): void {
	const frame = envelope.subagent;
	if (!frame) { return; }
	const inner = envelope.event;
	const index = draft.subagents.get(frame.id);
	const card = index === undefined ? undefined : getOpenideChatContentAt<IOpenideChatSubagentContent>(draft, index, 'subagent');

	if ((inner.type === 'toolStart' || inner.type === 'toolResult') && card && index !== undefined) {
		const timelineEvent: ISubagentTimelineEvent = {
			sequence: card.timeline.length,
			timestamp: draft.now,
			type: inner.type,
			toolCallId: inner.id,
			toolName: inner.name,
			argumentsJson: inner.type === 'toolStart' ? inner.argumentsJson : undefined,
			isError: inner.type === 'toolResult' ? inner.isError : undefined,
		};
		setOpenideChatContentAt(draft, index, { ...card, timeline: [...card.timeline, timelineEvent] });
	}

	const message = mirrorMessageFor(inner);
	if (message) {
		addOpenideChatEffect(draft, { type: 'subagentSessionMessage', runId: frame.id, message, mergeText: inner.type === 'text' });
	}
	// Streamed text is deliberately excluded: persisting per token would write on every delta.
	if (inner.type !== 'text') {
		addOpenideChatEffect(draft, { type: 'subagentSessionSave', runId: frame.id, isError: false });
	}
}

function mirrorMessageFor(ev: AgentLoopEvent): IChatMessage | undefined {
	switch (ev.type) {
		case 'text': return { role: 'assistant', content: ev.delta };
		case 'toolStart': return { role: 'assistant', content: '', toolCalls: [{ id: ev.id, name: ev.name, argumentsJson: ev.argumentsJson }] };
		case 'toolResult': return { role: 'tool', toolCallId: ev.id, content: ev.result };
		case 'info': return { role: 'assistant', content: ev.message };
		default: return undefined;
	}
}

function applyDone(draft: IOpenideChatDraft, reason: string | undefined): void {
	removeOpenideChatRetry(draft);
	closeOpenideChatMarkdown(draft);
	finalizeOpenideChatThinking(draft);
	finalizeOpenideChatExplore(draft);
	draft.complete = true;
	addOpenideChatEffect(draft, { type: 'runComplete', reason });
}

function applyError(draft: IOpenideChatDraft, message: string, action: 'connect' | 'continue' | undefined): void {
	removeOpenideChatRetry(draft);
	interrupt(draft);
	finalizeOpenideChatExplore(draft);
	// 'continue' is not a failure: the turn ran out of cycles and the task is still alive. Painting
	// it red made users believe something broke and guess that typing "continue" resumed it.
	pushOpenideChatContent(draft, {
		kind: 'notice',
		severity: action === 'continue' ? 'info' : 'error',
		message,
		action,
	});
	draft.complete = true;
	draft.errorMessage = action === 'continue' ? undefined : message;
	addOpenideChatEffect(draft, { type: 'runFailed', message, action });
}
