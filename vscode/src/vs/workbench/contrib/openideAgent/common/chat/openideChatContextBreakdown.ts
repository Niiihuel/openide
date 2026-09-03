/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextBreakdown } from '../openideAgentTypes.js';

/**
 * The arithmetic behind "Uso de contexto".
 *
 * Transcribed from `fillCtxPanel` (the removed chat webview), where it was interleaved with
 * string concatenation of the panel's HTML — which is why the one thing worth checking about a
 * usage panel (that its numbers are right) could not be checked at all. Everything here is data in,
 * data out; the panel that draws it holds no arithmetic.
 */

/** What the transcript reports about the conversation's context. */
export interface IOpenideChatContextUsage {
	readonly input: number;
	readonly output: number;
	/** Model-reported total. Preferred over input+output, which double-counts a cached prefix. */
	readonly used: number;
	/** 0 when the provider never reported one: the panel then has percentages of nothing. */
	readonly limit: number;
	readonly breakdown?: IContextBreakdown;
}

/** How many of each kind are loaded. Counts, not tokens — they label the segments. */
export interface IOpenideChatCapabilityCounts {
	readonly tools: number;
	readonly mcp: number;
	readonly skills: number;
}

export const OPENIDE_CHAT_EMPTY_CAPABILITIES: IOpenideChatCapabilityCounts = { tools: 0, mcp: 0, skills: 0 };

export type OpenideChatContextSegmentId = keyof IContextBreakdown;

export interface IOpenideChatContextSegment {
	readonly id: OpenideChatContextSegmentId;
	readonly label: string;
	readonly tokens: number;
	/** Width of the segment as a percentage of the LIMIT, to one decimal. */
	readonly percent: number;
	/** Present only for the three segments whose size the user can act on. */
	readonly count?: number;
}

/**
 * Order, labels and which segments survive being empty.
 *
 * `alwaysVisible` is the interesting column: system prompt, tools, MCP, skills and the conversation
 * are shown at zero because their absence is information ("no MCP server is loaded"), while memory,
 * mentions, images and subagents at zero are just noise.
 */
const SEGMENTS: readonly {
	readonly id: OpenideChatContextSegmentId;
	readonly label: string;
	readonly alwaysVisible: boolean;
	readonly countKey?: keyof IOpenideChatCapabilityCounts;
}[] = [
		{ id: 'system', label: 'System prompt', alwaysVisible: true },
		{ id: 'tools', label: 'Herramientas', alwaysVisible: true, countKey: 'tools' },
		{ id: 'mcp', label: 'MCP', alwaysVisible: true, countKey: 'mcp' },
		{ id: 'memory', label: 'Memoria', alwaysVisible: false },
		{ id: 'skills', label: 'Skills', alwaysVisible: true, countKey: 'skills' },
		{ id: 'mentions', label: 'Menciones (@archivos)', alwaysVisible: false },
		{ id: 'images', label: 'Imágenes', alwaysVisible: false },
		{ id: 'subagents', label: 'Subagentes', alwaysVisible: false },
		{ id: 'conversation', label: 'Conversación', alwaysVisible: true },
	];

/**
 * Total context in use.
 *
 * `used` wins when the provider reported it: input + output counts a cached prefix twice, and on a
 * long conversation with prompt caching the sum drifts far above the real occupancy.
 */
export function openideChatContextTotal(usage: IOpenideChatContextUsage): number {
	return usage.used || (usage.input || 0) + (usage.output || 0);
}

/** How full the window is, clamped: a provider that under-reports its limit must not exceed 100. */
export function openideChatContextPercent(usage: IOpenideChatContextUsage): number {
	const limit = usage.limit;
	return limit ? Math.min(100, Math.round(openideChatContextTotal(usage) / limit * 100)) : 0;
}

/**
 * The segmented bar, or an empty list when it cannot be drawn.
 *
 * Both a breakdown AND a limit are required, because a segment's width is its share of the LIMIT,
 * not of the total: sizing against the total would paint a full bar on an empty conversation and
 * hide the one fact the panel exists to show.
 */
export function openideChatContextSegments(
	usage: IOpenideChatContextUsage,
	capabilities: IOpenideChatCapabilityCounts,
): readonly IOpenideChatContextSegment[] {
	const breakdown = usage.breakdown;
	if (!breakdown || !usage.limit) {
		return [];
	}
	const segments: IOpenideChatContextSegment[] = [];
	for (const segment of SEGMENTS) {
		const tokens = breakdown[segment.id] || 0;
		if (!tokens && !segment.alwaysVisible) {
			continue;
		}
		segments.push({
			id: segment.id,
			label: segment.label,
			tokens,
			percent: Math.min(100, Math.round(tokens / usage.limit * 1000) / 10),
			count: segment.countKey ? capabilities[segment.countKey] : undefined,
		});
	}
	return segments;
}

/**
 * Compact token count: `1.2K`, `840`.
 *
 * Deliberately NOT the locale-grouped form used for the input/output/total rows at the bottom of
 * the panel. Those are exact figures a reader compares digit by digit; these label a coloured bar,
 * where four significant digits per row is what turns a legend into a spreadsheet.
 */
export function formatOpenideChatTokens(value: number): string {
	const tokens = value || 0;
	return tokens >= 1000 ? `${Math.round(tokens / 100) / 10}K` : String(tokens);
}

/** Upstream drops any row that would round to 0.0%; so do we. */
export const OPENIDE_CHAT_MIN_VISIBLE_PERCENT = 0.05;

export interface IOpenideChatContextCategoryRow {
	readonly label: string;
	/** How many tools / MCP servers / skills are behind the percentage, when the segment counts. */
	readonly count?: number;
	/** Share of the LIMIT, one decimal — the same scale the ring shows. */
	readonly percent: number;
}

export interface IOpenideChatContextCategory {
	readonly id: 'system' | 'user' | 'other';
	readonly rows: readonly IOpenideChatContextCategoryRow[];
}

const CATEGORIES: readonly { id: 'system' | 'user'; ids: readonly OpenideChatContextSegmentId[] }[] = [
	{ id: 'system', ids: ['system', 'tools', 'mcp', 'skills', 'memory'] },
	{ id: 'user', ids: ['conversation', 'mentions', 'images', 'subagents'] },
];

/**
 * The panel's breakdown, grouped the way upstream's `renderTokenDetails` groups it: one block per
 * category, rows under 0.05% dropped, and a final "unclassified" row for whatever the segments do
 * not account for.
 *
 * That last row is the reason this is a function and not a loop in the view: without it the rows
 * silently fail to add up to the ring above them, and a usage panel whose parts do not sum to its
 * own total is worse than no panel. `contextPercent` is passed in rather than recomputed so the
 * remainder is measured against exactly the number the user can see.
 *
 * Labels are ids, not text: the view resolves them through `t()` so the panel follows
 * `openide.language` without this module knowing about languages.
 */
export function openideChatContextCategories(
	segments: readonly IOpenideChatContextSegment[],
	contextPercent: number,
): readonly IOpenideChatContextCategory[] {
	const result: IOpenideChatContextCategory[] = [];
	if (!segments.length) {
		return result;
	}
	for (const category of CATEGORIES) {
		const rows: IOpenideChatContextCategoryRow[] = [];
		for (const id of category.ids) {
			const segment = segments.find(candidate => candidate.id === id);
			if (segment && segment.percent >= OPENIDE_CHAT_MIN_VISIBLE_PERCENT) {
				rows.push({ label: segment.label, count: segment.count || undefined, percent: segment.percent });
			}
		}
		if (rows.length) {
			result.push({ id: category.id, rows });
		}
	}
	if (!result.length) {
		return result;
	}
	// Rounded to one decimal like the rows themselves: otherwise a pile of hidden thousandths
	// shows up as an "unclassified 0.0%" row that says nothing.
	const classified = segments.reduce((sum, segment) => sum + segment.percent, 0);
	const rest = Math.round((contextPercent - classified) * 10) / 10;
	if (rest >= OPENIDE_CHAT_MIN_VISIBLE_PERCENT) {
		result.push({ id: 'other', rows: [{ label: 'unclassified', percent: rest }] });
	}
	return result;
}
