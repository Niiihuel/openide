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
import { List } from '../../../../../base/browser/ui/list/listWidget.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { defaultListStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { getOpenideCli } from '../../common/openideAgentCliCatalog.js';
import { createProviderIcon } from '../openideProviderIcons.js';
import { InputBox } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { openideSearchBoxStyles } from '../openideControlStyles.js';
import { onDidChangeOpenideLanguage, OpenideStringKey, t } from '../../common/openideStrings.js';
import { IChatSessionMeta, OpenideChatSessions } from '../openideChatSessions.js';
import { OPENIDE_CHAT_HOVER_APPEARANCE, OPENIDE_CHAT_HOVER_GROUP, setupChatTooltip } from './openideChatHover.js';
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
import './media/openideChatSessions.css';
import { menuIcon, menuRow, menuRowAction, OpenideChatMenuPopover } from './openideChatMenuDom.js';

/** Conversation navigation for the IDE dock and the standalone agent workspace. */

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

/** Only avatar inputs are retained; navigation never loads worker transcripts. */
type SubagentAvatarTask = Pick<ISubagentRun, 'task' | 'profile' | 'readonly'>;

type NavigationEntry =
	| { id: string; kind: 'group'; project: IOpenideSessionProject; count: number; running: number; expanded: boolean }
	| { id: string; kind: 'session'; session: IChatSessionMeta; project: IOpenideSessionProject; active: boolean; open: boolean }
	| { id: string; kind: 'children'; parentId: string; count: number; expanded: boolean }
	| { id: string; kind: 'child'; session: IChatSessionMeta; parentId: string };

interface NavigationTemplate {
	readonly container: HTMLElement;
	readonly store: DisposableStore;
	entry?: NavigationEntry;
	update?: () => void;
}

/** A native virtual list; stream updates patch only the visible rows, preserving their controls. */
export class OpenideChatSessionsPane extends Disposable {
	readonly domNode: HTMLElement;
	private readonly _listHost: HTMLElement;
	private readonly _list: List<NavigationEntry>;
	private readonly _emptyHost: HTMLElement;
	private readonly _emptyStore = this._register(new DisposableStore());
	private readonly _search: HTMLInputElement;
	private readonly _searchBox: InputBox;
	private readonly _head: HTMLElement;
	private readonly _filterMenu: FilterMenu;
	private readonly _sessionMenu: SessionActionsMenu;
	private readonly _templates = new Map<string, NavigationTemplate>();
	private _entries: NavigationEntry[] = [];
	private _compact = false;
	private readonly _collapsedGroups = new Set<string>(['archived']);
	private readonly _expandedParents = new Set<string>();
	private _renaming: { id: string; value: string } | undefined;
	private _menuSessionId: string | undefined;
	private _filter: OpenideSessionsFilter = 'all';
	private _query = '';
	private readonly _subagentTasks = new Map<string, SubagentAvatarTask | undefined>();
	private _open = false;
	private _full = false;
	private _lastWidth = 0;
	private _emptyKey: string | undefined;
	private _languageVersion = 0;

	private readonly _onDidOpenSession = this._register(new Emitter<string>());
	readonly onDidOpenSession: Event<string> = this._onDidOpenSession.event;
	private readonly _onDidOpenSubagent = this._register(new Emitter<string>());
	readonly onDidOpenSubagent: Event<string> = this._onDidOpenSubagent.event;
	private readonly _onDidChangeOpen = this._register(new Emitter<boolean>());
	readonly onDidChangeOpen: Event<boolean> = this._onDidChangeOpen.event;
	private readonly _onDidRequestCloseSession = this._register(new Emitter<string>());
	/** Explicitly release the hosted PTY and close its tab while retaining the record. */
	readonly onDidRequestCloseSession: Event<string> = this._onDidRequestCloseSession.event;
	private readonly _onDidMutate = this._register(new Emitter<void>());
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
		this._head = append(this.domNode, $('.openide-chat-sessions-head'));
		const searchRow = append(this._head, $('.openide-chat-sessions-search'));
		this._searchBox = this._register(new InputBox(searchRow, undefined, {
			placeholder: t('sessions.search'), ariaLabel: t('sessions.search'), inputBoxStyles: openideSearchBoxStyles,
		}));
		append(searchRow, $('span.codicon.codicon-search.openide-chat-sessions-search-icon'));
		this._search = this._searchBox.inputElement;
		const filterButton = append(this._head, menuRowAction('filter', t('sessions.filter'), { hoverService: this.hoverService, store: this._store }));
		this._sessionMenu = this._register(new SessionActionsMenu(contextViewService));
		this._filterMenu = this._register(new FilterMenu(contextViewService, () => this._filter, filter => { this._filter = filter; this.render(); }));
		this._register(addDisposableListener(filterButton, 'click', event => { event.stopPropagation(); this._filterMenu.toggle(this._head, filterButton); }));
		this._register(addDisposableListener(this._search, 'input', () => { this._query = this._search.value; this.render(); }));

		this._listHost = append(this.domNode, $('.openide-chat-sessions-list.openide-chat-sessions-scroll'));
		this._emptyHost = append(this.domNode, $('.openide-chat-sessions-empty'));
		this._list = this._register(new List<NavigationEntry>('OpenideChatSessions', this._listHost, {
			getHeight: entry => entry.kind === 'session' ? this._compact ? 40 : 52 : 32,
			getTemplateId: () => 'navigation',
		}, [{
			templateId: 'navigation',
			renderTemplate: container => ({ container, store: new DisposableStore() }),
			renderElement: (entry, _index, template: NavigationTemplate) => this._bindTemplate(entry, template),
			disposeElement: (entry, _index, template) => {
				if (entry.kind === 'session' && entry.session.id === this._menuSessionId) { this._sessionMenu.close(); this._menuSessionId = undefined; }
				if (this._templates.get(entry.id) === template) { this._templates.delete(entry.id); }
				// A recycled template must never retain a hover, input listener or session closure.
				template.store.clear(); template.entry = undefined; template.update = undefined; clearNode(template.container);
			},
			disposeTemplate: template => template.store.dispose(),
		}], {
			horizontalScrolling: false, keyboardSupport: false, mouseSupport: false, multipleSelectionSupport: false,
			identityProvider: { getId: entry => entry.id },
			accessibilityProvider: {
				getWidgetAriaLabel: () => t('sessions.navigation.list'), getWidgetRole: () => 'list', getRole: () => 'listitem',
				getAriaLabel: entry => entry.kind === 'group' ? entry.project.label : entry.kind === 'children' ? t('agentWindow.subagents') : entry.session.title,
			},
		}));
		this._list.style({ ...defaultListStyles, listBackground: 'transparent', listHoverBackground: undefined, listHoverForeground: undefined, listInactiveFocusBackground: undefined });
		this._register(addDisposableListener(this.domNode, 'keydown', event => this._onKeyDown(event)));
		const observer = new (getWindow(parent).ResizeObserver)(() => this._layoutList());
		observer.observe(this.domNode);
		this._register(toDisposable(() => observer.disconnect()));
		this._register(onDidChangeOpenideLanguage(() => {
			this._languageVersion++;
			this._emptyKey = undefined;
			this._searchBox.setPlaceHolder(t('sessions.search')); this._searchBox.setAriaLabel(t('sessions.search'));
			this.render();
		}));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.render()));
		this._register(this.subagentRuns.onDidChangeRun(event => {
			if (event.type === 'timeline' || !this._subagentTasks.has(event.run.runId)) { return; }
			const task = this._avatarTask(event.run);
			const previous = this._subagentTasks.get(event.run.runId);
			if (previous?.task === task.task && previous?.profile === task.profile && previous?.readonly === task.readonly) { return; }
			this._subagentTasks.set(event.run.runId, task);
			for (const template of this._templates.values()) {
				if (template.entry?.kind === 'child' && template.entry.session.subagentRunId === event.run.runId) { template.update?.(); }
			}
		}));
	}

	/** Standalone windows use their central search; the IDE panel keeps search and filters. */
	setCompact(compact: boolean): void {
		if (this._compact === compact) { return; }
		this._compact = compact;
		this.domNode.classList.toggle('compact', compact); this._head.hidden = compact;
		if (compact) { this._filterMenu.close(); this._filter = 'all'; this._query = ''; this._searchBox.value = ''; }
		// Action sets differ between compact and IDE mode; templates are rebuilt only for this explicit switch.
		this._list.splice(0, this._entries.length); this._entries = [];
		this.render(); this._layoutList();
	}
	get isOpen(): boolean { return this._open; }
	get mode(): OpenideSessionsPaneMode { return this._full ? 'full' : this._lastWidth >= SIDE_BY_SIDE_MIN_WIDTH ? 'side' : 'stacked'; }
	setFull(full: boolean): void { if (this._full === full) { return; } this._full = full; this._applyMode(); if (full) { this.setOpen(true); } }
	private _applyMode(): void {
		for (const mode of ['full', 'side', 'stacked']) { this.domNode.classList.toggle(mode, this.mode === mode); }
	}
	setOpen(open: boolean): void {
		if (this._open === open || (!open && this._full)) { return; }
		this._open = open; this.domNode.classList.toggle('hidden', !open);
		if (open) { this.render(); this._layoutList(); } else { this._filterMenu.close(); this._sessionMenu.close(); }
		this._onDidChangeOpen.fire(open);
	}
	toggle(): void { this.setOpen(!this._open); }
	layout(width: number, headerHeight: number, bottom = 0): void {
		this._lastWidth = width; this._applyMode();
		this.domNode.style.top = `${headerHeight}px`; this.domNode.style.bottom = this._full ? `${bottom}px` : '0';
		this._layoutList();
	}
	private _layoutList(): void {
		if (!this._open) { return; }
		this._list.layout(this._listHost.clientHeight, this._listHost.clientWidth);
	}

	/** Build lightweight metadata entries, retaining their identity; transcripts stay in storage. */
	render(): void {
		if (!this._open) { return; }
		const activeId = this.sessions.activeSessionId();
		const openOrder = new Map(this.sessions.openTabs().map((session, index) => [session.id, index]));
		const openIds = new Set(openOrder.keys());
		const folders = this.workspaceContextService.getWorkspace().folders;
		const query = this._query.trim().toLowerCase();
		const all = this.sessions.listAll();
		const children = new Map<string, IChatSessionMeta[]>();
		const runIds = new Set<string>();
		for (const session of all) {
			if (!session.subagentRunId || !session.parentSessionId) { continue; }
			runIds.add(session.subagentRunId);
			const siblings = children.get(session.parentSessionId) ?? [];
			siblings.push(session); children.set(session.parentSessionId, siblings);
		}
		for (const id of this._subagentTasks.keys()) { if (!runIds.has(id)) { this._subagentTasks.delete(id); } }
		const visible = all.filter(session => !session.subagentRunId && (!session.empty || session.pinned || session.id === activeId || openIds.has(session.id)))
			.filter(session => this._compact || matchesOpenideSessionsFilter(session, this._filter))
			.filter(session => {
				const project = sessionProjectContext(session, folders);
				return !query || [session.title, project.label, project.path, getOpenideCli(session.cliId)?.name].some(value => value?.toLowerCase().includes(query));
			});
		const groups = new Map<string, { project: IOpenideSessionProject; sessions: IChatSessionMeta[] }>();
		const addGroup = (id: string, label: string, sessions: IChatSessionMeta[], path?: string) => {
			if (sessions.length) { groups.set(id, { project: { id, label, path }, sessions }); }
		};
		if (this._compact) {
			addGroup('pinned', t('sessions.group.pinned'), visible.filter(session => session.pinned && !session.archived));
			// Open is tab membership, never a synonym for running. A completed tab stays here.
			addGroup('opened', t('sessions.navigation.opened'), visible.filter(session => !session.pinned && !session.archived && openIds.has(session.id)).sort((a, b) => openOrder.get(a.id)! - openOrder.get(b.id)!));
		}
		for (const session of visible) {
			if (this._compact && (session.pinned || session.archived || openIds.has(session.id))) { continue; }
			const project = sessionProjectContext(session, folders);
			let group = groups.get(project.id);
			if (!group) {
				group = { project: this._compact ? { ...project, label: project.id === 'no-project' ? t('sessions.navigation.history') : t('sessions.navigation.historyProject', project.label) } : project, sessions: [] };
				groups.set(project.id, group);
			}
			group.sessions.push(session);
		}
		if (this._compact) { addGroup('archived', t('sessions.filter.archived'), visible.filter(session => session.archived)); }
		const next: NavigationEntry[] = [];
		for (const { project, sessions } of groups.values()) {
			const expanded = !this._collapsedGroups.has(project.id) || !!query;
			next.push({ id: `group:${project.id}`, kind: 'group', project, count: sessions.length, running: sessions.filter(session => session.status === 'in-progress').length, expanded });
			if (!expanded) { continue; }
			for (const session of sessions) {
				next.push({ id: `session:${session.id}`, kind: 'session', session, project: sessionProjectContext(session, folders), active: session.id === activeId, open: openIds.has(session.id) });
				const workers = children.get(session.id);
				if (!workers?.length) { continue; }
				const expanded = this._expandedParents.has(session.id);
				next.push({ id: `children:${session.id}`, kind: 'children', parentId: session.id, count: workers.length, expanded });
				if (expanded) {
					for (const worker of workers) { next.push({ id: `child:${worker.id}`, kind: 'child', session: worker, parentId: session.id }); }
				}
			}
		}
		this._reconcile(next);
		this._listHost.hidden = !visible.length; this._emptyHost.hidden = !!visible.length;
		if (!visible.length) { this._showEmpty(); } else { this._emptyStore.clear(); clearNode(this._emptyHost); this._emptyKey = undefined; }
		if (this._menuSessionId && !next.some(entry => entry.kind === 'session' && entry.session.id === this._menuSessionId)) { this._sessionMenu.close(); this._menuSessionId = undefined; }
		this._layoutList();
	}

	private _reconcile(next: NavigationEntry[]): void {
		const activeElement = this.domNode.ownerDocument.activeElement;
		const focused = activeElement instanceof getWindow(this.domNode).HTMLElement ? activeElement.closest<HTMLElement>('[data-navigation-id]')?.dataset.navigationId : undefined;
		const previousIndex = focused ? this._entries.findIndex(entry => entry.id === focused) : -1;
		const oldById = new Map(this._entries.map(entry => [entry.id, entry]));
		for (let index = 0; index < next.length; index++) {
			const previous = oldById.get(next[index].id);
			if (previous) { Object.assign(previous, next[index]); next[index] = previous; }
		}
		let start = 0;
		while (start < next.length && start < this._entries.length && next[start].id === this._entries[start].id) { start++; }
		let oldEnd = this._entries.length; let newEnd = next.length;
		while (oldEnd > start && newEnd > start && this._entries[oldEnd - 1].id === next[newEnd - 1].id) { oldEnd--; newEnd--; }
		const scrollTop = this._list.scrollTop;
		if (oldEnd !== start || newEnd !== start) { this._list.splice(start, oldEnd - start, next.slice(start, newEnd)); }
		this._entries = next;
		// Status/title changes do not splice, replace targets or close menus. Only mounted rows are patched.
		for (const template of this._templates.values()) { template.update?.(); }
		this._list.scrollTop = scrollTop;
		if (focused && activeElement && !activeElement.isConnected) {
			const index = next.findIndex(entry => entry.id === focused);
			this._focusEntry(index < 0 ? Math.min(previousIndex, next.length - 1) : index);
		}
	}

	private _showEmpty(): void {
		const filtered = !!this._query || this._filter !== 'all';
		const key = `${filtered}:${this._compact}:${this._languageVersion}`;
		if (key === this._emptyKey) { return; }
		this._emptyKey = key; this._emptyStore.clear(); clearNode(this._emptyHost);
		const commandId = this._compact ? AgentWindowAction.newChat : 'openide.agent.newChat';
		this._emptyStore.add(this.instantiationService.createInstance(OpenideEmptyState, this._emptyHost, {
			title: t('sessions.empty'), description: '', compact: true,
			actions: filtered ? [{ label: t('openide.sessions.clearFilters'), run: () => { this._query = ''; this._filter = 'all'; this._searchBox.value = ''; this.render(); this._search.focus(); } }]
				: [{ label: t('chat.header.newTitle'), commandId, run: async () => { await this.commandService.executeCommand(commandId); } }],
		}));
	}

	private _bindTemplate(entry: NavigationEntry, template: NavigationTemplate): void {
		if (template.entry?.id !== entry.id) {
			if (template.entry) { this._templates.delete(template.entry.id); }
			template.store.clear(); clearNode(template.container);
			template.entry = entry;
			template.container.dataset.navigationId = entry.id;
			this._templates.set(entry.id, template);
			switch (entry.kind) {
				case 'group': this._renderGroup(entry, template); break;
				case 'session': this._renderRow(entry, template); break;
				case 'children': this._renderChildren(entry, template); break;
				case 'child': this._renderChild(entry, template); break;
			}
		}
		template.update?.();
	}

	private _renderGroup(entry: Extract<NavigationEntry, { kind: 'group' }>, template: NavigationTemplate): void {
		const button = append(template.container, $<HTMLButtonElement>('button.openide-chat-sessions-group.oi-btn.ghost.oi-dock-row', { type: 'button', 'data-project-id': entry.project.id }));
		append(button, menuIcon(entry.project.id === 'pinned' ? 'pin' : entry.project.id === 'opened' ? 'comment-discussion' : entry.project.id === 'archived' ? 'archive' : 'history'));
		const title = append(button, $('span.openide-chat-sessions-group-title'));
		const count = append(button, $('span.openide-chat-sessions-group-count'));
		append(button, menuIcon('chevron-right')).classList.add('openide-chat-sessions-chevron');
		template.update = () => { setText(title, entry.project.label); setText(count, String(entry.count)); button.setAttribute('aria-expanded', String(entry.expanded)); };
		template.store.add(addDisposableListener(button, 'click', () => {
			if (entry.expanded) { this._collapsedGroups.add(entry.project.id); } else { this._collapsedGroups.delete(entry.project.id); }
			this.render();
		}));
		template.store.add(this.hoverService.setupDelayedHover(button, () => {
			const preview = $('.openide-chat-session-preview');
			const heading = append(preview, $('.openide-chat-session-preview-heading'));
			append(heading, menuIcon('folder'));
			append(heading, $('.openide-chat-session-preview-title', undefined, entry.project.label));
			append(preview, $('.openide-chat-session-preview-activity', undefined, t('openide.sessions.projectActivity', entry.count, entry.running)));
			if (entry.project.path) {
				const context = append(preview, $('.openide-chat-session-preview-context'));
				append(context, menuIcon('folder-opened')); append(context, $('span', undefined, entry.project.path));
			}
			return { content: preview, position: { hoverPosition: HoverPosition.RIGHT }, appearance: OPENIDE_CHAT_HOVER_APPEARANCE, persistence: { hideOnHover: false } };
		}, { groupId: OPENIDE_CHAT_HOVER_GROUP }));
	}

	private _renderChildren(entry: Extract<NavigationEntry, { kind: 'children' }>, template: NavigationTemplate): void {
		const group = append(template.container, $('.openide-chat-sessions-children', { 'data-parent-session-id': entry.parentId }));
		const button = append(group, $<HTMLButtonElement>('button.oi-btn.ghost.openide-chat-sessions-children-toggle', { type: 'button' }));
		append(button, menuIcon('chevron-right')).classList.add('openide-chat-sessions-chevron');
		const title = append(button, $('span'));
		template.update = () => { setText(title, `${t('agentWindow.subagents')} · ${entry.count}`); button.setAttribute('aria-expanded', String(entry.expanded)); };
		template.store.add(addDisposableListener(button, 'click', () => {
			if (entry.expanded) { this._expandedParents.delete(entry.parentId); } else { this._expandedParents.add(entry.parentId); }
			this.render();
		}));
	}

	private _avatarTask(run: ISubagentRun): SubagentAvatarTask { return { task: run.task, profile: run.profile ?? run.routingDecision?.profile, readonly: run.readonly }; }
	private _renderChild(entry: Extract<NavigationEntry, { kind: 'child' }>, template: NavigationTemplate): void {
		const button = append(template.container, $<HTMLButtonElement>('button.oi-btn.ghost.openide-chat-sessions-child', { type: 'button', 'data-subagent-session-id': entry.session.id }));
		let avatar: HTMLElement | undefined;
		let avatarKind: string | undefined;
		let previousStatus: IChatSessionMeta['status'];
		const title = append(button, $('span.openide-chat-sessions-child-title'));
		const activity = append(button, $('span.openide-chat-sessions-activity'));
		template.update = () => {
			const runId = entry.session.subagentRunId!;
			if (!this._subagentTasks.has(runId)) {
				const run = this.subagentRuns.get(runId); this._subagentTasks.set(runId, run ? this._avatarTask(run) : undefined);
			}
			const task = this._subagentTasks.get(runId) ?? { task: entry.session.title };
			const kind = subagentAvatarKind(task);
			if (!avatar || avatarKind !== kind) { avatar?.remove(); avatar = createSubagentAvatar(task); button.prepend(avatar); avatarKind = kind; }
			setText(title, entry.session.title);
			if (previousStatus !== entry.session.status) {
				clearNode(activity); const icon = createChatSessionStatusIcon(button.ownerDocument, entry.session.status); if (icon) { append(activity, icon); }
				previousStatus = entry.session.status;
			}
		};
		template.store.add(setupChatTooltip(this.hoverService, button, () => entry.session.title, { position: HoverPosition.RIGHT }));
		template.store.add(addDisposableListener(button, 'click', () => { this._onDidOpenSession.fire(entry.parentId); this._onDidOpenSubagent.fire(entry.session.id); }));
	}

	private _renderRow(entry: Extract<NavigationEntry, { kind: 'session' }>, template: NavigationTemplate): void {
		const row = append(template.container, $('.openide-chat-sessions-row', { 'data-session-id': entry.session.id }));
		const primary = append(row, $<HTMLButtonElement>('button.openide-chat-sessions-open.oi-dock-row', { type: 'button' }));
		const kind = append(primary, $('span.openide-chat-sessions-kind', { 'aria-hidden': 'true' }));
		const body = append(primary, $('span.openide-chat-sessions-body'));
		const title = append(body, $('span.openide-chat-sessions-row-title'));
		const subtitle = append(body, $('span.openide-chat-sessions-row-context', { 'aria-hidden': 'true' }));
		const activity = append(primary, $('span.openide-chat-sessions-activity', { 'aria-hidden': 'true' }));
		const time = append(primary, $('time.openide-chat-sessions-row-time', { 'aria-hidden': 'true' }));
		const actions = append(row, $('span.openide-chat-sessions-row-actions'));
		const actionsStore = template.store.add(new DisposableStore());
		const renameStore = template.store.add(new DisposableStore());
		let renameInput: InputBox | undefined;
		let actionsKey: string | undefined;
		let iconKey: string | undefined;
		let status: IChatSessionMeta['status'];
		let unread = false;
		const update = () => {
			const session = entry.session;
			const renaming = this._renaming?.id === session.id;
			row.classList.toggle('openide-chat-sessions-rename', renaming);
			primary.hidden = renaming; actions.hidden = renaming;
			if (renaming && !renameInput) {
				renameInput = renameStore.add(new InputBox(row, undefined, { ariaLabel: t('sessions.action.rename'), inputBoxStyles: openideSearchBoxStyles }));
				renameInput.value = this._renaming!.value;
				const input = renameInput;
				renameStore.add(input.onDidChange(value => { if (this._renaming?.id === session.id) { this._renaming.value = value; } }));
				const finish = (save: boolean) => {
					if (this._renaming?.id !== session.id) { return; }
					this._renaming = undefined;
					if (save && input.value.trim()) { this.sessions.rename(session.id, input.value.trim()); this._onDidMutate.fire(); }
					this.render(); primary.focus({ preventScroll: true });
				};
				renameStore.add(addDisposableListener(input.inputElement, 'keydown', event => {
					if (!event.isComposing && (event.key === 'Enter' || event.key === 'Escape')) { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); }
				}));
				renameStore.add(addDisposableListener(input.inputElement, 'blur', () => finish(true)));
				input.focus(); input.select();
			} else if (!renaming && renameInput) { renameStore.clear(); renameInput.element.remove(); renameInput = undefined; }
			row.classList.toggle('active', entry.active); row.classList.toggle('unread', !!session.unread); row.classList.toggle('running', session.status === 'in-progress');
			row.classList.toggle('has-status', session.status === 'in-progress' || session.status === 'needs-input' || session.status === 'failed');
			primary.classList.toggle('selected', entry.active); primary.setAttribute('aria-current', String(entry.active));
			const cli = getOpenideCli(session.cliId);
			const nextIcon = session.kind === 'cli' ? `cli:${cli?.icon ?? 'terminal'}` : 'openide';
			if (iconKey !== nextIcon) {
				clearNode(kind);
				append(kind, session.kind === 'cli' && cli
					? createProviderIcon(primary.ownerDocument, cli.icon, cli.name, 'openide-chat-sessions-provider-icon')
					: session.kind === 'cli' ? menuIcon('terminal') : $('span.openide-chat-sessions-native-icon'));
				iconKey = nextIcon;
			}
			setText(title, session.title || t('chat.header.newTitle'));
			const activityLabel = session.status ? t(statusKey(session.status)) : '';
			setText(subtitle, [entry.project.label, cli?.name, session.status === 'needs-input' || session.status === 'failed' || session.status === 'unknown' ? activityLabel : undefined].filter(Boolean).join(' · '));
			if (status !== session.status || unread !== !!session.unread) {
				clearNode(activity); const icon = createChatSessionStatusIcon(primary.ownerDocument, session.status);
				if (icon) { append(activity, icon); } else if (session.unread) { append(activity, $('span.openide-chat-sessions-unread')); }
				status = session.status; unread = !!session.unread;
			}
			setText(time, relativeTimeLabel(session.updatedAt, Date.now())); time.setAttribute('datetime', new Date(session.updatedAt).toISOString());
			primary.setAttribute('aria-label', [title.textContent, entry.project.label, cli?.name, activityLabel, entry.open ? t('sessions.navigation.opened') : '', time.textContent].filter(Boolean).join(' · '));
			const nextActionsKey = `${session.unread}:${session.archived}:${entry.open}:${session.kind}:${this._languageVersion}`;
			if (actionsKey !== nextActionsKey) {
				// The compact menu trigger is never replaced for streaming metadata changes.
				if (!this._compact || actionsKey === undefined) { actionsStore.clear(); clearNode(actions); this._renderActions(entry, row, actions, actionsStore); }
				actionsKey = nextActionsKey;
			}
		};
		template.update = update;
		template.store.add(addDisposableListener(primary, 'click', () => this._onDidOpenSession.fire(entry.session.id)));
		template.store.add(this.hoverService.setupDelayedHover(primary, () => {
			const session = entry.session;
			const preview = $('.openide-chat-session-preview');
			const heading = append(preview, $('.openide-chat-session-preview-heading'));
			append(heading, $('.openide-chat-session-preview-title', undefined, session.title || t('chat.header.newTitle')));
			append(heading, $('.openide-chat-session-preview-meta', undefined, relativeTimeLabel(session.updatedAt, Date.now())));
			const context = append(preview, $('.openide-chat-session-preview-context')); append(context, menuIcon('folder'));
			append(context, $('span', undefined, entry.project.path ?? entry.project.label));
			const activity = append(preview, $('.openide-chat-session-preview-activity'));
			append(activity, $('span', undefined, [getOpenideCli(session.cliId)?.name, session.status ? t(statusKey(session.status)) : ''].filter(Boolean).join(' · ')));
			activity.hidden = !activity.textContent;
			return { id: `openide-session-preview-${session.id}`, content: preview, position: { hoverPosition: HoverPosition.RIGHT }, appearance: OPENIDE_CHAT_HOVER_APPEARANCE, persistence: { hideOnHover: false } };
		}, { groupId: OPENIDE_CHAT_HOVER_GROUP }));
	}

	private _renderActions(entry: Extract<NavigationEntry, { kind: 'session' }>, row: HTMLElement, host: HTMLElement, store: DisposableStore): void {
		if (this._compact) {
			const more = append(host, menuRowAction('ellipsis', t('chat.header.more'), { hoverService: this.hoverService, store }));
			store.add(addDisposableListener(more, 'click', event => {
				event.stopPropagation(); this._menuSessionId = entry.session.id;
				this._sessionMenu.actions = this._sessionActions(entry.session); this._sessionMenu.toggle(row, more);
			}));
		} else {
			const actions = this._sessionActions(entry.session).filter(action => action.icon !== 'pin' && action.icon !== 'pinned' && action.icon !== 'edit');
			for (const action of actions) {
				const button = append(host, menuRowAction(action.icon, action.label, { hoverService: this.hoverService, store }));
				store.add(addDisposableListener(button, 'click', event => { event.stopPropagation(); Promise.resolve(action.run()).catch(onUnexpectedError); }));
			}
		}
		row.style.setProperty('--oi-session-actions-width', `${host.childElementCount * 26 + 8}px`);
	}

	private _sessionActions(session: IChatSessionMeta): ISessionMenuAction[] {
		const mutate = (run: () => void) => () => { run(); this.render(); this._onDidMutate.fire(); };
		const actions: ISessionMenuAction[] = [
			{ icon: session.pinned ? 'pinned' : 'pin', label: t(session.pinned ? 'sessions.action.unpin' : 'sessions.action.pin'), run: mutate(() => this.sessions.setPinned(session.id, !session.pinned)) },
			{ icon: 'edit', label: t('sessions.action.rename'), run: () => { this._renaming = { id: session.id, value: session.title }; this.render(); } },
		];
		if (session.unread) { actions.push({ icon: 'eye', label: t('sessions.action.markRead'), run: mutate(() => this.sessions.markRead(session.id)) }); }
		actions.push({ icon: session.archived ? 'unarchive' : 'archive', label: t(session.archived ? 'sessions.action.unarchive' : 'sessions.action.archive'), run: mutate(() => session.archived ? this.sessions.unarchive(session.id) : this.sessions.archive(session.id)) });
		if (session.kind === 'cli' && this.sessions.openTabs().some(open => open.id === session.id)) { actions.push({ icon: 'close', label: t('sessions.action.closeSession'), run: () => this._onDidRequestCloseSession.fire(session.id) }); }
		actions.push({ icon: 'trash', label: t('sessions.action.delete'), run: async () => { if (await this.confirmDelete(session.id)) { this.render(); this._onDidMutate.fire(); } } });
		return actions;
	}

	private _focusEntry(index: number): void {
		const entry = this._entries[index];
		if (!entry) { if (!this._compact) { this._search.focus(); } return; }
		this._list.reveal(index); this._list.setFocus([index]);
		this._templates.get(entry.id)?.container.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
	}
	private _onKeyDown(event: KeyboardEvent): void {
		if (event.isComposing) { return; }
		const target = event.target as HTMLElement;
		if (event.key === 'Escape') { event.preventDefault(); this.setOpen(false); return; }
		if (target.closest('.openide-chat-sessions-rename, .openide-menu')) { return; }
		const id = target.closest<HTMLElement>('[data-navigation-id]')?.dataset.navigationId;
		const index = this._entries.findIndex(entry => entry.id === id);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (index >= 0 && (event.key === 'Home' || event.key === 'End'))) {
			event.preventDefault(); event.stopPropagation();
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? this._entries.length - 1 : Math.max(0, Math.min(this._entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
			this._focusEntry(next);
		}
	}
}

function statusKey(status: NonNullable<IChatSessionMeta['status']>): OpenideStringKey {
	switch (status) {
		case 'in-progress': return 'sessions.status.inProgress';
		case 'needs-input': return 'sessions.status.needsInput';
		case 'completed': return 'sessions.status.completed';
		case 'failed': return 'sessions.status.failed';
		default: return 'sessions.navigation.unknown';
	}
}

/** Keep unchanged labels intact during token and status notifications. */
function setText(element: HTMLElement, value: string): void {
	if (element.textContent !== value) { element.textContent = value; }
}
