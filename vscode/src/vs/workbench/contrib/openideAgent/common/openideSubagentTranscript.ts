/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentLoopEvent, IChatMessage } from './openideAgentTypes.js';
import { ISubagentRun, ISubagentTimelineEvent } from './openideSubagentTypes.js';

/** Both delegation paths retain the same provider-emitted content and workspace events. */
export function subagentTimelineEvent(event: AgentLoopEvent): Omit<ISubagentTimelineEvent, 'sequence' | 'timestamp'> | undefined {
	switch (event.type) {
		case 'text':
		case 'reasoning': return { type: event.type, message: event.delta };
		case 'toolStart': return { type: event.type, toolCallId: event.id, toolName: event.name, argumentsJson: event.argumentsJson };
		case 'toolResult': return { type: event.type, toolCallId: event.id, toolName: event.name, message: event.result, isError: event.isError };
		case 'terminalData': return { type: 'terminal', toolCallId: event.id, message: event.data };
		case 'fileDiff': return { type: 'fileChange', path: event.path, fileDiff: { path: event.path, created: event.created, editAdded: event.editAdded ?? event.added, editRemoved: event.editRemoved ?? event.removed, diffLines: event.diffLines } };
		case 'info': return { type: 'progress', message: event.message };
		case 'error': return { type: 'error', message: event.message, isError: true };
		default: return undefined;
	}
}

/** Coalesce adjacent deltas into stable blocks, retaining every step rather than a fixed tail. */
export function appendSubagentTimeline(timeline: readonly ISubagentTimelineEvent[], event: Omit<ISubagentTimelineEvent, 'sequence' | 'timestamp'>, now: number): readonly ISubagentTimelineEvent[] {
	const last = timeline[timeline.length - 1];
	if (last && (event.type === 'text' || event.type === 'reasoning' || event.type === 'terminal') && last.type === event.type && last.toolCallId === event.toolCallId) {
		return [...timeline.slice(0, -1), { ...last, message: (last.message ?? '') + (event.message ?? '') }];
	}
	return [...timeline, { ...event, sequence: (last?.sequence ?? 0) + 1, timestamp: now }];
}

export function subagentTimelineMessage(event: Omit<ISubagentTimelineEvent, 'sequence' | 'timestamp'>): IChatMessage | undefined {
	switch (event.type) {
		case 'reasoning': return { role: 'assistant', content: '', reasoning: event.message ?? '' };
		case 'toolStart': return event.toolCallId && event.toolName ? { role: 'assistant', content: '', toolCalls: [{ id: event.toolCallId, name: event.toolName, argumentsJson: event.argumentsJson ?? '{}' }] } : undefined;
		case 'toolResult': return { role: 'tool', toolCallId: event.toolCallId, content: event.message ?? '' };
		case 'fileChange': return { role: 'assistant', content: '', fileDiff: event.fileDiff };
		case 'terminal': return { role: 'assistant', content: '', terminalOutput: { callId: event.toolCallId ?? '', output: event.message ?? '' } };
		default: return event.message ? { role: 'assistant', content: event.message } : undefined;
	}
}

/** Full mirror history for durable runs, including reasoning and file changes after reload. */
export function subagentRunMessages(run: ISubagentRun): IChatMessage[] {
	const messages: IChatMessage[] = [{ role: 'user', content: run.task }];
	for (const event of run.timeline) {
		const message = subagentTimelineMessage(event);
		if (message) { messages.push(message); }
	}
	const conclusion = run.error || run.result?.summary;
	if (conclusion && messages[messages.length - 1]?.content !== conclusion) {
		messages.push({ role: 'assistant', content: conclusion });
	}
	return messages;
}
