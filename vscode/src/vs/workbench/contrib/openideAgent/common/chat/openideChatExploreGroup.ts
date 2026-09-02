/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideChatExploreContent, IOpenideChatExploreEntry, OpenideChatToolState } from './openideChatContent.js';
import { compactExploreDetail, getOpenideToolMeta, lineSpanTarget, OpenideChatExploreKind, openideExploreKind, toolDetailFor } from './openideChatToolMeta.js';

/**
 * Folds consecutive read/search/list calls into ONE collapsible "Exploring" block with a counter.
 *
 * Ported from the removed chat webview (`ensureExploreGroup` / `exploredLabel` /
 * `onExploreStart` / `onExploreEnd` / `finalizeExploreGroup`). The webview tracked the group with
 * three mutable module-level variables and live DOM counters; here the entries themselves are the
 * state, so the counter is derived and can never disagree with what the block shows.
 */

export interface IOpenideChatExploreCounts {
	readonly files: number;
	readonly searches: number;
	readonly other: number;
}

export function createOpenideChatExploreContent(id: string): IOpenideChatExploreContent {
	return { kind: 'explore', id, entries: [], isComplete: false };
}

/**
 * Target line for one entry: verb + compacted detail, exactly the single sentence the webview
 * writes into `.part-verb`.
 */
export function exploreEntryTarget(tool: string, argumentsJson: string | undefined): string {
	const meta = getOpenideToolMeta(tool);
	return compactExploreDetail(meta, toolDetailFor(meta, argumentsJson));
}

export function createOpenideChatExploreEntry(callId: string, tool: string, argumentsJson: string | undefined): IOpenideChatExploreEntry {
	return { callId, tool, target: exploreEntryTarget(tool, argumentsJson), state: 'running' };
}

export function appendOpenideChatExploreEntry(content: IOpenideChatExploreContent, entry: IOpenideChatExploreEntry): IOpenideChatExploreContent {
	// A repeated callId means the same call was announced twice (restore replaying history over a
	// live group). Replacing keeps identity stable instead of double-counting the same read.
	const index = content.entries.findIndex(existing => existing.callId === entry.callId);
	const entries = index >= 0
		? content.entries.map((existing, at) => at === index ? entry : existing)
		: [...content.entries, entry];
	return { ...content, entries, isComplete: false };
}

/** Settles one entry and closes the block once nothing is left in flight. */
export function settleOpenideChatExploreEntry(
	content: IOpenideChatExploreContent,
	callId: string,
	state: OpenideChatToolState,
): IOpenideChatExploreContent {
	let touched = false;
	const entries = content.entries.map(entry => {
		if (entry.callId !== callId) { return entry; }
		touched = true;
		return { ...entry, state };
	});
	if (!touched) { return content; }
	return { ...content, entries, isComplete: entries.every(entry => entry.state !== 'running') };
}

/**
 * Rewrites a settled entry with the range the tool ACTUALLY returned, for tools whose result is a
 * span of file lines. That is what turns "Read openideChatView.ts" into "Read … L1-240".
 */
export function enrichOpenideChatExploreEntry(
	content: IOpenideChatExploreContent,
	callId: string,
	argumentsJson: string | undefined,
	resultText: string,
): IOpenideChatExploreContent {
	const entries = content.entries.map(entry => {
		if (entry.callId !== callId) { return entry; }
		const enriched = lineSpanTarget(getOpenideToolMeta(entry.tool), argumentsJson, resultText);
		return enriched ? { ...entry, target: enriched } : entry;
	});
	return { ...content, entries };
}

/** Marks the block finished when something else takes over the transcript (text, an edit, done). */
export function finalizeOpenideChatExploreContent(content: IOpenideChatExploreContent): IOpenideChatExploreContent {
	if (content.isComplete) { return content; }
	return {
		...content,
		entries: content.entries.map(entry => entry.state === 'running' ? { ...entry, state: 'success' as const } : entry),
		isComplete: true,
	};
}

export function isOpenideChatExploreActive(content: IOpenideChatExploreContent): boolean {
	return !content.isComplete && content.entries.some(entry => entry.state === 'running');
}

export function exploreEntryKind(entry: IOpenideChatExploreEntry): OpenideChatExploreKind {
	return openideExploreKind(entry.tool);
}

export function countOpenideChatExploreEntries(entries: readonly IOpenideChatExploreEntry[]): IOpenideChatExploreCounts {
	let files = 0;
	let searches = 0;
	let other = 0;
	for (const entry of entries) {
		const kind = exploreEntryKind(entry);
		if (kind === 'file') { files++; }
		else if (kind === 'search') { searches++; }
		else { other++; }
	}
	return { files, searches, other };
}

function plural(count: number, singular: string, pluralForm: string): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "Explored 3 files, 1 search". Empty groups still say "0 items" rather than nothing. */
export function formatExploredLabel(entries: readonly IOpenideChatExploreEntry[]): string {
	const counts = countOpenideChatExploreEntries(entries);
	const parts: string[] = [];
	if (counts.files) { parts.push(plural(counts.files, 'file', 'files')); }
	if (counts.searches) { parts.push(plural(counts.searches, 'search', 'searches')); }
	if (counts.other) { parts.push(plural(counts.other, 'item', 'items')); }
	return `Explored ${parts.length ? parts.join(', ') : '0 items'}`;
}

/**
 * Header of the block. It shimmers as "Exploring" while any call is in flight and only then
 * settles into the counted past tense — the same two states the webview toggles on `.activity-label`.
 */
export function openideChatExploreLabel(content: IOpenideChatExploreContent): string {
	return isOpenideChatExploreActive(content) ? 'Exploring' : formatExploredLabel(content.entries);
}
