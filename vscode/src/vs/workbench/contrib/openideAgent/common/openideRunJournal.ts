/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideRunJournalRecord, OPENIDE_UNKNOWN_TOOL_OUTCOME, openideJournalSnapshot } from '../../../../platform/openideAgentHost/common/openideRunJournal.js';
import { IChatMessage, IProviderRequest } from './openideAgentTypes.js';

const JOURNAL_TEXT_PREVIEW = 2048;
const JOURNAL_MESSAGE_TAIL = 12;
const JOURNAL_TOOL_NAMES = 64;

function recordedText(value: string | undefined): { readonly chars: number; readonly preview: string } {
	const text = value ?? '';
	return { chars: text.length, preview: text.slice(0, JOURNAL_TEXT_PREVIEW) };
}

/**
 * Record bounded diagnostics for the model-facing envelope. The durable conversation projection is
 * already checkpointed by run/start, model/result, tool/result and committed compaction events;
 * copying every message and image again for dispatch and retry made long journals grow by gigabytes.
 */
export function openideRecordedRequest(request: IProviderRequest) {
	const tail = request.messages.slice(-JOURNAL_MESSAGE_TAIL).map(message => ({
		role: message.role,
		content: recordedText(message.content),
		imageCount: message.images?.length ?? 0,
		toolCallId: message.toolCallId,
		toolCalls: message.toolCalls?.map(call => ({ id: call.id, name: call.name, argumentsChars: call.argumentsJson.length })),
	}));
	return openideJournalSnapshot({
		providerId: request.providerId,
		model: request.model,
		effort: request.effort,
		serviceTier: request.serviceTier,
		system: recordedText(request.system),
		messageCount: request.messages.length,
		omittedMessages: Math.max(0, request.messages.length - tail.length),
		messages: tail,
		toolCount: request.tools?.length ?? 0,
		tools: request.tools?.slice(0, JOURNAL_TOOL_NAMES).map(tool => tool.name),
		maxTokens: request.maxTokens,
	});
}

/** A crash result is uncertainty, not permission to repeat an effect. Newer user messages are retained. */
export function applyOpenideJournalRecovery(messages: IChatMessage[], records: readonly IOpenideRunJournalRecord[]): number {
	let recovered = 0;
	for (const { event } of records) {
		if (event.kind !== 'tool/unknown') { continue; }
		const recoveryId = `openide-recovery:${event.runId}:${event.payload['operationId']}`;
		if (messages.some(message => message.messageId === recoveryId) || records.some(record => {
			const history = record.event.kind === 'run/start' || record.event.kind === 'run/end' ? record.event.payload['messages'] : undefined;
			return Array.isArray(history) && history.some(message => message && typeof message === 'object' && !Array.isArray(message) && message['messageId'] === recoveryId);
		})) { continue; }
		const callId = event.payload['callId'];
		const owner = typeof callId === 'string' ? messages.findLastIndex(message => message.toolCalls?.some(call => call.id === callId && call.name === event.payload['name'] && call.argumentsJson === event.payload['argumentsJson'])) : -1;
		if (owner < 0) {
			// The UI snapshot may predate the assistant's durable call. Preserve the new prompt and add
			// uncertainty as context instead of silently dropping the effect or replacing newer history.
			const currentPrompt = messages.findLastIndex(message => message.role === 'user' && !message.hidden);
			const argumentsText = event.payload['argumentsJson'] ?? JSON.stringify(event.payload['arguments'] ?? {});
			messages.splice(currentPrompt < 0 ? messages.length : currentPrompt, 0, { role: 'user', content: `${OPENIDE_UNKNOWN_TOOL_OUTCOME}\nTool: ${String(event.payload['name'] ?? 'unknown')}\nArguments: ${String(argumentsText)}`, hidden: true, messageId: recoveryId });
			recovered++;
			continue;
		}
		let end = owner + 1;
		while (end < messages.length && messages[end].role === 'tool') { end++; }
		const relative = messages.slice(owner + 1, end).findIndex(message => message.toolCallId === callId);
		const existing = relative < 0 ? -1 : owner + 1 + relative;
		if (existing >= 0) {
			messages[existing] = { ...messages[existing], content: OPENIDE_UNKNOWN_TOOL_OUTCOME, messageId: recoveryId }; recovered++;
			continue;
		}
		let insert = owner + 1;
		while (insert < messages.length && messages[insert].role === 'tool') { insert++; }
		messages.splice(insert, 0, { role: 'tool', toolCallId: callId as string, content: OPENIDE_UNKNOWN_TOOL_OUTCOME, messageId: recoveryId });
		recovered++;
	}
	return recovered;
}

/** Recover the last recorded conversation projection. This function has no execution capability. */
export function reconstructOpenideJournalMessages(records: readonly IOpenideRunJournalRecord[]): IChatMessage[] | undefined {
	let messages: IChatMessage[] | undefined;
	for (const { event } of records) {
		const snapshot = event.kind === 'run/start' || event.kind === 'run/end'
			? event.payload['messages']
			: event.kind === 'model/request'
				? event.payload['projection'] // Legacy journals before bounded request records.
				: event.kind === 'compaction' && event.payload['state'] === 'committed'
					? event.payload['after']
					: undefined;
		if (Array.isArray(snapshot)) { messages = structuredClone(snapshot) as unknown as IChatMessage[]; }
		if (!messages) { continue; }
		if (event.kind === 'model/result') {
			const message = structuredClone(event.payload['message']) as unknown as IChatMessage;
			if (!message || message.role !== 'assistant') { continue; }
			if (event.payload['continuation'] && messages.at(-1)?.role === 'assistant') {
				const previous = messages.pop()!;
				messages.push({ ...previous, ...message, content: `${previous.content ?? ''}${message.content ?? ''}` });
			} else { messages.push(message); }
		} else if (event.kind === 'tool/result') {
			const message = structuredClone(event.payload['message']) as unknown as IChatMessage;
			if (message?.role === 'tool' && !messages.some(existing => existing.role === 'tool' && existing.toolCallId === message.toolCallId)) { messages.push(message); }
		}
	}
	if (messages) { applyOpenideJournalRecovery(messages, records); }
	return messages;
}
