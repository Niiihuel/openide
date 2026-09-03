/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — subagent state machine and scheduler. Each run owns its CTS and lifecycle.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { cloneSubagentRun, EMPTY_SUBAGENT_METRICS, ICreateSubagentRunOptions, isTerminalSubagentStatus, ISubagentAttemptLease, ISubagentResult, ISubagentRun, ISubagentTimelineEvent, SubagentRunEvent, SubagentRunStatus } from '../common/openideSubagentTypes.js';
import { ISubagentRoutingAttempt, ISubagentRoutingDecision } from '../common/openideSubagentRouting.js';
import { ISubagentRunStorageService } from './openideSubagentRunStorageService.js';

export const ISubagentRunService = createDecorator<ISubagentRunService>('openideSubagentRunService');

export interface ISubagentRunController { readonly run: ISubagentRun; readonly token: CancellationToken }
export interface ISubagentRunService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeRun: Event<SubagentRunEvent>;
	create(options: ICreateSubagentRunOptions): ISubagentRunController;
	get(runId: string): ISubagentRun | undefined;
	token(runId: string): CancellationToken | undefined;
	list(): readonly ISubagentRun[];
	listByParent(conversationId: string, messageId?: string): readonly ISubagentRun[];
	transition(runId: string, status: SubagentRunStatus, progress?: string): ISubagentRun | undefined;
	append(runId: string, event: Omit<ISubagentTimelineEvent, 'sequence' | 'timestamp'>): ISubagentRun | undefined;
	recordUsage(runId: string, usage: { inputTokens?: number; outputTokens?: number }): ISubagentRun | undefined;
	recordRoutingDecision(runId: string, decision: ISubagentRoutingDecision): ISubagentRun | undefined;
	recordRoutingAttempt(runId: string, attempt: ISubagentRoutingAttempt, fallback: boolean): ISubagentRun | undefined;
	setChangeSetId(runId: string, changeSetId: string): ISubagentRun | undefined;
	acquireLease(runId: string, workerId: string, ttlMs?: number): ISubagentAttemptLease | undefined;
	renewLease(runId: string, lease: ISubagentAttemptLease, ttlMs?: number): boolean;
	isLeaseCurrent(runId: string, lease: ISubagentAttemptLease): boolean;
	complete(runId: string, result: ISubagentResult, lease?: ISubagentAttemptLease): ISubagentRun | undefined;
	fail(runId: string, error: string): ISubagentRun | undefined;
	cancel(runId: string): boolean;
	markDelivered(runId: string): void;
	addChild(parentRunId: string, childRunId: string): void;
}

interface IMutableRun { value: ISubagentRun; readonly cts: CancellationTokenSource; timeout?: ReturnType<typeof setTimeout> }

export class SubagentRunService extends Disposable implements ISubagentRunService {
	declare readonly _serviceBrand: undefined;
	private readonly active = new Map<string, IMutableRun>();
	private readonly _onDidChangeRun = this._register(new Emitter<SubagentRunEvent>());
	readonly onDidChangeRun = this._onDidChangeRun.event;

	constructor(
		@ISubagentRunStorageService private readonly storage: ISubagentRunStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) { super(); }

	create(options: ICreateSubagentRunOptions): ISubagentRunController {
		const now = Date.now();
		const run: ISubagentRun = {
			runId: generateUuid(), definitionId: options.definition.id, definitionVersion: options.definition.version,
			definitionName: options.definition.name, parentConversationId: options.parentConversationId,
			parentMessageId: options.parentMessageId, parentRunId: options.parentRunId,
			depth: options.depth ?? (options.parentRunId ? 1 : 0), task: options.task, status: 'queued', createdAt: now,
			model: options.model || options.definition.model || 'default', profile: options.definition.profile, readonly: options.definition.readonly,
			background: options.background ?? options.definition.isBackground, metrics: { ...EMPTY_SUBAGENT_METRICS }, routingAttempts: [],
			timeline: [], childRunIds: [], deliveryState: 'pending', generation: 1, attemptCount: 0,
		};
		const cts = new CancellationTokenSource();
		const mutable: IMutableRun = { value: run, cts };
		const timeoutMinutes = Math.max(1, Number(this.configurationService.getValue('openide.subagents.defaultTimeoutMinutes')) || 15);
		mutable.timeout = setTimeout(() => this.timeout(run.runId, timeoutMinutes), timeoutMinutes * 60_000);
		this.active.set(run.runId, mutable); this.storage.save(run); this._onDidChangeRun.fire({ type: 'created', run: cloneSubagentRun(run) });
		return { run: cloneSubagentRun(run), token: cts.token };
	}

	get(runId: string): ISubagentRun | undefined { return this.active.get(runId)?.value ? cloneSubagentRun(this.active.get(runId)!.value) : this.storage.get(runId); }
	token(runId: string): CancellationToken | undefined { return this.active.get(runId)?.cts.token; }
	list(): readonly ISubagentRun[] { return this.storage.list(); }
	listByParent(conversationId: string, messageId?: string): readonly ISubagentRun[] { return this.storage.list().filter(run => run.parentConversationId === conversationId && (!messageId || run.parentMessageId === messageId)); }

	private update(runId: string, updater: (run: ISubagentRun) => ISubagentRun, terminalEvent?: 'completed' | 'failed' | 'cancelled'): ISubagentRun | undefined {
		const mutable = this.active.get(runId); if (!mutable) { return undefined; }
		mutable.value = updater(mutable.value); this.storage.save(mutable.value);
		const snapshot = cloneSubagentRun(mutable.value);
		this._onDidChangeRun.fire(terminalEvent ? { type: terminalEvent, run: snapshot } : { type: 'changed', run: snapshot });
		if (isTerminalSubagentStatus(snapshot.status)) { if (mutable.timeout) { clearTimeout(mutable.timeout); } mutable.cts.cancel(); mutable.cts.dispose(); this.active.delete(runId); }
		return snapshot;
	}

	transition(runId: string, status: SubagentRunStatus, progress?: string): ISubagentRun | undefined {
		return this.update(runId, run => ({ ...run, status, progress, startedAt: run.startedAt ?? (status !== 'queued' ? Date.now() : undefined) }));
	}
	append(runId: string, event: Omit<ISubagentTimelineEvent, 'sequence' | 'timestamp'>): ISubagentRun | undefined {
		const mutable = this.active.get(runId); if (!mutable) { return undefined; }
		const lastSequence = mutable.value.timeline[mutable.value.timeline.length - 1]?.sequence ?? 0;
		const timelineEvent: ISubagentTimelineEvent = { ...event, sequence: lastSequence + 1, timestamp: Date.now() };
		const updated = this.update(runId, run => ({ ...run, timeline: [...run.timeline, timelineEvent].slice(-500) }));
		if (updated) { this._onDidChangeRun.fire({ type: 'timeline', runId, event: timelineEvent }); }
		return updated;
	}
	recordUsage(runId: string, usage: { inputTokens?: number; outputTokens?: number }): ISubagentRun | undefined {
		const inputTokens = Number.isFinite(usage.inputTokens) ? Math.max(0, Math.floor(usage.inputTokens ?? 0)) : 0;
		const outputTokens = Number.isFinite(usage.outputTokens) ? Math.max(0, Math.floor(usage.outputTokens ?? 0)) : 0;
		if (!inputTokens && !outputTokens) { return this.get(runId); }
		return this.update(runId, run => ({
			...run,
			metrics: {
				...run.metrics,
				inputTokens: run.metrics.inputTokens + inputTokens,
				outputTokens: run.metrics.outputTokens + outputTokens,
			},
		}));
	}
	setChangeSetId(runId: string, changeSetId: string): ISubagentRun | undefined { return this.update(runId, run => ({ ...run, changeSetId })); }
	acquireLease(runId: string, workerId: string, ttlMs = 60_000): ISubagentAttemptLease | undefined {
		const mutable = this.active.get(runId); if (!mutable || isTerminalSubagentStatus(mutable.value.status)) { return undefined; }
		const now = Date.now();
		const lease: ISubagentAttemptLease = { attemptId: generateUuid(), generation: mutable.value.generation + 1, workerId, acquiredAt: now, heartbeatAt: now, expiresAt: now + Math.max(5_000, ttlMs) };
		this.update(runId, run => ({ ...run, generation: lease.generation, attemptCount: run.attemptCount + 1, activeLease: lease }));
		return lease;
	}
	isLeaseCurrent(runId: string, lease: ISubagentAttemptLease): boolean {
		const current = this.active.get(runId)?.value.activeLease;
		return !!current && current.attemptId === lease.attemptId && current.generation === lease.generation && current.workerId === lease.workerId && current.expiresAt >= Date.now();
	}
	renewLease(runId: string, lease: ISubagentAttemptLease, ttlMs = 60_000): boolean {
		if (!this.isLeaseCurrent(runId, lease)) { return false; }
		const now = Date.now(); this.update(runId, run => ({ ...run, activeLease: { ...lease, heartbeatAt: now, expiresAt: now + Math.max(5_000, ttlMs) } })); return true;
	}
	recordRoutingDecision(runId: string, decision: ISubagentRoutingDecision): ISubagentRun | undefined {
		return this.update(runId, run => ({ ...run, profile: decision.profile, routingDecision: decision, providerId: decision.selected?.providerId, model: decision.selected?.model ?? run.model }));
	}
	recordRoutingAttempt(runId: string, attempt: ISubagentRoutingAttempt, fallback: boolean): ISubagentRun | undefined {
		return this.update(runId, run => ({
			...run, providerId: attempt.providerId, model: attempt.model,
			routingAttempts: [...(run.routingAttempts ?? []), attempt].slice(-20),
			metrics: { ...run.metrics, routingAttempts: run.metrics.routingAttempts + 1, fallbacks: run.metrics.fallbacks + (fallback ? 1 : 0) },
		}));
	}
	complete(runId: string, result: ISubagentResult, lease?: ISubagentAttemptLease): ISubagentRun | undefined {
		if (lease && !this.isLeaseCurrent(runId, lease)) { return this.get(runId); }
		return this.update(runId, run => ({ ...run, status: 'completed', completedAt: Date.now(), result, progress: 'Completed', activeLease: undefined }), 'completed');
	}
	private timeout(runId: string, minutes: number): void {
		const mutable = this.active.get(runId);
		if (!mutable) { return; }
		// Cancelling first prevents new events/tools; publishing failed preserves the timeout semantics.
		mutable.cts.cancel();
		this.fail(runId, `Timeout de ${minutes} minutos.`);
	}
	fail(runId: string, error: string): ISubagentRun | undefined { return this.update(runId, run => ({ ...run, status: 'failed', completedAt: Date.now(), error, activeLease: undefined, metrics: { ...run.metrics, errors: run.metrics.errors + 1 } }), 'failed'); }
	cancel(runId: string): boolean { const mutable = this.active.get(runId); if (!mutable) { return false; } mutable.cts.cancel(); this.update(runId, run => ({ ...run, status: 'cancelled', completedAt: Date.now(), activeLease: undefined, metrics: { ...run.metrics, cancellations: run.metrics.cancellations + 1 } }), 'cancelled'); return true; }
	markDelivered(runId: string): void { const run = this.storage.get(runId); if (run && run.deliveryState !== 'delivered') { this.storage.save({ ...run, deliveryState: 'delivered' }); } }
	addChild(parentRunId: string, childRunId: string): void { this.update(parentRunId, run => ({ ...run, childRunIds: run.childRunIds.includes(childRunId) ? run.childRunIds : [...run.childRunIds, childRunId] })); }
}
