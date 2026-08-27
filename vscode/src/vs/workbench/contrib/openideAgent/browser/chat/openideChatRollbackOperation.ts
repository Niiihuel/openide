/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentMode, IChatCapabilityMention, IChatImage } from '../../common/openideAgentTypes.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { OpenideChatSessions } from '../openideChatSessions.js';

/**
 * Reverting one user turn: its file transaction plus the truncation of the thread.
 *
 * Split out of `OpenideChatController` for the 400-line cap, and it is the right seam: everything
 * here is storage and workspace work with no transcript state involved, which is why it can be a
 * free function. The controller keeps the serialization (`OpenideChatRollbackBarrier`) and the
 * repaint, because those are the parts that depend on its own fields.
 */

export interface IOpenideChatRollbackOutcome {
	readonly committed: boolean;
	/** Turn returned to the composer, when the caller asked to restore it. */
	readonly composer?: { readonly text: string; readonly images?: readonly IChatImage[]; readonly capabilities?: readonly IChatCapabilityMention[] };
	readonly mode?: AgentMode;
	readonly providerId?: string;
	readonly modelId?: string;
	/** Turns whose work the user discarded. The caller feeds the project-map learning signal. */
	readonly removedMessageIds: readonly string[];
	readonly warning?: string;
}

export interface IOpenideChatRollbackRequest {
	readonly sessions: OpenideChatSessions;
	readonly agentService: IOpenideAgentService;
	readonly conversationId: string;
	readonly messageId: string;
	readonly restoreComposer: boolean;
	/** Cancels the run in flight and resolves once no tool of it can write any more. */
	readonly drainRun: () => Promise<void>;
}

export async function runOpenideChatRollback(request: IOpenideChatRollbackRequest): Promise<IOpenideChatRollbackOutcome> {
	const { sessions, conversationId, messageId } = request;
	const messages = sessions.messagesOf(conversationId);
	const cut = messages.findIndex(message => message.role === 'user' && message.messageId === messageId);
	if (cut < 0) {
		return { committed: false, removedMessageIds: [], warning: 'El mensaje ya no existe en la conversación.' };
	}
	const rolledBack = messages[cut];
	await request.drainRun();
	// Re-checked after draining the run: `send` is blocked by the barrier, but a turn admitted
	// before it was raised may have appended while we waited.
	const freshCut = messages.findIndex(message => message.role === 'user' && message.messageId === messageId);
	if (freshCut < 0 || freshCut !== cut) {
		return { committed: false, removedMessageIds: [], warning: 'El mensaje cambió durante el rollback.' };
	}
	const warning = await revertTransaction(request);
	const removedMessageIds = messages.slice(cut).map(message => message.messageId).filter((value): value is string => !!value);
	messages.splice(cut);
	sessions.removeChangeSets(conversationId, removedMessageIds);
	sessions.clearUsage(conversationId);
	sessions.save(conversationId, messages, false);
	return {
		committed: true, removedMessageIds, warning,
		composer: request.restoreComposer
			? { text: rolledBack.displayText || rolledBack.content, images: rolledBack.images, capabilities: rolledBack.capabilities }
			: undefined,
		mode: rolledBack.executionMode ?? 'agent', providerId: rolledBack.providerId, modelId: rolledBack.modelId,
	};
}

/**
 * Reverting files is best-effort: a conflict is reported back but never blocks the truncation.
 * History navigation must always work, even when the workspace can no longer be put back exactly.
 */
async function revertTransaction(request: IOpenideChatRollbackRequest): Promise<string | undefined> {
	const changeSet = request.sessions.changeSetOf(request.conversationId, request.messageId);
	if (!changeSet) {
		return undefined;
	}
	let result = await request.agentService.rollbackMessage(changeSet);
	if (result.status === 'conflict') {
		result = await request.agentService.rollbackMessage(changeSet, true);
	}
	const conflicts = result.files.filter(file => file.status === 'conflict');
	if (!conflicts.length) {
		return undefined;
	}
	return `${conflicts.length} archivo(s) no se pudieron revertir por cambios posteriores: ${conflicts.map(file => file.uri).join(', ')}.`;
}
