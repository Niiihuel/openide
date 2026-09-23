/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { BaseMenuActionViewItem } from '../../../../base/browser/ui/menu/menu.js';
import { defaultMenuStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { OpenideEmptyState } from '../../../browser/openideEmptyState.js';
import { renderOpenideWindowSwitcher } from './openideWindowSwitcher.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { AnchorAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { AgentWindowAction } from '../common/openideAgentWindowShortcuts.js';
import { OpenideAgentWindowCommands, AgentWindowCommand } from './openideAgentWindowCommands.js';
import { OpenideAgentWindowSearch } from './openideAgentWindowSearch.js';
import { OpenideAgentWindowProjects } from './openideAgentWindowProjects.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { setupChatTooltip } from './chat/openideChatHover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { DEFAULT_LABELS_CONTAINER, ResourceLabels } from '../../../browser/labels.js';
import { ITitleService } from '../../../services/title/browser/titleService.js';
import { IStatusbarEntryContainer } from '../../../browser/parts/statusbar/statusbarPart.js';
import { IStatusbarService } from '../../../services/statusbar/browser/statusbar.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { hasCustomTitlebar } from '../../../../platform/window/common/window.js';
import { Sash, Orientation, SashState } from '../../../../base/browser/ui/sash/sash.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationError, onUnexpectedError } from '../../../../base/common/errors.js';
import { IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { SettingsEditorInput } from '../../openideSettings/browser/openideSettingsInput.js';
import { OpenideSettingsEditor } from '../../openideSettings/browser/openideSettingsEditor.js';
import { OpenideAccountProfile } from '../../openideSettings/browser/openideAccountProfile.js';
import { IOpenideCliChangesService, OpenideCliChangesService } from './openideCliChangesService.js';
import { getOpenideCli } from '../common/openideAgentCliCatalog.js';
import { OpenideChangesInput } from './openideChangesEditor.js';
import { OpenideAgentConversationInput } from './openideAgentConversationEditor.js';
import { OpenideSubagentsInput } from './openideSubagentsEditor.js';
import { OpenideAgentWindowMotion } from './openideAgentWindowMotion.js';
import { OpenideAgentWindowEditors } from './openideAgentWindowEditors.js';
import { OpenideFilesInput } from './openideFilesEditor.js';
import { OpenideAgentWindowTerminal } from './openideAgentWindowTerminal.js';
import { setupContextPreview } from './openideAgentWindowContextControls.js';
import { OpenideAgentWindowContext } from './openideAgentWindowContext.js';
import { OpenideAgentWindowStatusbar } from './openideAgentWindowStatusbar.js';
import { Action, Separator } from '../../../../base/common/actions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { OpenideChatWidget } from './chat/openideChatWidget.js';
import { OpenideChatSessionsPane } from './chat/openideChatSessionsPane.js';
import { OpenideChatSessionKindPicker, OpenideCliAvailability } from './chat/openideChatSessionKindPicker.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { t } from '../common/openideStrings.js';
import './chat/media/openideAgentWindow.css';

const BOUNDS_KEY = 'openide.agentWindow.bounds';
const LAYOUT_KEY = 'openide.agentWindow.layout';

/** A second native surface over the IDE's existing conversation and execution owner. */
export class OpenideAgentWindow extends Disposable {
	private auxiliary: IAuxiliaryWindow | undefined;
	private opening: Promise<void> | undefined;
	private readonly windowStore = this._register(new DisposableStore());

	constructor(
		private readonly source: OpenideChatWidget,
		private readonly registerStatusbarMirror: ((container: IStatusbarEntryContainer, document: Document, focusChat: () => void) => IDisposable) | undefined,
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IHoverService private readonly hoverService: IHoverService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IHostService private readonly hostService: IHostService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@ITitleService private readonly titleService: ITitleService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IBrowserViewWorkbenchService private readonly browserService: IBrowserViewWorkbenchService,
		@IOpenideCliChangesService private readonly cliChanges: OpenideCliChangesService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super();
		// Close the companion when its shared runtime shuts down, before the owner can
		// leave stale DOM behind with disposed services and removed theme stylesheets.
		this._register(lifecycleService.onDidShutdown(() => this.dispose()));
		this._register(addDisposableListener(mainWindow, 'pagehide', () => this.dispose()));
	}

	open(): Promise<void> {
		if (this._store.isDisposed) { return Promise.reject(new CancellationError()); }
		if (this.opening) { return this.opening; }
		if (this.auxiliary) { return this.hostService.focus(this.auxiliary.window); }
		return this.opening ??= this.openWindow().catch(error => {
			this.auxiliary = undefined;
			this.windowStore.clear();
			throw error;
		}).finally(() => { this.opening = undefined; });
	}

	private async openWindow(): Promise<void> {
		const stored = this.storageService.getObject<{ x: number; y: number; width: number; height: number }>(BOUNDS_KEY, StorageScope.WORKSPACE);
		const bounds = stored && [stored.x, stored.y, stored.width, stored.height].every(Number.isFinite)
			? { ...stored, width: Math.max(640, stored.width), height: Math.max(480, stored.height) }
			: { width: 1280, height: 860 };
		const customTitle = hasCustomTitlebar(this.configurationService);
		const auxiliary = await this.auxiliaryWindowService.open({ bounds, nativeTitlebar: !customTitle, noBackgroundThrottling: true, keepWorkbenchAlive: true });
		if (this._store.isDisposed) { auxiliary.dispose(); throw new CancellationError(); }
		this.auxiliary = auxiliary;
		this.windowStore.add(auxiliary);
		const store = this.windowStore;
		const closed = new Promise<boolean>(resolve => {
			store.add(toDisposable(() => resolve(true)));
			store.add(auxiliary.onUnload(() => {
				if (this.auxiliary === auxiliary) { this.auxiliary = undefined; this.windowStore.clear(); }
				resolve(true);
			}));
		});
		if (await Promise.race([closed, auxiliary.whenStylesHaveLoaded.then(() => false)]) || this._store.isDisposed || this.auxiliary !== auxiliary) { throw new CancellationError(); }
		const workspace = this.workspaceContextService.getWorkspace();
		const project = workspace.folders.map(folder => folder.name).join(', ') || t('agentWindow.noProject');
		auxiliary.window.document.title = `${project} — OpenIDE Agent`;
		const titlebar = customTitle ? store.add(this.titleService.createAuxiliaryTitlebarPart(auxiliary.container, this.editorGroupsService.mainPart, this.instantiationService)) : undefined;
		let menubar: HTMLElement | undefined;
		titlebar?.container.classList.add('openide-agent-titlebar');
		if (titlebar) {
			// This companion has a smaller command surface than the IDE. A dedicated menubar keeps
			// file/project selection visible without exposing editor-only Selection, Go and Run menus.
			const left = titlebar.container.querySelector<HTMLElement>('.titlebar-left');
			if (left && !left.querySelector('.openide-agent-menubar')) {
				menubar = append(left, $('.openide-agent-menubar', { role: 'menubar', 'aria-label': t('agentWindow.menu.label') }));
			}
		}
		const editors = store.add(this.instantiationService.createInstance(OpenideAgentWindowEditors, auxiliary.window.vscodeWindowId));
		const projects = store.add(this.instantiationService.createInstance(OpenideAgentWindowProjects, auxiliary.window));
		store.add(this.agentService.registerDiffEditorTarget(auxiliary.window.vscodeWindowId, () => editors.getEditorService()));
		store.add(this.browserService.registerPreviewEditorTarget(auxiliary.window.vscodeWindowId, async modal => {
			return modal === true ? editors.getModalEditorService() : editors.getEditorService();
		}));
		const openResource = async (resource: URI) => { await editors.openEditor({ resource, options: { pinned: true } }); };
		const openBrowser = async (url?: string) => { await editors.openEditor(this.browserService.getOrCreatePreview(url)); };
		const savedLayout = this.storageService.getObject<{ sidebarWidth: number; contextWidth: number; terminalHeight: number; sidebarHidden: boolean; contextHidden: boolean; rightMode?: 'editors' | 'files'; filesOpen?: boolean; filesDirectory?: string }>(LAYOUT_KEY, StorageScope.WORKSPACE);
		const root = append(auxiliary.container, $('.openide-agent-window'));
		const topActions = $('.openide-agent-window-actions');
		const nativeActions = titlebar?.container.querySelector('.titlebar-right');
		if (nativeActions) { nativeActions.insertBefore(topActions, nativeActions.firstChild); }
		else { auxiliary.container.insertBefore(topActions, root); }
		const statusbar = store.add(this.statusbarService.createAuxiliaryStatusbarPart(auxiliary.container, this.instantiationService));
		if (this.registerStatusbarMirror) { store.add(this.registerStatusbarMirror(statusbar, auxiliary.window.document, () => companion.focus())); }
		root.classList.toggle('context-hidden', savedLayout?.contextHidden ?? true);
		root.classList.toggle('sidebar-hidden', savedLayout?.sidebarHidden ?? auxiliary.window.innerWidth < 680);
		root.setAttribute('aria-label', t('agentWindow.label'));
		const sidebar = append(root, $('aside.openide-agent-window-sidebar.openide-chat-native.openide-agent-island', { id: 'openide-agent-window-sidebar' }));
		const brand = append(sidebar, $('.openide-agent-window-brand'));
		this.button(brand, t('agentWindow.search'), 'search', () => search.show(), store, AgentWindowAction.search).classList.add('icon-only');
		const sidebarActions = append(sidebar, $('.openide-agent-window-new'));
		this.button(sidebarActions, t('chat.header.newTitle'), 'edit', () => this.source.newSession(), store, AgentWindowAction.newChat).classList.add('openide-agent-new-session');
		const choose = this.button(sidebarActions, t('agentWindow.harness'), 'chevron-down', () => picker.toggle(sidebarActions, choose), store);
		const picker = store.add(new OpenideChatSessionKindPicker(this.contextViewService, new OpenideCliAvailability(this.agentService), choice => companion.createSession(choice)));
		const sessionsHost = append(sidebar, $('.openide-agent-window-sessions', { id: 'openide-agent-window-sessions' }));
		const sessions = store.add(this.instantiationService.createInstance(OpenideChatSessionsPane, sessionsHost, this.source.sessionStore, id => this.source.deleteSession(id)));
		sessions.setFull(true);
		sessions.setCompact(true);
		store.add(sessions.onDidOpenSession(id => companion.openSession(id)));
		const showSubagents = async (parentId: string | undefined, runId?: string) => {
			if (!parentId) { return; }
			const input = editors.tabs.find((tab): tab is OpenideSubagentsInput => tab instanceof OpenideSubagentsInput && tab.parentSessionId === parentId)
				?? new OpenideSubagentsInput(parentId, this.source);
			input.select(runId);
			await editors.openEditor(input, { pinned: true });
		};
		const openSubagents = (sessionId?: string) => {
			const session = this.source.sessionStore.metaOf(sessionId);
			return showSubagents(session?.parentSessionId ?? this.source.sessionStore.activeSessionId(), session?.subagentRunId);
		};
		store.add(sessions.onDidOpenSubagent(id => void openSubagents(id).catch(onUnexpectedError)));

		store.add(sessions.onDidRequestCloseSession(id => this.source.closeSession(id)));
		store.add(sessions.onDidMutate(() => this.source.refreshSessions()));
		const search: OpenideAgentWindowSearch = store.add(this.instantiationService.createInstance(OpenideAgentWindowSearch, auxiliary.container, this.source.sessionStore, {
			openSession: (id: string) => companion.openSession(id),
			newChat: () => this.source.newSession(),
			openFolder: () => projects.openFolder(),
			searchFiles: () => search.showFiles(),
			openFile: openResource,
		}));
		const openEnvironment = () => {
			root.classList.add('context-hidden'); environmentHidden = false; environmentForced = true; layout();
			context.querySelector<HTMLButtonElement>('.openide-agent-window-section-body button')?.focus();
		};
		const openFiles = async (resource?: URI) => {
			const input = editors.tabs.find((input): input is OpenideFilesInput => input instanceof OpenideFilesInput && input.directory?.toString() === resource?.toString()) ?? new OpenideFilesInput(resource);
			await editors.openEditor(input, { pinned: true });
		};
		const footer = append(sidebar, $('.openide-agent-window-footer'));
		const account = store.add(this.instantiationService.createInstance(OpenideAccountProfile, footer));
		account.setOpenProfile(() => {
			void editors.openSettings(this.instantiationService.createInstance(SettingsEditorInput)).then(pane => {
				if (pane instanceof OpenideSettingsEditor) { pane.showSettingsCategory('workbench/profile'); }
			}).catch(onUnexpectedError);
		});
		this.button(footer, t('agentWindow.settings'), 'settings-gear', () => void editors.openSettings(this.instantiationService.createInstance(SettingsEditorInput)).catch(onUnexpectedError), store).classList.add('icon-only');

		const workspacePanel = append(root, $('aside.openide-agent-window-workspace.openide-agent-island', { id: 'openide-agent-window-workspace', 'aria-label': t('agentWindow.workspacePanel') }));
		const addTabMenu = MenuId.for(`OpenideAgentWorkspaceAddTab.${auxiliary.window.vscodeWindowId}`);
		const workspaceHeader = append(workspacePanel, $('.openide-agent-window-workspace-header'));
		// These controls own focus; do not forward their clicks into the native editor body.
		for (const type of ['pointerdown', 'mousedown', 'click']) { store.add(addDisposableListener(workspaceHeader, type, event => event.stopPropagation())); }
		workspaceHeader.setAttribute('role', 'toolbar');
		workspaceHeader.setAttribute('aria-label', t('agentWindow.workspacePanel'));
		const workspaceHeaderHome = append(workspacePanel, $('.openide-agent-window-workspace-header-home'));
		workspaceHeaderHome.appendChild(workspaceHeader);
		const editorHost = append(workspacePanel, $('.openide-agent-window-editor-host'));
		const editorEmpty = append(editorHost, $('.openide-agent-window-editor-empty'));
		const emptyState = store.add(this.instantiationService.createInstance(OpenideEmptyState, editorEmpty, { title: t('agentWindow.workspacePanel'), description: t('agentWindow.workspaceEmpty'), hideHeading: true }));
		editors.configureDock(editorHost, () => { root.classList.remove('context-hidden'); layout(); }, workspaceHeader, addTabMenu.id);
		const center = append(root, $('.openide-agent-window-center'));
		const main = append(center, $('main.openide-agent-window-main.openide-agent-island'));
		const header = append(main, $('header.openide-agent-window-header'));
		const switcher = append(topActions, $('button.openide-chat-head-btn', { type: 'button' }));
		renderOpenideWindowSwitcher(switcher, t('openide.switch.ide'));
		store.add(addDisposableListener(switcher, 'click', () => void this.focusIde()));
		store.add(setupChatTooltip(this.hoverService, switcher, () => t('openide.switch.ide'), { position: HoverPosition.BELOW }));
		const sidebarToggle = this.button(header, t('agentWindow.toggleSidebar'), 'layout-sidebar-left', () => { root.classList.toggle('sidebar-hidden'); layout(); }, store, AgentWindowAction.sidebar);
		sidebarToggle.setAttribute('aria-controls', sidebar.id);
		const identity = append(header, $('.openide-agent-window-identity'));
		const title = append(identity, $('.openide-agent-window-title'));
		const location = append(identity, $('.openide-agent-window-location'));
		const harnessLabel = append(header, $('span.openide-agent-window-harness-label'));
		const more = this.button(header, t('chat.header.more'), 'ellipsis', () => companion.showConversationMenu(more), store);
		const openReview = () => {
			const summary = context.querySelector<HTMLButtonElement>('.openide-agent-window-review-summary');
			if (summary && !summary.disabled) { summary.click(); return; }
			const id = this.source.sessionStore.activeSessionId() ?? 'workspace';
			let input = reviews.get(id);
			if (!input || input.isDisposed()) { input = this.instantiationService.createInstance(OpenideChangesInput, id, []); reviews.set(id, input); }
			configureReview(input, id);
			void editors.openEditor(input, { pinned: true }).catch(onUnexpectedError);
		};
		const showViewMenu = (anchor: HTMLElement, workspaceOnly = false) => {
			const menuStore = new DisposableStore();
			const action = (id: string, label: string, icon: string, run: () => void, enabled = true) =>
				menuStore.add(new Action(id, label, `codicon codicon-${icon}`, enabled, async () => run()));
			const actions = [
				action(AgentWindowAction.review, t('agentWindow.reviewChanges'), 'diff', () => openReview()),
				action(AgentWindowAction.browser, t('agentWindow.browser'), 'globe', () => void openBrowser().catch(onUnexpectedError)),
				action(AgentWindowAction.files, t('agentWindow.filesTitle'), 'files', () => void openFiles().catch(onUnexpectedError)),
				action(AgentWindowAction.terminal, t('agentWindow.terminal'), 'terminal', () => void openTerminal().catch(onUnexpectedError)),
				new Separator(),
				action('openide.workspace.conversations', t('agentWindow.conversations'), 'comment-discussion', () => { root.classList.remove('sidebar-hidden'); layout(); }),
				action('openide.workspace.environment', t('agentWindow.environment'), 'layout', () => openEnvironment()),
				action('openide.workspace.focusChat', t('agentWindow.focusChat'), 'layout-centered', () => { root.classList.add('sidebar-hidden', 'context-hidden'); closeTerminal(); }),
			];
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				anchorAlignment: AnchorAlignment.RIGHT,
				// Render native menu styles in this window before measuring; the main-window
				// stylesheet mirror arrives asynchronously in auxiliary windows.
				domForShadowRoot: anchor,
				useWindowContainerForShadowRoot: true,
				getActions: () => workspaceOnly ? actions.slice(0, 3) : actions,
				getActionViewItem: action => new BaseMenuActionViewItem(undefined, action, { icon: true, label: true }, defaultMenuStyles),
				getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
				onHide: cancelled => { menuStore.dispose(); if (cancelled && anchor.isConnected) { anchor.focus(); } },
			});
		};
		const layoutButton = this.button(workspaceHeader, t('agentWindow.openView'), 'add', () => showViewMenu(layoutButton, true), store);
		layoutButton.classList.add('openide-workspace-add-fallback');
		let environmentHidden = false; let environmentForced = false;
		let environmentVisible: boolean | undefined;
		const reducedMotion = auxiliary.window.matchMedia('(prefers-reduced-motion: reduce)');
		const environmentToggle = this.button(header, t('conversationWorkspace.title'), 'layout', () => {
			if (environmentVisible) { environmentHidden = true; environmentForced = true; layout(); }
			else { openEnvironment(); }
		}, store);
		const contextToggle = this.button(header, t('agentWindow.toggleWorkspace'), 'layout-sidebar-right', () => { root.classList.toggle('context-hidden'); layout(); }, store, AgentWindowAction.workspace);
		contextToggle.setAttribute('aria-controls', workspacePanel.id);
		environmentToggle.setAttribute('aria-controls', 'openide-agent-window-context');
		const openModalButton = this.button(workspaceHeader, t('agentWindow.openModal'), 'screen-full', () => void editors.showModal().catch(onUnexpectedError), store);
		this.button(workspaceHeader, t('agentWindow.minimizeView'), 'layout-sidebar-right', () => openEnvironment(), store);
		const conversationBody = append(main, $('.openide-agent-conversation-body'));
		const chatHost = append(conversationBody, $('.openide-agent-window-chat'));
		const companion = store.add(this.source.createCompanion(chatHost, (runId, parentId) => {
			void showSubagents(parentId ?? this.source.sessionStore.activeSessionId(), runId).catch(onUnexpectedError);
		}));
		const terminalHost = append(center, $('.openide-agent-window-terminal-island.openide-agent-island', { id: 'openide-agent-window-terminal' }));
		terminalHost.hidden = true;
		const terminal = store.add(this.instantiationService.createInstance(OpenideAgentWindowTerminal, terminalHost, () => closeTerminal()));
		const openTerminal = async (instanceId?: number) => {
			terminalHost.hidden = false; layout(); await terminal.reveal(instanceId); layout();
		};
		const closeTerminal = () => { terminal.hide(); terminalHost.hidden = true; layout(); };
		const toggleTerminal = () => { if (terminalHost.hidden) { void openTerminal().catch(onUnexpectedError); } else { closeTerminal(); } };
		const contextViewport = $('.openide-agent-window-context-viewport');
		const contextScroll = store.add(new DomScrollableElement(contextViewport, { horizontal: ScrollbarVisibility.Hidden, vertical: ScrollbarVisibility.Auto, verticalScrollbarSize: 6, useShadows: false }));
		const contextHost = append(conversationBody, contextScroll.getDomNode());
		contextHost.classList.add('openide-agent-window-context-scroll');
		// Let responsive and exit styles position the native scroll host instead of its inline default.
		contextHost.style.removeProperty('position');
		const context = append(contextViewport, $('aside.openide-agent-window-context.openide-agent-island', { id: 'openide-agent-window-context' }));
		const contextHeader = append(context, $('.openide-agent-window-context-header'));
		append(contextHeader, $('span', undefined, t('conversationWorkspace.title')));
		const historyButton = this.button(contextHeader, t('conversationWorkspace.history'), 'history', () => {
			const id = this.source.sessionStore.activeSessionId();
			if (id && this.source.sessionStore.kindOf(id) === 'native') { void editors.openEditor(new OpenideAgentConversationInput(id, this.source), { pinned: true }).catch(onUnexpectedError); }
		}, store);
		historyButton.classList.add('icon-only');
		this.button(contextHeader, t('chat.header.close'), 'close', () => { environmentHidden = true; layout(); environmentToggle.focus(); }, store).classList.add('icon-only');
		store.add(addDisposableListener(context, 'keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); environmentHidden = true; layout(); environmentToggle.focus(); } }));
		const contextResize = new auxiliary.window.ResizeObserver(() => contextScroll.scanDomNode());
		contextResize.observe(context); store.add(toDisposable(() => contextResize.disconnect()));
		const reviews = new Map<string, OpenideChangesInput>();
		const configureReview = (input: OpenideChangesInput, sessionId: string) => {
			input.stageComment = comment => companion.stageReviewComment(sessionId, comment);
			const pending = () => {
				const session = this.source.sessionStore.metaOf(sessionId);
				if (session?.kind !== 'native' || session.status === 'in-progress') { return []; }
				const owned = new Set(this.agentService.pendingFileDiffs(sessionId).map(file => file.path));
				return input.files.flatMap(file => file.pendingPath && owned.has(file.pendingPath) ? [file.pendingPath] : []);
			};
			input.acceptChanges = {
				canAccept: () => pending().length > 0,
				run: async () => { const paths = pending(); if (paths.length) { await this.agentService.keepEdits(paths); } input.refreshAcceptance(); },
			};
			input.refreshAcceptance();
		};
		store.add(this.source.sessionStore.onDidChange(() => { for (const input of reviews.values()) { input.refreshAcceptance(); } }));
		store.add(this.agentService.onDidChangeFileDiff(() => { for (const input of reviews.values()) { input.refreshAcceptance(); } }));
		store.add(this.instantiationService.createInstance(OpenideAgentWindowContext, context, this.source, {
			review: (sessionId, files, open) => {
				let input = reviews.get(sessionId);
				if (input?.isDisposed()) { reviews.delete(sessionId); input = undefined; }
				if (!input && open) { input = this.instantiationService.createInstance(OpenideChangesInput, sessionId, files); reviews.set(sessionId, input); }
				if (input) { configureReview(input, sessionId); }
				input?.update(files);
				if (open && input) { void editors.openEditor(input, { pinned: true }).catch(onUnexpectedError); }
			},
			openTerminal: (id?: number) => void openTerminal(id).catch(onUnexpectedError), openFiles: (resource?: URI) => void openFiles(resource).catch(onUnexpectedError),
			openProject: () => void projects.openFolder().catch(onUnexpectedError),
			createTerminal: async (cwd: URI) => { terminalHost.hidden = false; layout(); await terminal.create({ cwd }); layout(); },
			openSubagents: () => void openSubagents().catch(onUnexpectedError),
			openComparison: async input => { await editors.openEditor(input); },
			openResource: (resource: URI) => void openResource(resource).catch(onUnexpectedError),
			openBrowser: (url: string) => void openBrowser(url).catch(onUnexpectedError),
			openCliChanges: (sessionId, file) => { void editors.getEditorService().then(service => this.cliChanges.openDiff(sessionId, file, service)).catch(onUnexpectedError); },
			openChanges: (path, resource) => {
				void (async () => {
					if (path) { await this.agentService.openDiff(path, await editors.getEditorService()); }
					else if (resource?.multiDiffEditorOriginalUri && resource.multiDiffEditorModifiedUri) {
						await editors.openEditor({ original: { resource: resource.multiDiffEditorOriginalUri }, modified: { resource: resource.multiDiffEditorModifiedUri }, options: { pinned: true } });
					} else if (resource) { await openResource(resource.sourceUri); }
				})().catch(onUnexpectedError);
			},
			addSource: () => companion.pickAttachments()
		}));
		const viewStore = store.add(new DisposableStore());
		const viewLabels = store.add(this.instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		const viewsSection = append(context, $('.openide-agent-window-context-section.openide-agent-window-views'));
		const viewsHeading = append(viewsSection, $('.openide-agent-window-section-heading'));
		append(viewsHeading, $('h2', undefined, t('agentWindow.openViews')));
		const viewsAdd = this.button(viewsHeading, t('agentWindow.openView'), 'add', () => showViewMenu(viewsAdd), store);
		const viewsList = append(viewsSection, $('.openide-agent-window-section-body'));
		const workspaceActions = [
			{ label: t('agentWindow.reviewChanges'), icon: Codicon.diff, commandId: AgentWindowAction.review, run: () => openReview() },
			{ label: t('agentWindow.browser'), icon: Codicon.globe, commandId: AgentWindowAction.browser, run: () => openBrowser() },
			{ label: t('agentWindow.filesTitle'), icon: Codicon.files, commandId: AgentWindowAction.files, run: () => openFiles() },
		];
		for (const [index, entry] of workspaceActions.entries()) {
			const id = entry.commandId;
			store.add(MenuRegistry.appendMenuItem(addTabMenu, { command: { id, title: entry.label, icon: entry.icon }, group: 'navigation', order: index }));
		}
		emptyState.setActions(workspaceActions);
		const viewRows = new Map<EditorInput, { row: HTMLElement; activate: HTMLButtonElement; label: ReturnType<ResourceLabels['create']>; name: string; iconKey: string; store: DisposableStore }>();
		viewStore.add(toDisposable(() => { for (const entry of viewRows.values()) { entry.store.dispose(); } viewRows.clear(); }));
		const viewsEmpty = append(viewsList, $('.openide-agent-window-empty', undefined, t('agentWindow.noOpenViews')));
		const renderViews = () => {
			const tabs = editors.tabs;
			for (const [input, entry] of viewRows) {
				if (!tabs.includes(input)) { entry.store.dispose(); entry.row.remove(); viewRows.delete(input); }
			}
			viewsEmpty.hidden = tabs.length > 0;
			editorEmpty.hidden = editors.tabs.length > 0;
			workspaceHeaderHome.classList.toggle('has-editor', editors.tabs.length > 0 && !editors.isModal);
			openModalButton.disabled = editors.tabs.length === 0;
			let anchor: ChildNode | null = viewsList.firstChild;
			for (const input of tabs) {
				let entry = viewRows.get(input);
				if (!entry) {
					const rowStore = new DisposableStore();
					const row = $('.openide-agent-window-view-row');
					const activate = this.button(row, input.getName(), undefined, () => void editors.activate(input).catch(onUnexpectedError), rowStore);
					activate.classList.add('openide-agent-window-view-name', 'oi-dock-row', 'show-file-icons');
					clearNode(activate);
					const label = rowStore.add(viewLabels.create(activate));
					setupContextPreview(activate, activate, () => input.getName(), rowStore, this.hoverService);
					this.button(row, t('chat.header.close'), 'close', () => void editors.closeTab(input).catch(onUnexpectedError), rowStore);
					entry = { row, activate, label, name: '', iconKey: '', store: rowStore };
					viewRows.set(input, entry);
					rowStore.add(input.onDidChangeLabel(renderViews));
				}
				const name = input.getName();
				const icon = input.getIcon();
				const iconKey = URI.isUri(icon) ? icon.toString() : icon?.id ?? '';
				if (name !== entry.name || iconKey !== entry.iconKey) {
					entry.name = name; entry.iconKey = iconKey;
					entry.activate.setAttribute('aria-label', name);
					entry.label.setResource({ resource: input.resource, name }, { icon, title: '' });
				}
				const active = String(input === editors.activeEditor);
				if (entry.activate.getAttribute('aria-pressed') !== active) { entry.activate.setAttribute('aria-pressed', active); }
				if (entry.row !== anchor) { viewsList.insertBefore(entry.row, anchor); }
				anchor = entry.row.nextSibling;
			}
			if (editors.isModal) {
				const modalHeader = auxiliary.container.querySelector<HTMLElement>('.openide-agent-expanded-surface .modal-editor-action-container');
				if (modalHeader && !modalHeader.querySelector('.openide-return-to-workspace')) {
					this.button(modalHeader, t('agentWindow.dockView'), 'layout-sidebar-right', () => void editors.dock().catch(onUnexpectedError), store).classList.add('openide-return-to-workspace');
				}
			}
		};
		store.add(editors.onDidChange(renderViews)); renderViews();
		store.add(this.instantiationService.createInstance(OpenideAgentWindowStatusbar, statusbar, auxiliary.window.document, this.source, {
			openEnvironment: () => openEnvironment(),
			openTerminal: () => void openTerminal().catch(onUnexpectedError),
			openBrowser: () => void openBrowser().catch(onUnexpectedError)
		}));
		const runCommand = (id: string) => void this.commandService.executeCommand(id).catch(onUnexpectedError);
		const showTitleMenu = (anchor: HTMLButtonElement, actions: readonly (Action | Separator)[]) => {
			const menuStore = new DisposableStore();
			for (const action of actions) { if (!(action instanceof Separator)) { menuStore.add(action); } }
			anchor.setAttribute('aria-expanded', 'true');
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				anchorAlignment: AnchorAlignment.LEFT,
				domForShadowRoot: anchor,
				useWindowContainerForShadowRoot: true,
				getActions: () => actions,
				getActionViewItem: action => new BaseMenuActionViewItem(undefined, action, { icon: true, label: true }, defaultMenuStyles),
				getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
				onHide: cancelled => {
					anchor.setAttribute('aria-expanded', 'false');
					menuStore.dispose();
					if (cancelled && anchor.isConnected) { anchor.focus(); }
				},
			});
		};
		const titleAction = (id: string, label: string, icon: string, run: () => void) => new Action(id, label, `codicon codicon-${icon}`, true, async () => run());
		const addTitleMenu = (label: string, actions: () => readonly (Action | Separator)[]) => {
			if (!menubar) { return; }
			const button = append(menubar, $<HTMLButtonElement>('button.openide-agent-menubar-button', {
				type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false'
			}, label));
			store.add(addDisposableListener(button, 'pointerdown', event => event.stopPropagation()));
			store.add(addDisposableListener(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				showTitleMenu(button, actions());
			}));
		};
		addTitleMenu(t('agentWindow.menu.file'), () => [
			titleAction(AgentWindowAction.newChat, t('agentWindow.menu.newChat'), 'edit', () => { this.source.newSession(); companion.focus(); }),
			new Separator(),
			titleAction('workbench.action.quickOpen', t('agentWindow.menu.openFile'), 'file', () => search.showFiles()),
			titleAction('workbench.action.files.openFolder', t('agentWindow.menu.openProject'), 'folder-opened', () => void projects.openFolder().catch(onUnexpectedError)),
			titleAction('workbench.action.openRecent', t('agentWindow.menu.openRecent'), 'history', () => void projects.openRecent().catch(onUnexpectedError)),
			new Separator(),
			titleAction('openide.agent.backToIde', t('agentWindow.menu.backToIde'), 'arrow-left', () => void this.focusIde().catch(onUnexpectedError)),
		]);
		addTitleMenu(t('agentWindow.menu.view'), () => [
			titleAction('openide.workspace.conversations', t('agentWindow.conversations'), 'comment-discussion', () => { root.classList.remove('sidebar-hidden'); layout(); }),
			titleAction('openide.workspace.environment', t('agentWindow.environment'), 'layout', () => openEnvironment()),
			new Separator(),
			titleAction(AgentWindowAction.review, t('agentWindow.reviewChanges'), 'diff', () => openReview()),
			titleAction(AgentWindowAction.files, t('agentWindow.filesTitle'), 'files', () => void openFiles().catch(onUnexpectedError)),
			titleAction(AgentWindowAction.browser, t('agentWindow.browser'), 'globe', () => void openBrowser().catch(onUnexpectedError)),
			titleAction(AgentWindowAction.terminal, t('agentWindow.terminal'), 'terminal', () => toggleTerminal()),
		]);
		addTitleMenu(t('agentWindow.menu.help'), () => [
			titleAction('workbench.action.openSettings', t('agentWindow.settings'), 'settings-gear', () => void editors.openSettings(this.instantiationService.createInstance(SettingsEditorInput)).catch(onUnexpectedError)),
			titleAction('workbench.action.openGlobalKeybindings', t('agentWindow.menu.keyboardShortcuts'), 'keyboard', () => runCommand('workbench.action.openGlobalKeybindings')),
		]);
		sidebarToggle.setAttribute('aria-controls', sidebar.id);
		contextToggle.setAttribute('aria-controls', workspacePanel.id);
		environmentToggle.setAttribute('aria-controls', context.id);
		const refresh = () => {
			sessions.render();
			const id = this.source.sessionStore.activeSessionId();
			const active = this.source.sessionStore.metaOf(id);
			historyButton.hidden = active?.kind !== 'native';
			title.textContent = active?.title || project;
			location.textContent = active?.cwd ?? project;
			location.hidden = !location.textContent || location.textContent === title.textContent;
			const cli = active?.cliId ? getOpenideCli(active.cliId) : undefined;
			harnessLabel.textContent = cli?.name ?? '';
			harnessLabel.hidden = !cli;

		};
		store.add(this.source.sessionStore.onDidChange(refresh));
		store.add(this.source.onDidChangeNavigation(refresh));
		store.add(this.source.controller.onDidChangeSessions(refresh));
		const size = (value: number | undefined, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
		let sidebarWidth = size(savedLayout?.sidebarWidth, 248, 200, 400); let contextWidth = size(savedLayout?.contextWidth, 560, 360, 1000); let terminalHeight = size(savedLayout?.terminalHeight, 240, 120, 600);
		const sidebarSash = store.add(new Sash(root, { getVerticalSashLeft: () => sidebar.offsetLeft + sidebar.offsetWidth + 2, getVerticalSashTop: () => 4, getVerticalSashHeight: () => root.clientHeight - 8 }, { orientation: Orientation.VERTICAL }));
		const contextSash = store.add(new Sash(root, { getVerticalSashLeft: () => workspacePanel.offsetLeft - 2, getVerticalSashTop: () => 4, getVerticalSashHeight: () => root.clientHeight - 8 }, { orientation: Orientation.VERTICAL }));
		const terminalSash = store.add(new Sash(center, { getHorizontalSashTop: () => terminalHost.offsetTop - 2, getHorizontalSashWidth: () => center.clientWidth }, { orientation: Orientation.HORIZONTAL }));
		const pendingLayout = store.add(new MutableDisposable<IDisposable>());
		const scheduleLayout = () => {
			if (!pendingLayout.value) {
				pendingLayout.value = scheduleAtNextAnimationFrame(auxiliary.window, () => layout(false));
			}
		};
		let startSize = 0;
		for (const [sash, read, change] of [
			[sidebarSash, () => sidebarWidth, (delta: number) => { sidebarWidth = Math.max(200, Math.min(400, root.clientWidth - contextWidth - 380, startSize + delta)); }],
			[contextSash, () => contextWidth, (delta: number) => { contextWidth = Math.max(360, Math.min(1000, root.clientWidth - sidebarWidth - 380, startSize - delta)); }],
		] as const) {
			store.add(sash.onDidStart(() => { finishEnvironmentTransition(); startSize = read(); }));
			store.add(sash.onDidChange(event => { change(event.currentX - event.startX); scheduleLayout(); }));
			store.add(sash.onDidEnd(() => layout()));
		}
		store.add(terminalSash.onDidStart(() => { finishEnvironmentTransition(); startSize = terminalHeight; }));
		store.add(terminalSash.onDidChange(event => { terminalHeight = Math.max(120, Math.min(center.clientHeight * 0.7, startSize - event.currentY + event.startY)); scheduleLayout(); }));
		store.add(terminalSash.onDidEnd(() => layout()));
		store.add(terminalSash.onDidReset(() => { terminalHeight = 240; layout(); }));
		let chromeWidth = -1; let chromeHeight = -1; let chromeTitleHeight = -1; let chromeStatusHeight = -1;
		let sessionsWidth = -1; let sessionsHeight = -1;
		let chatWidth = -1; let chatHeight = -1;
		const updateToggle = (button: HTMLButtonElement, expanded: boolean, icon: string) => {
			const state = String(expanded);
			if (button.getAttribute('aria-expanded') !== state) {
				button.setAttribute('aria-expanded', state);
				button.querySelector('.codicon')!.className = `codicon codicon-${icon}`;
			}
		};
		let lastSidebarHidden = root.classList.contains('sidebar-hidden');
		let lastContextHidden = root.classList.contains('context-hidden');
		const motion = store.add(new OpenideAgentWindowMotion(auxiliary.window, [
			{ element: center },
			{ element: chatHost, parent: center },
			{ element: contextHost, parent: center, exitContainer: root, direction: 1 },
			{ element: sidebar, direction: -1 },
			{ element: workspacePanel, direction: 1 },
		], () => editors.setDockVisible(!root.classList.contains('context-hidden'))));
		const finishEnvironmentTransition = () => motion.finish();
		store.add(addDisposableListener(reducedMotion, 'change', () => { if (reducedMotion.matches) { motion.finish(); } }));
		const layout = (animate = true) => {
			pendingLayout.clear();
			const sidebarHidden = root.classList.contains('sidebar-hidden');
			const contextHidden = root.classList.contains('context-hidden');
			// Restore the last committed classes before reading: callers only express the next state.
			root.classList.toggle('sidebar-hidden', lastSidebarHidden);
			root.classList.toggle('context-hidden', lastContextHidden);
			let visible = !environmentHidden && (environmentForced || main.clientWidth >= 760) && contextHidden;
			const changed = sidebarHidden !== lastSidebarHidden || contextHidden !== lastContextHidden || visible !== environmentVisible;
			const commit = () => {
				root.classList.toggle('sidebar-hidden', sidebarHidden);
				root.classList.toggle('context-hidden', contextHidden);
				lastSidebarHidden = sidebarHidden; lastContextHidden = contextHidden;
				visible = !environmentHidden && (environmentForced || main.clientWidth >= 760) && contextHidden;
				environmentVisible = visible;
				context.inert = !visible;
				contextHost.hidden = !visible;
				applyLayout(visible);
			};
			const moving = changed
				? motion.run(commit, animate && environmentVisible !== undefined && !reducedMotion.matches)
				: (applyLayout(visible), false);
			// Chromium's native surface is a window child and cannot follow or be clipped by DOM
			// transforms. Keep it hidden for the complete FLIP transition; the editor's screenshot
			// stays in the moving dock and motion reveals the native surface only after settling.
			editors.setDockVisible(!contextHidden && !moving);
		};
		const applyLayout = (visible: boolean) => {
			environmentToggle.setAttribute('aria-expanded', String(visible));
			const width = auxiliary.container.clientWidth; const height = auxiliary.container.clientHeight;
			const titleHeight = titlebar?.height ?? topActions.offsetHeight; const statusHeight = statusbar.height;
			if (width !== chromeWidth || height !== chromeHeight || titleHeight !== chromeTitleHeight || statusHeight !== chromeStatusHeight) {
				chromeWidth = width; chromeHeight = height; chromeTitleHeight = titleHeight; chromeStatusHeight = statusHeight;
				titlebar?.layout(width, titleHeight, 0, 0);
				statusbar.layout(width, statusHeight, height - statusHeight, 0);
			}
			root.style.height = `${Math.max(0, height - titleHeight - statusHeight)}px`;
			// Preserve preferred widths while reserving enough room for the chat/header on resize.
			const sideVisible = !root.classList.contains('sidebar-hidden'); const contextVisible = !root.classList.contains('context-hidden');
			const preferred = (sideVisible ? sidebarWidth : 0) + (contextVisible ? contextWidth : 0);
			const ratio = Math.min(1, Math.max(0, width - 384) / Math.max(1, preferred));
			root.style.setProperty('--agent-sidebar-width', `${Math.max(200, sidebarWidth * ratio)}px`);
			root.style.setProperty('--agent-context-width', `${Math.max(360, contextWidth * ratio)}px`);
			terminalHost.style.height = `${Math.min(terminalHeight, center.clientHeight * 0.7)}px`;
			updateToggle(sidebarToggle, sideVisible, sideVisible ? 'layout-sidebar-left' : 'layout-sidebar-left-off');
			updateToggle(contextToggle, contextVisible, contextVisible ? 'layout-sidebar-right' : 'layout-sidebar-right-off');
			// The embedded editor observes its host size; a manual layout here duplicates that pass.
			// Read the host, never the previously laid out child. Unchanged siblings need no work.
			// Layout uses untransformed dimensions so unrelated updates cannot feed the visual
			// interpolation back into the chat's virtualized list and compositor sizing.
			const nextChatWidth = Math.min(chatHost.clientWidth, 1000);
			if (nextChatWidth !== chatWidth || chatHost.clientHeight !== chatHeight) {
				chatWidth = nextChatWidth; chatHeight = chatHost.clientHeight;
				companion.layout(chatHeight, chatWidth);
			}
			if (visible) { contextScroll.scanDomNode(); }
			const nextSessionsWidth = sessionsHost.clientWidth; const nextSessionsHeight = sessionsHost.clientHeight;
			if (nextSessionsWidth !== sessionsWidth || nextSessionsHeight !== sessionsHeight) {
				sessionsWidth = nextSessionsWidth; sessionsHeight = nextSessionsHeight;
				sessions.layout(sessionsWidth, 0);
			}
			if (!terminalHost.hidden) { terminal.layout(); }
			sidebarSash.state = root.classList.contains('sidebar-hidden') || width < 1000 ? SashState.Disabled : SashState.Enabled;
			contextSash.state = root.classList.contains('context-hidden') || width < 1000 ? SashState.Disabled : SashState.Enabled;
			terminalSash.state = terminalHost.hidden ? SashState.Disabled : SashState.Enabled;
			sidebarSash.layout(); contextSash.layout(); terminalSash.layout();

		};
		store.add(auxiliary.onDidLayout(() => { finishEnvironmentTransition(); layout(false); }));
		if (titlebar) { store.add(titlebar.onDidChange(() => layout())); }
		store.add(auxiliary.onBeforeUnload(() => {
			this.storageService.store(LAYOUT_KEY, { sidebarWidth, contextWidth, terminalHeight, sidebarHidden: root.classList.contains('sidebar-hidden'), contextHidden: root.classList.contains('context-hidden'), filesOpen: editors.activeEditor instanceof OpenideFilesInput, filesDirectory: editors.activeEditor instanceof OpenideFilesInput ? editors.activeEditor.directory?.toString() : undefined }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			const state = auxiliary.createState();
			if (state.bounds) { this.storageService.store(BOUNDS_KEY, state.bounds, StorageScope.WORKSPACE, StorageTarget.MACHINE); }
		}));

		const handlers = new Map<string, AgentWindowCommand>([
			[AgentWindowAction.newChat, () => { this.source.newSession(); companion.focus(); }],
			['openide.agent.newChat', () => { companion.newSession(); companion.focus(); }],
			['openide.agent.forkChat', () => { companion.forkActiveSession(); companion.focus(); }],
			['openide.agent.showContext', () => companion.showContextPanel()],
			['openide.agent.askInNewChat', prompt => {
				if (typeof prompt === 'string' && prompt.trim()) { companion.askInNewSession(prompt); }
			}],
			['openide.agent.injectPrompt', text => {
				const prompt = typeof text === 'string' ? text.trim() : '';
				if (prompt) { companion.injectCanvasPrompt(prompt, false); }
			}],
			['openide.agent.injectCanvasChoice', value => {
				const choice = value as { label?: unknown } | undefined;
				const label = typeof choice?.label === 'string' ? choice.label.trim().slice(0, 1000) : '';
				if (label) { companion.injectCanvasChoice(label); }
			}],
			['openide.agent.injectCanvasPrompt', value => {
				const request = value as { prompt?: unknown; send?: unknown } | undefined;
				const prompt = typeof request?.prompt === 'string' ? request.prompt.trim().slice(0, 4000) : '';
				if (prompt) { companion.injectCanvasPrompt(prompt, request?.send !== false); }
			}],
			['openide.agent.createGoalFromPlan', value => {
				const request = value as { planPath?: unknown; objective?: unknown } | undefined;
				if (typeof request?.planPath === 'string' && typeof request.objective === 'string') {
					companion.createGoalFromPlan({ planPath: request.planPath, objective: request.objective });
				}
			}],
			[AgentWindowAction.search, () => search.show()],
			[AgentWindowAction.review, () => openReview()],
			[AgentWindowAction.browser, () => openBrowser()],
			[AgentWindowAction.files, () => openFiles()],
			[AgentWindowAction.terminal, () => toggleTerminal()],
			[AgentWindowAction.focusChat, () => companion.focus()],
			[AgentWindowAction.sidebar, () => sidebarToggle.click()],
			[AgentWindowAction.workspace, () => contextToggle.click()],
			[AgentWindowAction.explore, () => companion.prepareStarter(0)],
			[AgentWindowAction.plan, () => companion.prepareStarter(1)],
			[AgentWindowAction.debug, () => companion.prepareStarter(2)],
			['workbench.action.togglePanel', () => toggleTerminal()],
			['workbench.action.terminal.toggleTerminal', () => toggleTerminal()],
			['workbench.action.toggleSidebarVisibility', () => sidebarToggle.click()],
			['workbench.action.toggleAuxiliaryBar', () => contextToggle.click()],
			['workbench.action.findInFiles', () => search.show()],
			['workbench.action.quickOpen', () => search.showFiles()],
			['workbench.action.files.openFolder', () => projects.openFolder()],
			['workbench.action.openRecent', () => projects.openRecent()],
			['workbench.action.files.newUntitledFile', () => this.source.newSession()],
			['workbench.action.focusActiveEditorGroup', () => companion.focus()],
			['workbench.action.openSettings', () => editors.openSettings(this.instantiationService.createInstance(SettingsEditorInput))],
		]);
		for (const id of CommandsRegistry.getCommands().keys()) {
			if (OpenideAgentWindowTerminal.supportsCommand(id)) {
				handlers.set(id, async (...args) => { terminalHost.hidden = false; layout(); await terminal.handleCommand(id, ...args); layout(); });
			}
		}
		store.add(this.instantiationService.createInstance(OpenideAgentWindowCommands, auxiliary.window, handlers, (id: string) => {
			// The native editor keeps its own new-file, search and focus behavior while a modal is open.
			return !auxiliary.container.querySelector('.monaco-modal-editor-block:not(.embedded-editor)') || ![
				'workbench.action.files.newUntitledFile', 'workbench.action.findInFiles', 'workbench.action.focusActiveEditorGroup'
			].includes(id);
		}));
		companion.setVisible(true); refresh();
		layout(); if ((savedLayout?.filesOpen || savedLayout?.rightMode === 'files') && !root.classList.contains('context-hidden')) { void openFiles(savedLayout?.filesDirectory ? URI.parse(savedLayout.filesDirectory) : undefined).catch(onUnexpectedError); } companion.focus();
	}

	private async focusIde(): Promise<void> { await this.hostService.focus(mainWindow); this.source.focus(); }

	private button(parent: HTMLElement, label: string, icon: string | undefined, action: () => void, store: DisposableStore, commandId?: string): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>(icon ? 'button.openide-chat-head-btn.oi-dock-action.openide-agent-window-chrome-action' : 'button.oi-btn.ghost', { type: 'button', 'aria-label': label }));
		if (icon) {
			append(button, $('span.codicon', { 'aria-hidden': 'true' })).classList.add(`codicon-${icon}`);
			store.add(setupChatTooltip(this.hoverService, button, () => {
				const shortcut = commandId ? this.keybindingService.lookupKeybinding(commandId)?.getLabel() : undefined;
				return shortcut ? `${label} (${shortcut})` : label;
			}, { position: HoverPosition.BELOW, aria: false }));
		}
		append(button, $('span', undefined, label));
		store.add(addDisposableListener(button, 'click', action));
		return button;
	}
}
