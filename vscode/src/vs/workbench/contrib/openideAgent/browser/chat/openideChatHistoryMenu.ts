/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IChatSessionMeta } from '../openideChatSessions.js';
import { menuEmpty, menuIcon, menuRow, menuRowAction, menuSection, menuSeparator, OpenideChatMenuPopover } from './openideChatMenuDom.js';
import './media/openideChatHistory.css';

/**
 * Conversation history popover. Same content and same wording as the webview's `#historyMenu`
 * (the removed webview's `buildHistoryMenu` / `renderHistoryList` / `historyRow`): a search field,
 * the non-archived sessions grouped by recency, and the archived ones behind a collapsed toggle.
 */

const DEFAULT_TITLE = 'Nuevo chat';
const SEARCH_PLACEHOLDER = 'Buscar conversaciones…';
const NO_RESULTS = 'Sin resultados';
const NO_SESSIONS = 'Sin conversaciones';
const RENAME_TOOLTIP = 'Renombrar';
const FORK_TOOLTIP = 'Fork (rama independiente con este contexto)';
const ARCHIVE_TOOLTIP = 'Archivar';
const UNARCHIVE_TOOLTIP = 'Desarchivar';
const DELETE_TOOLTIP = 'Eliminar';

const DAY = 86_400_000;

/** What the header lets the history do. Mutations that can change the ACTIVE conversation stay in
 *  the header: only it knows how to reactivate another one and tell the widget to reload. */
export interface IOpenideChatHistoryActions {
	list(): readonly IChatSessionMeta[];
	activeId(): string | undefined;
	/** Switch to a conversation. Closes the popover, like the webview does. */
	open(id: string): void;
	/** Branch off a conversation. Closes the popover, like the webview does. */
	fork(id: string): void;
	rename(id: string): void;
	/** These three keep the popover open; the list repaints in place. */
	archive(id: string): void;
	unarchive(id: string): void;
	remove(id: string): void;
}

/** Recency bucket a session's timestamp falls into, matching the webview's `groupOf`. */
function groupOf(timestamp: number): string {
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	if (timestamp >= startOfToday) { return 'Hoy'; }
	if (timestamp >= startOfToday - DAY) { return 'Ayer'; }
	if (timestamp >= startOfToday - 7 * DAY) { return 'Últimos 7 días'; }
	if (timestamp >= startOfToday - 30 * DAY) { return 'Últimos 30 días'; }
	return 'Más viejas';
}

/** The icon states the row's status: active wins over failed, failed over forked. */
function rowIcon(session: IChatSessionMeta, active: boolean): string {
	if (active) { return 'check'; }
	if (session.hasError) { return 'error'; }
	if (session.forked) { return 'repo-forked'; }
	return 'comment';
}

export class OpenideChatHistoryMenu extends OpenideChatMenuPopover {

	/** Both survive a repaint so filtering and expanding do not reset each other. */
	private search = '';
	private archivedOpen = false;

	private searchInput: HTMLInputElement | undefined;
	private listHost: HTMLElement | undefined;
	private listStore: DisposableStore | undefined;

	constructor(
		contextViewService: IContextViewService,
		private readonly actions: IOpenideChatHistoryActions,
	) {
		super(contextViewService, {
			menuClass: 'openide-chat-history-menu',
			insetLeft: 6,
			insetRight: 6,
			alignment: AnchorAlignment.LEFT,
			stretchToAnchor: true,
			anchorTo: 'header',
		});
	}

	protected override initialFocus(): HTMLElement | undefined {
		return this.searchInput;
	}

	protected override renderContent(content: HTMLElement, store: DisposableStore): void {
		const searchRow = append(content, $('div.openide-menu-search-row'));
		append(searchRow, menuIcon('search'));
		const input = append(searchRow, $<HTMLInputElement>('input.openide-menu-search', { type: 'text', placeholder: SEARCH_PLACEHOLDER }));
		input.value = this.search;
		store.add(addDisposableListener(input, 'input', () => {
			this.search = input.value;
			this.renderList();
		}));
		this.searchInput = input;

		this.listHost = append(content, $('div.openide-chat-history-list'));
		this.listStore = store.add(new DisposableStore());
		this.renderList();
	}

	/** Repaints just the rows: rebuilding the whole body would drop the search field's focus. */
	private renderList(): void {
		const list = this.listHost;
		const store = this.listStore;
		if (!list || !store) {
			return;
		}
		store.clear();
		clearNode(list);

		const query = this.search.trim().toLowerCase();
		// Empty sessions never reach history — VS Code filters `isEmpty` out of the picker too.
		const visible = this.actions.list()
			.filter(session => !session.empty)
			.filter(session => !query || (session.title || DEFAULT_TITLE).toLowerCase().includes(query));
		const recent = visible.filter(session => !session.archived);
		const archived = visible.filter(session => session.archived);
		if (!recent.length && !archived.length) {
			append(list, menuEmpty(query ? NO_RESULTS : NO_SESSIONS));
			this.relayout();
			return;
		}

		let lastGroup = '';
		for (const session of recent) {
			const group = groupOf(session.updatedAt || 0);
			if (group !== lastGroup) {
				lastGroup = group;
				append(list, menuSection(group));
			}
			append(list, this.createRow(session, false, store));
		}

		if (archived.length) {
			append(list, menuSeparator());
			const toggle = menuRow(this.archivedOpen ? 'chevron-down' : 'chevron-right', `Archivadas (${archived.length})`);
			store.add(addDisposableListener(toggle.row, 'click', event => {
				event.stopPropagation();
				this.archivedOpen = !this.archivedOpen;
				this.renderList();
			}));
			append(list, toggle.row);
			if (this.archivedOpen) {
				for (const session of archived) {
					append(list, this.createRow(session, true, store));
				}
			}
		}
		this.relayout();
	}

	private createRow(session: IChatSessionMeta, isArchived: boolean, store: DisposableStore): HTMLElement {
		const active = session.id === this.actions.activeId();
		const { row } = menuRow(rowIcon(session, active), session.title || DEFAULT_TITLE);
		// The webview's `has-actions`. It is what makes the title reserve the strip's width up front
		// (media/openideChatHistory.css); the "Archivadas (N)" toggle is a row too and must not.
		row.classList.add('openide-menu-has-actions');
		const actions = append(row, $('span.openide-menu-row-actions'));

		const rename = append(actions, menuRowAction('edit', RENAME_TOOLTIP));
		store.add(addDisposableListener(rename, 'click', event => {
			event.stopPropagation();
			this.close();
			this.actions.rename(session.id);
		}));
		const fork = append(actions, menuRowAction('repo-forked', FORK_TOOLTIP));
		store.add(addDisposableListener(fork, 'click', event => {
			event.stopPropagation();
			this.close();
			this.actions.fork(session.id);
		}));

		const archive = append(actions, menuRowAction(isArchived ? 'inbox' : 'archive', isArchived ? UNARCHIVE_TOOLTIP : ARCHIVE_TOOLTIP));
		store.add(addDisposableListener(archive, 'click', event => {
			event.stopPropagation();
			if (isArchived) {
				this.actions.unarchive(session.id);
			} else {
				this.actions.archive(session.id);
			}
			this.renderList();
		}));

		const remove = append(actions, menuRowAction('trash', DELETE_TOOLTIP));
		store.add(addDisposableListener(remove, 'click', event => {
			event.stopPropagation();
			this.actions.remove(session.id);
			this.renderList();
		}));

		store.add(addDisposableListener(row, 'click', () => {
			this.close();
			this.actions.open(session.id);
		}));
		return row;
	}
}
