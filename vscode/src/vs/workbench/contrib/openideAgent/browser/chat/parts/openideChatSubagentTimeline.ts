/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { getOpenideToolMeta, parseToolArguments, toolDetailFor } from '../../../common/chat/openideChatToolMeta.js';
import { ISubagentTimelineEvent } from '../../../common/openideSubagentTypes.js';
import { setOpenideChatActivityIcon } from './openideChatActivityRow.js';

/**
 * Body of a specialist card: the `.sub-tool` / `.sub-text` rows of `onSubagentEvent`
 * (openideChatHtml.ts:3648-3693), rebuilt against the persisted timeline instead of against a live
 * event stream.
 *
 * Separated from the card itself so the card stays a state machine over head/status/collapse and
 * this file stays a pure event → row mapping. Both would otherwise sit well past 400 lines in one
 * file whose two halves change for entirely different reasons.
 */

/** Longest brief argument the webview shows next to a tool name (openideChatHtml.ts:3548). */
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
		name.title = name.textContent;
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
		return { node: appendText(body, event.message || localize('openide.chat.subagent.toolFailed', "A tool failed")) };
	}

	if (event.type === 'permissionDenied' || event.type === 'error') {
		const existing = event.toolCallId ? rows.get(event.toolCallId) : undefined;
		if (existing) {
			existing.classList.add('openide-chat-sub-tool-error');
		}
		const message = event.message || (event.type === 'permissionDenied'
			? localize('openide.chat.subagent.denied', "Permission denied")
			: localize('openide.chat.subagent.failed', "The specialist failed"));
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
