/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { getOpenideToolMeta, parseToolArguments, toolDetailFor } from '../../../common/chat/openideChatToolMeta.js';
import { ISubagentTimelineEvent } from '../../../common/openideSubagentTypes.js';
import { setupChatTooltip } from '../openideChatHover.js';
import { setOpenideChatActivityIcon } from './openideChatActivityRow.js';
import { t } from '../../../common/openideStrings.js';

/**
 * Body of a specialist card: the `.sub-tool` / `.sub-text` rows of `onSubagentEvent`
 * (the removed chat webview), rebuilt against the persisted timeline instead of against a live
 * event stream.
 *
 * Separated from the card itself so the card stays a state machine over head/status/collapse and
 * this file stays a pure event → row mapping. Both would otherwise sit well past 400 lines in one
 * file whose two halves change for entirely different reasons.
 */

/** Longest brief argument the webview shows next to a tool name. */
const BRIEF_ARGS_LIMIT = 60;

/**
 * Short target next to a tool name inside the card.
 *
 * Falls back to the webview's fixed field order for tools the catalog does not know, which is the
 * common case here: specialists are the ones most likely to be running MCP tools.
 */
export function subagentBriefArgs(tool: string, argumentsJson: string | undefined): string {
	const meta = getOpenideToolMeta(tool);
	const fromCatalog = toolDetailFor(meta, argumentsJson);
	if (fromCatalog) {
		return fromCatalog.slice(0, BRIEF_ARGS_LIMIT);
	}
	const args = parseToolArguments(argumentsJson);
	const value = args['path'] ?? args['query'] ?? args['pattern'] ?? args['name'] ?? args['command'];
	return value === undefined || value === null ? '' : String(value).slice(0, BRIEF_ARGS_LIMIT);
}

/**
 * The live status line: verb + target of the last call the specialist started.
 *
 * Same vocabulary as the main transcript's rows on purpose — a specialist doing the same work as
 * the parent should describe it with the same words, or the two panes read as two products.
 */
export function subagentStatusText(tool: string, argumentsJson: string | undefined): string {
	const meta = getOpenideToolMeta(tool);
	const detail = toolDetailFor(meta, argumentsJson);
	return detail ? `${meta.verb} ${detail}` : meta.verb;
}

/**
 * The last events that would actually PAINT something, newest last.
 *
 * Not `timeline.slice(-limit)`. Most of what a specialist emits leaves no row: a successful
 * `toolResult` renders nothing at all (its only job is to un-shimmer the call it answers), and a
 * failing one with a known `toolCallId` only tints the row its call already has. A raw tail is
 * therefore mostly invisible events, and a card asked for "the last three lines" would show one.
 *
 * Kept pure and separate from `appendSubagentTimelineEvent` so the rule can be asserted, but the
 * two have to agree: anything this keeps, that function must be able to draw.
 */
export function lastSubagentTimelineRows(timeline: readonly ISubagentTimelineEvent[], limit: number): readonly ISubagentTimelineEvent[] {
	const picked: ISubagentTimelineEvent[] = [];
	// The ids of the calls we are keeping, so a failing result for one of them is recognised as a
	// tint on a row that is already in the list rather than as a line of its own.
	const listed = new Set<string>();
	for (let index = timeline.length - 1; index >= 0 && picked.length < limit; index--) {
		const event = timeline[index];
		if (paintsRow(event, listed)) {
			picked.push(event);
			if (event.type === 'toolStart' && event.toolCallId) { listed.add(event.toolCallId); }
		}
	}
	return picked.reverse();
}

function paintsRow(event: ISubagentTimelineEvent, listed: ReadonlySet<string>): boolean {
	switch (event.type) {
		case 'toolStart':
			// Without a name there is no row to draw; it falls through to the text branch below.
			return !!event.toolName || !!event.message;
		case 'toolResult':
			// A success is silent, and a failure whose call is already listed is a tint, not a line.
			return !!event.isError && !(event.toolCallId && listed.has(event.toolCallId));
		case 'permissionDenied':
		case 'error':
			return true;
		default:
			return !!event.message;
	}
}

export interface IRenderedTimelineRow {
	/** Set for `toolStart` rows, so a later failing `toolResult` can find and tint its own row. */
	readonly toolCallId?: string;
	readonly node: HTMLElement;
}

/**
 * Appends one timeline event to `body`, or marks an existing row when the event is a verdict on a
 * call already listed. Returns the row it created, if any.
 */
export function appendSubagentTimelineEvent(
	body: HTMLElement,
	rows: Map<string, HTMLElement>,
	event: ISubagentTimelineEvent,
	hoverService: IHoverService,
	/** Owns the row hovers: the body is emptied wholesale when a restore replaces the card. */
	store: DisposableStore,
): IRenderedTimelineRow | undefined {
	if (event.type === 'toolStart' && event.toolName) {
		const row = append(body, $('div.openide-chat-sub-tool'));
		const icon = append(row, $('span.openide-chat-sub-tool-icon'));
		// Per-tool codicon rather than the webview's single `codicon-tools` for every row: the card
		// is a compressed transcript, and a column of identical glyphs carries no information.
		setOpenideChatActivityIcon(icon, getOpenideToolMeta(event.toolName).icon);
		const name = append(row, $('span.openide-chat-sub-tool-name'));
		const brief = subagentBriefArgs(event.toolName, event.argumentsJson);
		name.textContent = brief ? `${event.toolName} · ${brief}` : event.toolName;
		// The line is elided and the hover only completes it, so it is not a second accessible name.
		store.add(setupChatTooltip(hoverService, name, () => name.textContent ?? '', { aria: false }));
		if (event.toolCallId) {
			rows.set(event.toolCallId, row);
		}
		return { toolCallId: event.toolCallId, node: row };
	}

	if (event.type === 'toolResult') {
		if (!event.isError) {
			return undefined;
		}
		const existing = event.toolCallId ? rows.get(event.toolCallId) : undefined;
		if (existing) {
			existing.classList.add('openide-chat-sub-tool-error');
			return undefined;
		}
		return { node: appendText(body, event.message || t('chatSurface.subagent.toolFailed')) };
	}

	if (event.type === 'permissionDenied' || event.type === 'error') {
		const existing = event.toolCallId ? rows.get(event.toolCallId) : undefined;
		if (existing) {
			existing.classList.add('openide-chat-sub-tool-error');
		}
		const message = event.message || (event.type === 'permissionDenied'
			? t('chatSurface.subagent.denied')
			: t('chatSurface.subagent.failed'));
		return { node: appendText(body, message) };
	}

	if (event.message) {
		return { node: appendText(body, event.message) };
	}
	return undefined;
}

function appendText(body: HTMLElement, text: string): HTMLElement {
	const node = append(body, $('div.openide-chat-sub-text'));
	node.textContent = text;
	return node;
}

/** Head counter. Token totals are not here: `usage` is a reducer effect, never card content. */
export function subagentToolCount(timeline: readonly ISubagentTimelineEvent[]): number {
	let count = 0;
	for (const event of timeline) {
		if (event.type === 'toolStart') {
			count++;
		}
	}
	return count;
}

/** Last call the specialist announced, which is what the status line describes. */
export function lastSubagentToolStart(timeline: readonly ISubagentTimelineEvent[]): ISubagentTimelineEvent | undefined {
	for (let i = timeline.length - 1; i >= 0; i--) {
		if (timeline[i].type === 'toolStart' && timeline[i].toolName) {
			return timeline[i];
		}
	}
	return undefined;
}
