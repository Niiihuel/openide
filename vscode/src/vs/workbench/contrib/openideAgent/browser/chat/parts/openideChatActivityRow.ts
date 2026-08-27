/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../../../base/browser/dom.js';
import { IOpenideToolMeta } from '../../../common/chat/openideChatToolMeta.js';

/**
 * The `.part` / `.tool-activity` row of the webview, rebuilt node by node.
 *
 * It lives apart from the two parts that use it (tool rows and explore entries) because both build
 * the SAME element — `openideChatHtml.ts:3166-3198` creates one row and only branches on the text
 * it puts inside. Duplicating the builder is how the two drift: the explore row would keep the old
 * gap while the tool row got a new one, and the transcript would show two grammars for one idea.
 */

/** Webview `.part`. */
export const OPENIDE_CHAT_PART_CLASS = 'openide-chat-part';
/** Webview `.tool-activity`: no card, no badge, no visible arguments — the Thinking grammar. */
export const OPENIDE_CHAT_ACTIVITY_CLASS = 'openide-chat-tool-activity';
/** Webview `.part-explore`: a flat row that lives inside the collapsible Exploring block. */
export const OPENIDE_CHAT_EXPLORE_ROW_CLASS = 'openide-chat-part-explore';
/** Webview `.error` on the row root. */
export const OPENIDE_CHAT_PART_ERROR_CLASS = 'openide-chat-part-error';
/** Webview `.part.open`: reveals `.part-body`. */
export const OPENIDE_CHAT_PART_OPEN_CLASS = 'openide-chat-part-open';

/**
 * Webview `.shimmer`: a gradient swept across the TEXT (`background-clip: text`), not an opacity
 * pulse of the row. The keyframe `openide-chat-shimmer-sweep` is declared once in
 * `media/openideChatNative.css` and reused here so both files animate at the same 2.1s cadence.
 */
export const OPENIDE_CHAT_SHIMMER_CLASS = 'openide-chat-shimmer';

export interface IOpenideChatActivityRowOptions {
	/**
	 * Explore rows have no chevron and no expandable body: their result is the line itself. Passing
	 * this in — instead of letting the caller delete nodes afterwards — keeps the DOM shape a
	 * function of one flag, which is what `hasSameContent` can then cheaply reason about.
	 */
	readonly explore: boolean;
	/** Prefix of `tool-kind-{mcp|skill|tool}`, so a stylesheet can tint an MCP call differently. */
	readonly visualKindId: string;
}

export interface IOpenideChatActivityRow {
	readonly root: HTMLElement;
	/** Clickable in the webview even when the chevron is hidden; toggles the result body. */
	readonly head: HTMLElement;
	readonly icon: HTMLElement;
	readonly verb: HTMLElement;
	/** Absent on explore rows: their target is already folded into the verb line. */
	readonly detail: HTMLElement | undefined;
	readonly chevron: HTMLElement | undefined;
	readonly body: HTMLElement | undefined;
	readonly resultLabel: HTMLElement | undefined;
	readonly resultPre: HTMLElement | undefined;
}

/**
 * Builds the row.
 *
 * DELIBERATE DEVIATION, and the only one: the webview hides `.part-icon` with
 * `display: none !important` (openideChatHtml.ts:306), so today every tool call is a bare verb.
 * That is exactly the "a dot instead of an icon" the user reported. The icon node is rendered AND
 * visible here; every other value — 22px min-height, 12.5px verb, 13px icon, the 6px gap, the
 * muted foreground — is transcribed unchanged, so the row still reads as the same family.
 */
export function createOpenideChatActivityRow(options: IOpenideChatActivityRowOptions): IOpenideChatActivityRow {
	const root = $(`div.${OPENIDE_CHAT_PART_CLASS}.${OPENIDE_CHAT_ACTIVITY_CLASS}.openide-chat-tool-kind-${options.visualKindId}`);
	if (options.explore) {
		root.classList.add(OPENIDE_CHAT_EXPLORE_ROW_CLASS);
	}

	// A <button> like the webview's, not a <div role=button>: the row must be reachable by keyboard
	// to expand a failed call's output, and the native button already carries that for free.
	const head = append(root, $('button.openide-chat-part-head')) as HTMLButtonElement;
	head.type = 'button';

	const icon = append(head, $('span.openide-chat-part-icon'));
	const verb = append(head, $('span.openide-chat-part-verb'));

	let detail: HTMLElement | undefined;
	let chevron: HTMLElement | undefined;
	let body: HTMLElement | undefined;
	let resultLabel: HTMLElement | undefined;
	let resultPre: HTMLElement | undefined;

	if (!options.explore) {
		detail = append(head, $('span.openide-chat-part-detail'));
		append(head, $('span.openide-chat-part-spacer'));
		chevron = append(head, $('span.openide-chat-part-chevron'));
		append(chevron, $('span.codicon.codicon-chevron-right'));

		body = append(root, $('div.openide-chat-part-body'));
		resultLabel = append(body, $('div.openide-chat-part-label2'));
		resultPre = append(body, $('pre.openide-chat-part-pre'));
	} else {
		// The explore row still needs the spacer: without it the verb stops stretching and the
		// fade-on-overflow mask lands mid-word instead of at the row's right edge.
		append(head, $('span.openide-chat-part-spacer'));
	}

	return { root, head, icon, verb, detail, chevron, body, resultLabel, resultPre };
}

/**
 * Swaps the codicon shown by the row.
 *
 * The id always comes from `OPENIDE_TOOL_META` or from `toolVisualKind`, never from the model, so
 * no unvetted string reaches a class name here.
 */
export function setOpenideChatActivityIcon(icon: HTMLElement, iconId: string): void {
	clearNode(icon);
	append(icon, $(`span.codicon.codicon-${iconId}`));
}

export function setOpenideChatShimmer(element: HTMLElement, active: boolean): void {
	element.classList.toggle(OPENIDE_CHAT_SHIMMER_CLASS, active);
}

/** Webview truncation (openideChatHtml.ts:3451): the model keeps the full text, the row does not. */
const RESULT_LIMIT = 6000;

export function truncateOpenideChatResult(result: string): string {
	const value = String(result ?? '');
	return value.length > RESULT_LIMIT ? `${value.slice(0, RESULT_LIMIT)}\n…` : value;
}

/**
 * Fills (or hides) the collapsible result block.
 *
 * `resultPre` is a scroll container of its own (`max-height: 260px; overflow: auto`). That is not
 * cosmetic: the list runs with `horizontalScrolling: false`, so a single long line of tool output
 * escaping this box would widen every row in the transcript.
 */
export function renderOpenideChatActivityResult(row: IOpenideChatActivityRow, resultText: string | undefined, label: string): void {
	if (!row.body || !row.resultPre || !row.resultLabel) {
		return;
	}
	const text = resultText ? truncateOpenideChatResult(resultText) : '';
	row.resultLabel.textContent = label;
	row.resultPre.textContent = text;
	row.resultLabel.classList.toggle('hidden', !text);
	row.resultPre.classList.toggle('hidden', !text);
}

/** Wires the head so a click toggles the body, and keeps the chevron pointing the right way. */
export function bindOpenideChatActivityToggle(row: IOpenideChatActivityRow, onToggle: () => void): void {
	if (!row.chevron) {
		return;
	}
	row.head.addEventListener('click', () => {
		setOpenideChatActivityOpen(row, !row.root.classList.contains(OPENIDE_CHAT_PART_OPEN_CLASS));
		onToggle();
	});
}

/** Programmatic open/close of the result body — `openide.chat.tools.defaultExpanded` and the click share it. */
export function setOpenideChatActivityOpen(row: IOpenideChatActivityRow, open: boolean): void {
	if (!row.chevron) {
		return;
	}
	row.root.classList.toggle(OPENIDE_CHAT_PART_OPEN_CLASS, open);
	clearNode(row.chevron);
	append(row.chevron, $(`span.codicon.codicon-chevron-${open ? 'down' : 'right'}`));
}

/**
 * The line an explore row shows: `verb + compacted target`, e.g. "Read openideChatHtml.ts L1-40".
 *
 * Split out of the parts because the running row and the settled row must produce the same string
 * from different inputs — otherwise the row visibly rewrites itself on `toolResult` even when the
 * target never changed.
 */
export function activityLine(meta: IOpenideToolMeta, verb: string, target: string): string {
	return target ? `${verb} ${target}` : verb || meta.verb;
}

/** `path/to/file.ts L1-240` → `{ path, suffix: ' L1-240' }`; anything without a file-ish head is not a chip. */
const FILE_TARGET = /^((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z0-9]+)(\s.*)?$/;

/**
 * Paints `verb + target` into the row, rendering a path target as a file chip with the icon theme's
 * glyph — the anatomy of upstream's progress steps ("Generating patch in [README.md]",
 * chatInlineAnchorWidget). The classes mirror `getIconClasses` for a FILE (name + extension keys),
 * built here because parts have no DI: the icon theme keys on those class names, not on a service.
 */
export function renderOpenideChatActivityLine(verb: HTMLElement, verbText: string, target: string): void {
	clearNode(verb);
	verb.append(document.createTextNode(target ? `${verbText} ` : verbText));
	if (!target) {
		return;
	}
	const match = FILE_TARGET.exec(target);
	if (!match) {
		verb.append(document.createTextNode(target));
		return;
	}
	const path = match[1];
	const name = path.slice(path.lastIndexOf('/') + 1);
	const chip = append(verb, $('span.openide-chat-activity-chip'));
	const icon = append(chip, $('span.openide-chat-activity-chip-icon.file-icon.name-file-icon.ext-file-icon'));
	const lower = name.toLowerCase();
	icon.classList.add(`${cssEscape(lower)}-name-file-icon`);
	const segments = lower.split('.');
	for (let i = 1; i < segments.length; i++) {
		icon.classList.add(`${cssEscape(segments.slice(i).join('.'))}-ext-file-icon`);
	}
	append(chip, $('span.openide-chat-activity-chip-name', undefined, name));
	if (match[2]) {
		verb.append(document.createTextNode(match[2]));
	}
}

/** `getIconClasses`'s escape (editor/common/services/getIconClasses.ts): `CSS.escape` would turn a
 * leading digit into `\\32 …`, which `classList.add` rejects — and broke the whole row's render. */
function cssEscape(value: string): string {
	return value.replace(/[\x11\x12\x14\x15\x40]/g, '/');
}
