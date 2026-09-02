/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IOpenideChatContent, IOpenideChatToolContent, isOpenideChatToolContent } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { getOpenideToolMeta, IOpenideToolMeta, toolDetailFor, toolVisualKind } from '../../../common/chat/openideChatToolMeta.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { isOpenideChatTextClipped, setupChatTooltip } from '../openideChatHover.js';
import {
	bindOpenideChatActivityToggle,
	createOpenideChatActivityRow,
	setOpenideChatActivityOpen,
	IOpenideChatActivityRow,
	OPENIDE_CHAT_PART_ERROR_CLASS,
	OPENIDE_CHAT_PART_LIVE_CLASS,
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
		case 'cancelled':
			// The outcome is not folded into the verb any more: it is a badge beside it (`_paintBadge`),
			// which keeps the failure spelled out in text for a colour-blind reading while the verb
			// stays the same word as on a row that succeeded.
			return meta.done || content.name;
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
	private _note: HTMLElement | undefined;
	private _content: IOpenideChatToolContent;
	private _meta: IOpenideToolMeta;
	/** Whether this call is the turn's trailing step, and so the one the status line is speaking. */
	private _live = false;

	constructor(
		content: IOpenideChatToolContent,
		context: IOpenideChatContentPartContext,
		hoverService: IHoverService,
	) {
		super();

		this._content = content;
		this._meta = getOpenideToolMeta(content.name);
		this._row = createOpenideChatActivityRow({ explore: false, visualKindId: toolVisualKind(content.name).id });
		this.domNode = this._row.root;
		// Full target in the hover: the row truncates with an ellipsis and a path is exactly the kind
		// of string whose END carries the information. Read at hover time, so the streamed arguments
		// need no second copy — and it repeats the line, so it is not an accessible name of its own.
		this._register(setupChatTooltip(hoverService, this._row.head, () => this._hoverText(), { aria: false, atMouse: true }));

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

	/**
	 * A failed or cancelled call says so the way the workbench's own chat does: the row's icon
	 * becomes `error` (or `circle-slash`), the verb stays the same word as on a row that succeeded,
	 * and the first line of what the tool answered follows in a muted note, so the failure is read
	 * without opening the body and without a red sentence. One node, reused across repaints.
	 */
	private _paintNote(content: IOpenideChatToolContent): void {
		const failed = content.state === 'error' || content.state === 'cancelled';
		if (!failed) {
			this._note?.classList.add('hidden');
			return;
		}
		let note = this._note;
		if (!note) {
			note = this._note = $('span.openide-chat-part-note');
			this._row.verb.insertAdjacentElement('afterend', note);
		}
		const firstLine = (content.resultText ?? '').split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0);
		note.textContent = content.state === 'cancelled'
			? localize('openide.chat.tool.note.cancelled', "Cancelled")
			: (firstLine ? firstLine.slice(0, 120) : localize('openide.chat.tool.note.error', "Failed"));
		note.title = content.resultText?.trim() ?? '';
		note.classList.remove('hidden');
	}

	private _render(): void {
		const content = this._content;
		const meta = this._meta;

		// The workbench's chat swaps the tool's icon for the outcome on a failed call (`Codicon.error`,
		// `circleSlash` when skipped); the verb keeps its wording.
		setOpenideChatActivityIcon(this._row.icon, content.state === 'error' ? 'error' : content.state === 'cancelled' ? 'circle-slash' : meta.icon);

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

		this._row.root.classList.toggle(OPENIDE_CHAT_PART_ERROR_CLASS, content.state === 'error');
		this._row.root.classList.toggle('openide-chat-part-cancelled', content.state === 'cancelled');
		this._paintNote(content);

		renderOpenideChatActivityResult(this._row, content.resultText, localize('openide.chat.tool.result', "Result"));
		this._applyLive();
	}

	/**
	 * A RUNNING trailing call has no row: the status line says "Reading x.ts" and swaps that out
	 * for the next step. The row appears the moment the call settles, which is when it stops being
	 * the news and becomes the record.
	 */
	setLive(live: boolean): void {
		if (this._live === live) {
			return;
		}
		this._live = live;
		if (this._applyLive()) {
			this._onDidChangeHeight.fire();
		}
	}

	private _applyLive(): boolean {
		const hidden = this._live && this._content.state === 'running';
		if (this._row.root.classList.contains(OPENIDE_CHAT_PART_LIVE_CLASS) === hidden) {
			return false;
		}
		this._row.root.classList.toggle(OPENIDE_CHAT_PART_LIVE_CLASS, hidden);
		return true;
	}

	/**
	 * The tip, or nothing.
	 *
	 * Nothing is the common case and the point of the method: a row that shows its whole line —
	 * `batch_read`, and every other tool whose catalog entry has no target — has nothing left to
	 * reveal, and popping a box saying `batch_read` over the row above it was the reported bug. The
	 * tip survives for the two cases that DO hide something: a line the ellipsis ate, and a `cmd`
	 * tool whose target is deliberately kept off the row (`.openide-chat-part-detail` is hidden on
	 * an activity row, so "Running" on screen is "Running npm test" in full).
	 */
	private _hoverText(): string {
		const full = this._headText();
		const onScreen = this._row.verb.textContent ?? '';
		return full !== onScreen || isOpenideChatTextClipped(this._row.verb) ? full : '';
	}

	private _headText(): string {
		const verb = toolVerb(this._meta, this._content);
		const detail = toolDetailFor(this._meta, this._content.argumentsJson);
		return detail ? `${verb} ${detail}` : verb;
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
