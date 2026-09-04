/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IOpenideChatContent, IOpenideChatExploreContent, IOpenideChatExploreEntry, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { isOpenideChatExploreActive, openideChatExploreLabel } from '../../../common/chat/openideChatExploreGroup.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { getOpenideToolMeta, toolVisualKind } from '../../../common/chat/openideChatToolMeta.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import { isOpenideChatTextClipped, setupChatTooltip } from '../openideChatHover.js';
import {
	activityLine,
	createOpenideChatActivityRow,
	IOpenideChatActivityRow,
	OPENIDE_CHAT_PART_ERROR_CLASS,
	OPENIDE_CHAT_PART_LIVE_CLASS,
	setOpenideChatActivityIcon,
	setOpenideChatShimmer,
	renderOpenideChatActivityLine,
} from './openideChatActivityRow.js';
import '../media/openideChatActivity.css';
import { t } from '../../../common/openideStrings.js';

export const OPENIDE_CHAT_ACTIVITY_GROUP_CLASS = 'openide-chat-activity-group';

interface IRenderedEntry {
	readonly callId: string;
	readonly row: IOpenideChatActivityRow;
	/** The row's hover. Dropping the entry drops its node, so the hover has to go with it. */
	readonly store: DisposableStore;
	target: string;
	state: IOpenideChatExploreEntry['state'];
	tool: string;
	/** The untruncated line, which is what the hover shows. */
	line: string;
}

/**
 * Line of one explore entry.
 *
 * Errors drop the target and say so, which is what `finishTool` does for a failed explore call
 * (the removed chat webview): the row is then about the failure, and a path next to the word "error"
 * reads as if the path itself were the problem.
 */
function entryLine(entry: IOpenideChatExploreEntry): string {
	const meta = getOpenideToolMeta(entry.tool);
	if (entry.state === 'error') {
		return t('chatSurface.explore.error', meta.done || entry.tool);
	}
	const verb = entry.state === 'running' ? meta.verb : (meta.done || meta.verb);
	return activityLine(meta, verb, entry.target);
}

/**
 * The collapsed record of one exploration phase.
 *
 * Consecutive reads and searches are one phase, not N rows: they fold into a single `<details>`
 * that reads "Explored 3 files, 1 search" and opens to the list of what was actually touched.
 *
 * It is born CLOSED and it is not shown at all while it is the tail of a running turn. That is the
 * change the user asked for: watching the agent work is the job of the turn's status line, which
 * says "Read openideChatWidget.ts" and swaps that out for the next step in the same place. A block
 * that expanded itself live turned every phase into a tree growing under the answer. What is left
 * here is the record — one line, counted, expandable when the user wants the detail.
 */
export class OpenideChatExplorePart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _details: HTMLDetailsElement;
	private readonly _label: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _entries: IRenderedEntry[] = [];

	private _content: IOpenideChatExploreContent;
	private _turnComplete: boolean;
	/** Whether this phase is the turn's trailing content, and so the one the status line is showing. */
	private _live = false;
	/** `openide.chat.tools.defaultExpanded`: the group starts open instead of folded. */
	private readonly _defaultExpanded: boolean;

	constructor(
		content: IOpenideChatExploreContent,
		context: IOpenideChatContentPartContext,
		private readonly _hoverService: IHoverService,
	) {
		super();

		this._content = content;
		this._defaultExpanded = context.toolsDefaultExpanded === true;
		this._turnComplete = context.element.isComplete;

		this._details = $(`details.${OPENIDE_CHAT_ACTIVITY_GROUP_CLASS}`) as HTMLDetailsElement;
		// Closed unless the user asked for open groups. It used to be created open so the reads could
		// be watched as they happened; the status line does that now, and an open block would put the
		// same rows on screen twice.
		this._details.open = this._defaultExpanded;
		this.domNode = this._details;

		const summary = append(this._details, $('summary.openide-chat-activity-summary'));
		this._label = append(summary, $('span.openide-chat-activity-label'));
		append(summary, $('span.codicon.codicon-chevron-right.openide-chat-activity-chevron'));
		this._body = append(this._details, $('div.openide-chat-activity-body'));

		this._register(this._registerToggle());
		this._render();
	}

	/**
	 * While the phase is the tail of a running turn it has NO block: the status line is reading out
	 * the file being opened right now, one line, swapped in place. The block appears — collapsed,
	 * counted, expandable — once something else lands after it or the turn ends.
	 *
	 * Keyed off the tail and not off `isOpenideChatExploreActive` on purpose: between two reads
	 * every entry is momentarily settled, so keying off "active" would flash the whole block open
	 * and shut once per file the agent touches.
	 */
	setLive(live: boolean): void {
		if (this._live === live) {
			return;
		}
		this._live = live;
		this._details.classList.toggle(OPENIDE_CHAT_PART_LIVE_CLASS, live);
		this._onDidChangeHeight.fire();
	}

	private _registerToggle() {
		const listener = () => this._onDidChangeHeight.fire();
		this._details.addEventListener('toggle', listener);
		return { dispose: () => this._details.removeEventListener('toggle', listener) };
	}

	private _render(): void {
		const active = isOpenideChatExploreActive(this._content);
		this._label.textContent = openideChatExploreLabel(this._content);
		setOpenideChatShimmer(this._label, active);
		this._syncEntries();
		// No auto-collapse any more: the block is born folded, so the only thing that ever opens it
		// is the user clicking it — and a turn finishing must not undo that click.
	}

	/**
	 * Reconciles the rows with the entries.
	 *
	 * Entries only ever append and settle in place, so a positional diff is exact. Rows are reused
	 * whenever the `callId` at that index still matches: rebuilding them would restart the shimmer
	 * of every in-flight read each time a new one starts.
	 */
	private _syncEntries(): void {
		const entries = this._content.entries;
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const rendered = this._entries[i];
			if (rendered && rendered.callId === entry.callId) {
				this._updateEntry(rendered, entry);
				continue;
			}
			if (rendered) {
				this._dropEntriesFrom(i);
			}
			this._entries[i] = this._createEntry(entry);
		}
		this._dropEntriesFrom(entries.length);
	}

	private _createEntry(entry: IOpenideChatExploreEntry): IRenderedEntry {
		const row = createOpenideChatActivityRow({ explore: true, visualKindId: toolVisualKind(entry.tool).id });
		append(this._body, row.root);
		const store = this._register(new DisposableStore());
		const rendered: IRenderedEntry = { callId: entry.callId, row, store, target: '', state: entry.state, tool: entry.tool, line: '' };
		// The row truncates: the untruncated line is the hover, because a path's tail is the part
		// that identifies it and the tail is exactly what the ellipsis eats. Only WHEN it truncates,
		// though — a tip that repeats a line already on screen is a box over the row above it. It
		// repeats the row, so it is not a second accessible name.
		store.add(setupChatTooltip(this._hoverService, row.head, () => isOpenideChatTextClipped(row.verb) ? rendered.line : '', { aria: false, atMouse: true }));
		this._paintEntry(rendered, entry);
		return rendered;
	}

	private _updateEntry(rendered: IRenderedEntry, entry: IOpenideChatExploreEntry): void {
		if (rendered.target === entry.target && rendered.state === entry.state && rendered.tool === entry.tool) {
			return;
		}
		this._paintEntry(rendered, entry);
	}

	private _paintEntry(rendered: IRenderedEntry, entry: IOpenideChatExploreEntry): void {
		const meta = getOpenideToolMeta(entry.tool);
		setOpenideChatActivityIcon(rendered.row.icon, meta.icon);
		const line = entryLine(entry);
		const verb = entry.state === 'running' ? meta.verb : (meta.done || meta.verb);
		if (entry.state === 'error') {
			rendered.row.verb.textContent = line;
		} else {
			renderOpenideChatActivityLine(rendered.row.verb, verb, entry.target);
		}
		rendered.line = line;
		setOpenideChatShimmer(rendered.row.verb, entry.state === 'running');
		rendered.row.root.classList.toggle(OPENIDE_CHAT_PART_ERROR_CLASS, entry.state === 'error');
		rendered.target = entry.target;
		rendered.state = entry.state;
		rendered.tool = entry.tool;
	}

	private _dropEntriesFrom(index: number): void {
		for (let i = index; i < this._entries.length; i++) {
			this._entries[i]?.row.root.remove();
			this._entries[i]?.store.dispose();
		}
		this._entries.length = Math.min(this._entries.length, index);
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'explore')) {
			return false;
		}
		if (other.id !== this._content.id || element.isComplete !== this._turnComplete) {
			return false;
		}
		if (other.entries.length !== this._content.entries.length || other.isComplete !== this._content.isComplete) {
			return false;
		}
		return other.entries.every((entry, i) => {
			const mine = this._content.entries[i];
			return entry.callId === mine.callId && entry.state === mine.state && entry.target === mine.target;
		});
	}

	/** Same block, new snapshot. A different `id` is a different exploration phase and gets its own. */
	tryUpdate(other: IOpenideChatContent, element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'explore') || other.id !== this._content.id) {
			return false;
		}
		this._content = other;
		this._turnComplete = element.isComplete;
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}
