/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — idle-timeout floors for model families with extended reasoning.
 *--------------------------------------------------------------------------------------------*/

const REASONING_STALE_FLOORS: ReadonlyArray<readonly [string, number]> = [
	['nemotron-3-ultra', 600],
	['nemotron-3-super', 600],
	['nemotron-3-nano', 300],
	['deepseek-reasoner', 600],
	['deepseek-v4-flash', 600],
	['deepseek-v4-pro', 600],
	['deepseek-r1', 600],
	['qwq-32b', 300],
	['qwen3', 180],
	['o1-preview', 600],
	['o1-mini', 600],
	['o1-pro', 600],
	['o1', 600],
	['o3-mini', 300],
	['o3-pro', 600],
	['o3', 600],
	['o4-mini', 300],
	['claude-opus-4', 240],
	['claude-sonnet-4.5', 180],
	['claude-sonnet-4.6', 180],
	['grok-4-fast-reasoning', 300],
	['grok-4.20-reasoning', 300],
];

export function getReasoningStaleTimeoutFloor(model: string | undefined): number | undefined {
	const slug = String(model ?? '').trim().toLowerCase().split('/').pop() ?? '';
	if (!slug) {
		return undefined;
	}
	for (const [family, seconds] of [...REASONING_STALE_FLOORS].sort((a, b) => b[0].length - a[0].length)) {
		if (slug === family || slug.startsWith(`${family}-`) || slug.startsWith(`${family}.`) || slug.startsWith(`${family}_`)) {
			return seconds;
		}
	}
	return undefined;
}

export function resolveStreamStaleTimeoutSeconds(model: string, configuredSeconds: number, effort: string | undefined): number {
	const configured = Number.isFinite(configuredSeconds) ? Math.max(0, configuredSeconds) : 180;
	if (!effort || effort === 'none') {
		return configured;
	}
	return Math.max(configured, getReasoningStaleTimeoutFloor(model) ?? 0);
}
