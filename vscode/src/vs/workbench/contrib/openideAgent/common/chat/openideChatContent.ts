/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { AgentMode, IAskQuestion, IChatImage, IPersistedFlowVideo, ICompactionSnapshot, IPersistedFileDiff, ITodoItem, ToolApprovalDecision, ToolRisk } from '../openideAgentTypes.js';
import { ISubagentRun, ISubagentTimelineEvent } from '../openideSubagentTypes.js';

/**
 * Renderable content of an assistant turn.
 *
 * The vocabulary mirrors `IChatProgress` (contrib/chat/common/chatService/chatService.ts:1131) on
 * purpose: it keeps the door open to plugging into `IChatService` later without rewriting every
 * content part. The source of truth for what can ever appear here is `AgentLoopEvent`
 * (common/openideAgentTypes.ts:322-382) — the reducer translates those 30 events into these kinds.
 *
 * Every kind is declared now even though Stage 1 only renders 'markdown' and 'progress': later
 * stages add parts, never change the contract. Events that are not rows (usage, agentLocation,
 * fileCheckpoint, messageChangeSet) are deliberately absent — they feed panels and side effects.
 *
 * Everything is readonly because the reducer is pure: a delta produces a NEW content object and
 * the item's dataId changes, which is what makes the list repaint (see openideChatItem.ts).
 */
export type IOpenideChatContent =
	| IOpenideChatMarkdownContent
	| IOpenideChatThinkingContent
	| IOpenideChatToolContent
	| IOpenideChatExploreContent
	| IOpenideChatEditContent
	| IOpenideChatTerminalContent
	| IOpenideChatConfirmationContent
	| IOpenideChatAccountChoiceContent
	| IOpenideChatDecisionContent
	| IOpenideChatAskContent
	| IOpenideChatTodosContent
	| IOpenideChatPlanContent
	| IOpenideChatPlanUpdateContent
	| IOpenideChatSubagentContent
	| IOpenideChatDelegationContent
	| IOpenideChatDiagramContent
	| IOpenideChatNoticeContent
	| IOpenideChatCompactionContent
	| IOpenideChatCanvasContent
	| IOpenideChatModeSuggestionContent
	| IOpenideChatScreenshotContent
	| IOpenideChatVideoContent
	| IOpenideChatProgressContent;

export type OpenideChatContentKind = IOpenideChatContent['kind'];

/** Assistant prose. Streams: each `text` delta yields a new object with the accumulated value. */
export interface IOpenideChatMarkdownContent {
	readonly kind: 'markdown';
	readonly value: IMarkdownString;
}

/** `reasoning` deltas, collapsed behind "Thought for Ns". */
export interface IOpenideChatThinkingContent {
	readonly kind: 'thinking';
	readonly text: string;
	readonly durationMs?: number;
	readonly isComplete: boolean;
}

export type OpenideChatToolState = 'running' | 'success' | 'error' | 'cancelled';

/** Generic tool row (`toolStart` → `toolResult`). Specific tools get their own kind instead. */
export interface IOpenideChatToolContent {
	readonly kind: 'tool';
	readonly callId: string;
	readonly name: string;
	/** Raw, possibly truncated: `toolCallDelta` streams incomplete JSON that JSON.parse rejects. */
	readonly argumentsJson: string;
	readonly state: OpenideChatToolState;
	readonly resultText?: string;
}

export interface IOpenideChatExploreEntry {
	readonly callId: string;
	readonly tool: string;
	/** Path, glob or query — whatever identifies the target for this tool. */
	readonly target: string;
	readonly state: OpenideChatToolState;
}

/** Consecutive read/search/list calls folded into one "Exploring" block with a counter. */
export interface IOpenideChatExploreContent {
	readonly kind: 'explore';
	readonly id: string;
	readonly entries: readonly IOpenideChatExploreEntry[];
	readonly isComplete: boolean;
}

/**
 * One file edit. The card is a remote control for OpenideEditReview, not a diff viewer, so it
 * only needs the counters. `diff` reuses the persisted shape so restore and live render agree.
 */
export interface IOpenideChatEditContent {
	readonly kind: 'edit';
	readonly diff: IPersistedFileDiff;
	/** Accumulated against the turn baseline, unlike the per-edit numbers inside `diff`. */
	readonly added: number;
	readonly removed: number;
	/**
	 * The conversation whose turn on this file this write is waiting for. Set while it queues, gone
	 * once it has the file: a write parked for up to two minutes has to say WHY, or it reads as the
	 * agent having frozen.
	 */
	readonly waitingFor?: string;
}

export type OpenideChatTerminalState = 'running' | 'awaiting-input' | 'exited';

export interface IOpenideChatTerminalContent {
	readonly kind: 'terminal';
	readonly callId: string;
	readonly command: string;
	/** The model's 3-5 word title for the command (`run_command`'s `description`); the card's header. */
	readonly description?: string;
	readonly background: boolean;
	readonly output: string;
	readonly state: OpenideChatTerminalState;
	readonly exitCode?: number;
}

/**
 * Inline approval. One of the three kinds that survive as a request/response protocol with an id,
 * because the service is literally blocked on a Promise until the user answers.
 */
/**
 * The turn ran out of quota and more than one account could carry it.
 *
 * Asked rather than decided because the answer spends a subscription: with two accounts holding
 * room, "which one pays" is not a detail the IDE gets to settle on its own, and an account billed
 * per use is a question about whether to spend at all. Same card grammar as an approval, because it
 * is the same kind of moment — the run is parked waiting for a person.
 */
export interface IOpenideChatAccountChoiceContent {
	readonly kind: 'accountChoice';
	readonly requestId: string;
	/** Account that ran out, so the card can say what it is recovering from. */
	readonly spentLabel: string;
	readonly candidates: readonly { readonly accountId: string; readonly label: string; readonly paid?: boolean }[];
	/** Set once answered: the account id chosen, or `stop`. The card stays as the record. */
	readonly decision?: string;
}

export interface IOpenideChatConfirmationContent {
	readonly kind: 'confirmation';
	readonly requestId: string;
	readonly tool: string;
	readonly title: string;
	readonly detail?: string;
	readonly command?: string;
	readonly risk: ToolRisk;
	readonly sensitive?: boolean;
	/** Set once answered; the part turns non-interactive instead of disappearing mid-turn. */
	readonly decision?: ToolApprovalDecision;
}

/**
 * Flat one-line trace of a decision. Only denials produce one: granting leaves no card at all
 * (asymmetry fixed in commit 4146dda).
 */
export interface IOpenideChatDecisionContent {
	readonly kind: 'decision';
	readonly tool: string;
	readonly decision: ToolApprovalDecision;
}

/** `ask_user` stepper, 1 to 5 questions. Blocking protocol. */
export interface IOpenideChatAskContent {
	readonly kind: 'ask';
	readonly requestId: string;
	readonly questions: readonly IAskQuestion[];
	readonly allowFreeText?: boolean;
	readonly answers?: readonly string[];
	readonly isComplete: boolean;
}

export interface IOpenideChatTodosContent {
	readonly kind: 'todos';
	readonly items: readonly ITodoItem[];
}

/** The draft renders as a skeleton while the model is still writing the plan's arguments. */
export interface IOpenideChatPlanContent {
	readonly kind: 'plan';
	readonly planId: string;
	readonly title?: string;
	readonly body: IMarkdownString;
	readonly state: 'draft' | 'final';
	/**
	 * An EXTERNAL agent wrote this plan and is parked waiting for the answer.
	 *
	 * The card must not offer "Build" for one of these: building launches OpenIDE's own agent,
	 * and the plan belongs to the CLI that asked. Its buttons drive that agent's decision instead.
	 */
	readonly external?: boolean;
}

/** "Updating the plan" line for writes under .openide/plans/. */
export interface IOpenideChatPlanUpdateContent {
	readonly kind: 'planUpdate';
	readonly path: string;
}

export type OpenideChatSubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface IOpenideChatSubagentContent {
	readonly kind: 'subagent';
	readonly runId: string;
	readonly parentId?: string;
	readonly index: number;
	readonly total: number;
	readonly title: string;
	readonly model?: string;
	/**
	 * Model of the turn that delegated this specialist, so the row can name the specialist's model
	 * ONLY when it differs — a badge repeating the model you are already running says nothing.
	 * Stamped at creation from the request item; absent on conversations saved before this existed.
	 */
	readonly parentModel?: string;
	readonly status: OpenideChatSubagentStatus;
	/** Absent on legacy conversations, which only persisted subagentStart/subagentDone. */
	readonly run?: ISubagentRun;
	readonly timeline: readonly ISubagentTimelineEvent[];
}

/** Legacy delegation envelope. Kept so old conversations restore with their grouping intact. */
export interface IOpenideChatDelegationContent {
	readonly kind: 'delegation';
	readonly delegationId: string;
	readonly total: number;
	readonly status: 'running' | 'completed' | 'partial' | 'cancelled';
}

/**
 * Diagram source, not a parsed spec: keeping the engine out of the contract means every consumer
 * of IOpenideChatContent does not transitively pull the 656-line parser.
 */
export interface IOpenideChatDiagramContent {
	readonly kind: 'diagram';
	readonly syntax: string;
	readonly source: string;
}

/** Rate-limit/transient retry countdown. Replaces itself in place until the stream resumes. */
export interface IOpenideChatRetryInfo {
	readonly kind: 'rate-limit' | 'transient';
	readonly attempt: number;
	readonly max: number;
	readonly delayMs: number;
}

/**
 * info / warning / error / retry in one kind, because they share a part. `action` drives the CTA:
 * auth and billing failures are not red errors, they are "do this".
 */
export interface IOpenideChatNoticeContent {
	readonly kind: 'notice';
	readonly severity: 'info' | 'warning' | 'error';
	readonly message: string;
	readonly action?: 'connect' | 'continue' | 'account-back';
	readonly retry?: IOpenideChatRetryInfo;
}

export interface IOpenideChatCompactionContent {
	readonly kind: 'compaction';
	readonly status: 'started' | 'completed' | 'skipped' | 'failed';
	readonly origin: ICompactionSnapshot['origin'];
	readonly snapshot?: ICompactionSnapshot;
	readonly message?: string;
}

export interface IOpenideChatCanvasContent {
	readonly kind: 'canvas';
	readonly canvasId: string;
	readonly title: string;
	readonly resource?: string;
	/**
	 * Whether this write CREATED the canvas. Only the live event knows: a restored conversation has
	 * nothing on disk that records it, so the card says just "Canvas" when it is absent rather than
	 * guessing between "creado" and "actualizado".
	 */
	readonly created?: boolean;
}

/** Complexity triage. Blocking protocol: the run waits for accept/dismiss or the auto-accept. */
export interface IOpenideChatModeSuggestionContent {
	readonly kind: 'modeSuggestion';
	readonly requestId: string;
	readonly mode: AgentMode | 'fork';
	readonly reason: string;
	readonly prompt?: string;
	readonly autoAcceptSeconds?: number;
	readonly accepted?: boolean;
}

export interface IOpenideChatScreenshotContent {
	readonly kind: 'screenshot';
	readonly callId: string;
	readonly image: IChatImage;
}

/** A recorded browser flow: the card plays the file from disk, so it survives a restore. */
export interface IOpenideChatVideoContent {
	readonly kind: 'video';
	readonly callId: string;
	readonly video: IPersistedFlowVideo;
}

/**
 * Single-line fallback ("· read_file"). Stage 1 routes every event without a part here, so the
 * transcript never silently drops an event while the richer parts are still being written.
 */
export interface IOpenideChatProgressContent {
	readonly kind: 'progress';
	readonly text: string;
	readonly shimmer?: boolean;
	/** AgentLoopEvent['type'] that produced it, so a missing part is greppable in a bug report. */
	readonly sourceEvent?: string;
}

/** Every declared kind. Exported so tests can assert the union and the guards stay in sync. */
export const OPENIDE_CHAT_CONTENT_KINDS = [
	'markdown', 'thinking', 'tool', 'explore', 'edit', 'terminal', 'confirmation', 'decision',
	'ask', 'todos', 'plan', 'planUpdate', 'subagent', 'delegation', 'diagram', 'notice',
	'compaction', 'canvas', 'modeSuggestion', 'screenshot', 'video', 'progress', 'accountChoice',
] as const satisfies readonly OpenideChatContentKind[];

/** Kinds a part exists for in Stage 1. The factory falls back to 'progress' for the rest. */
export const OPENIDE_CHAT_STAGE1_KINDS = ['markdown', 'progress'] as const satisfies readonly OpenideChatContentKind[];

const KIND_SET: ReadonlySet<string> = new Set<string>(OPENIDE_CHAT_CONTENT_KINDS);

export function isOpenideChatContent(value: unknown): value is IOpenideChatContent {
	return !!value && typeof value === 'object' && KIND_SET.has((value as { kind?: unknown }).kind as string);
}

/** Narrowing helper so parts do not repeat `content.kind === 'x'` casts. */
export function isOpenideChatContentOfKind<K extends OpenideChatContentKind>(
	content: IOpenideChatContent,
	kind: K,
): content is Extract<IOpenideChatContent, { kind: K }> {
	return content.kind === kind;
}

export function isOpenideChatMarkdownContent(content: IOpenideChatContent): content is IOpenideChatMarkdownContent {
	return content.kind === 'markdown';
}

export function isOpenideChatProgressContent(content: IOpenideChatContent): content is IOpenideChatProgressContent {
	return content.kind === 'progress';
}

export function isOpenideChatToolContent(content: IOpenideChatContent): content is IOpenideChatToolContent {
	return content.kind === 'tool';
}

export function isOpenideChatThinkingContent(content: IOpenideChatContent): content is IOpenideChatThinkingContent {
	return content.kind === 'thinking';
}

/**
 * The three kinds the agent service blocks on. The controller must keep them interactive even
 * after a re-render, or the run stays stuck with no visible way to answer.
 */
export function isOpenideChatBlockingContent(
	content: IOpenideChatContent,
): content is IOpenideChatConfirmationContent | IOpenideChatAskContent | IOpenideChatModeSuggestionContent {
	return content.kind === 'confirmation' || content.kind === 'ask' || content.kind === 'modeSuggestion';
}

/** True when Stage 1 has a real part; false means the row degrades to the generic line. */
export function hasOpenideChatStage1Part(content: IOpenideChatContent): boolean {
	return (OPENIDE_CHAT_STAGE1_KINDS as readonly string[]).includes(content.kind);
}
