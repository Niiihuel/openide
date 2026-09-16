/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { OpenideEmptyState } from '../../../../browser/openideEmptyState.js';
import { AgentWindowAction } from '../../common/openideAgentWindowShortcuts.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { getOpenideCli } from '../../common/openideAgentCliCatalog.js';
import { InputBox } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { openideSearchBoxStyles } from '../openideControlStyles.js';
import { onDidChangeOpenideLanguage, OpenideStringKey, t } from '../../common/openideStrings.js';
import { IChatSessionMeta, OpenideChatSessions } from '../openideChatSessions.js';
import { OPENIDE_CHAT_HOVER_APPEARANCE, OPENIDE_CHAT_HOVER_GROUP, setupChatTooltip, setupOverflowFade } from './openideChatHover.js';
import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { URI } from '../../../../../base/common/uri.js';
import { isEqualOrParent } from '../../../../../base/common/resources.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../../platform/workspace/common/workspace.js';
import { createChatSessionStatusIcon } from './openideChatIcons.js';
import { createSubagentAvatar, subagentAvatarKind } from '../openideSubagentAvatar.js';
import { ISubagentRunService } from '../openideSubagentRunService.js';
import { ISubagentRun } from '../../common/openideSubagentTypes.js';
import './media/openideSubagents.css';
import { menuIcon, menuRow, menuRowAction, OpenideChatMenuPopover } from './openideChatMenuDom.js';

/**
 * The Sessions panel of the dock — VS Code's Agent Sessions view (`agentSessionsControl.ts`,
 * `agentSessionsModel.ts` sections, `agentSessionsFilter.ts`) rebuilt on the dock's own
 * primitives: a panel that slides in under the header, side-by-side as a right column when the
 * dock is wide and stacked over the transcript when it is narrow, with search, a filter menu,
 * project-grouped rows with a shared activity indicator, and the per-row actions (mark read, archive, delete).
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

export interface IOpenideSessionProject {
	readonly id: string;
	readonly label: string;
	readonly path?: string;
}

/** Native history is scoped to this workspace; only CLI records carry a specific cwd. */
export function sessionProjectContext(session: IChatSessionMeta, folders: readonly Pick<IWorkspaceFolder, 'name' | 'uri'>[]): IOpenideSessionProject {
	const cwd = session.cwd ? URI.file(session.cwd) : undefined;
	const folder = cwd
		? [...folders].sort((a, b) => b.uri.path.length - a.uri.path.length).find(entry => isEqualOrParent(cwd, entry.uri, isWindows))
		: folders.length === 1 ? folders[0] : undefined;
	if (folder) { return { id: folder.uri.toString(), label: folder.name, path: folder.uri.fsPath }; }
	if (cwd) { return { id: cwd.toString(), label: cwd.path.replace(/\/+$/, '').split('/').pop() || session.cwd!, path: session.cwd }; }
	return { id: 'no-project', label: t('sessions.group.noProject') };
}

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

interface ISessionMenuAction { readonly icon: string; readonly label: string; readonly run: () => void | Promise<void>; }

class SessionActionsMenu extends OpenideChatMenuPopover {
	private firstAction: HTMLElement | undefined;
	private trigger: HTMLElement | undefined;
	actions: readonly ISessionMenuAction[] = [];
	constructor(contextViewService: IContextViewService) {
		super(contextViewService, { menuClass: 'openide-chat-kind-menu', insetLeft: 0, insetRight: 0, alignment: AnchorAlignment.RIGHT, stretchToAnchor: false, anchorTo: 'trigger' });
	}
	protected override initialFocus(): HTMLElement | undefined { return this.firstAction; }
	override toggle(header: HTMLElement, trigger: HTMLElement): void { this.trigger = trigger; super.toggle(header, trigger); }
	override close(): void {
		const open = this.isOpen; super.close();
		if (open && this.trigger?.isConnected) { this.trigger.focus({ preventScroll: true }); }
	}
	protected override renderContent(content: HTMLElement, store: DisposableStore): void {
		this.firstAction = undefined;
		for (const action of this.actions) {
			const { row } = menuRow(action.icon, action.label);
			row.setAttribute('aria-label', action.label);
			this.firstAction ??= row;
			store.add(addDisposableListener(row, 'click', event => {
				event.stopPropagation(); this.close();
				Promise.resolve().then(action.run).catch(onUnexpectedError);
			}));
			append(content, row);
		}
	}
}

const COMPACT_RECENT_LIMIT = 6;

/** Only avatar inputs are retained; a sidebar never needs the worker transcript. */
type SubagentAvatarTask = Pick<ISubagentRun, 'task' | 'profile' | 'readonly'>;

export class OpenideChatSessionsPane extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _listHost: HTMLElement;
	private readonly _scroll: DomScrollableElement;
	private readonly _rowsStore = this._register(new DisposableStore());
	private readonly _search: HTMLInputElement;
	private readonly _searchBox: InputBox;
	private _head!: HTMLElement;
	private readonly _filterMenu: FilterMenu;
	private readonly _sessionMenu: SessionActionsMenu;
	private _compact = false;
	private readonly _collapsedGroups = new Set<string>(['archived']);
	private readonly _expandedGroups = new Set<string>();
	private readonly _expandedParents = new Set<string>();
	private _renaming: { id: string; value: string } | undefined;
	private _filter: OpenideSessionsFilter = 'all';
	private _query = '';
	private _renderKey: string | undefined;
	private readonly _subagentTasks = new Map<string, SubagentAvatarTask | undefined>();
	private readonly _subagentIcons = new Map<string, { node: HTMLElement; kind: string }>();
	private _open = false;
	private _full = false;
	private _lastWidth = 0;

	private readonly _onDidOpenSession = this._register(new Emitter<string>());
	readonly onDidOpenSession: Event<string> = this._onDidOpenSession.event;
	private readonly _onDidOpenSubagent = this._register(new Emitter<string>());
	readonly onDidOpenSubagent = this._onDidOpenSubagent.event;

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
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextViewService contextViewService: IContextViewService,
		@IHoverService private readonly hoverService: IHoverService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ISubagentRunService private readonly subagentRuns: ISubagentRunService,
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
			inputBoxStyles: openideSearchBoxStyles,
		}));
		append(searchRow, $('span.codicon.codicon-search.openide-chat-sessions-search-icon'));
		this._search = this._searchBox.inputElement;
		const filterButton = menuRowAction('filter', t('sessions.filter'), { hoverService: this.hoverService, store: this._store });
		append(head, filterButton);

		this._listHost = $('.openide-chat-sessions-list');
		this._scroll = this._register(new DomScrollableElement(this._listHost, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		this._scroll.getDomNode().classList.add('openide-chat-sessions-scroll');
		append(this.domNode, this._scroll.getDomNode());

		this._sessionMenu = this._register(new SessionActionsMenu(contextViewService));
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
			if (event.key === 'Escape' && !event.isComposing) {
				event.preventDefault();
				this.setOpen(false);
			}
		}));
		this._register(onDidChangeOpenideLanguage(() => this._repaintChrome()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.render()));
		this._register(this.subagentRuns.onDidChangeRun(event => {
			if (event.type === 'timeline' || !this._subagentTasks.has(event.run.runId)) { return; }
			const previous = this._subagentTasks.get(event.run.runId);
			if (previous && previous.task === event.run.task && previous.profile === (event.run.profile ?? event.run.routingDecision?.profile) && previous.readonly === event.run.readonly) { return; }
			const task = this._avatarTask(event.run);
			this._subagentTasks.set(event.run.runId, task);
			const icon = this._subagentIcons.get(event.run.runId);
			const kind = subagentAvatarKind(task);
			if (icon && icon.kind !== kind) {
				const node = createSubagentAvatar(task);
				icon.node.replaceWith(node);
				this._subagentIcons.set(event.run.runId, { node, kind });
			}
		}));
	}

	/** Standalone agent windows use a central search picker; IDE panels retain their search row. */
	setCompact(compact: boolean): void {
		this._compact = compact;
		this.domNode.classList.toggle('compact', compact);
		this._head.hidden = compact;
		if (compact) {
			this._filterMenu.close();
			this._filter = 'all';
			this._query = '';
			this._searchBox.value = '';
			this.render();
		}
		this.render();
		this._scroll.scanDomNode();
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
		this._renderKey = undefined;
		this._searchBox.setPlaceHolder(t('sessions.search'));
		this._searchBox.setAriaLabel(t('sessions.search'));
		this.render();
	}

	/** Repaints the rows only; the search field keeps its focus and text. */
	render(): void {
		if (!this._open) {
			return;
		}
		const oldRows = Array.from(this._listHost.querySelectorAll<HTMLElement>('.openide-chat-sessions-row'));
		const focusedRow = oldRows.find(row => row.contains(this.domNode.ownerDocument.activeElement));
		const focusedId = focusedRow?.dataset.sessionId;
		const focusedIndex = focusedRow ? oldRows.indexOf(focusedRow) : -1;
		const query = this._query.trim().toLowerCase();
		const activeId = this.sessions.activeSessionId();
		const now = Date.now();
		const folders = this.workspaceContextService.getWorkspace().folders;
		const all = this.sessions.listAll();
		const visible = all
			.filter(session => !session.subagentRunId)
			.filter(session => !session.empty || session.pinned || session.id === activeId)
			.filter(session => this._compact || matchesOpenideSessionsFilter(session, this._filter))
			.filter(session => {
				const project = sessionProjectContext(session, folders);
				return !query || [session.title, project.label, project.path, getOpenideCli(session.cliId)?.name].some(value => value?.toLowerCase().includes(query));
			});
		// No-op notifications keep DOM targets (and open native previews) stable.
		const renderKey = JSON.stringify([all.filter(session => session.subagentRunId), this._compact, [...this._expandedGroups], this._renaming?.id, this._filter, query, activeId, Math.floor(now / 60_000), visible, folders.map(folder => [folder.name, folder.uri.toString()]), this.sessions.openTabs().map(session => session.id)]);
		if (renderKey === this._renderKey) { return; }
		this._renderKey = renderKey;
		this._sessionMenu.close();
		this._rowsStore.clear();
		this._subagentIcons.clear();
		const runIds = new Set(all.map(session => session.subagentRunId));
		for (const id of this._subagentTasks.keys()) { if (!runIds.has(id)) { this._subagentTasks.delete(id); } }
		clearNode(this._listHost);
		if (!visible.length) {
			const filtered = !!query || this._filter !== 'all';
			const commandId = this._compact ? AgentWindowAction.newChat : 'openide.agent.newChat';
			this._rowsStore.add(this.instantiationService.createInstance(OpenideEmptyState, this._listHost, {
				title: t('sessions.empty'), description: '', compact: true,
				actions: filtered ? [{
					label: t('openide.sessions.clearFilters'),
					run: () => { this._query = ''; this._filter = 'all'; this._searchBox.value = ''; this.render(); this._search.focus(); },
				}] : [{ label: t('chat.header.newTitle'), commandId, run: async () => { await this.commandService.executeCommand(commandId); } }],
			}));
			if (focusedRow) { this._search.focus(); }
			this._scroll.scanDomNode();
			return;
		}
		const projects = new Map<string, { project: IOpenideSessionProject; sessions: IChatSessionMeta[] }>();
		if (this._compact && visible.some(session => session.pinned && !session.archived)) {
			projects.set('pinned', { project: { id: 'pinned', label: t('sessions.group.pinned') }, sessions: visible.filter(session => session.pinned && !session.archived) });
		}
		for (const session of visible) {
			if (this._compact && (session.pinned || session.archived)) { continue; }
			const project = sessionProjectContext(session, folders);
			let group = projects.get(project.id);
			if (!group) { group = { project, sessions: [] }; projects.set(project.id, group); }
			group.sessions.push(session);
		}
		if (this._compact && visible.some(session => session.archived)) {
			projects.set('archived', { project: { id: 'archived', label: t('sessions.filter.archived') }, sessions: visible.filter(session => session.archived) });
		}
		for (const { project, sessions } of projects.values()) {
			const section = append(this._listHost, $(this._compact ? 'button.openide-chat-sessions-group.oi-btn.ghost.oi-dock-row' : '.openide-chat-sessions-group.oi-dock-section'));
			section.dataset.projectId = project.id;
			append(section, menuIcon(project.id === 'pinned' ? 'pin' : project.id === 'archived' ? 'archive' : 'folder'));
			append(section, $('span.openide-chat-sessions-group-title', undefined, project.label));
			append(section, $('span.openide-chat-sessions-group-count', undefined, String(sessions.length)));
			if (project.path) {
				const projectPath = project.path;
				this._rowsStore.add(this.hoverService.setupDelayedHover(section, () => {
					const preview = $('.openide-chat-session-preview');
					const heading = append(preview, $('.openide-chat-session-preview-heading'));
					append(heading, menuIcon('folder'));
					append(heading, $('.openide-chat-session-preview-title', undefined, project.label));
					const activity = append(preview, $('.openide-chat-session-preview-activity'));
					append(activity, menuIcon('comment'));
					const active = sessions.filter(session => session.status === 'in-progress').length;
					append(activity, $('span', undefined, t('openide.sessions.projectActivity', sessions.length, active)));
					const context = append(preview, $('.openide-chat-session-preview-context'));
					append(context, menuIcon('folder-opened'));
					append(context, $('span', undefined, projectPath));
					return { content: preview, position: { hoverPosition: HoverPosition.RIGHT }, appearance: OPENIDE_CHAT_HOVER_APPEARANCE, persistence: { hideOnHover: false } };
				}, { groupId: OPENIDE_CHAT_HOVER_GROUP }));
			}
			const populate = (content: HTMLElement) => {
				const limited = this._compact && project.id !== 'pinned' && !this._expandedGroups.has(project.id);
				const recent = limited ? sessions.filter((session, index) => index < COMPACT_RECENT_LIMIT || session.id === activeId || session.id === this._renaming?.id) : sessions;
				for (const session of recent) {
					const row = append(content, this._renderRow(session, session.id === activeId, now, sessionProjectContext(session, folders)));
					const children = all.filter(child => child.subagentRunId && child.parentSessionId === session.id);
					if (children.length) { this._renderSubagents(content, row, session, children); }
				}
				if (this._compact && project.id !== 'pinned' && sessions.length > COMPACT_RECENT_LIMIT) {
					const more = append(content, $<HTMLButtonElement>('button.oi-btn.ghost.openide-chat-sessions-more', { type: 'button', 'data-more-project-id': project.id }, t(limited ? 'sessions.showMore' : 'sessions.showLess')));
					this._rowsStore.add(addDisposableListener(more, 'click', () => {
						if (limited) { this._expandedGroups.add(project.id); } else { this._expandedGroups.delete(project.id); }
						this.render();
						Array.from(this._listHost.querySelectorAll<HTMLElement>('[data-more-project-id]')).find(element => element.dataset.moreProjectId === project.id)?.focus();
					}));
				}
			};
			if (this._compact) {
				section.setAttribute('type', 'button');
				append(section, menuIcon('chevron-right')).classList.add('openide-chat-sessions-chevron');
				this._disclosure(this._listHost, section, !this._collapsedGroups.has(project.id), populate, expanded => {
					if (expanded) { this._collapsedGroups.delete(project.id); } else { this._collapsedGroups.add(project.id); }
				});
			} else { populate(this._listHost); }

		}
		if (this._renaming) {
			this._listHost.querySelector<HTMLInputElement>('.openide-chat-sessions-rename input')?.focus({ preventScroll: true });
		} else if (focusedRow) {
			const rows = Array.from(this._listHost.querySelectorAll<HTMLElement>('.openide-chat-sessions-row'));
			const next = rows.find(row => row.dataset.sessionId === focusedId) ?? rows[Math.min(focusedIndex, rows.length - 1)];
			next?.querySelector<HTMLButtonElement>('.openide-chat-sessions-open')?.focus({ preventScroll: true });
		}
		this._scroll.scanDomNode();
	}

	/** Keep branch DOM and focus stable; only materialize children when first expanded. */
	private _disclosure(host: HTMLElement, toggle: HTMLElement, expanded: boolean, populate: (content: HTMLElement) => void, changed: (expanded: boolean) => void): void {
		const reveal = append(host, $('.openide-chat-sessions-reveal'));
		const clip = append(reveal, $('.openide-chat-sessions-clip'));
		const content = append(clip, $('.openide-chat-sessions-branch'));
		let populated = false;
		const update = () => {
			if (expanded && !populated) { populate(content); populated = true; }
			toggle.setAttribute('aria-expanded', String(expanded));
			content.inert = !expanded;
			reveal.classList.toggle('expanded', expanded);
		};
		update();
		const observer = new (getWindow(host).ResizeObserver)(() => this._scroll.scanDomNode());
		observer.observe(reveal);
		this._rowsStore.add(toDisposable(() => observer.disconnect()));
		this._rowsStore.add(addDisposableListener(toggle, 'click', () => {
			expanded = !expanded;
			changed(expanded);
			update();
		}));
	}

	private _avatarTask(run: ISubagentRun): SubagentAvatarTask {
		return { task: run.task, profile: run.profile ?? run.routingDecision?.profile, readonly: run.readonly };
	}

	private _subagentAvatar(child: IChatSessionMeta): HTMLElement {
		const runId = child.subagentRunId!;
		if (!this._subagentTasks.has(runId)) {
			const run = this.subagentRuns.get(runId);
			this._subagentTasks.set(runId, run ? this._avatarTask(run) : undefined);
		}
		const task = this._subagentTasks.get(runId) ?? { task: child.title };
		const node = createSubagentAvatar(task);
		this._subagentIcons.set(runId, { node, kind: subagentAvatarKind(task) });
		return node;
	}

	private _renderSubagents(host: HTMLElement, row: HTMLElement, parent: IChatSessionMeta, children: IChatSessionMeta[]): void {
		const group = append(host, $('.openide-chat-sessions-children'));
		group.dataset.parentSessionId = parent.id;
		const expanded = this._expandedParents.has(parent.id);
		const toggle = append(group, $<HTMLButtonElement>('button.oi-btn.ghost.openide-chat-sessions-children-toggle', { type: 'button', 'aria-expanded': String(expanded) }));
		append(toggle, menuIcon('chevron-right')).classList.add('openide-chat-sessions-chevron');
		append(toggle, $('span', undefined, `${t('agentWindow.subagents')} · ${children.length}`));
		row.classList.add('has-subagents');
		this._disclosure(group, toggle, expanded, content => {
			for (const child of children) {
				const button = append(content, $<HTMLButtonElement>('button.oi-btn.ghost.openide-chat-sessions-child', { type: 'button', 'data-subagent-session-id': child.id }));
				append(button, this._subagentAvatar(child));
				const title = append(button, $('span.openide-chat-sessions-child-title', undefined, child.title));
				const status = createChatSessionStatusIcon(button.ownerDocument, child.status);
				if (status) { append(button, status); }
				this._rowsStore.add(setupChatTooltip(this.hoverService, button, () => child.title, { position: HoverPosition.RIGHT }));
				this._rowsStore.add(setupOverflowFade(title));
				this._rowsStore.add(addDisposableListener(button, 'click', () => {
					this._onDidOpenSession.fire(parent.id);
					this._onDidOpenSubagent.fire(child.id);
				}));
			}
		}, expanded => {
			if (expanded) { this._expandedParents.add(parent.id); } else { this._expandedParents.delete(parent.id); }
		});
	}

	private _renderRow(session: IChatSessionMeta, active: boolean, now: number, project: IOpenideSessionProject): HTMLElement {
		const row = $('.openide-chat-sessions-row');
		row.classList.toggle('active', active);
		row.classList.toggle('unread', !!session.unread);
		row.classList.toggle('has-status', !!session.status && session.status !== 'completed');
		row.dataset.sessionId = session.id;
		if (this._renaming?.id === session.id) { return this._renderRename(row, session); }
		const primary = append(row, $<HTMLButtonElement>('button.openide-chat-sessions-open.oi-dock-row', { type: 'button' }));
		primary.classList.toggle('selected', active);
		if (active) { primary.setAttribute('aria-current', 'true'); }

		const statusIcon = createChatSessionStatusIcon(primary.ownerDocument, session.status);
		if (statusIcon && !this._compact) { append(primary, statusIcon); }
		if (session.kind === 'cli' || session.forked) {
			const kind = append(primary, $('span.openide-chat-sessions-kind', { 'aria-hidden': 'true' }));
			append(kind, menuIcon(session.kind === 'cli' ? 'terminal' : 'repo-forked'));
		}

		const title = session.title || t('chat.header.newTitle');
		const body = append(primary, $('span.openide-chat-sessions-body'));
		append(body, $('span.openide-chat-sessions-row-title', undefined, title));
		if (statusIcon && this._compact) { append(primary, statusIcon); }
		row.classList.toggle('running', session.status === 'in-progress');
		append(primary, $('time.openide-chat-sessions-row-time', { 'aria-hidden': 'true', datetime: new Date(session.updatedAt).toISOString() }, relativeTimeLabel(session.updatedAt, now)));
		const cli = getOpenideCli(session.cliId);
		const status = session.status ? t(statusKey(session.status)) : '';
		primary.setAttribute('aria-label', [title, project.label, cli?.name, status, relativeTimeLabel(session.updatedAt, now)].filter(Boolean).join(' · '));
		// One stable target owns the preview. Child title/status tooltips would compete as the
		// pointer crosses them, and rebuilding it on mousemove would make it flicker.
		this._rowsStore.add(this.hoverService.setupDelayedHover(primary, () => {
			const preview = $('.openide-chat-session-preview');
			const heading = append(preview, $('.openide-chat-session-preview-heading'));
			append(heading, $('.openide-chat-session-preview-title', undefined, title));
			const meta = append(heading, $('.openide-chat-session-preview-meta'));
			append(meta, menuIcon(session.kind === 'cli' ? 'terminal' : 'device-desktop'));
			append(meta, $('span', undefined, relativeTimeLabel(session.updatedAt, Date.now())));
			const context = append(preview, $('.openide-chat-session-preview-context'));
			append(context, menuIcon('folder'));
			append(context, $('span', undefined, project.label));
			const activity = append(preview, $('.openide-chat-session-preview-activity'));
			const activityIcon = createChatSessionStatusIcon(primary.ownerDocument, session.status);
			if (activityIcon) { append(activity, activityIcon); }
			append(activity, $('span', undefined, [cli?.name, status].filter(Boolean).join(' · ')));
			activity.hidden = !activity.textContent;
			return { id: `openide-session-preview-${session.id}`, content: preview, position: { hoverPosition: HoverPosition.RIGHT }, appearance: OPENIDE_CHAT_HOVER_APPEARANCE, persistence: { hideOnHover: false } };
		}, { groupId: OPENIDE_CHAT_HOVER_GROUP }));

		if (this._compact && session.unread && session.status !== 'in-progress') {
			append(primary, $('span.openide-chat-sessions-unread', { 'aria-hidden': 'true' }));
		}
		const actions = append(row, $('span.openide-chat-sessions-row-actions'));
		if (this._compact) {
			const more = append(actions, menuRowAction('ellipsis', t('chat.header.more'), { hoverService: this.hoverService, store: this._rowsStore }));
			this._rowsStore.add(addDisposableListener(more, 'click', event => {
				event.stopPropagation();
				this._sessionMenu.actions = this._sessionActions(session);
				this._sessionMenu.toggle(row, more);
			}));
			row.style.setProperty('--oi-session-actions-width', '34px');
			this._rowsStore.add(addDisposableListener(primary, 'click', () => this._onDidOpenSession.fire(session.id)));
			return row;
		}
		if (session.unread) {
			const read = append(actions, menuRowAction('eye', t('sessions.action.markRead'), { hoverService: this.hoverService, store: this._rowsStore }));
			this._rowsStore.add(addDisposableListener(read, 'click', event => { event.stopPropagation(); this.sessions.markRead(session.id); this.render(); this._onDidMutate.fire(); }));
		}
		const archive = append(actions, menuRowAction(session.archived ? 'unarchive' : 'archive', t(session.archived ? 'sessions.action.unarchive' : 'sessions.action.archive'), { hoverService: this.hoverService, store: this._rowsStore }));
		this._rowsStore.add(addDisposableListener(archive, 'click', event => {
			event.stopPropagation();
			if (session.archived) { this.sessions.unarchive(session.id); } else { this.sessions.archive(session.id); }
			this.render();
			this._onDidMutate.fire();
		}));
		if (session.kind === 'cli' && this.sessions.openTabs().some(open => open.id === session.id)) {
			const close = append(actions, menuRowAction('close', t('sessions.action.closeSession'), { hoverService: this.hoverService, store: this._rowsStore }));
			this._rowsStore.add(addDisposableListener(close, 'click', event => { event.stopPropagation(); this._onDidRequestCloseSession.fire(session.id); }));
		}
		const remove = append(actions, menuRowAction('trash', t('sessions.action.delete'), { hoverService: this.hoverService, store: this._rowsStore }));
		this._rowsStore.add(addDisposableListener(remove, 'click', async event => {
			event.stopPropagation();
			if (await this.confirmDelete(session.id)) {
				this.render();
				this._onDidMutate.fire();
			}
		}));

		row.style.setProperty('--oi-session-actions-width', `${actions.childElementCount * 26 + 8}px`);

		this._rowsStore.add(addDisposableListener(primary, 'click', () => this._onDidOpenSession.fire(session.id)));
		return row;
	}
	private _sessionActions(session: IChatSessionMeta): ISessionMenuAction[] {
		const mutate = (run: () => void) => () => { run(); this.render(); this._onDidMutate.fire(); };
		const actions: ISessionMenuAction[] = [
			{ icon: session.pinned ? 'pinned' : 'pin', label: t(session.pinned ? 'sessions.action.unpin' : 'sessions.action.pin'), run: mutate(() => this.sessions.setPinned(session.id, !session.pinned)) },
			{ icon: 'edit', label: t('sessions.action.rename'), run: () => { this._renaming = { id: session.id, value: session.title }; this.render(); this._listHost.querySelector<HTMLInputElement>('.openide-chat-sessions-rename input')?.select(); } },
		];
		if (session.unread) { actions.push({ icon: 'eye', label: t('sessions.action.markRead'), run: mutate(() => this.sessions.markRead(session.id)) }); }
		actions.push({ icon: session.archived ? 'unarchive' : 'archive', label: t(session.archived ? 'sessions.action.unarchive' : 'sessions.action.archive'), run: mutate(() => session.archived ? this.sessions.unarchive(session.id) : this.sessions.archive(session.id)) });
		if (session.kind === 'cli' && this.sessions.openTabs().some(open => open.id === session.id)) {
			actions.push({ icon: 'close', label: t('sessions.action.closeSession'), run: () => this._onDidRequestCloseSession.fire(session.id) });
		}
		actions.push({ icon: 'trash', label: t('sessions.action.delete'), run: async () => { if (await this.confirmDelete(session.id)) { this.render(); this._onDidMutate.fire(); } } });
		return actions;
	}

	private _renderRename(row: HTMLElement, session: IChatSessionMeta): HTMLElement {
		row.classList.add('openide-chat-sessions-rename');
		const input = this._rowsStore.add(new InputBox(row, undefined, { ariaLabel: t('sessions.action.rename'), inputBoxStyles: openideSearchBoxStyles }));
		input.value = this._renaming!.value;
		this._rowsStore.add(input.onDidChange(value => { if (this._renaming?.id === session.id) { this._renaming.value = value; } }));
		let finished = false;
		const finish = (save: boolean) => {
			if (finished) { return; } finished = true;
			this._renaming = undefined;
			if (save && input.value.trim()) { this.sessions.rename(session.id, input.value.trim()); this._onDidMutate.fire(); }
			this.render();
		};
		this._rowsStore.add(addDisposableListener(input.inputElement, 'keydown', event => {
			if (event.isComposing) { return; }
			if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); }
		}));
		this._rowsStore.add(addDisposableListener(input.inputElement, 'blur', () => finish(true)));
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
