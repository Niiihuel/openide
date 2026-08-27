/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../nls.js';
import { IOpenideChatContent, IOpenideChatToolContent, isOpenideChatToolContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { getOpenideToolMeta, IOpenideToolMeta, toolDetailFor, toolVisualKind } from '../../../common/chat/openideChatToolMeta.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import {
	bindOpenideChatActivityToggle,
	createOpenideChatActivityRow,
	setOpenideChatActivityOpen,
	IOpenideChatActivityRow,
	OPENIDE_CHAT_PART_ERROR_CLASS,
	renderOpenideChatActivityResult,
	setOpenideChatActivityIcon,
	setOpenideChatShimmer,
	renderOpenideChatActivityLine,
} from './openideChatActivityRow.js';
import '../media/openideChatActivity.css';

/**
 * Verb shown for a call, by state.
 *
 * Present tense while it runs, past tense once it settles: the wording is what tells the user the
 * call is over, because the row has no spinner and no status glyph. Both strings come from the
 * catalog, never from a hardcoded name — that is the drift the catalog exists to prevent.
 */
function toolVerb(meta: IOpenideToolMeta, content: IOpenideChatToolContent): string {
	switch (content.state) {
		case 'running':
			return meta.verb;
		case 'error':
			// openideChatHtml.ts:3464 — the failure is spelled out on the row itself; the red text
			// alone does not survive a colour-blind reading, and the output stays behind the body.
			return localize('openide.chat.tool.error', "{0} — error", meta.done || content.name);
		case 'cancelled':
			return localize('openide.chat.tool.cancelled', "{0} — cancelled", meta.done || content.name);
		case 'success':
		default:
			return meta.done || meta.verb;
	}
}

/**
 * A generic tool call: one flat row, icon + verb + target.
 *
 * This is the row that used to render as "· razonando" for every event the native transcript had
 * no part for. Everything it shows comes from `OPENIDE_TOOL_META`, so an MCP tool nobody wrote an
 * entry for still prints its real name instead of a shrug.
 */
export class OpenideChatToolPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _row: IOpenideChatActivityRow;
	private _content: IOpenideChatToolContent;
	private _meta: IOpenideToolMeta;

	constructor(content: IOpenideChatToolContent, context: IOpenideChatContentPartContext) {
		super();

		this._content = content;
		this._meta = getOpenideToolMeta(content.name);
		this._row = createOpenideChatActivityRow({ explore: false, visualKindId: toolVisualKind(content.name).id });
		this.domNode = this._row.root;

		// The body is hidden until the head is clicked, so opening it changes the row's height
		// without the list knowing — the same reason the thinking card listens to `toggle`.
		bindOpenideChatActivityToggle(this._row, () => this._onDidChangeHeight.fire());
		// `openide.chat.tools.defaultExpanded` only sets the STARTING state; the user's own toggle
		// wins afterwards because updates absorb into this same part without rebuilding it.
		if (context.toolsDefaultExpanded) {
			setOpenideChatActivityOpen(this._row, true);
		}

		this._render();
	}

	private _render(): void {
		const content = this._content;
		const meta = this._meta;

		setOpenideChatActivityIcon(this._row.icon, meta.icon);

		const verb = toolVerb(meta, content);
		const detail = toolDetailFor(meta, content.argumentsJson);
		// A path-like target joins the verb as a file chip (upstream's "Generating patch in
		// [README.md]"); a command or free-form argument stays out of the line, as before.
		renderOpenideChatActivityLine(this._row.verb, verb, !meta.cmd && detail && /\.[A-Za-z0-9]+(\s|$)/.test(detail) ? detail : '');
		setOpenideChatShimmer(this._row.verb, content.state === 'running');

		if (this._row.detail) {
			this._row.detail.textContent = detail;
			// `cmd` tools render their target as a command: monospace, 11.5px, stretched. Same node,
			// different class — a second node would need the head's child order kept in sync twice.
			this._row.detail.classList.toggle('openide-chat-part-cmd', meta.cmd === true);
			this._row.detail.classList.toggle('hidden', !detail);
		}

		// Full target in the tooltip: the row truncates with an ellipsis and a path is exactly the
		// kind of string whose END carries the information.
		this._row.head.title = detail ? `${verb} ${detail}` : verb;

		this._row.root.classList.toggle(OPENIDE_CHAT_PART_ERROR_CLASS, content.state === 'error');
		this._row.root.classList.toggle('openide-chat-part-cancelled', content.state === 'cancelled');

		renderOpenideChatActivityResult(this._row, content.resultText, localize('openide.chat.tool.result', "Result"));
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		if (!isOpenideChatToolContent(other)) {
			return false;
		}
		return other.callId === this._content.callId
			&& other.name === this._content.name
			&& other.argumentsJson === this._content.argumentsJson
			&& other.state === this._content.state
			&& other.resultText === this._content.resultText;
	}

	/**
	 * Absorbs any update to the SAME call, and only that.
	 *
	 * `toolCallDelta` streams the arguments a fragment at a time, so a single call produces a new
	 * content object per frame while the model is still typing the path. Rebuilding the part on each
	 * one would restart the shimmer's sweep from zero and slam the result body shut. A different
	 * `callId` is a different call and must get its own row.
	 */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatToolContent(other) || other.callId !== this._content.callId) {
			return false;
		}
		this._content = other;
		this._meta = getOpenideToolMeta(other.name);
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
