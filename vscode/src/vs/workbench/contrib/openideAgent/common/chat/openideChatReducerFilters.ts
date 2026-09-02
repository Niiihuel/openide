/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentLoopEvent } from '../openideAgentTypes.js';
import { IOpenideChatSessionEffect } from './openideChatReducerState.js';

/**
 * The passthrough filters, extracted from browser/openideChatView.ts:1436-1478.
 *
 * In the webview build these three rules were four `if`s buried in the middle of the run callback,
 * between a cancellation guard and a `postMessage`. Nothing tested them and nothing could: they
 * only existed inside a closure over a live run. They are load-bearing — remove any of them and
 * either host-only metadata leaks into the transcript or a silent mode handoff paints a spurious
 * "finished" state — so they move out first, as data.
 */

export interface IOpenideChatSubagentFrame {
	readonly id: string;
	readonly parentId: string;
	readonly index: number;
	readonly total: number;
}

export interface IOpenideChatEventEnvelope {
	/** The event to reduce, with every `subagentEvent` layer already peeled off. */
	readonly event: AgentLoopEvent;
	/** The original event, wrapper included: subagent bookkeeping needs the wrapper's ids. */
	readonly source: AgentLoopEvent;
	/** 0 for the root conversation. Anything above 0 came from inside a specialist. */
	readonly depth: number;
	/** Innermost wrapper. Present exactly when `depth > 0`. */
	readonly subagent?: IOpenideChatSubagentFrame;
}

export type OpenideChatDropReason = 'file-checkpoint' | 'message-change-set' | 'mode-switch';

export type IOpenideChatFilterResult =
	| { readonly kind: 'drop'; readonly reason: OpenideChatDropReason; readonly sessionEffects: readonly IOpenideChatSessionEffect[] }
	| { readonly kind: 'pass'; readonly envelope: IOpenideChatEventEnvelope; readonly sessionEffects: readonly IOpenideChatSessionEffect[] };

/**
 * Peels `subagentEvent` wrappers until a real event is reached.
 *
 * The recursion is not theoretical: a specialist can itself delegate, so the payload nests. The
 * webview walked this with a `while` loop and then threw the wrappers away; keeping the innermost
 * frame is what lets the reducer attribute nested activity to the right specialist card instead of
 * dumping a specialist's tool calls into the main transcript.
 */
export function unwrapSubagentEvent(ev: AgentLoopEvent): IOpenideChatEventEnvelope {
	let event = ev;
	let depth = 0;
	let subagent: IOpenideChatSubagentFrame | undefined;
	while (event.type === 'subagentEvent') {
		subagent = { id: event.id, parentId: event.parentId, index: event.index, total: event.total };
		event = event.ev;
		depth++;
	}
	return { event, source: ev, depth, subagent };
}

/**
 * Applies the three passthrough rules, in the order the webview applied them.
 *
 * Order matters: the checkpoint rules run against the UNWRAPPED event (a change set produced
 * inside a specialist is just as host-only as one from the root), while the mode-handoff rule runs
 * against the ORIGINAL one — a `done` nested inside a specialist ends that specialist, not the
 * user's turn, and swallowing it there would freeze the parent card as "running" forever.
 */
export function filterAgentEvent(ev: AgentLoopEvent): IOpenideChatFilterResult {
	const envelope = unwrapSubagentEvent(ev);
	const inner = envelope.event;

	if (inner.type === 'fileCheckpoint') {
		// Legacy internal compatibility only. New conversations persist `messageChangeSet`, so
		// there is deliberately NO effect here: emitting one would resurrect a storage format the
		// product stopped writing.
		return { kind: 'drop', reason: 'file-checkpoint', sessionEffects: [] };
	}

	if (inner.type === 'messageChangeSet') {
		// The transaction is saved against the conversation and never crosses into the transcript:
		// it is the data "Go back here" reverts, not something the user reads.
		return { kind: 'drop', reason: 'message-change-set', sessionEffects: [{ type: 'saveChangeSet', changeSet: inner.changeSet }] };
	}

	if (isOpenideChatModeHandoff(ev)) {
		// The run is NOT over: the engine is resuming the same user turn under another mode. Letting
		// this through would clear the caret, re-enable send and end the turn mid-flight.
		return { kind: 'drop', reason: 'mode-switch', sessionEffects: [{ type: 'modeHandoff' }] };
	}

	return { kind: 'pass', envelope, sessionEffects: [] };
}

/** `done { reason: 'mode-switch' }` at the top level, i.e. not one produced by a specialist. */
export function isOpenideChatModeHandoff(ev: AgentLoopEvent): boolean {
	return ev.type === 'done' && ev.reason === 'mode-switch';
}

/** True when the event carries no renderable content by design (it feeds panels or storage). */
export function isOpenideChatHostOnlyEvent(ev: AgentLoopEvent): boolean {
	const inner = unwrapSubagentEvent(ev).event;
	return inner.type === 'fileCheckpoint' || inner.type === 'messageChangeSet' || inner.type === 'modelRoute';
}
