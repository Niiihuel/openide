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
 * Pending legacy delegation. Once its children arrive, ActivityGroups supplies the compact
 * avatar summary and retains this envelope as hidden metadata inside the disclosure.
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
