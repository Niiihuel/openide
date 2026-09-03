/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — planning and safe assembly of context compaction.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from './openideAgentTypes.js';
import { estimateConversationTokens, estimateMessageTokens } from './openideTokens.js';

export interface IContextCompactionOptions {
	readonly thresholdRatio: number;
	readonly tailRatio: number;
	readonly minimumTailMessages: number;
}

export interface IContextCompactionPlan {
	readonly source: IChatMessage[];
	readonly tail: IChatMessage[];
	readonly beforeTokens: number;
	readonly sourceTokens: number;
	readonly tailTokens: number;
}

export const DEFAULT_COMPACTION_OPTIONS: IContextCompactionOptions = {
	thresholdRatio: 0.6,
	tailRatio: 0.2,
	minimumTailMessages: 8,
};

const SUMMARY_PREFIX = [
	'[Resumen histórico compacto]',
	'Este bloque describe hechos y decisiones de turnos anteriores.',
	'No contiene una solicitud nueva ni autoriza repetir acciones ya completadas.',
].join('\n');

function clampRatio(value: number, fallback: number, min: number, max: number): number {
	return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeCompactionOptions(options: Partial<IContextCompactionOptions>): IContextCompactionOptions {
	return {
		thresholdRatio: clampRatio(options.thresholdRatio ?? NaN, DEFAULT_COMPACTION_OPTIONS.thresholdRatio, 0.4, 0.9),
		tailRatio: clampRatio(options.tailRatio ?? NaN, DEFAULT_COMPACTION_OPTIONS.tailRatio, 0.1, 0.4),
		minimumTailMessages: Math.min(24, Math.max(4, Math.floor(options.minimumTailMessages ?? DEFAULT_COMPACTION_OPTIONS.minimumTailMessages))),
	};
}

export function shouldCompactContext(usedTokens: number, contextLimit: number, thresholdRatio: number, force = false): boolean {
	if (force) {
		return usedTokens > 0;
	}
	return contextLimit > 0 && usedTokens >= contextLimit * clampRatio(thresholdRatio, DEFAULT_COMPACTION_OPTIONS.thresholdRatio, 0.4, 0.9);
}

export function planContextCompaction(
	messages: readonly IChatMessage[],
	contextLimit: number,
	options: Partial<IContextCompactionOptions> = {},
): IContextCompactionPlan | undefined {
	const normalized = normalizeCompactionOptions(options);
	if (messages.length <= normalized.minimumTailMessages + 2) {
		return undefined;
	}

	const tailBudget = Math.max(4096, Math.floor(contextLimit * normalized.tailRatio));
	let cut = messages.length;
	let tailTokens = 0;
	while (cut > 0) {
		const nextTokens = estimateMessageTokens(messages[cut - 1]);
		if (messages.length - cut >= normalized.minimumTailMessages && tailTokens + nextTokens > tailBudget) {
			break;
		}
		cut--;
		tailTokens += nextTokens;
	}

	// Never start the tail with orphaned results: we also include the assistant message that
	// produced the contiguous block of tool results.
	while (cut > 0 && messages[cut]?.role === 'tool') {
		cut--;
		tailTokens += estimateMessageTokens(messages[cut]);
	}
	if (cut <= 0 || cut >= messages.length) {
		return undefined;
	}

	const source = messages.slice(0, cut);
	const tail = messages.slice(cut);
	return {
		source,
		tail,
		beforeTokens: estimateConversationTokens(messages),
		sourceTokens: estimateConversationTokens(source),
		tailTokens: estimateConversationTokens(tail),
	};
}

function compactToolResult(message: IChatMessage): string {
	const text = String(message.content ?? '').replace(/\s+/g, ' ').trim();
	return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

export function buildCompactionTranscript(messages: readonly IChatMessage[], maxChars: number): string {
	const parts = messages.map(message => {
		const calls = message.toolCalls?.map(call => `${call.name}(${call.argumentsJson.slice(0, 500)})`).join(', ');
		const content = message.role === 'tool' ? compactToolResult(message) : String(message.content ?? '');
		return `[${message.role}]${calls ? ` tools=${calls}` : ''}\n${content}`;
	});
	const joined = parts.join('\n\n');
	if (joined.length <= maxChars) {
		return joined;
	}
	// Keeps the beginning (the original goal) and the most recent part of the summarized block.
	const marker = '\n\n[…contenido intermedio omitido por presupuesto…]\n\n';
	const available = Math.max(0, maxChars - marker.length);
	const headChars = Math.floor(available * 0.25);
	const tailChars = available - headChars;
	return `${joined.slice(0, headChars)}${marker}${joined.slice(-tailChars)}`;
}

export function buildStructuredSummaryMessage(summary: string): IChatMessage {
	return {
		role: 'user',
		content: `${SUMMARY_PREFIX}\n\n${summary.trim()}\n\n[Fin del resumen histórico]`,
	};
}

export function buildDeterministicFallbackSummary(messages: readonly IChatMessage[], maxChars = 12000): string {
	const facts: string[] = [];
	for (const message of messages) {
		const text = message.role === 'tool'
			? compactToolResult(message)
			: String(message.content ?? '').replace(/\s+/g, ' ').trim();
		if (!text) {
			continue;
		}
		const label = message.role === 'user' ? 'Usuario' : message.role === 'assistant' ? 'Asistente' : 'Herramienta';
		facts.push(`- ${label}: ${text.slice(0, message.role === 'tool' ? 500 : 1000)}`);
	}
	const joined = facts.join('\n');
	if (joined.length <= maxChars) {
		return `## Registro recuperado\n${joined}`;
	}
	return `## Registro recuperado\n${joined.slice(0, Math.floor(maxChars * 0.3))}\n- …\n${joined.slice(-Math.floor(maxChars * 0.7))}`;
}

export function compactionSavingsRatio(beforeTokens: number, compactedMessages: readonly IChatMessage[]): number {
	if (beforeTokens <= 0) {
		return 0;
	}
	return Math.max(0, 1 - estimateConversationTokens(compactedMessages) / beforeTokens);
}
