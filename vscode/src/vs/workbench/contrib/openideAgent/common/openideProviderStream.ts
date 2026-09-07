/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendOpenideJournal, isOpenideRunJournalError, IOpenideJournalContext } from '../../../../platform/openideAgentHost/common/openideRunJournal.js';
import { openideRecordedRequest } from './openideRunJournal.js';
import { timeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { AgentLoopEvent, AgentStreamEvent, ILLMProvider, IProviderRequest, IProviderResult } from './openideAgentTypes.js';
import { classifyProviderError } from './openideErrorClassifier.js';
import { t } from './openideStrings.js';

const MAX_STREAM_ATTEMPTS = 3;

export interface IOpenideProviderStreamOptions {
	staleTimeoutSeconds(request: IProviderRequest): number;
	wait?(milliseconds: number, token: CancellationToken): Promise<void>;
	random?(): number;
}

/** Retry state and cancellation belong to each invocation, never to the provider instance. */
export class OpenideProviderStream {
	constructor(private readonly options: IOpenideProviderStreamOptions) { }

	private attempt(adapter: ILLMProvider, request: IProviderRequest, onStream: (event: AgentStreamEvent) => void, token: CancellationToken): Promise<IProviderResult> {
		if (token.isCancellationRequested) { return Promise.reject(new CancellationError()); }
		const seconds = this.options.staleTimeoutSeconds(request);
		const attemptCts = new CancellationTokenSource(token);
		return new Promise<IProviderResult>((resolve, reject) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let cancelSub: IDisposable | undefined;
			const cleanup = () => {
				if (timer !== undefined) { clearTimeout(timer); }
				cancelSub?.dispose();
				attemptCts.dispose();
			};
			const fail = (error: unknown) => {
				if (settled) { return; }
				settled = true;
				attemptCts.cancel();
				cleanup(); reject(error);
			};
			const succeed = (result: IProviderResult) => {
				if (settled) { return; }
				settled = true;
				cleanup(); resolve(result);
			};
			const arm = () => {
				if (timer !== undefined) { clearTimeout(timer); }
				if (seconds > 0) { timer = setTimeout(() => fail(new Error(`Stream stale timeout: ${t('agentSurface.chat.staleTimeout', seconds, request.model)}`)), seconds * 1000); }
			};
			cancelSub = token.onCancellationRequested(() => fail(new CancellationError()));
			if (token.isCancellationRequested) { fail(new CancellationError()); }
			if (settled) { cancelSub.dispose(); return; }
			arm();
			// Normalize synchronous transport exceptions and suppress late events from an aborted attempt.
			void Promise.resolve().then(() => {
				if (settled) { throw new CancellationError(); }
				return adapter.streamChat(request, event => { if (!settled) { arm(); onStream(event); } }, attemptCts.token);
			}).then(succeed, fail);
		});
	}

	async stream(adapter: ILLMProvider, request: IProviderRequest, onStream: (event: AgentStreamEvent) => void, token: CancellationToken, onEvent: (event: AgentLoopEvent) => void, journal?: IOpenideJournalContext): Promise<IProviderResult> {
		let activeRequest = request;
		let droppedTools = false;
		for (let attempt = 1; ; attempt++) {
			let emitted = false;
			await appendOpenideJournal(journal, 'model/request', { phase: 'attempt', attempt, request: openideRecordedRequest(activeRequest) });
			if (token.isCancellationRequested) { throw new CancellationError(); }
			try {
				return await this.attempt(adapter, activeRequest, event => {
					if (event.type === 'text' || event.type === 'reasoning' || event.type === 'toolCall' || event.type === 'toolCallDelta') { emitted = true; }
					onStream(event);
				}, token);
			} catch (error) {
				if (isOpenideRunJournalError(error)) { throw error; }
				if (token.isCancellationRequested) { throw error; }
				const classified = classifyProviderError(error instanceof Error ? error.message : String(error));
				if (!emitted && !droppedTools && classified.shouldDropTools && activeRequest.tools?.length) {
					await appendOpenideJournal(journal, 'model/retry', { attempt: attempt + 1, reason: 'tools-rejected', providerId: request.providerId, model: request.model });
					droppedTools = true;
					activeRequest = { ...activeRequest, tools: [], system: `${activeRequest.system ?? ''}\n\nMODEL CAPABILITY: the endpoint rejected function calling. Answer without tools and do not claim to have performed actions in OpenIDE.`.trim() };
					onEvent({ type: 'info', message: t('agentSurface.chat.noFunctionCalling', request.model) });
					continue;
				}
				const transient = classified.kind === 'transient' || classified.kind === 'rate-limit';
				if (emitted || !transient || attempt >= MAX_STREAM_ATTEMPTS) { throw error; }
				const delay = classified.retryAfterMs ?? (Math.min(8000, 600 * 2 ** attempt) + Math.floor((this.options.random?.() ?? Math.random()) * 300));
				await appendOpenideJournal(journal, 'model/retry', { attempt: attempt + 1, max: MAX_STREAM_ATTEMPTS, delayMs: delay, kind: classified.kind, providerId: request.providerId, model: request.model });
					onEvent({ type: 'retry', kind: classified.kind === 'rate-limit' ? 'rate-limit' : 'transient', attempt: attempt + 1, max: MAX_STREAM_ATTEMPTS, delayMs: delay });
				await (this.options.wait ?? timeout)(delay, token);
				if (token.isCancellationRequested) { throw new CancellationError(); }
			}
		}
	}
}
