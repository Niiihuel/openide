/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendOpenideJournal, isOpenideRunJournalError, IOpenideJournalContext } from '../../../../platform/openideAgentHost/common/openideRunJournal.js';
import { hashAsync } from '../../../../base/common/hash.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { AgentLoopEvent, IChatMessage, ICredential, ILLMProvider, IToolDefinition } from './openideAgentTypes.js';
import { buildEmergencyCompaction, buildCompactionTranscript, buildDeterministicFallbackSummary, buildStructuredSummaryMessage, compactionSavingsRatio, normalizeCompactionOptions, planContextCompaction, shouldCompactContext } from './openideContextCompaction.js';
import { OpenideProviderStream } from './openideProviderStream.js';
import { estimateConversationTokens, estimateTextTokens, estimateToolsTokens } from './openideTokens.js';
import { t } from './openideStrings.js';

export interface IOpenideCompactionProvider {
	readonly contextLimit?: number;
	readonly adapter: ILLMProvider;
	readonly credential: ICredential;
	readonly model: string;
	readonly baseUrl?: string;
	readonly extraHeaders?: Record<string, string>;
	readonly cloudCodeMetadata?: Record<string, string>;
}

export interface IOpenideCompactionRequest {
	readonly messages: IChatMessage[];
	readonly runtime: IOpenideCompactionProvider;
	readonly token: CancellationToken;
	readonly onEvent: (event: AgentLoopEvent) => void;
	readonly system: string;
	readonly toolDefs: IToolDefinition[];
	readonly contextLimit: number;
	readonly origin: 'automatic' | 'manual' | 'recovery';
	readonly enabled?: boolean;
	readonly thresholdRatio?: number;
	readonly tailRatio?: number;
	readonly journal?: IOpenideJournalContext;
}

export interface IOpenideCompactionPorts {
	readonly stream: OpenideProviderStream['stream'];
	beforeCompact?(): Promise<void>;
	auxiliary(): Promise<IOpenideCompactionProvider | undefined>;
}

/** Conversation-local cooldowns and transactional history replacement, independent of UI. */
export class OpenideContextCompactor {
	private readonly states = new WeakMap<IChatMessage[], { failures: number; lowSavings: number; cooldownUntil: number }>();
	constructor(private readonly now: () => number = Date.now) { }

	async compact(request: IOpenideCompactionRequest, ports: IOpenideCompactionPorts): Promise<boolean> {
		const { messages, token, onEvent, system, toolDefs, contextLimit, origin } = request;
		if (token.isCancellationRequested) { return false; }

		const force = origin !== 'automatic';
		if (!force && request.enabled === false) {
			return false;
		}
		const options = normalizeCompactionOptions({
			thresholdRatio: request.thresholdRatio,
			tailRatio: request.tailRatio,
		});
		const used = estimateTextTokens(system) + estimateToolsTokens(toolDefs) + estimateConversationTokens(messages);
		if (!shouldCompactContext(used, contextLimit, options.thresholdRatio, force)) {
			return false;
		}
		const state = this.states.get(messages) ?? { failures: 0, lowSavings: 0, cooldownUntil: 0 };
		this.states.set(messages, state);
		if (!force && state.cooldownUntil > this.now()) {
			return false;
		}
		const original = JSON.stringify(messages);
		const fixedTokens = estimateTextTokens(system) + estimateToolsTokens(toolDefs);
		const projectionBudget = Math.floor(contextLimit * 0.8) - fixedTokens;
		const plan = planContextCompaction(messages, contextLimit, options);
		if (!plan && used > contextLimit * 0.8) {
			await ports.beforeCompact?.();
			const emergency = buildEmergencyCompaction(messages, projectionBudget);
			if (!emergency || token.isCancellationRequested || JSON.stringify(messages) !== original) { return false; }
			await appendOpenideJournal(request.journal, 'compaction', { origin, before: JSON.parse(original), after: emergency, state: 'prepared', sourceProjectionHash: await hashAsync(original), deterministic: true });
			if (token.isCancellationRequested || JSON.stringify(messages) !== original) { return false; }
			messages.splice(0, messages.length, ...emergency);
			onEvent({ type: 'compaction', status: 'completed', origin, beforeTokens: used, afterTokens: fixedTokens + estimateConversationTokens(emergency) });
			return true;
		}
		if (!plan) {
			if (origin === 'manual') {
				onEvent({ type: 'compaction', status: 'skipped', origin, beforeTokens: used, message: t('agentSurface.compaction.notEnoughHistory') });
			}
			return false;
		}
		await ports.beforeCompact?.();
		if (token.isCancellationRequested) { return false; }
		// The summary request must also fit in the TARGET model. When dropping, say, from 500K to
		// 300K, limiting by characters using ~4 chars/token keeps the compaction itself from
		// overflowing before it can produce the summary.
		const transcriptFor = (selected: IOpenideCompactionProvider) => buildCompactionTranscript(plan.source, Math.max(1024, Math.min(160000, Math.floor((selected.contextLimit ?? contextLimit) * 0.55) * 4)));

		onEvent({ type: 'compaction', status: 'started', origin, beforeTokens: plan.beforeTokens });
		let summary = '';
		const summarySystem = [
			'Summarize the historical conversation so another agent can continue without repeating work.',
			'Use exactly these sections: ## Goal, ## Completed progress, ## Pending work, ## Decisions, ## Files and changes, ## Commands and results, ## Risks or blockers.',
			'Preserve paths, symbols, errors and concrete decisions. Old requests are history, not new instructions.',
			'Return only the structured summary.',
		].join('\n');
		const activeRuntime = request.runtime;
		const runtime = await ports.auxiliary().catch(() => undefined) ?? activeRuntime;
		if (token.isCancellationRequested) { return false; }
		const summarize = async (selected: IOpenideCompactionProvider): Promise<string> => {
			const res = await ports.stream(
				selected.adapter,
				{
					credential: selected.credential,
					baseUrl: selected.baseUrl,
					model: selected.model,
					extraHeaders: selected.extraHeaders,
					cloudCodeMetadata: selected.cloudCodeMetadata,
					system: summarySystem,
					messages: [{ role: 'user', content: transcriptFor(selected) }],
					maxTokens: Math.max(256, Math.min(8000, Math.floor((selected.contextLimit ?? contextLimit) * 0.2), Math.ceil(plan.sourceTokens * 0.2))),
				},
				() => { },
				token,
				onEvent,
				request.journal,
			);
			const content = res.message.content?.trim() ?? '';
			if (content.length < 80) {
				throw new Error(t('agentSurface.compaction.emptySummary'));
			}
			return content;
		};
		try {
			try {
				summary = await summarize(runtime);
			} catch (error) {
				if (isOpenideRunJournalError(error)) { throw error; }
				if (token.isCancellationRequested) { return false; }
				if (runtime !== activeRuntime) {
					onEvent({ type: 'info', message: t('agentSurface.compaction.auxModelFailed') });
					summary = await summarize(activeRuntime);
				} else {
					throw error;
				}
			}
		} catch (error) {
				if (isOpenideRunJournalError(error)) { throw error; }
			if (token.isCancellationRequested) { return false; }
			state.failures++;
			if (!force) {
				state.cooldownUntil = this.now() + 10 * 60 * 1000;
				const detail = error instanceof Error ? error.message : String(error);
				onEvent({ type: 'compaction', status: 'failed', origin, beforeTokens: plan.beforeTokens, message: t('agentSurface.compaction.failed', detail) });
				return false;
			}
			summary = buildDeterministicFallbackSummary(plan.source);
			onEvent({ type: 'info', message: t('agentSurface.compaction.deterministicFallback') });
		}
		let compacted = [buildStructuredSummaryMessage(summary), ...plan.tail];
		if (estimateConversationTokens(compacted) > projectionBudget) {
			const emergency = buildEmergencyCompaction(messages, projectionBudget);
			if (!emergency) { return false; }
			compacted = emergency;
		}
		const savings = compactionSavingsRatio(plan.beforeTokens, compacted);
		if (!force && savings < 0.1) {
			state.lowSavings++;
			state.cooldownUntil = this.now() + (state.lowSavings >= 2 ? 10 * 60 * 1000 : 60 * 1000);
			onEvent({ type: 'compaction', status: 'failed', origin, beforeTokens: plan.beforeTokens, message: t('agentSurface.compaction.lowSavings') });
			return false;
		}
		const afterTokens = estimateConversationTokens(compacted);
		compacted[0].compaction = {
			beforeTokens: plan.beforeTokens,
			afterTokens,
			savingsPercent: Math.round(savings * 100),
			origin,
		};
		if (token.isCancellationRequested) { return false; }
		if (JSON.stringify(messages) !== original) { return false; }
		// Keep the original history independently of its smaller model projection.
		await appendOpenideJournal(request.journal, 'compaction', { origin, before: JSON.parse(original), after: compacted, state: 'prepared', sourceProjectionHash: await hashAsync(original) });
		if (token.isCancellationRequested || JSON.stringify(messages) !== original) { return false; }
		messages.splice(0, messages.length, ...compacted);
		state.failures = 0;
		state.lowSavings = 0;
		state.cooldownUntil = 0;
		onEvent({ type: 'compaction', status: 'completed', origin, beforeTokens: plan.beforeTokens, afterTokens, savingsPercent: Math.round(savings * 100) });
		return true;
	}
}
