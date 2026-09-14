/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IOpenideCodexGoalEvent, IOpenideCodexGoalResult } from '../common/openideCodexGoal.js';

interface IWire { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
export interface IOpenideCodexWire {
	request(method: string, params: Record<string, unknown>): Promise<unknown>;
	respond(id: string | number, result: unknown): void;
	deny(id: string | number): void;
}
interface IRun {
	readonly runId: string;
	turnId?: string;
	readonly queued: IWire[];
	readonly changes: Map<string, string>;
	readonly pendingCommands: Set<string>;
	completing?: boolean;
	report: string;
	cancelled: boolean;
	starting?: boolean;
	readonly settle: (result: IOpenideCodexGoalResult) => void;
}

/** Only correlated structured turns can settle a goal; terminal bytes are never consulted. */
export class OpenideCodexGoalConnection extends Disposable {
	private readonly changed = this._register(new Emitter<IOpenideCodexGoalEvent>());
	readonly onDidChange = this.changed.event;
	private run: IRun | undefined;
	private readonly approvals = new Map<string, { wireId: string | number; turnId: string }>();
	private manual = false;
	private disconnected = false;
	private providerGoal = false;
	get isConnected(): boolean { return !this.disconnected; }
	constructor(readonly sessionId: string, readonly threadId: string, private readonly wire: IOpenideCodexWire) { super(); }

	async start(runId: string, prompt: string): Promise<IOpenideCodexGoalResult> {
		if (this.disconnected || this.run || this.manual || this.providerGoal) { throw new Error('Codex is disconnected, busy, or controlled by another goal.'); }
		let settle!: (result: IOpenideCodexGoalResult) => void;
		const result = new Promise<IOpenideCodexGoalResult>(resolve => { settle = resolve; });
		const run: IRun = { runId, queued: [], changes: new Map(), pendingCommands: new Set(), report: '', cancelled: false, settle };
		this.run = run;
		try {
			const nativeGoal = await this.wire.request('thread/goal/get', { threadId: this.threadId }) as { goal?: { status?: string } };
			if (this.run !== run || run.cancelled) { return result; }
			if (nativeGoal.goal?.status === 'active') { this.finish({ report: '', error: 'Pause the Codex-native goal before using an OpenIDE goal.', stop: true }); return result; }
			const state = await this.wire.request('thread/read', { threadId: this.threadId, includeTurns: false }) as { thread?: { status?: { type?: string } } };
			if (this.run !== run || run.cancelled) { return result; }
			if (state.thread?.status?.type !== 'idle' || this.disconnected || this.manual || this.providerGoal) { this.finish({ report: '', error: 'Codex is not idle; automatic continuation is paused.', stop: true }); return result; }
			run.starting = true;
			const started = await this.wire.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: prompt, text_elements: [] }] }) as { turn?: { id?: string } };
			if (!started.turn?.id || this.run !== run) { throw new Error('Codex did not confirm ownership of the requested turn.'); }
			run.turnId = started.turn.id;
			for (const event of run.queued.splice(0)) { this.accept(event); }
			if (run.cancelled) { await this.interrupt(runId); }
		} catch {
			if (this.run === run) { this.finish({ report: run.report, error: 'Codex could not start the owned goal turn.', stop: true }); }
		}
		return result;
	}

	accept(message: IWire): void {
		const params = message.params ?? {};
		if (params['threadId'] !== this.threadId) { return; }
		if (message.method === 'thread/goal/updated') {
			const goal = params['goal'] as { status?: string } | undefined;
			this.providerGoal = goal?.status === 'active';
			if (this.providerGoal) { this.stopForManual('providerGoal', 'Codex activated its own goal controller. OpenIDE continuation is paused.'); }
			return;
		}
		if (message.method === 'thread/goal/cleared') { this.providerGoal = false; return; }
		const run = this.run;
		if (run && !run.turnId) {
			if (run.queued.length >= 256) { this.disconnect(); return; }
			run.queued.push(message); return;
		}
		const turn = params['turn'] as { id?: string; status?: string } | undefined;
		const turnId = typeof params['turnId'] === 'string' ? params['turnId'] : turn?.id;
		if (message.method === 'turn/started' && turnId !== run?.turnId) { this.manual = true; this.stopForManual('manualTurn', 'A turn started from the Codex terminal. Resume the OpenIDE goal after it finishes.'); return; }
		if (message.method === 'turn/completed' && turnId !== run?.turnId) { this.manual = false; return; }
		if (!run || turnId !== run.turnId) { return; }
		if (message.method === 'item/started' || message.method === 'item/completed') {
			const item = params['item'] as { type?: string; id?: string; status?: string; exitCode?: number | null } | undefined;
			if (item?.type === 'commandExecution' && item.id) {
				if (message.method === 'item/completed' && typeof item.exitCode === 'number' && item.status !== 'inProgress') { run.pendingCommands.delete(item.id); }
				else { run.pendingCommands.add(item.id); }
			}
		}
		if (message.method === 'item/started') {
			const item = params['item'] as { id?: string; type?: string; changes?: { path?: string; diff?: string }[] } | undefined;
			if (item?.type === 'fileChange' && item.id && Array.isArray(item.changes) && item.changes.length && item.changes.every(change => typeof change.path === 'string' && typeof change.diff === 'string')) {
				const detail = item.changes.map(change => `${change.path}\n${change.diff}`).join('\n\n');
				if (detail.length <= 16000) { run.changes.set(item.id, detail); }
			}
		}
		if (message.id !== undefined) {
			// The controller only answers requests for its exact thread and turn. Requests
			// from manually started TUI turns remain with that client.
			const command = message.method === 'item/commandExecution/requestApproval';
			const file = message.method === 'item/fileChange/requestApproval';
			const decisions = params['availableDecisions'];
			const fileDetail = typeof params['itemId'] === 'string' ? run.changes.get(params['itemId']) : undefined;
			if ((!command && !file) || (command && (typeof params['command'] !== 'string' || !params['command'] || typeof params['cwd'] !== 'string')) || (file && !fileDetail) || params['grantRoot'] || params['additionalPermissions'] || (Array.isArray(decisions) && !decisions.includes('accept'))) {
				this.wire.deny(message.id);
				this.stopForManual('manualTurn', 'Codex requires a permission or input type that must be handled manually.'); return;
			}
			const approvalId = randomUUID();
			this.approvals.set(approvalId, { wireId: message.id, turnId: run.turnId! });
			this.changed.fire({ sessionId: this.sessionId, kind: 'approval', approvalId, title: command ? 'Approve Codex Command' : 'Approve Codex File Change', detail: [fileDetail, params['command'], params['cwd'], params['reason']].filter(value => typeof value === 'string').join('\n').slice(0, 16000) });
			return;
		}
		if (message.method === 'item/agentMessage/delta' && typeof params['delta'] === 'string') { run.report = (run.report + params['delta']).slice(-16000); }
		if (message.method === 'turn/completed' && !run.completing) {
			run.completing = true;
			if (turn?.status !== 'completed' || run.cancelled) { this.finish({ report: run.report, error: 'Codex goal turn was interrupted or failed.', stop: true }); }
			else { void this.completeWithBackgroundCheck(run); }
		}
	}

	private async completeWithBackgroundCheck(run: IRun): Promise<void> {
		try {
			const background = await this.wire.request('thread/backgroundTerminals/list', { threadId: this.threadId, limit: 1 }) as { data?: unknown[]; nextCursor?: string | null };
			if (this.run !== run) { return; }
			if (run.cancelled) { this.finish({ report: run.report, stop: true }); return; }
			if (!Array.isArray(background.data) || background.data.length || background.nextCursor || run.pendingCommands.size) {
				this.finish({ report: run.report, error: 'Codex has background or unconfirmed command execution. Inspect it before completing the goal.', stop: true });
			} else { this.finish({ report: run.report }); }
		} catch { if (this.run === run) { this.finish({ report: run.report, error: 'Codex background process state could not be verified.', stop: true }); } }

	}

	respond(approvalId: string, accepted: boolean): void {
		const approval = this.approvals.get(approvalId);
		if (!approval || approval.turnId !== this.run?.turnId) { throw new Error('The Codex approval is no longer active.'); }
		this.approvals.delete(approvalId);
		this.wire.respond(approval.wireId, { decision: accepted ? 'accept' : 'decline' });
	}
	async interrupt(runId: string): Promise<void> {
		const run = this.run; if (!run || run.runId !== runId) { return; }
		run.cancelled = true;
		// The owned turn already ended; a manual TUI turn may have started during the final check.
		if (run.completing) { this.finish({ report: run.report, stop: true }); return; }
		if (!run.turnId && !run.starting) { this.finish({ report: run.report, stop: true }); return; }
		if (run.turnId) {
			await this.wire.request('turn/interrupt', { threadId: this.threadId, turnId: run.turnId });
			if (this.run === run) { this.finish({ report: run.report, stop: true }); }
		}
	}
	private stopForManual(kind: 'manualTurn' | 'providerGoal', reason: string): void {
		this.changed.fire({ sessionId: this.sessionId, kind, reason });
		if (this.run) { void this.interrupt(this.run.runId).catch(() => this.disconnect()); }
	}
	private finish(result: IOpenideCodexGoalResult): void {
		const run = this.run; if (!run) { return; }
		this.run = undefined;
		for (const approval of this.approvals.values()) { this.wire.respond(approval.wireId, { decision: 'decline' }); }
		this.approvals.clear(); run.settle(result);
	}
	disconnect(): void {
		if (this.disconnected) { return; }
		this.disconnected = true;
		this.finish({ report: this.run?.report ?? '', error: 'Codex connection closed; no turn completion was confirmed.', stop: true });
		this.changed.fire({ sessionId: this.sessionId, kind: 'disconnected', reason: 'Codex connection closed.' });
	}
	override dispose(): void { this.disconnect(); super.dispose(); }
}
