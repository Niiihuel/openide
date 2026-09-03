/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMessage } from './openideAgentTypes.js';

/** Stands in for the result a dangling tool call never got (crash, abort, an old bug). */
const MISSING_RESULT = '(interrumpido: la tool no llegó a devolver resultado)';

/**
 * Repairs broken assistant(toolCalls) ↔ tool(result) pairing in a saved conversation, IN PLACE.
 *
 * Providers enforce the pairing strictly: a `tool` message whose call id was never announced is
 * rejected outright (OpenAI: HTTP 400 "No tool call found for function call output with call_id
 * …"), and an announced call with no result is rejected the other way around. Histories written by
 * older builds can carry both kinds of damage — the accepted `suggest_mode` used to append its ack
 * AFTER `resumeInMode` had already rewound the array, leaving an orphan tool message glued to the
 * user turn — and once saved, the conversation failed every turn from then on.
 *
 * Mutating the array in place is the point: the caller's array IS the session store's, so the next
 * save persists the healed history and the conversation stays healed.
 *
 * Returns the number of repairs, so the caller can log that a stored history needed healing.
 */
export function repairOpenideChatToolPairs(messages: IChatMessage[]): number {
	const announced = new Set<string>();
	const answered = new Set<string>();
	for (const message of messages) {
		if (message.role === 'assistant') {
			for (const call of message.toolCalls ?? []) { announced.add(call.id); }
		} else if (message.role === 'tool' && message.toolCallId) {
			answered.add(message.toolCallId);
		}
	}

	let repairs = 0;
	const repaired: IChatMessage[] = [];
	const seen = new Set<string>();
	for (const message of messages) {
		if (message.role === 'tool') {
			const id = message.toolCallId ?? '';
			// Orphan (never announced) or duplicate result: the provider rejects either.
			if (!id || !announced.has(id) || seen.has(id)) {
				repairs++;
				continue;
			}
			seen.add(id);
			repaired.push(message);
			continue;
		}
		repaired.push(message);
		if (message.role === 'assistant' && message.toolCalls?.length) {
			// A dangling call gets a synthetic result RIGHT AFTER its assistant turn, which is the
			// only position every provider accepts.
			for (const call of message.toolCalls) {
				if (answered.has(call.id)) { continue; }
				repaired.push({ role: 'tool', toolCallId: call.id, content: MISSING_RESULT });
				seen.add(call.id);
				repairs++;
			}
		}
	}

	if (repairs > 0) {
		messages.splice(0, messages.length, ...repaired);
	}
	return repairs;
}
