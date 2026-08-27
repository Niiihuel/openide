/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — pairing tool calls with their results.
 *
 *  All three protocols (OpenAI, Anthropic, Gemini) demand the same thing: EVERY tool call in an
 *  `assistant` turn must have its result message. If one is missing, the request
 *  entero se rechaza — OpenAI con "No tool output found for function call call_XXX".
 *
 *  This broke on cancel: the `assistant` turn with its toolCalls was already in the history and
 *  the loop exited before running the tool, leaving the call orphaned. And because the history
 *  is resent in full on every turn, the conversation was permanently unusable: each new message
 *  resent the dangling call and failed again.
 *
 *  Hence two uses: sealing on cancel (never produce orphans) and sanitizing before sending
 *  (healing conversations that are already broken).
 *--------------------------------------------------------------------------------------------*/

export interface IPairableToolCall {
	readonly id: string;
	readonly name: string;
}

export interface IPairableMessage {
	role: string;
	content: string;
	toolCalls?: readonly IPairableToolCall[];
	toolCallId?: string;
}

/** Text of the synthetic result. It states WHAT happened: an empty result would be
 *  indistinguishable from a tool that returned nothing, and the model would read it as success. */
export const CANCELLED_TOOL_RESULT = 'Cancelado por el usuario: la herramienta no llegó a ejecutarse.';

/**
 * Inserts one synthetic result per dangling call, right after the turn that requested it.
 * Returns how many it sealed. Mutating the array is deliberate: it is the same array that gets
 * persisted and sent to the provider, and both views must stay consistent.
 */
export function sealOrphanToolCalls(messages: IPairableMessage[], resultText = CANCELLED_TOOL_RESULT): number {
	let sealed = 0;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== 'assistant' || !message.toolCalls?.length) {
			continue;
		}
		// A turn's results live contiguously right after it; the first non-'tool' message closes
		// the block. Searching the whole history would pair with the result of another turn that
		// happened to reuse the same id.
		const answered = new Set<string>();
		let cursor = index + 1;
		while (cursor < messages.length && messages[cursor].role === 'tool') {
			const id = messages[cursor].toolCallId;
			if (id) { answered.add(id); }
			cursor++;
		}
		const missing = message.toolCalls.filter(call => call.id && !answered.has(call.id));
		if (!missing.length) {
			continue;
		}
		messages.splice(cursor, 0, ...missing.map(call => ({
			role: 'tool',
			toolCallId: call.id,
			content: resultText,
		})));
		sealed += missing.length;
	}
	return sealed;
}

/** Diagnostic: ids of calls without a result. Empty = the history is safe to send. */
export function findOrphanToolCalls(messages: readonly IPairableMessage[]): string[] {
	const orphans: string[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== 'assistant' || !message.toolCalls?.length) {
			continue;
		}
		const answered = new Set<string>();
		let cursor = index + 1;
		while (cursor < messages.length && messages[cursor].role === 'tool') {
			const id = messages[cursor].toolCallId;
			if (id) { answered.add(id); }
			cursor++;
		}
		for (const call of message.toolCalls) {
			if (call.id && !answered.has(call.id)) { orphans.push(call.id); }
		}
	}
	return orphans;
}
