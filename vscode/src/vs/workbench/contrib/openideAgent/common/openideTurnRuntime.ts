/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { appendOpenideJournal, isOpenideRunJournalError, IOpenideJournalContext, IOpenideRunJournal, OPENIDE_UNKNOWN_TOOL_OUTCOME } from '../../../../platform/openideAgentHost/common/openideRunJournal.js';
import { openideRecordedRequest } from './openideRunJournal.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { AgentLoopEvent, AgentStreamEvent, IChatMessage, IProviderRequest, IProviderResult, IToolCall } from './openideAgentTypes.js';
import { classifyProviderError } from './openideErrorClassifier.js';
import { isOutputLimitStopReason, MAX_OUTPUT_CONTINUATIONS } from './openideRunLimits.js';
import { OpenideRunSequencer } from './openideRunSequencer.js';
import { t } from './openideStrings.js';
import { estimateConversationTokens, estimateTextTokens, estimateToolsTokens } from './openideTokens.js';
import { sealOrphanToolCalls } from './openideToolPairing.js';

const OUTPUT_CONTINUATION_PROMPT = '[Internal OpenIDE continuation: the previous answer hit the output limit. Continue exactly where it was cut off, without repeating text and without calling the task finished early.]';

type Usage = Partial<Extract<AgentStreamEvent, { type: 'usage' }>>;
export type OpenideTurnOutcome = 'completed' | 'stopped' | 'cancelled';

/** All product-specific behavior enters through these ports; the loop has no editor or IPC. */
export interface IOpenideTurnPorts {
	stream(request: IProviderRequest, onStream: (event: AgentStreamEvent) => void, journal?: IOpenideJournalContext): Promise<IProviderResult>;
	compact(origin: 'automatic' | 'manual' | 'recovery', journal?: IOpenideJournalContext): Promise<boolean>;
	readonly journal?: IOpenideRunJournal;
	/** Returns true when a tool (for example plan approval) ends the turn. */
	executeTools(calls: readonly IToolCall[], emit: (event: AgentLoopEvent) => void): Promise<boolean>;
	enrichUsage(event: Usage, reported: boolean): AgentLoopEvent;
	planDraft(id: string, argumentsJson: string): void;
	stop(): void;
	checkpoint?(reason: 'completed' | 'milestone' | 'interrupted'): Promise<void>;
}

export interface IOpenideTurnRequest {
	readonly messages: IChatMessage[];
	readonly provider: Omit<IProviderRequest, 'messages'>;
	readonly token: CancellationToken;
	readonly onEvent: (event: AgentLoopEvent) => void;
	readonly maxIterations: number;
	readonly messageId?: string;
	readonly runtimeContext?: string;
	readonly compactOnly?: boolean;
	readonly contextLimit?: number;
	readonly runId?: string;
}

/** One invocation owns all continuation and recovery state, including concurrent sessions. */
export async function runOpenideTurn(request: IOpenideTurnRequest, ports: IOpenideTurnPorts): Promise<OpenideTurnOutcome> {
	const { messages, provider, token, maxIterations } = request;
	const journal = ports.journal ? { journal: ports.journal, runId: request.runId ?? generateUuid() } : undefined;
	let terminal = false;
	let queuedTerminal: AgentLoopEvent | undefined;
	const emit = (event: AgentLoopEvent) => {
		if (terminal || token.isCancellationRequested) { return; }
		if (event.type === 'done' || event.type === 'error') { terminal = true; queuedTerminal = event; return; }
		request.onEvent(event);
	};
	let contextOverflowRecoveries = 0;
	let imageFallbackApplied = false;
	let continueTruncatedOutput = false;
	let outputContinuations = 0;
	try {
		if (token.isCancellationRequested) { return 'cancelled'; }
		await appendOpenideJournal(journal, 'run/start', { messages });
		if (token.isCancellationRequested) { return 'cancelled'; }
		const sealed = sealOrphanToolCalls(messages);
		if (sealed > 0) { emit({ type: 'info', message: t('agentSurface.chat.sealedToolCalls', sealed) }); }
		if (request.compactOnly) {
			await ports.compact('manual', journal);
			if (token.isCancellationRequested) { return 'cancelled'; }
			emit({ type: 'done', reason: 'compaction' });
			return 'completed';
		}
		for (let iteration = 0; iteration < maxIterations; iteration++) {
			if (token.isCancellationRequested) { return 'cancelled'; }
			const isOutputContinuation = continueTruncatedOutput;
			continueTruncatedOutput = false;
			await ports.compact('automatic', journal);
			if (token.isCancellationRequested) { return 'cancelled'; }
			let sawUsage = false;
			let runtimeOwnerIndex = request.messageId ? messages.findIndex(message => message.messageId === request.messageId) : -1;
			if (runtimeOwnerIndex < 0) {
				for (let index = messages.length - 1; index >= 0; index--) { if (messages[index].role === 'user') { runtimeOwnerIndex = index; break; } }
			}
			const wireMessages = messages.map((message, index) => {
				const additions = [message.context, index === runtimeOwnerIndex ? request.runtimeContext : ''].filter(Boolean).join('\n\n');
				const withContext = additions ? { ...message, content: `${message.content}\n\n${additions}` } : message;
				if (!imageFallbackApplied || !withContext.images?.length) { return withContext; }
				const { images, ...withoutImages } = withContext;
				return { ...withoutImages, content: `${withoutImages.content}\n\n[${images.length} image(s) omitted: the active model does not support vision]` };
			});
			if (isOutputContinuation) { wireMessages.push({ role: 'user', content: OUTPUT_CONTINUATION_PROMPT }); }
			const requiredTokens = estimateConversationTokens(wireMessages) + estimateTextTokens(provider.system) + estimateToolsTokens(provider.tools) + (provider.maxTokens ?? 0);
			if (request.contextLimit && requiredTokens > request.contextLimit) {
				emit({ type: 'error', message: t('memory.requestTooLarge', requiredTokens, request.contextLimit) });
				return 'stopped';
			}
			let iterationEmitted = false;
			let result: IProviderResult;
			await appendOpenideJournal(journal, 'model/request', { phase: 'dispatch', iteration, projection: messages, request: openideRecordedRequest({ ...provider, messages: wireMessages }) });
			if (token.isCancellationRequested) { return 'cancelled'; }
			try {
				result = await ports.stream({ ...provider, messages: wireMessages }, event => {
					if (token.isCancellationRequested) { return; }
					if (event.type === 'text' || event.type === 'reasoning') {
						iterationEmitted = true;
						emit(event);
					} else if (event.type === 'usage') {
						sawUsage = true;
						emit(ports.enrichUsage(event, true));
					} else if (event.type === 'info') {
						emit(event);
					} else if (event.type === 'toolCallDelta' && event.name === 'plan_save') {
						ports.planDraft(event.id, event.argumentsJson);
					}
				}, journal);
			} catch (error) {
				if (isOpenideRunJournalError(error)) { throw error; }
				if (token.isCancellationRequested) { return 'cancelled'; }
				const classified = classifyProviderError(error instanceof Error ? error.message : String(error));
				if (classified.shouldCompact && !iterationEmitted && contextOverflowRecoveries < 1) {
					contextOverflowRecoveries++;
					if (await ports.compact('recovery', journal)) { iteration--; continue; }
				}
				if (classified.shouldDropImages && !iterationEmitted && !imageFallbackApplied && messages.some(message => !!message.images?.length)) {
					imageFallbackApplied = true;
					emit({ type: 'info', message: t('agentSurface.chat.imagesRejected') });
					iteration--; continue;
				}
				throw error;
			}
			if (token.isCancellationRequested) { return 'cancelled'; }
			await appendOpenideJournal(journal, 'model/result', { iteration, continuation: isOutputContinuation, message: result.message, stopReason: result.stopReason });
			if (token.isCancellationRequested) { return 'cancelled'; }
			if (isOutputContinuation && messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
				const previous = messages[messages.length - 1];
				messages[messages.length - 1] = { ...previous, content: `${previous.content ?? ''}${result.message.content ?? ''}`, toolCalls: result.message.toolCalls, geminiParts: result.message.geminiParts };
			} else { messages.push(result.message); }
			if (!sawUsage) { emit(ports.enrichUsage({}, false)); }
			const calls = result.message.toolCalls;
			if (!calls?.length) {
				if (isOutputLimitStopReason(result.stopReason) && outputContinuations < MAX_OUTPUT_CONTINUATIONS) {
					outputContinuations++;
					continueTruncatedOutput = true;
					if (outputContinuations === 1) { emit({ type: 'info', message: t('agentSurface.chat.outputLimitContinued') }); }
					continue;
				}
				if (!result.message.content?.trim()) {
					const stopInfo = result.stopReason ? ` (finish_reason: ${result.stopReason})` : '';
					const nimHint = provider.providerId === 'nvidia-nim' ? t('agentSurface.chat.nimEmptyHint') : '';
					emit({ type: 'error', message: t('agentSurface.chat.emptyResponse', stopInfo, nimHint) });
					return 'stopped';
				}
				await ports.checkpoint?.('completed');
				ports.stop();
				emit({ type: 'done', reason: result.stopReason });
				return 'completed';
			}
			for (const call of calls) {
				await appendOpenideJournal(journal, 'tool/intent', { operationId: `${iteration}:${call.id}`, callId: call.id, name: call.name, argumentsJson: call.argumentsJson });
			}
			if (token.isCancellationRequested) { return 'cancelled'; }
			let pendingTerminal: AgentLoopEvent | undefined;
			const stopped = await ports.executeTools(calls, event => {
				if (event.type === 'done' || event.type === 'error') { pendingTerminal ??= event; } else { emit(event); }
			});
			for (const call of calls) {
				const message = messages.findLast(message => message.role === 'tool' && message.toolCallId === call.id);
				if (message) { await appendOpenideJournal(journal, 'tool/result', { operationId: `${iteration}:${call.id}`, callId: call.id, message }); }
			}
			if (iteration % 8 === 7 && !token.isCancellationRequested) { await ports.checkpoint?.('milestone'); }
			if (pendingTerminal) { emit(pendingTerminal); }
			if (stopped) { return token.isCancellationRequested ? 'cancelled' : 'stopped'; }
		}
		ports.stop();
		emit({ type: 'error', message: t('agentSurface.chat.iterationLimit', maxIterations), action: 'continue' });
		return token.isCancellationRequested ? 'cancelled' : 'stopped';
	} finally {
		// Tool failures, cancellation and intentional early stops must leave usable history.
		if (token.isCancellationRequested || queuedTerminal?.type !== 'done') { await ports.checkpoint?.('interrupted'); }
		sealOrphanToolCalls(messages, journal ? OPENIDE_UNKNOWN_TOOL_OUTCOME : undefined);
		await appendOpenideJournal(journal, 'run/end', { cancelled: token.isCancellationRequested, messages });
		if (queuedTerminal && !token.isCancellationRequested) { request.onEvent(queuedTerminal); }
	}
}

/** Per-conversation serialization with cleanup and no cross-session head-of-line blocking. */
export class OpenideTurnCoordinator {
	private readonly queues = new Map<string, { sequencer: OpenideRunSequencer; pending: number }>();
	async run(conversationId: string | undefined, token: CancellationToken, operation: () => Promise<void>, release: () => void): Promise<void> {
		const key = conversationId ?? '';
		let entry = this.queues.get(key);
		if (!entry) { entry = { sequencer: new OpenideRunSequencer(), pending: 0 }; this.queues.set(key, entry); }
		entry.pending++;
		try {
			await entry.sequencer.queue(async () => {
				if (token.isCancellationRequested) { return; }
				try { await operation(); } finally { release(); }
			});
		} finally {
			if (--entry.pending === 0) { this.queues.delete(key); }
		}
	}
}
