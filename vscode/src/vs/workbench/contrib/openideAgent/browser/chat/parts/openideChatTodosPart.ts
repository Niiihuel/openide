/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IOpenideChatContent, IOpenideChatTodosContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { ITodoItem, TodoStatus } from '../../../common/openideAgentTypes.js';
import { t } from '../../../common/openideStrings.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatTodos.css';

export const OPENIDE_CHAT_TODOS_CLASS = 'openide-chat-todos-card';

/**
 * The turn's to-do list.
 *
 * Ported from the webview's `paintTodoPanel` in the shape `appendTodoUpdate` gives it: the rounded
 * card, not the `.turn-todos` skirt glued under the user's bubble. The skirt is a live overlay of
 * the CURRENT list anchored to the composer's turn, and the native transcript has no such anchor —
 * every row here is a list item. The reducer agrees: `applyTodos` (openideChatReducer.ts) keeps
 * ONE content per turn and rewrites it in place, so this card is the live panel and the snapshot
 * at once.
 *
 * The header is a single line — "3 de 4 tareas completadas" — and the whole strip toggles the
 * list. Expanded while anything is pending, because the row exists to answer "what is it doing
 * and how much is left"; once the last item completes it folds itself, since a finished list is
 * a receipt and the count already says everything a receipt has to. A toggle by hand afterwards
 * is respected until the list changes state again.
 */
export class OpenideChatTodosPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _head: HTMLElement;
	private readonly _caret: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _body: HTMLElement;

	private _content: IOpenideChatTodosContent;
	private _expanded: boolean;
	private _allDone: boolean;

	constructor(
		content: IOpenideChatTodosContent,
		_context: IOpenideChatContentPartContext,
		_hoverService: IHoverService,
	) {
		super();

		this._content = content;
		this._allDone = allTodosDone(content.items);
		this._expanded = !this._allDone;

		this.domNode = $(`div.${OPENIDE_CHAT_TODOS_CLASS}`);
		this._head = append(this.domNode, $('div.openide-chat-tt-head', { role: 'button', tabindex: '0' }));
		this._caret = append(this._head, $('span.codicon.openide-chat-tt-caret'));
		this._title = append(this._head, $('span.openide-chat-tt-title'));
		// The grid row is what animates: `1fr` to `0fr` over 180ms. The body inside clips.
		const reveal = append(this.domNode, $('div.openide-chat-tt-reveal'));
		this._body = append(reveal, $('div.openide-chat-tt-body'));
		// Once when the fold starts (the list can begin making room) and once more here with the
		// settled height — see the same pair in `openideChatQuestionsCard.ts`.
		this._register(addDisposableListener(reveal, 'transitionend', () => this._onDidChangeHeight.fire()));

		this._register(addDisposableListener(this._head, 'click', () => this._toggle()));
		this._register(addDisposableListener(this._head, 'keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			// Stopped as well as prevented: the list is a tree, and a bubbling Enter would activate
			// the focused row instead of toggling the card.
			event.preventDefault();
			event.stopPropagation();
			this._toggle();
		}));

		this._render();
	}

	private _toggle(): void {
		this._expanded = !this._expanded;
		this._applyExpanded();
		this._onDidChangeHeight.fire();
	}

	private _applyExpanded(): void {
		this.domNode.classList.toggle('openide-chat-todos-collapsed', !this._expanded);
		this._caret.className = `codicon openide-chat-tt-caret codicon-${this._expanded ? 'chevron-down' : 'chevron-right'}`;
		this._head.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');
	}

	private _render(): void {
		const items = this._content.items;
		const done = items.filter(item => item.status === 'completed').length;

		// Empty is hidden rather than "0/0": the webview's `renderTodos` removes the panel outright
		// when the model clears the list, and an empty bordered box reads as a bug.
		this.domNode.classList.toggle('openide-chat-todos-empty', items.length === 0);

		this._title.textContent = t('chat.part.todosProgress', done, items.length);
		this._applyExpanded();
		this._renderBody();
	}

	private _renderBody(): void {
		clearNode(this._body);
		for (const item of this._content.items) {
			const status = item.status ?? 'pending';
			const row = append(this._body, $(`div.openide-chat-tt-row.openide-chat-tt-s-${status}`));
			append(row, $(`span.codicon.openide-chat-tt-icon.${todoGlyph(status)}`));
			const text = append(row, $('span.openide-chat-tt-text'));
			text.textContent = item.title ?? '';
			// The row ellipsizes; a native title is the cheapest way to give every row its full text
			// without one hover disposable per item per repaint.
			text.title = item.title ?? '';
		}
	}

	/**
	 * Deep-compares the list because the reducer replaces the whole content object on every
	 * `update_todos`: an identity check would rebuild the card — and reset the user's collapse — on
	 * a call that only flipped one item from pending to completed.
	 */
	hasSameContent(other: IOpenideChatContent, _followingContent: readonly IOpenideChatContent[], _element: IOpenideChatItem): boolean {
		return isOpenideChatContentOfKind(other, 'todos') && sameTodos(other.items, this._content.items);
	}

	tryUpdate(other: IOpenideChatContent, _element: IOpenideChatItem): boolean {
		if (!isOpenideChatContentOfKind(other, 'todos')) {
			return false;
		}
		this._content = other;
		// The fold follows the list's state, not every update: completing the last item collapses,
		// a new pending item re-opens, and anything in between leaves the user's choice alone.
		const allDone = allTodosDone(other.items);
		if (allDone !== this._allDone) {
			this._allDone = allDone;
			this._expanded = !allDone;
		}
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}

function allTodosDone(items: readonly ITodoItem[]): boolean {
	return items.length > 0 && items.every(item => item.status === 'completed');
}

/** The status glyphs of the webview: pass / spinning / outline circle. */
function todoGlyph(status: TodoStatus): string {
	switch (status) {
		case 'completed': return 'codicon-pass';
		case 'in-progress': return 'codicon-loading.codicon-modifier-spin';
		default: return 'codicon-circle-large-outline';
	}
}

function sameTodos(a: readonly ITodoItem[], b: readonly ITodoItem[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return a.every((item, index) => item.id === b[index].id
		&& item.title === b[index].title
		&& item.status === b[index].status);
}
