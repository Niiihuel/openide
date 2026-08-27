/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — foreground/background orchestration, nesting and exactly-once delivery.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { raceCancellation } from '../../../../base/common/async.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICreateSubagentRunOptions, isTerminalSubagentStatus, ISubagentResult, ISubagentRun, SubagentRunEvent } from '../common/openideSubagentTypes.js';
import { classifySubagentTask, ISubagentRoutingTarget, subagentTargetKey } from '../common/openideSubagentRouting.js';
import { classifyProviderError } from '../common/openideErrorClassifier.js';
import { ISubagentExecutionService } from './openideSubagentExecutionService.js';
import { ISubagentPermissionService } from './openideSubagentPermissionService.js';
import { ISubagentRegistryService } from './openideSubagentRegistryService.js';
import { ISubagentRunService } from './openideSubagentRunService.js';
import { ISubagentRoutingService } from './openideSubagentRoutingService.js';

export const ISubagentOrchestrationService = createDecorator<ISubagentOrchestrationService>('openideSubagentOrchestrationService');

export interface IDelegateSubagentRequest extends Omit<ICreateSubagentRunOptions, 'definition'> { readonly agent: string }
export interface ISubagentOrchestrationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeRun: Event<SubagentRunEvent>;
	delegate(request: IDelegateSubagentRequest): Promise<ISubagentRun>;
	get(runId: string): ISubagentRun | undefined;
	getRunsForParent(conversationId: string, messageId?: string): readonly ISubagentRun[];
	awaitResult(runId: string): Promise<ISubagentRun>;
	cancel(runId: string): boolean;
	markDelivered(runId: string): void;
	pendingDeliveries(conversationId?: string): readonly ISubagentRun[];
}

export class SubagentOrchestrationService implements ISubagentOrchestrationService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeRun: Event<SubagentRunEvent>;
	private readonly completions = new Map<string, Promise<ISubagentRun>>();
	private running = 0;
	private readonly queue: Array<() => void> = [];

	constructor(
		@ISubagentRegistryService private readonly registry: ISubagentRegistryService,
		@ISubagentRunService private readonly runs: ISubagentRunService,
		@ISubagentExecutionService private readonly execution: ISubagentExecutionService,
		@ISubagentPermissionService private readonly permissions: ISubagentPermissionService,
		@ISubagentRoutingService private readonly routing: ISubagentRoutingService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		// Assigned here and not as a field initializer: `this.runs` is a parameter property, which
		// under `useDefineForClassFields` semantics is not yet set when initializers run.
		this.onDidChangeRun = this.runs.onDidChangeRun;
		void this.registry.initialize();
	}

	async delegate(request: IDelegateSubagentRequest): Promise<ISubagentRun> {
		await this.registry.whenReady();
		const definition = this.registry.get(request.agent);
		if (!definition) { throw new Error(`Subagente no registrado: ${request.agent}.`); }
		if (!definition.readonly && this.configurationService.getValue<boolean>('openide.subagents.allowWritable') !== true) {
			throw new Error(`El subagente ${definition.name} necesita escritura. Habilitá openide.subagents.allowWritable para ejecutarlo.`);
		}
		const configuredDepth = Number(this.configurationService.getValue('openide.subagents.maxDepth'));
		const maxDepth = Math.max(0, Number.isFinite(configuredDepth) ? configuredDepth : 2);
		const parent = request.parentRunId ? this.runs.get(request.parentRunId) : undefined;
		if (request.parentRunId && !parent) { throw new Error('El parentRunId no existe.'); }
		if (parent && (parent.status === 'completed' || parent.status === 'failed' || parent.status === 'cancelled' || parent.status === 'interrupted')) { throw new Error('No se puede delegar desde un run terminal.'); }
		const depth = parent ? parent.depth + 1 : 0;
		const ancestors: string[] = [];
		let cursor = parent;
		while (cursor) { ancestors.push(cursor.definitionId); cursor = cursor.parentRunId ? this.runs.get(cursor.parentRunId) : undefined; }
		const nesting = this.permissions.validateNesting(definition.id, depth, ancestors, maxDepth);
		if (!nesting.allowed) { throw new Error(nesting.reason); }
		const controller = this.runs.create({
			...request,
			parentConversationId: parent?.parentConversationId ?? request.parentConversationId,
			parentMessageId: parent?.parentMessageId ?? request.parentMessageId,
			depth,
			definition,
		});
		if (parent) { this.runs.addChild(parent.runId, controller.run.runId); }
		const completion = this.execute(controller.run.runId, definition, request);
		this.completions.set(controller.run.runId, completion);
		void completion.then(() => this.completions.delete(controller.run.runId), () => this.completions.delete(controller.run.runId));
		return controller.run.background ? controller.run : completion;
	}

	private async acquireSlot(token: { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): { dispose(): void } }): Promise<boolean> {
		if (token.isCancellationRequested) { return false; }
		const limit = Math.max(1, Math.min(16, Number(this.configurationService.getValue('openide.subagents.maxParallelRuns')) || 4));
		if (this.running < limit) { this.running++; return !token.isCancellationRequested || (this.releaseSlot(), false); }
		return new Promise<boolean>(resolve => {
			let active = true;
			let cancel: { dispose(): void } | undefined;
			const resume = () => { if (!active) { return; } active = false; cancel?.dispose(); if (token.isCancellationRequested) { resolve(false); return; } this.running++; resolve(true); };
			this.queue.push(resume);
			cancel = token.onCancellationRequested(() => { if (!active) { return; } active = false; const index = this.queue.indexOf(resume); if (index >= 0) { this.queue.splice(index, 1); } resolve(false); });
			if (token.isCancellationRequested && active) { active = false; const index = this.queue.indexOf(resume); if (index >= 0) { this.queue.splice(index, 1); } cancel.dispose(); resolve(false); }
		});
	}

	private releaseSlot(): void {
		this.running = Math.max(0, this.running - 1);
		const next = this.queue.shift();
		if (next) { next(); }
	}

	private async execute(runId: string, definition: NonNullable<ReturnType<ISubagentRegistryService['get']>>, request: IDelegateSubagentRequest): Promise<ISubagentRun> {
		const token = this.runs.token(runId);
		if (!token) { throw new Error('Token del run no disponible.'); }
		this.runs.transition(runId, 'queued', 'Waiting for execution slot');
		if (!await this.acquireSlot(token)) { return this.runs.cancel(runId) ? this.runs.get(runId)! : this.runs.get(runId)!; }
		try {
		this.runs.transition(runId, 'starting', 'Starting');
		if (token.isCancellationRequested) { this.runs.cancel(runId); return this.runs.get(runId)!; }
		const current = this.runs.get(runId);
		if (!current || isTerminalSubagentStatus(current.status)) { return current ?? Promise.reject(new Error('Run no disponible.')); }
		// Each writer keeps its own durable identity before it can dispatch tools.
		// The backend attributes edits to a runId; persisting it allows isolated rollback after a reload.
		if (!definition.readonly) { this.runs.setChangeSetId(runId, runId); }
		const classification = classifySubagentTask({ explicitProfile: definition.profile, origin: 'delegation', readonly: definition.readonly, writable: !definition.readonly, tools: definition.tools, task: request.task });
		const tried = new Set<string>();
		let target: ISubagentRoutingTarget | undefined;
		let decision;
		if (this.routing.isEnabled()) {
			try { decision = await raceCancellation(this.routing.decide(classification.profile, {}, tried), token); }
			catch (error) { return this.runs.fail(runId, `No se pudo resolver routing: ${error instanceof Error ? error.message : String(error)}`) ?? this.runs.get(runId)!; }
			if (!decision || token.isCancellationRequested || isTerminalSubagentStatus(this.runs.get(runId)?.status ?? 'cancelled')) { return this.runs.get(runId)!; }
			target = decision.selected;
			this.runs.recordRoutingDecision(runId, { ...decision, reason: `${decision.reason}; ${classification.reason}` });
			if (!target) { return this.runs.fail(runId, `Routing habilitado sin target elegible para ${classification.profile}.`) ?? this.runs.get(runId)!; }
		}
		const maxAttempts = this.routing.isEnabled() ? this.routing.policy().maxAttempts : 1;
		for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
			const lease = this.runs.acquireLease(runId, `orchestrator:${attemptNumber}`);
			if (!lease) { return this.runs.get(runId)!; }
			let emittedOutput = false;
			let producedSideEffects = false;
			const startedAt = Date.now();
			try {
				if (token.isCancellationRequested || isTerminalSubagentStatus(this.runs.get(runId)?.status ?? 'cancelled')) { return this.runs.get(runId)!; }
				const result: ISubagentResult = await this.execution.execute({
					runId, definition, task: request.task, model: target?.model ?? current.model, target, profile: classification.profile, context: request.context,
					token, onExecutionState: state => { if (!this.runs.isLeaseCurrent(runId, lease)) { return; } emittedOutput ||= state.emittedOutput === true; producedSideEffects ||= state.producedSideEffects === true; },
					onEvent: event => { if (token.isCancellationRequested || !this.runs.isLeaseCurrent(runId, lease)) { return; } this.runs.renewLease(runId, lease); if (event.type === 'toolStart') { const risk = event.toolName ? this.permissions.checkTool(definition, event.toolName, definition.readonly ? 'safe' : 'write') : undefined; producedSideEffects ||= risk?.allowed === true && !definition.readonly; } this.runs.append(runId, event); if (event.type === 'progress' && event.message) { this.runs.transition(runId, 'running', event.message); } },
					onUsage: usage => { if (!token.isCancellationRequested && this.runs.isLeaseCurrent(runId, lease)) { this.runs.recordUsage(runId, usage); } },
				});
				if (token.isCancellationRequested || isTerminalSubagentStatus(this.runs.get(runId)?.status ?? 'cancelled')) { return this.runs.get(runId)!; }
				if (target) { this.routing.recordSuccess(target); this.runs.recordRoutingAttempt(runId, { providerId: target.providerId, model: target.model, attempt: attemptNumber, startedAt, completedAt: Date.now(), outcome: 'completed', emittedOutput, producedSideEffects }, attemptNumber > 1); }
				return this.runs.complete(runId, result, lease) ?? this.runs.get(runId)!;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const classified = classifyProviderError(message, target ? { providerId: target.providerId, model: target.model } : undefined);
				if (target) {
					if (!token.isCancellationRequested) { this.routing.recordFailure(target, classified); }
					this.runs.recordRoutingAttempt(runId, { providerId: target.providerId, model: target.model, attempt: attemptNumber, startedAt, completedAt: Date.now(), outcome: token.isCancellationRequested ? 'cancelled' : 'failed', errorKind: classified.kind, errorReason: classified.reason, emittedOutput, producedSideEffects }, attemptNumber > 1);
					tried.add(subagentTargetKey(target));
				}
				if (token.isCancellationRequested) { return this.runs.get(runId) ?? Promise.reject(error); }
				const recoverable = classified.kind === 'auth' || classified.kind === 'billing' || classified.kind === 'rate-limit' || classified.kind === 'transient' || classified.reason === 'model-not-found' || classified.reason === 'model-retired' || classified.reason === 'provider-unavailable' || classified.reason === 'project-not-found';
				if (!this.routing.isEnabled() || !this.routing.policy().fallbackEnabled || !recoverable || emittedOutput || producedSideEffects || token.isCancellationRequested || attemptNumber >= maxAttempts) {
					return this.runs.fail(runId, message) ?? this.runs.get(runId)!;
				}
				try { decision = await raceCancellation(this.routing.decide(classification.profile, {}, tried), token); }
				catch (routingError) { return this.runs.fail(runId, `Falló la reselección de routing: ${routingError instanceof Error ? routingError.message : String(routingError)}`) ?? this.runs.get(runId)!; }
				if (!decision || token.isCancellationRequested || isTerminalSubagentStatus(this.runs.get(runId)?.status ?? 'cancelled')) { return this.runs.get(runId)!; }
				target = decision.selected;
				if (!target) { return this.runs.fail(runId, message) ?? this.runs.get(runId)!; }
				this.runs.append(runId, { type: 'progress', message: `Fallback a ${target.providerId}/${target.model} (${classified.reason})` });
			}
		}
		return this.runs.fail(runId, 'Se agotaron los targets de routing.') ?? this.runs.get(runId)!;
		} finally {
			this.releaseSlot();
		}
	}

	get(runId: string): ISubagentRun | undefined { return this.runs.get(runId); }
	getRunsForParent(conversationId: string, messageId?: string): readonly ISubagentRun[] { return this.runs.listByParent(conversationId, messageId); }
	async awaitResult(runId: string): Promise<ISubagentRun> {
		const snapshot = this.runs.get(runId);
		if (snapshot && isTerminalSubagentStatus(snapshot.status)) { return snapshot; }
		const completion = this.completions.get(runId);
		return completion ? completion : Promise.resolve(snapshot ?? Promise.reject(new Error('Run inexistente.')) as never);
	}
	cancel(runId: string): boolean {
		const run = this.runs.get(runId);
		if (!run) { return false; }
		for (const childRunId of run.childRunIds) { this.cancel(childRunId); }
		return this.runs.cancel(runId);
	}
	markDelivered(runId: string): void { this.runs.markDelivered(runId); }
	pendingDeliveries(conversationId?: string): readonly ISubagentRun[] { const runs = conversationId ? this.runs.listByParent(conversationId) : this.runs.list(); return runs.filter(run => run.deliveryState === 'pending' && (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted')); }
}
