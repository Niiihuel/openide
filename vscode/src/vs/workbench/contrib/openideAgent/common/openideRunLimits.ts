/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — defensive limits for the agent loop.
 *--------------------------------------------------------------------------------------------*/

// The loop must be long but finite: each iteration can mean a billable request.
// Repetition detection still fires earlier, and the user can continue in another turn.
// 200 by default so a long session is not cut off halfway; grok-cli uses 400 as an outer ceiling
// but caps each turn at 120, so this lands in the same range.
export const DEFAULT_AGENT_ITERATIONS = 200;
export const MIN_AGENT_ITERATIONS = 25;
export const MAX_AGENT_ITERATIONS = 500;
export const MAX_OUTPUT_CONTINUATIONS = 2;

export function resolveAgentIterationLimit(configured: unknown): number {
	const value = Number(configured);
	if (!Number.isFinite(value) || value <= 0) { return DEFAULT_AGENT_ITERATIONS; }
	return Math.max(MIN_AGENT_ITERATIONS, Math.min(MAX_AGENT_ITERATIONS, Math.floor(value)));
}

/** Providers use different names for the same condition (OpenAI `length`, Anthropic
 *  `max_tokens`, Responses `incomplete`, Gemini `max_output_tokens`). */
export function isOutputLimitStopReason(reason: string | undefined): boolean {
	if (!reason) {
		return false;
	}
	return /(?:^|[^a-z])(?:length|max[_ -]?(?:output[_ -]?)?tokens?|incomplete)(?:$|[^a-z])/i.test(reason);
}
