/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { ISubagentRun, isTerminalSubagentStatus } from '../../common/openideSubagentTypes.js';
import { subagentRunMessages } from '../../common/openideSubagentTranscript.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IOpenideChatSessionEffect, IOpenideChatUsageEffect } from '../../common/chat/openideChatReducerState.js';
import { IChatMessage } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { IChatSessionUsage, OpenideChatSessions } from '../openideChatSessions.js';
import { OpenideChatFollowController } from './openideChatFollowController.js';

/**
 * Performs what the reducer refuses to do.
 *
 * The reducer is pure and lives in `common/`, so it can neither reach `OpenideChatSessions` nor
 * move the editor; it emits `IOpenideChatSessionEffect` instead. Everything in this file used to
 * live inline in the webview host's run callback (`browser/openideChatView.ts:1436-1520` and
 * `trackSubagentEvent`, :261-308), where it was unreachable from the native chat — which is why a
 * native run persisted no usage, no specialist conversation and never followed the agent.
 *
 * Split out of the controller because these are storage and workspace side effects, not transcript
 * state: keeping them here is what lets the controller stay a translation of events into rows.
 */

/** The conversation an event belongs to. Passed per call: a run outlives the active tab. */
export interface IOpenideChatEffectTarget {
	readonly targetWindowId?: number;
	readonly conversationId: string;
	/** Live array of the run, so `saveConversation` persists what the engine actually appended. */
	readonly messages: IChatMessage[];
}

interface IMirrorSession {
	readonly sessionId: string;
	messages: IChatMessage[];
}

export class OpenideChatSessionEffects extends Disposable {

	/** runId → the background conversation mirroring a specialist. Same map as the webview host. */
	private readonly _mirrors = new Map<string, IMirrorSession>();
	private readonly _pendingMirrors = new Map<string, boolean>();
	private readonly _saveMirrors = this._register(new RunOnceScheduler(() => this.flushMirrors(), 100));

	/**
	 * Accumulated context usage of the visible conversation. The provider reports deltas field by
	 * field, so a snapshot has to be carried: writing only what arrived would zero the rest.
	 */
	private _usage: IChatSessionUsage = { input: 0, output: 0, used: 0, limit: 0 };
	private _usageConversationId: string | undefined;

	private readonly _onDidChangeUsage = this._register(new Emitter<IChatSessionUsage>());
	/** Fired on every counter update, so an open "Uso de contexto" panel keeps up with the run. */
	readonly onDidChangeUsage: Event<IChatSessionUsage> = this._onDidChangeUsage.event;

	/**
	 * Serializes `followAgentLocation`. Opening an editor is async and the agent reports faster than
	 * the workbench can reveal: without the chain two locations race and the editor lands on the
	 * older one.
	 */
	private readonly _follow: OpenideChatFollowController;

	constructor(
		private readonly sessions: OpenideChatSessions,
		@IOpenideAgentService agentService: IOpenideAgentService,
	) {
		super();
		this._follow = this._register(new OpenideChatFollowController(agentService));
	}

	/** Which conversation is on screen. Only used to decide whether a specialist's tab may close. */
	private _visibleId: string | undefined;

	setVisibleConversation(conversationId: string | undefined): void {
		this._visibleId = conversationId;
		this._follow.setVisibleConversation(conversationId);
	}

	/**
	 * The counters of a conversation, from memory when it is the one being tracked and from storage
	 * otherwise. Storage is the fallback and not the other way round: the in-memory snapshot is
	 * ahead of the persisted one for the duration of a run.
	 */
	usageOf(conversationId: string | undefined): IChatSessionUsage {
		if (conversationId && conversationId === this._usageConversationId) {
			return this._usage;
		}
		return this.sessions.usageOf(conversationId) ?? { input: 0, output: 0, used: 0, limit: 0 };
	}

	apply(target: IOpenideChatEffectTarget, effects: readonly IOpenideChatSessionEffect[]): void {
		for (const effect of effects) {
			this.applyOne(target, effect);
		}
	}

	private applyOne(target: IOpenideChatEffectTarget, effect: IOpenideChatSessionEffect): void {
		switch (effect.type) {
			case 'followLocation':
				this._follow.follow(target.conversationId, effect.location, target.targetWindowId);
				return;
			case 'usage':
				this.applyUsage(target.conversationId, effect.usage);
				return;
			case 'saveChangeSet':
				this.sessions.saveChangeSet(target.conversationId, effect.changeSet);
				return;
			case 'saveConversation':
				this.sessions.save(target.conversationId, target.messages, false);
				return;
			case 'subagentSessionStart':
				this.startMirror(effect.runId, effect.title, effect.prompt, target.conversationId, effect.inLoop);
				return;
			case 'subagentSessionMessage':
				this.appendMirrorMessage(effect.runId, effect.message, effect.mergeText);
				return;
			case 'subagentSessionSave':
				this.saveMirror(effect.runId, effect.isError);
				return;
			case 'subagentSessionEnd':
				this.endMirror(effect.runId, effect.cancelled ? 'cancelled' : effect.isError ? 'failed' : 'completed');
				return;
			case 'modeHandoff':
			case 'runComplete':
			case 'runFailed':
				// Run lifecycle: the controller owns it, because closing the turn and clearing the busy
				// state are transcript decisions, not storage ones.
				return;
		}
	}

	private applyUsage(conversationId: string, usage: IOpenideChatUsageEffect): void {
		if (this._usageConversationId !== conversationId) {
			// A different conversation's counters are not ours to add to: they are persisted per
			// session, and carrying them over shows the previous thread's context as if it were this
			// one's. Restoring the stored snapshot keeps a resumed conversation from starting at zero.
			this._usage = this.sessions.usageOf(conversationId) ?? { input: 0, output: 0, used: 0, limit: 0 };
			this._usageConversationId = conversationId;
		}
		const next: IChatSessionUsage = { ...this._usage };
		if (typeof usage.inputTokens === 'number') { next.input = usage.inputTokens; }
		if (typeof usage.outputTokens === 'number') { next.output = usage.outputTokens; }
		if (typeof usage.contextUsed === 'number') { next.used = usage.contextUsed; }
		// A negative limit means "unknown" upstream, and writing it would render a full ring.
		if (typeof usage.contextLimit === 'number' && usage.contextLimit >= 0) { next.limit = usage.contextLimit; }
		if (usage.breakdown) { next.breakdown = usage.breakdown; }
		this._usage = next;
		this.sessions.saveUsage(conversationId, next);
		this._onDidChangeUsage.fire(next);
	}

	/**
	 * The mirror conversation of a specialist run, for "open" on its row.
	 *
	 * The Map holds only what THIS window opened, so after a reload it is empty while the sessions
	 * themselves are still on disk. The fallback re-binds from the session store and seeds the Map,
	 * which also arms `startMirror`'s guard: a run whose mirror was recovered must not get a second
	 * session if it somehow reports itself again.
	 */
	mirrorSessionOf(runId: string): string | undefined {
		const known = this._mirrors.get(runId)?.sessionId;
		if (known) { return known; }
		const recovered = this.sessions.sessionOfSubagentRun(runId);
		if (recovered) {
			this._mirrors.set(runId, { sessionId: recovered, messages: this.sessions.messagesOf(recovered) });
		}
		return recovered;
	}

	private startMirror(runId: string, title: string, prompt: string, parentSessionId: string, inLoop = false): void {
		// `mirrorSessionOf` and not `_mirrors.has`: after a reload the Map is empty but the session
		// exists, and re-creating it would fork the specialist's history into a second tab.
		if (this.mirrorSessionOf(runId)) {
			return; // subagentStart is re-emitted on reconnect; a second session would fork the history
		}
		const messages: IChatMessage[] = [{ role: 'user', content: prompt }];
		const sessionId = this.sessions.createBackground(title, messages, runId, parentSessionId);

		this._mirrors.set(runId, { sessionId, messages });
		if (inLoop) {
			// Durable runs own their lifecycle; in-loop specialists keep it with their mirror.
			this.sessions.rename(sessionId, title);
			this.sessions.setSubagentStatus(sessionId, 'running');
		}
	}

	private appendMirrorMessage(runId: string, message: IChatMessage, mergeText: boolean): void {
		const mirror = this._mirrors.get(runId);
		if (!mirror) {
			return;
		}
		const last = mirror.messages[mirror.messages.length - 1];
		if (message.terminalOutput && last?.terminalOutput?.callId === message.terminalOutput.callId) {
			last.terminalOutput.output += message.terminalOutput.output;
			return;
		}
		// Streamed deltas grow the LAST assistant message instead of pushing one per token; a message
		// that already carries tool calls is closed and must not absorb prose.
		if (mergeText && last?.role === 'assistant' && !last.toolCalls?.length && !last.fileDiff && !last.terminalOutput && (last.reasoning !== undefined) === (message.reasoning !== undefined)) {
			if (message.reasoning !== undefined) { last.reasoning = (last.reasoning ?? '') + message.reasoning; }
			else { last.content += message.content; }
			return;
		}
		mirror.messages.push(message);
	}

	/** Durable and in-loop runs share the same complete mirror format. */
	syncSubagentRun(run: ISubagentRun): void {
		this.startMirror(run.runId, run.definitionName, run.task, run.parentConversationId);
		const mirror = this._mirrors.get(run.runId)!;
		mirror.messages = subagentRunMessages(run);
		this.sessions.setSubagentStatus(mirror.sessionId, isTerminalSubagentStatus(run.status) ? run.status as 'completed' | 'failed' | 'cancelled' | 'interrupted' : 'running');
		this.saveMirror(run.runId, run.status === 'failed');
		if (isTerminalSubagentStatus(run.status)) { this.flushMirrors(); }
	}

	private saveMirror(runId: string, isError: boolean): void {
		this._pendingMirrors.set(runId, isError);
		if (!this._saveMirrors.isScheduled()) { this._saveMirrors.schedule(); }
	}

	private flushMirrors(): void {
		for (const [runId, isError] of this._pendingMirrors) {
			const mirror = this._mirrors.get(runId);
			if (mirror) { this.sessions.save(mirror.sessionId, mirror.messages, isError); }
		}
		this._pendingMirrors.clear();
	}

	override dispose(): void {
		this.flushMirrors();
		super.dispose();
	}

	private endMirror(runId: string, status: 'completed' | 'failed' | 'cancelled'): void {
		const mirror = this._mirrors.get(runId);
		if (!mirror) {
			return;
		}
		this.saveMirror(runId, status === 'failed');
		this.flushMirrors();
		this.sessions.setSubagentStatus(mirror.sessionId, status);
		// Transient tab: the specialist's strip entry closes when its run ends, but never while the
		// user is reading it — the session itself stays reachable from the Agents panel either way.
		if (this._visibleId !== mirror.sessionId) {
			this.sessions.closeBackgroundTab(mirror.sessionId);
		}
	}
}
