/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — defensive limits for the agent loop.
 *--------------------------------------------------------------------------------------------*/

// Zero means no cycle ceiling. Long runs continue in the same harness and compact as needed.
// Positive values remain an explicit, optional per-run budget.
export const DEFAULT_AGENT_ITERATIONS = 0;
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
