/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { IOpenideChatContent, IOpenideChatTodosContent, isOpenideChatContentOfKind } from '../../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../../common/chat/openideChatItem.js';
import { ITodoItem, TodoStatus } from '../../../common/openideAgentTypes.js';
import { IOpenideChatContentPartContext, OpenideChatContentPart } from '../openideChatContentPart.js';
import '../media/openideChatTodos.css';

export const OPENIDE_CHAT_TODOS_CLASS = 'openide-chat-todos-card';

/**
 * The turn's to-do list.
 *
 * Ported from the webview's `paintTodoPanel` (openideChatHtml.ts:4275-4313) in the shape
 * `appendTodoUpdate` gives it (:4343-4357): the rounded `.todo-update` card, not the `.turn-todos`
 * skirt glued under the user's bubble. The skirt is a live overlay of the CURRENT list anchored to
 * the composer's turn, and the native transcript has no such anchor — every row here is a list
 * item. The reducer agrees: `applyTodos` (openideChatReducer.ts:232-239) keeps ONE content per turn
 * and rewrites it in place, so this card is the live panel and the snapshot at once.
 *
 * Not to be confused with the older to-do tray that was deleted from the webview: it is gone, and
 * nothing here revives it.
 *
 * Expanded by default, exactly like `appendTodoUpdate` sets `data-expanded='1'` — the row exists to
 * answer "what is it doing and how much is left", and a collapsed card answers only half of that.
 */
export class OpenideChatTodosPart extends OpenideChatContentPart {

	readonly domNode: HTMLElement;

	private readonly _toggle: HTMLElement;
	private readonly _caret: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _progress: HTMLElement;
	private readonly _body: HTMLElement;

	private _content: IOpenideChatTodosContent;
	private _expanded = true;

	constructor(content: IOpenideChatTodosContent, _context: IOpenideChatContentPartContext) {
		super();

		this._content = content;
		this.domNode = $(`div.${OPENIDE_CHAT_TODOS_CLASS}`);
		const head = append(this.domNode, $('div.openide-chat-tt-head'));
		this._toggle = append(head, $('button.openide-chat-tt-toggle'));
		this._toggle.setAttribute('type', 'button');
		this._caret = append(this._toggle, $('span.codicon'));
		this._title = append(this._toggle, $('span.openide-chat-tt-title'));
		this._progress = append(head, $('span.openide-chat-tt-prog'));
		this._body = append(this.domNode, $('div.openide-chat-tt-body'));

		this._register(addDisposableListener(this._toggle, 'click', () => {
			this._expanded = !this._expanded;
			this._render();
			this._onDidChangeHeight.fire();
		}));

		this._render();
	}

	private _render(): void {
		const items = this._content.items;
		const done = items.filter(item => item.status === 'completed').length;
		const allDone = items.length > 0 && done === items.length;

		// Empty is hidden rather than "0/0": `renderTodos` (openideChatHtml.ts:4319-4323) removes the
		// panel outright when the model clears the list, and an empty bordered box reads as a bug.
		this.domNode.classList.toggle('openide-chat-todos-empty', items.length === 0);

		this._caret.className = `codicon codicon-${this._expanded ? 'chevron-down' : allDone ? 'checklist' : 'arrow-circle-right'}`;
		const title = this._expanded ? 'Tareas' : currentTodoTitle(items);
		this._title.textContent = title;
		this._title.title = title;
		this._progress.textContent = `${done}/${items.length}`;
		this._toggle.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');

		this._renderBody();
	}

	private _renderBody(): void {
		clearNode(this._body);
		this._body.classList.toggle('hidden', !this._expanded || this._content.items.length === 0);
		if (!this._expanded) {
			return;
		}
		for (const item of this._content.items) {
			const status = item.status ?? 'pending';
			const row = append(this._body, $(`div.openide-chat-tt-row.openide-chat-tt-s-${status}`));
			append(row, $(`span.codicon.codicon-${todoGlyph(status)}.openide-chat-tt-icon`));
			const text = append(row, $('span.openide-chat-tt-text'));
			text.textContent = item.title ?? '';
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
		this._render();
		this._onDidChangeHeight.fire();
		return true;
	}
}

/** Collapsed headline: what is being worked on right now (openideChatHtml.ts:4283-4287, :4295). */
function currentTodoTitle(items: readonly ITodoItem[]): string {
	if (!items.length) {
		return 'Sin tareas';
	}
	const current = items.find(item => item.status === 'in-progress')
		?? items.find(item => item.status === 'pending')
		?? items[items.length - 1];
	return current.title || 'Tareas';
}

/** openideChatHtml.ts:4306. */
function todoGlyph(status: TodoStatus): string {
	switch (status) {
		case 'completed': return 'pass';
		case 'in-progress': return 'arrow-right';
		default: return 'circle-large-outline';
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
