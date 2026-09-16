/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import { ISubagentRun } from '../common/openideSubagentTypes.js';
import { OpenideChatSessions } from './openideChatSessions.js';

/** Presentation shared by durable orchestrator runs and in-loop specialists with mirror chats. */
export type SubagentPresentation = Pick<ISubagentRun, 'runId' | 'definitionName' | 'task' | 'status' | 'createdAt' | 'startedAt' | 'completedAt' | 'progress' | 'result' | 'error'>
	& Partial<Pick<ISubagentRun, 'readonly' | 'profile' | 'routingDecision' | 'timeline'>>;

export function conversationSubagents(sessions: OpenideChatSessions, parentId: string, durable: readonly ISubagentRun[]): readonly SubagentPresentation[] {
	const runs = new Map<string, SubagentPresentation>(durable.map(run => [run.runId, run]));
	for (const session of sessions.listAll()) {
		if (!session.subagentRunId || session.parentSessionId !== parentId || runs.has(session.subagentRunId)) { continue; }
		const task = sessions.messagesOf(session.id).find(message => message.role === 'user')?.content ?? session.title;
		runs.set(session.subagentRunId, {
			runId: session.subagentRunId, definitionName: session.title, task,
			status: session.subagentStatus ?? (session.status === 'in-progress' ? 'running' : session.hasError ? 'failed' : 'completed'),
			createdAt: session.subagentStartedAt ?? session.updatedAt, startedAt: session.subagentStartedAt,
			completedAt: session.subagentCompletedAt,
		});
	}
	return [...runs.values()].sort((a, b) => b.createdAt - a.createdAt);
}
