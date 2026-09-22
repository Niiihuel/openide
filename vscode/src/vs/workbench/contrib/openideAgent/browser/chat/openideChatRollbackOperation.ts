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
	const removedMessageIds = messages.slice(cut).map(message => message.messageId).filter((value): value is string => !!value);
	const warning = await revertTransaction(request, removedMessageIds);
	sessions.truncateArchiveBefore(conversationId, messageId);
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
async function revertTransaction(request: IOpenideChatRollbackRequest, removedMessageIds: readonly string[]): Promise<string | undefined> {
	// This barrier includes durable enqueue IO and capture requests that outlived the turn.
	// Cancellation is persisted before restoring files, so a restart cannot replay undone work.
	const memory = await request.agentService.prepareMemoryRollback(request.conversationId, removedMessageIds);
	const warnings: string[] = [];
	const conflicts = new Set<string>();
	for (const messageId of [...new Set(removedMessageIds)].reverse()) {
		// Preserve individual memory deltas: folding two writes across an intervening user
		// edit would put that user edit in the inverse transaction and could erase it.
		const changes = memory.filter(change => change.messageId === messageId).sort((a, b) => a.timestamp - b.timestamp).reverse();
		const turn = request.sessions.changeSetOf(request.conversationId, messageId);
		if (turn) { changes.push(turn); }
		for (const changeSet of changes) {
			if (changeSet.state === 'unavailable') { warnings.push(changeSet.unavailableReason ?? 'No hay un recibo verificable para restaurar este turno.'); continue; }
			let result = await request.agentService.rollbackMessage(changeSet);
			if (result.status === 'conflict' && changeSet === turn) { result = await request.agentService.rollbackMessage(changeSet, true); }
			for (const file of result.files) { if (file.status === 'conflict') { conflicts.add(file.uri); } }
			if (result.status === 'unavailable' && !result.files.length) { warnings.push('La restauración de archivos no está disponible.'); }
		}
	}
	if (conflicts.size) { warnings.push(`${conflicts.size} archivo(s) no se pudieron revertir por cambios posteriores: ${[...conflicts].join(', ')}.`); }
	return warnings.length ? warnings.join(' ') : undefined;
}
