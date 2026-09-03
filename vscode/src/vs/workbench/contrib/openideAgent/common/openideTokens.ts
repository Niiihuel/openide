/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — token estimation and context breakdown. No real tokenizer (vendoring a BPE costs
 *  megabytes): a structured heuristic — ~4 chars/token for text, a fixed per-message overhead,
 *  a fixed cost per image — and the real usage reported by the API is ALWAYS preferred when
 *  available (the estimator only fills in before the first usage report and for compaction).
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage, IContextBreakdown, IToolDefinition } from './openideAgentTypes.js';

/** Approximate token cost of an image (Anthropic/OpenAI average at typical resolution). */
export const IMAGE_TOKENS = 1100;

/** Overhead de framing por mensaje (role, delimitadores). */
const MESSAGE_OVERHEAD = 4;

/** ~4 chars/token for English/Spanish text and code; minimum 1 when there is content. */
export function estimateTextTokens(text: string | undefined): number {
	if (!text) {
		return 0;
	}
	return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageTokens(m: IChatMessage): number {
	let tokens = MESSAGE_OVERHEAD + estimateTextTokens(m.content) + (m.context ? estimateTextTokens(m.context) : 0);
	if (m.toolCalls?.length) {
		for (const c of m.toolCalls) {
			tokens += estimateTextTokens(c.name) + estimateTextTokens(c.argumentsJson) + MESSAGE_OVERHEAD;
		}
	}
	if (m.images?.length) {
		tokens += m.images.length * IMAGE_TOKENS;
	}
	return tokens;
}

export function estimateConversationTokens(messages: readonly IChatMessage[]): number {
	let total = 0;
	for (const m of messages) {
		total += estimateMessageTokens(m);
	}
	return total;
}

/** Tool definitions travel on every request: description + schema + overhead. */
export function estimateToolsTokens(tools: readonly IToolDefinition[] | undefined): number {
	if (!tools?.length) {
		return 0;
	}
	let chars = 0;
	for (const t of tools) {
		chars += t.name.length + t.description.length + JSON.stringify(t.parameters).length + 24;
	}
	return Math.ceil(chars / 4);
}

export function countImages(messages: readonly IChatMessage[]): number {
	let n = 0;
	for (const m of messages) {
		n += m.images?.length ?? 0;
	}
	return n;
}

/** Context tokens from @mentions (m.context), summed over the whole conversation. */
export function estimateMentionTokens(messages: readonly IChatMessage[]): number {
	let total = 0;
	for (const m of messages) {
		if (m.context) {
			total += estimateTextTokens(m.context);
		}
	}
	return total;
}

/** Tokens de informes de subagentes: runs persistentes y resultados legacy de delegate_task. */
export function estimateSubagentTokens(messages: readonly IChatMessage[]): number {
	const delegateIds = new Set<string>();
	for (const m of messages) {
		for (const c of m.toolCalls ?? []) {
			if (c.name === 'delegate_task') {
				delegateIds.add(c.id);
			}
		}
	}
	let total = 0;
	for (const m of messages) {
		if (m.subagentRunId || m.role === 'tool' && m.toolCallId && delegateIds.has(m.toolCallId)) {
			total += estimateTextTokens(m.content);
		}
	}
	return total;
}

/**
 * Context breakdown for the UI panel (integrated). The FULL system prompt arrives together
 * with the memory and skill texts embedded in it, so the categories can be separated.
 * If the API reported real usage (`reportedUsed` = input + cache read/creation + output), the
 * "conversation" share is derived from it by subtracting the other estimated categories.
 */
export function computeContextBreakdown(
	fullSystemPrompt: string,
	memoryText: string,
	skillsText: string,
	tools: readonly IToolDefinition[] | undefined,
	messages: readonly IChatMessage[],
	reportedUsed?: number,
): IContextBreakdown {
	const memory = estimateTextTokens(memoryText);
	const skills = estimateTextTokens(skillsText);
	const system = Math.max(0, estimateTextTokens(fullSystemPrompt) - memory - skills);
	const toolTokens = estimateToolsTokens(tools?.filter(tool => !tool.name.startsWith('mcp_')));
	const mcp = estimateToolsTokens(tools?.filter(tool => tool.name.startsWith('mcp_')));
	const mentions = estimateMentionTokens(messages);
	const images = countImages(messages) * IMAGE_TOKENS;
	const subagents = estimateSubagentTokens(messages);
	const fixed = system + memory + skills + toolTokens + mcp + mentions + images + subagents;
	const conversation = reportedUsed && reportedUsed > 0
		? Math.max(0, reportedUsed - fixed)
		: Math.max(0, estimateConversationTokens(messages) - mentions - images - subagents);
	return { system, memory, skills, tools: toolTokens, mcp, mentions, images, subagents, conversation };
}

export function breakdownTotal(b: IContextBreakdown): number {
	return b.system + b.memory + b.skills + b.tools + b.mcp + b.mentions + b.images + b.subagents + b.conversation;
}
