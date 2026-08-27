/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { localize } from '../../../../../../nls.js';
import { IOpenideChatContent, IOpenideChatExploreContent, IOpenideChatExploreEntry, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { isOpenideChatExploreActive, openideChatExploreLabel } from '../../../common/chat/openideChatExploreGroup.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { getOpenideToolMeta, toolVisualKind } from '../../../common/chat/openideChatToolMeta.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import {
	activityLine,
	createOpenideChatActivityRow,
	IOpenideChatActivityRow,
	OPENIDE_CHAT_PART_ERROR_CLASS,
	setOpenideChatActivityIcon,
	setOpenideChatShimmer,
	renderOpenideChatActivityLine,
} from './openideChatActivityRow.js';
import '../media/openideChatActivity.css';

export const OPENIDE_CHAT_ACTIVITY_GROUP_CLASS = 'openide-chat-activity-group';

interface IRenderedEntry {
	readonly callId: string;
	readonly row: IOpenideChatActivityRow;
	target: string;
	state: IOpenideChatExploreEntry['state'];
	tool: string;
}

/**
 * Line of one explore entry.
 *
 * Errors drop the target and say so, which is what `finishTool` does for a failed explore call
 * (openideChatHtml.ts:3464): the row is then about the failure, and a path next to the word "error"
 * reads as if the path itself were the problem.
 */
function entryLine(entry: IOpenideChatExploreEntry): string {
	const meta = getOpenideToolMeta(entry.tool);
	if (entry.state === 'error') {
		return localize('openide.chat.explore.error', "{0} — error", meta.done || entry.tool);
	}
	const verb = entry.state === 'running' ? meta.verb : (meta.done || meta.verb);
	return activityLine(meta, verb, entry.target);
}

/**
 * The collapsible "Exploring" block.
 *
 * Consecutive reads and searches are one phase, not N rows: the webview folds them into a single
 * `<details>` whose summary shimmers as "Exploring" while anything is in flight and settles into
 * "Explored 3 files, 1 search". Collapsed it keeps a masked 68px peek of the rows, which is what
 * makes the block feel like a folded phase rather than a hidden one.
 */
export class OpenideChatExplorePart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _details: HTMLDetailsElement;
	private readonly _label: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _entries: IRenderedEntry[] = [];

	private _content: IOpenideChatExploreContent;
	private _turnComplete: boolean;
	private _collapsedOnComplete = false;
	/** `openide.chat.tools.defaultExpanded`: the settled group stays open instead of folding. */
	private readonly _defaultExpanded: boolean;

	constructor(content: IOpenideChatExploreContent, context: IOpenideChatContentPartContext) {
		super();

		this._content = content;
		this._defaultExpanded = context.toolsDefaultExpanded === true;
		this._turnComplete = context.element.isComplete;

		this._details = $(`details.${OPENIDE_CHAT_ACTIVITY_GROUP_CLASS}`) as HTMLDetailsElement;
		// Created open, like `ensureExploreGroup` (openideChatHtml.ts:1577): the point of the block
		// is that the user can watch which files are being opened while it happens.
		this._details.open = true;
		this.domNode = this._details;

		const summary = append(this._details, $('summary.openide-chat-activity-summary'));
		this._label = append(summary, $('span.openide-chat-activity-label'));
		append(summary, $('span.codicon.codicon-chevron-right.openide-chat-activity-chevron'));
		this._body = append(this._details, $('div.openide-chat-activity-body'));

		this._register(this._registerToggle());
		this._render();
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

		// Collapsing keys off the TURN being over, not off `isComplete` on the content: between two
		// consecutive reads every entry is momentarily settled, so collapsing on that would slam the
		// block shut and reopen it a frame later, once per file the agent touches.
		if (this._turnComplete && !active && !this._collapsedOnComplete) {
			this._collapsedOnComplete = true;
			// `openide.chat.tools.defaultExpanded` keeps the settled group readable in place.
			if (!this._defaultExpanded) {
				this._details.open = false;
			}
		}
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
		const rendered: IRenderedEntry = { callId: entry.callId, row, target: '', state: entry.state, tool: entry.tool };
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
		// The row truncates: the untruncated line is the tooltip, because a path's tail is the part
		// that identifies it and the tail is exactly what the ellipsis eats.
		rendered.row.head.title = line;
		setOpenideChatShimmer(rendered.row.verb, entry.state === 'running');
		rendered.row.root.classList.toggle(OPENIDE_CHAT_PART_ERROR_CLASS, entry.state === 'error');
		rendered.target = entry.target;
		rendered.state = entry.state;
		rendered.tool = entry.tool;
	}

	private _dropEntriesFrom(index: number): void {
		for (let i = index; i < this._entries.length; i++) {
			this._entries[i]?.row.root.remove();
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
