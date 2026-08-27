/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { getOpenideCli, groupOpenideSessions, OpenideSessionGroup } from '../../common/openideAgentCliCatalog.js';
import { InputBox } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { openideInputBoxStyles } from '../openideControlStyles.js';
import { onDidChangeOpenideLanguage, OpenideStringKey, t } from '../../common/openideStrings.js';
import { IChatSessionMeta, OpenideChatSessions } from '../openideChatSessions.js';
import { menuIcon, menuRow, menuRowAction, OpenideChatMenuPopover } from './openideChatMenuDom.js';

/**
 * The Sessions panel of the dock — VS Code's Agent Sessions view (`agentSessionsControl.ts`,
 * `agentSessionsModel.ts` sections, `agentSessionsFilter.ts`) rebuilt on the dock's own
 * primitives: a panel that slides in under the header, side-by-side as a right column when the
 * dock is wide and stacked over the transcript when it is narrow, with search, a filter menu,
 * date-grouped rows with a status dot, and the per-row actions (mark read, archive, delete).
 *
 * Its head is ONE row — the search field and the filter — which is Cursor's ("Search Agents…" and
 * nothing else). Four controls were removed from it, each because something else already did the
 * job: a full-width "New session" button (the header's `+ ▾`), a panel toggle (the header's ⏱), a
 * title reading "Sessions" over a list of sessions, and a refresh button over an in-memory store
 * that repaints on every mutation. Search is always visible now instead of hiding behind a button,
 * which is the only reason that button existed.
 *
 * It only READS the store and asks the host to act: opening a session changes the transcript, the
 * terminal host and the header, which the widget owns.
 */

export type OpenideSessionsFilter = 'all' | 'local' | 'cli' | 'needsInput' | 'inProgress' | 'archived';

/** How the panel is laid out: beside the transcript, over it, or AS the body (no session open). */
export type OpenideSessionsPaneMode = 'side' | 'stacked' | 'full';

const FILTERS: readonly { readonly id: OpenideSessionsFilter; readonly label: OpenideStringKey; readonly icon: string }[] = [
	{ id: 'all', label: 'sessions.filter.all', icon: 'list-flat' },
	{ id: 'local', label: 'sessions.filter.local', icon: 'comment-discussion' },
	{ id: 'cli', label: 'sessions.filter.cli', icon: 'terminal' },
	{ id: 'needsInput', label: 'sessions.filter.needsInput', icon: 'bell' },
	{ id: 'inProgress', label: 'sessions.filter.inProgress', icon: 'sync' },
	{ id: 'archived', label: 'sessions.filter.archived', icon: 'archive' },
];

const GROUP_LABEL: Record<OpenideSessionGroup, OpenideStringKey> = {
	today: 'sessions.group.today',
	yesterday: 'sessions.group.yesterday',
	week: 'sessions.group.week',
	month: 'sessions.group.month',
	older: 'sessions.group.older',
};

/** Below this dock width the panel stacks over the transcript instead of sitting beside it. */
const SIDE_BY_SIDE_MIN_WIDTH = 720;

export function relativeTimeLabel(timestamp: number, now: number): string {
	const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
	if (minutes < 1) { return t('sessions.time.now'); }
	if (minutes < 60) { return t('sessions.time.minutes', minutes); }
	const hours = Math.round(minutes / 60);
	if (hours < 24) { return t('sessions.time.hours', hours); }
	return t('sessions.time.days', Math.round(hours / 24));
}

export function matchesOpenideSessionsFilter(session: IChatSessionMeta, filter: OpenideSessionsFilter): boolean {
	switch (filter) {
		case 'all': return !session.archived;
		case 'local': return !session.archived && session.kind === 'native';
		case 'cli': return !session.archived && session.kind === 'cli';
		case 'needsInput': return !session.archived && session.status === 'needs-input';
		case 'inProgress': return !session.archived && session.status === 'in-progress';
		case 'archived': return session.archived;
	}
}

class FilterMenu extends OpenideChatMenuPopover {
	constructor(contextViewService: IContextViewService, private readonly current: () => OpenideSessionsFilter, private readonly pick: (filter: OpenideSessionsFilter) => void) {
		super(contextViewService, { menuClass: 'openide-chat-kind-menu', insetLeft: 0, insetRight: 0, alignment: AnchorAlignment.RIGHT, stretchToAnchor: false, anchorTo: 'trigger' });
	}
	protected override renderContent(content: HTMLElement, store: DisposableStore): void {
		for (const filter of FILTERS) {
			const { row } = menuRow(filter.icon, t(filter.label));
			if (filter.id === this.current()) {
				append(row, menuIcon('check'));
			}
			store.add(addDisposableListener(row, 'click', event => {
				event.stopPropagation();
				this.close();
				this.pick(filter.id);
			}));
			append(content, row);
		}
	}
}

export class OpenideChatSessionsPane extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _listHost: HTMLElement;
	private readonly _scroll: DomScrollableElement;
	private readonly _rowsStore = this._register(new DisposableStore());
	private readonly _search: HTMLInputElement;
	private readonly _searchBox: InputBox;
	private _head!: HTMLElement;
	private readonly _filterMenu: FilterMenu;
	private _filter: OpenideSessionsFilter = 'all';
	private _query = '';
	private _open = false;
	private _full = false;
	private _lastWidth = 0;

	private readonly _onDidOpenSession = this._register(new Emitter<string>());
	readonly onDidOpenSession: Event<string> = this._onDidOpenSession.event;

	private readonly _onDidChangeOpen = this._register(new Emitter<boolean>());
	readonly onDidChangeOpen: Event<boolean> = this._onDidChangeOpen.event;

	private readonly _onDidRequestCloseSession = this._register(new Emitter<string>());
	/** The row's ✕ (external agents): release the hosted PTY and drop the tab, keep the record. */
	readonly onDidRequestCloseSession: Event<string> = this._onDidRequestCloseSession.event;

	private readonly _onDidMutate = this._register(new Emitter<void>());
	/** Archive/delete happened here; the header strip and the transcript may need a repaint. */
	readonly onDidMutate: Event<void> = this._onDidMutate.event;

	constructor(
		parent: HTMLElement,
		private readonly sessions: OpenideChatSessions,
		private readonly confirmDelete: (id: string) => Promise<boolean>,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super();
		this.domNode = append(parent, $('.openide-chat-sessions-pane.hidden'));

		const head = append(this.domNode, $('.openide-chat-sessions-head'));
		this._head = head;
		// Native `InputBox`, not a bordered div around a bare input: it brings the theme's input
		// colours, focus ring and high-contrast handling instead of a second copy that drifts. The
		// magnifier is laid over it in CSS, so the only border here is the themed one.
		const searchRow = append(head, $('.openide-chat-sessions-search'));
		this._searchBox = this._register(new InputBox(searchRow, undefined, {
			placeholder: t('sessions.search'),
			ariaLabel: t('sessions.search'),
			// `inputBackground` overridden on purpose: `openideInputBoxStyles` takes it from
			// `input.background`, which several themes define with the SAME value as the dock's
			// surface (Dracula: both #282a36) — the field vanished against the background and only
			// its border separated it. `--oi-raised` derives from the surface, so it contrasts in
			// any theme. It goes here and not in CSS because the widget paints the background
			// INLINE, and inline beats the stylesheet.
			inputBoxStyles: { ...openideInputBoxStyles, inputBackground: 'var(--oi-raised)' },
		}));
		append(searchRow, $('span.codicon.codicon-search.openide-chat-sessions-search-icon'));
		this._search = this._searchBox.inputElement;
		const filterButton = menuRowAction('filter', t('sessions.filter'));
		append(head, filterButton);

		this._listHost = $('.openide-chat-sessions-list');
		this._scroll = this._register(new DomScrollableElement(this._listHost, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		this._scroll.getDomNode().classList.add('openide-chat-sessions-scroll');
		append(this.domNode, this._scroll.getDomNode());

		this._filterMenu = this._register(new FilterMenu(contextViewService, () => this._filter, filter => { this._filter = filter; this.render(); }));

		this._register(addDisposableListener(filterButton, 'click', event => {
			event.stopPropagation();
			this._filterMenu.toggle(this._head, filterButton);
		}));
		this._register(addDisposableListener(this._search, 'input', () => {
			this._query = this._search.value;
			this.render();
		}));
		this._register(addDisposableListener(this.domNode, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.setOpen(false);
			}
		}));
		this._register(onDidChangeOpenideLanguage(() => this._repaintChrome()));
	}

	get isOpen(): boolean {
		return this._open;
	}

	get mode(): OpenideSessionsPaneMode {
		if (this._full) { return 'full'; }
		return this._lastWidth >= SIDE_BY_SIDE_MIN_WIDTH ? 'side' : 'stacked';
	}

	/** Full mode = the panel IS the body while no session is open; it cannot be dismissed. */
	setFull(full: boolean): void {
		if (this._full === full) { return; }
		this._full = full;
		this._applyMode();
		if (full) { this.setOpen(true); }
	}

	private _applyMode(): void {
		const mode = this.mode;
		this.domNode.classList.toggle('full', mode === 'full');
		this.domNode.classList.toggle('side', mode === 'side');
		this.domNode.classList.toggle('stacked', mode === 'stacked');
	}

	setOpen(open: boolean): void {
		if (this._open === open || (!open && this._full)) {
			return;
		}
		this._open = open;
		this.domNode.classList.toggle('hidden', !open);
		if (open) {
			this.render();
		} else {
			this._filterMenu.close();
		}
		this._onDidChangeOpen.fire(open);
	}

	toggle(): void {
		this.setOpen(!this._open);
	}

	/**
	 * Positions the panel: beside the transcript when wide, over it when narrow, and as the body
	 * (down to the composer) in full mode.
	 */
	layout(width: number, headerHeight: number, bottom = 0): void {
		this._lastWidth = width;
		this._applyMode();
		this.domNode.style.top = `${headerHeight}px`;
		this.domNode.style.bottom = this._full ? `${bottom}px` : '0';
		this._scroll.scanDomNode();
	}

	private _repaintChrome(): void {
		this._searchBox.setPlaceHolder(t('sessions.search'));
		this.render();
	}

	/** Repaints the rows only; the search field keeps its focus and text. */
	render(): void {
		if (!this._open) {
			return;
		}
		this._rowsStore.clear();
		clearNode(this._listHost);
		const query = this._query.trim().toLowerCase();
		const activeId = this.sessions.activeSessionId();
		const now = Date.now();
		const visible = this.sessions.listAll()
			.filter(session => !session.empty || session.id === activeId)
			.filter(session => matchesOpenideSessionsFilter(session, this._filter))
			.filter(session => !query || session.title.toLowerCase().includes(query));
		if (!visible.length) {
			append(this._listHost, $('.openide-chat-sessions-empty', undefined, t('sessions.empty')));
			this._scroll.scanDomNode();
			return;
		}
		for (const group of groupOpenideSessions(visible, now)) {
			const section = append(this._listHost, $('.openide-chat-sessions-group'));
			append(section, $('span', undefined, t(GROUP_LABEL[group.group])));
			append(section, $('span.openide-chat-sessions-group-count', undefined, String(group.sessions.length)));
			for (const session of group.sessions) {
				append(this._listHost, this._renderRow(session, session.id === activeId, now));
			}
		}
		this._scroll.scanDomNode();
	}

	private _renderRow(session: IChatSessionMeta, active: boolean, now: number): HTMLElement {
		const row = $('.openide-chat-sessions-row');
		row.classList.toggle('active', active);
		row.classList.toggle('unread', !!session.unread);
		row.tabIndex = 0;
		row.setAttribute('role', 'button');

		const dot = append(row, $('span.openide-chat-session-dot'));
		dot.classList.add(session.status ?? 'idle');
		dot.title = session.status ? t(statusKey(session.status)) : '';

		const kind = append(row, $('span.openide-chat-sessions-kind'));
		append(kind, menuIcon(session.kind === 'cli' ? 'terminal' : session.forked ? 'repo-forked' : 'comment-discussion'));

		const body = append(row, $('.openide-chat-sessions-body'));
		append(body, $('span.openide-chat-sessions-row-title', undefined, session.title || t('chat.header.newTitle')));
		const meta = append(body, $('span.openide-chat-sessions-row-meta'));
		const cli = getOpenideCli(session.cliId);
		meta.textContent = [cli?.name, session.status ? t(statusKey(session.status)) : undefined, relativeTimeLabel(session.updatedAt, now)].filter(Boolean).join(' · ');

		const actions = append(row, $('span.openide-chat-sessions-row-actions'));
		if (session.unread) {
			const read = append(actions, menuRowAction('eye', t('sessions.action.markRead')));
			this._rowsStore.add(addDisposableListener(read, 'click', event => { event.stopPropagation(); this.sessions.markRead(session.id); this.render(); this._onDidMutate.fire(); }));
		}
		const archive = append(actions, menuRowAction(session.archived ? 'unarchive' : 'archive', t(session.archived ? 'sessions.action.unarchive' : 'sessions.action.archive')));
		this._rowsStore.add(addDisposableListener(archive, 'click', event => {
			event.stopPropagation();
			if (session.archived) { this.sessions.unarchive(session.id); } else { this.sessions.archive(session.id); }
			this.render();
			this._onDidMutate.fire();
		}));
		if (session.kind === 'cli' && this.sessions.openTabs().some(open => open.id === session.id)) {
			const close = append(actions, menuRowAction('close', t('sessions.action.closeSession')));
			this._rowsStore.add(addDisposableListener(close, 'click', event => { event.stopPropagation(); this._onDidRequestCloseSession.fire(session.id); }));
		}
		const remove = append(actions, menuRowAction('trash', t('sessions.action.delete')));
		this._rowsStore.add(addDisposableListener(remove, 'click', async event => {
			event.stopPropagation();
			if (await this.confirmDelete(session.id)) {
				this.render();
				this._onDidMutate.fire();
			}
		}));

		const open = (): void => this._onDidOpenSession.fire(session.id);
		this._rowsStore.add(addDisposableListener(row, 'click', open));
		this._rowsStore.add(addDisposableListener(row, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				open();
			}
		}));
		return row;
	}
}

function statusKey(status: NonNullable<IChatSessionMeta['status']>): OpenideStringKey {
	switch (status) {
		case 'in-progress': return 'sessions.status.inProgress';
		case 'needs-input': return 'sessions.status.needsInput';
		case 'completed': return 'sessions.status.completed';
		case 'failed': return 'sessions.status.failed';
	}
}
