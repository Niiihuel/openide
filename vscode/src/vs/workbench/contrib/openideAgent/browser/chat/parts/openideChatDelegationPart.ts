/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../../base/browser/dom.js';
import { IOpenideChatContent, IOpenideChatDelegationContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatDelegation.css';

export const OPENIDE_CHAT_DELEGATION_CLASS = 'openide-chat-delegation';

type DelegationStatus = IOpenideChatDelegationContent['status'];

/**
 * The header of a delegation: "Delegation · 3 agents", with the group's status.
 *
 * Ported from the webview's delegation summary and its
 * `.delegation-summary*` styles (:679-690), but reduced to the head — and that reduction is the
 * whole design decision here, so it is worth writing down.
 *
 * In the webview a delegation is a BOX: `.delegation-group` holds a `.delegation-children` host and
 * every subagent card is appended INSIDE it (`orderedDelegationInsert`, :3537-3544). The native
 * transcript cannot nest: the list is flat, one row per content, and the reducer pushes the
 * envelope and then each `subagent` as siblings (openideChatReducerTools.ts:38-50). So this part
 * OPENS the group instead of containing it — the cards that follow are its members, in order,
 * exactly as they were inside the box.
 *
 * Two things the webview head had are therefore gone, both because the content model does not carry
 * them, not because they were dropped: the expandable "Resultado" body (it came from the
 * `delegate_task` tool result, which the reducer does not keep on this content) and the
 * Review-vs-Delegation wording with its shield icon (it came from the tool NAME, likewise absent).
 * The token and tool totals are gone for the same reason — they were summed over the child cards
 * the box owned, and this row owns nothing.
 */
export class OpenideChatDelegationPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _title: HTMLElement;
	private readonly _status: HTMLElement;

	private _content: IOpenideChatDelegationContent;

	constructor(content: IOpenideChatDelegationContent, _context: IOpenideChatContentPartContext) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_DELEGATION_CLASS}`);
		append(this.domNode, $('span.codicon.codicon-run-all.openide-chat-delegation-icon'));
		this._title = append(this.domNode, $('span.openide-chat-delegation-title'));
		append(this.domNode, $('span.openide-chat-delegation-space'));
		this._status = append(this.domNode, $('span.openide-chat-delegation-status'));

		this._render();
	}

	private _render(): void {
		this._title.textContent = delegationTitle(this._content.total);
		this._status.className = `codicon codicon-${delegationGlyph(this._content.status)} openide-chat-delegation-status`;
		// Spinning only while the group is still open; the modifier is what animates the glyph.
		this._status.classList.toggle('codicon-modifier-spin', this._content.status === 'running');
		this.domNode.classList.toggle('openide-chat-delegation-error', this._content.status === 'partial');
	}

	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'delegation')
			&& other.delegationId === this._content.delegationId
			&& other.total === this._content.total
			&& other.status === this._content.status;
	}

	/**
	 * Absorbs the count and the status of the SAME delegation.
	 *
	 * Both move after the row is on screen: `ensureOpenideChatDelegation` raises `total` when the
	 * envelope was created by whichever of `delegationStart` / `toolStart` arrived first with a
	 * smaller count, and `applyDelegationDone` flips the status at the end.
	 */
	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'delegation') || other.delegationId !== this._content.delegationId) {
			return false;
		}
		this._content = other;
		this._render();
		return true;
	}
}

/** the removed chat webview. English, like the webview's summary line. */
function delegationTitle(total: number): string {
	const count = Math.max(0, Math.round(total) || 0);
	return `Delegation · ${count} ${count === 1 ? 'agent' : 'agents'}`;
}

/**
 * `partial` is a WARNING and not an error: some of the delegated agents did finish, and the results
 * they produced are in the transcript right below. The webview only knew "error or not" because it
 * read the tool's `isError`; the content model is more precise, so the glyph is too.
 */
function delegationGlyph(status: DelegationStatus): string {
	switch (status) {
		case 'completed': return 'pass-filled';
		case 'partial': return 'warning';
		case 'cancelled': return 'circle-slash';
		case 'running':
		default: return 'loading';
	}
}
