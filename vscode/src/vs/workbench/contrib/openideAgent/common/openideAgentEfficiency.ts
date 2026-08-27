/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — provider-neutral budgets and helpers for reducing repeated context.
 *--------------------------------------------------------------------------------------------*/

export function resolveRetrievedContextBudget(configuredTokens: number, contextLimit: number): number {
	const configured = Number.isFinite(configuredTokens) && configuredTokens > 0 ? Math.floor(configuredTokens) : 3_000;
	const proportional = Number.isFinite(contextLimit) && contextLimit > 0 ? Math.floor(contextLimit * 0.04) : configured;
	return Math.max(500, Math.min(4_000, configured, proportional));
}

export function resolveToolResultCharBudget(contextLimit: number): number {
	const proportional = Number.isFinite(contextLimit) && contextLimit > 0 ? Math.floor(contextLimit * 4 * 0.04) : 20_000;
	return Math.max(8_000, Math.min(40_000, proportional));
}

export function compactAgentToolResult(toolName: string, output: string, contextLimit: number): string {
	const budget = resolveToolResultCharBudget(contextLimit);
	if (output.length <= budget) { return output; }
	const marker = `\n\n[… resultado de ${toolName} truncado por presupuesto; ${output.length - budget} caracteres omitidos …]\n\n`;
	const available = Math.max(0, budget - marker.length);
	const tailHeavy = /(?:command|terminal|test|build|mcp_)/i.test(toolName);
	const headSize = Math.floor(available * (tailHeavy ? 0.4 : 0.7));
	return `${output.slice(0, headSize)}${marker}${output.slice(-(available - headSize))}`;
}

/** Collapsing many MCP schemas behind one dispatcher improves compatibility and prefix cache. */
export function shouldCompressMcpTools(count: number, threshold = 8): boolean {
	return Number.isFinite(count) && count > Math.max(1, Math.floor(threshold));
}

export function stablePromptCacheKey(system: string, toolsJson: string): string {
	const value = `${system}\u0000${toolsJson}`;
	let hash = 5381;
	for (let index = 0; index < value.length; index++) {
		hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
	}
	return `pck_${(hash >>> 0).toString(16)}`;
}
