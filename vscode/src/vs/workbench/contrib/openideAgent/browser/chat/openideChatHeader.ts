/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getTotalHeight } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IChatSessionMeta, OpenideChatSessions } from '../openideChatSessions.js';
import { OpenideChatKebabMenu } from './openideChatKebabMenu.js';
import { OpenideChatSessionKindChoice, OpenideChatSessionKindPicker, OpenideCliAvailability } from './openideChatSessionKindPicker.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { createProviderIcon } from '../openideProviderIcons.js';
import { getOpenideCli, OPENIDE_CLI_CATALOG, OpenideCliId } from '../../common/openideAgentCliCatalog.js';
import './media/openideChatHeader.css';
import { onDidChangeOpenideLanguage, t } from '../../common/openideStrings.js';

/**
 * The dock's header: ONE 35px row, Cursor's chat chrome economy on VS Code's anatomy.
 *
 *     [◧ Etiquetas color y planta ✕] [A\ Codex ✕] ......... [+ ▾] [▣] [⚙] [⋯] | [⛶] [✕]
 *
 * It used to be three rows — view tabs, a session-title row, and the Sessions panel's own head —
 * which is 100px of chrome before the first message, and it repeated itself: two ways to create a
 * session, two panel toggles, and a back arrow that did what the toggle already did. What replaced
 * them:
 *
 *  - ONE TAB PER CONVERSATION, each carrying the brand mark of the agent running it. The mark is
 *    why nothing was lost: the old strip needed a tab row to say WHICH AGENT and a title row to
 *    say WHICH CONVERSATION, and a marked tab answers both in one row.
 *  - `+ ▾` is a real split control now: `+` starts another conversation with the agent already
 *    on screen, `▾` opens the kind picker. Transcribed from the terminal panel's own `+ ▾`
 *    (`DropdownWithPrimaryActionViewItem`), where both halves already do different things.
 *  - the Sessions panel has ONE toggle, here, where Cursor keeps it.
 *
 * A TAB IS A CONVERSATION, NOT A VIEW. This reverses the fork's earlier rule ("the top tabs are
 * VIEWS — CHAT plus one installed CLI per tab — never one per conversation"), and the reversal is
 * the user's own decision, not a drift: do not restore view tabs by reading the old comment. The
 * model is Cursor's, and the store was already built for it — `openTabIds` has always been "the
 * conversations open in the strip", with `openTab`/`closeTab`/`reorderTab` around it; only the
 * header was not using them.
 *
 * The constraint that motivated view tabs is real and still holds, so it is handled rather than
 * designed around: a hosted-CLI conversation is backed by a LIVE PTY, and
 * `openideChatAgentTerminalPane.ts` keeps that xterm alive across switches by REPARENTING it
 * instead of recreating it. Tabs change which conversation is active; they must never be a reason
 * to tear a terminal down. Whoever mounts this reconciles the terminals off the active session
 * (`_reconcileTerminals`), which is the single place that ownership lives.
 *
 * It owns the CHROME, not the transcript: every mutation goes straight to `OpenideChatSessions`
 * (the single store) and the only thing it tells the outside is "this conversation is active now",
 * "this tab closed" or "show the list". Reloading the transcript, cancelling a run in flight and
 * restoring the composer belong to whoever mounts this.
 */

/**
 * A conversation's agent: the local harness, or an external CLI by id. The tab strip no longer
 * groups by this — one tab is one conversation — but the Sessions panel still filters by it.
 */
export type OpenideChatViewKind = 'native' | OpenideCliId;

// Read through `t()` at use time: they follow `openide.language` without a rebuild.

/** Sessions panel toggle: hollow while closed, solid while open (the theme maps the pair). */
const SESSIONS_ICON_OPEN = 'layout-sidebar-right';
const SESSIONS_ICON_CLOSED = 'layout-sidebar-right-off';

/** Command the webview's `openProjectMap` message ends up executing (openideChatView.ts). */
const PROJECT_MAP_COMMAND = 'openide.memory.open';
/** The fork's settings editor replaces SettingsEditor2, so the stock command lands in it. */
const SETTINGS_COMMAND = 'workbench.action.openSettings';
const SETTINGS_QUERY = 'openide.chat';
const MAXIMIZE_COMMAND = 'workbench.action.toggleMaximizedAuxiliaryBar';
const CLOSE_COMMAND = 'workbench.action.closeAuxiliaryBar';

export function sessionMatchesViewKind(session: IChatSessionMeta, kind: OpenideChatViewKind): boolean {
	return kind === 'native' ? session.kind === 'native' : session.kind === 'cli' && session.cliId === kind;
}

export class OpenideChatHeader extends Disposable {

	private readonly _element: HTMLElement;
	private readonly _tabs: HTMLElement;
	private readonly _kindPicker: OpenideChatSessionKindPicker;
	private readonly _kebabButton: HTMLButtonElement;
	private readonly _kebabMenu: OpenideChatKebabMenu;
	private readonly _availability: OpenideCliAvailability;

	/** Cleared and refilled on every repaint: the view tabs are rebuilt, never patched. */
	private readonly _tabStore = this._register(new DisposableStore());
	private _listMode = false;
	private _probedAvailability = false;

	private readonly _onDidChangeActiveSession = this._register(new Emitter<string>());
	/** Fires with the id of the conversation that must now be on screen. */
	readonly onDidChangeActiveSession: Event<string> = this._onDidChangeActiveSession.event;

	private readonly _onDidCloseTab = this._register(new Emitter<string>());
	/**
	 * A tab left the strip. The host reconciles the hosted terminals off this: a CLI conversation
	 * whose tab is gone must release its PTY, and closing a tab that was NOT the active one fires
	 * no active-session change to piggyback on.
	 */
	readonly onDidCloseTab: Event<string> = this._onDidCloseTab.event;

	private readonly _onDidRequestExportTranscript = this._register(new Emitter<void>());
	readonly onDidRequestExportTranscript: Event<void> = this._onDidRequestExportTranscript.event;

	private readonly _onDidChooseNewKind = this._register(new Emitter<OpenideChatSessionKindChoice>());
	/** `+ ▾`: a new session of the chosen kind (Local or an external agent). */
	readonly onDidChooseNewKind: Event<OpenideChatSessionKindChoice> = this._onDidChooseNewKind.event;

	private readonly _sessionsToggle!: HTMLButtonElement;
	private readonly _onDidRequestToggleSessions = this._register(new Emitter<void>());
	/** The panel toggle (and the kebab's "History…") open the dock's Sessions panel. */
	readonly onDidRequestToggleSessions: Event<void> = this._onDidRequestToggleSessions.event;

	get domNode(): HTMLElement { return this._element; }

	/** Measured, not assumed: whoever splits the pane must not hardcode the row's height. */
	get height(): number { return getTotalHeight(this._element); }

	constructor(
		parent: HTMLElement,
		private readonly sessions: OpenideChatSessions,
		@IContextViewService contextViewService: IContextViewService,
		@ICommandService private readonly commandService: ICommandService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenideAgentService agentService: IOpenideAgentService,
	) {
		super();

		this._element = append(parent, $('div.openide-chat-headbar'));
		const strip = append(this._element, $('div.openide-chat-header'));
		this._tabs = append(strip, $('div.openide-chat-tabs', { role: 'tablist' }));
		const actions = append(strip, $('div.openide-chat-header-actions'));
		this._availability = new OpenideCliAvailability(agentService);
		this._kindPicker = this._register(new OpenideChatSessionKindPicker(contextViewService, this._availability, choice => {
			if (choice.kind === 'native') { this.newSession(); } else { this._onDidChooseNewKind.fire(choice); }
		}));

		this._kebabMenu = this._register(new OpenideChatKebabMenu(contextViewService, {
			rename: () => {
				const active = this.sessions.activeSessionId();
				if (active) { void this.renameSession(active); }
			},
			fork: () => {
				const active = this.sessions.activeSessionId();
				if (active) { this.forkSession(active); }
			},
			exportTranscript: () => this._onDidRequestExportTranscript.fire(),
			remove: () => {
				const active = this.sessions.activeSessionId();
				if (active) { void this.deleteSession(active); }
			},
			removeAll: () => void this.deleteAllSessions(),
			openProjectMap: () => { void this.commandService.executeCommand(PROJECT_MAP_COMMAND); },
		}));

		// `+ ▾`, ▣, ⚙, ⋯ | ⛶, ✕ — upstream's ChatViewTitle order, separator before the window pair.
		const split = this.createSplitNew(actions);
		this._sessionsToggle = this.createHeadButton(actions, SESSIONS_ICON_CLOSED, t('chat.header.sessions'), () => this._onDidRequestToggleSessions.fire());
		const settingsButton = this.createHeadButton(actions, 'settings-gear', t('chat.header.settings'), () => {
			void this.commandService.executeCommand(SETTINGS_COMMAND, SETTINGS_QUERY);
		});
		this._kebabButton = this.createHeadButton(actions, 'toolbar-more', t('chat.header.more'), () => {
			this._kindPicker.close();
			this._kebabMenu.toggle(this._element, this._kebabButton);
		});
		append(actions, $('span.openide-chat-head-sep'));
		const maximizeButton = this.createHeadButton(actions, 'screen-full', t('chat.header.maximize'), () => {
			void this.commandService.executeCommand(MAXIMIZE_COMMAND);
		});
		const closeButton = this.createHeadButton(actions, 'close', t('chat.header.close'), () => {
			void this.commandService.executeCommand(CLOSE_COMMAND);
		});

		this._register(onDidChangeOpenideLanguage(() => {
			split.primary.title = t('chat.header.new');
			split.chevron.title = t('chat.header.newKind');
			this._sessionsToggle.title = t('chat.header.sessions');
			settingsButton.title = t('chat.header.settings');
			this._kebabButton.title = t('chat.header.more');
			maximizeButton.title = t('chat.header.maximize');
			closeButton.title = t('chat.header.close');
			this.render();
		}));

		this.render();
	}

	/**
	 * List mode: no conversation on screen, the sessions list fills the body. The active tab then
	 * falls back to naming the VIEW, because there is no conversation for it to name.
	 */
	setListMode(listMode: boolean): void {
		if (this._listMode === listMode) { return; }
		this._listMode = listMode;
		this.render();
	}

	get isListMode(): boolean { return this._listMode; }

	/** Repaints the chrome from the store. Call it after the transcript renamed a conversation. */
	render(): void {
		this._tabStore.clear();
		clearNode(this._tabs);
		const activeId = this.sessions.activeSessionId();
		for (const session of this.sessions.openTabs()) {
			append(this._tabs, this.createTab(session, session.id === activeId));
		}
		this.probeAvailability();
	}

	/** Resolves the CLIs on PATH once, then repaints so their views appear without a reload. */
	private probeAvailability(): void {
		if (this._probedAvailability) { return; }
		this._probedAvailability = true;
		void Promise.all(OPENIDE_CLI_CATALOG.map(cli => this._availability.resolve(cli))).then(paths => {
			if (!this._store.isDisposed && paths.some(Boolean)) { this.render(); }
		});
	}

	/** The agent behind a conversation, for the tab's tooltip and its mark. */
	private agentLabel(session: IChatSessionMeta): string {
		return getOpenideCli(session.cliId)?.name ?? t('chat.view.local');
	}

	/**
	 * The mark that says WHICH AGENT runs this conversation: the provider brand for a hosted CLI —
	 * the same `createProviderIcon` the "New session with…" picker paints — and the local harness's
	 * glyph otherwise. It is the reason a tab can carry both facts the two old rows carried, so it
	 * never shrinks and never hides: once the strip is tight and the title has ellipsised away, the
	 * mark is all that still identifies the tab.
	 */
	private createTabIcon(session: IChatSessionMeta, document: Document): HTMLElement {
		const cli = getOpenideCli(session.cliId);
		return cli
			? createProviderIcon(document, cli.icon, cli.name, 'openide-chat-tab-icon')
			: $('span.openide-chat-tab-icon.codicon.codicon-comment-discussion');
	}

	private createTab(session: IChatSessionMeta, active: boolean): HTMLElement {
		const tab = $('button.openide-chat-tab', { type: 'button', role: 'tab' });
		tab.classList.toggle('active', active);
		tab.classList.toggle('unread', !!session.unread);
		tab.setAttribute('aria-selected', String(active));
		const title = session.title || t('chat.header.newTitle');
		tab.title = `${this.agentLabel(session)} · ${title}`;
		tab.setAttribute('aria-label', tab.title);

		append(tab, this.createTabIcon(session, this._tabs.ownerDocument));
		if (session.status === 'needs-input' || session.status === 'in-progress') {
			append(tab, $(`span.openide-chat-tab-dot.${session.status}`));
		}
		append(tab, $('span.openide-chat-tab-title', undefined, title));

		const close = append(tab, $<HTMLButtonElement>('span.openide-chat-tab-close', { role: 'button', title: t('chat.header.closeTab') }));
		close.setAttribute('aria-label', t('chat.header.closeTab'));
		append(close, $('span.codicon.codicon-close'));
		this._tabStore.add(addDisposableListener(close, 'click', event => {
			event.stopPropagation();
			this.closeTab(session.id);
		}));

		this._tabStore.add(addDisposableListener(tab, 'click', () => this.switchSession(session.id)));
		// Middle-click closes, the way every tab strip in the workbench does.
		this._tabStore.add(addDisposableListener(tab, 'auxclick', (event: MouseEvent) => {
			if (event.button === 1) { event.preventDefault(); this.closeTab(session.id); }
		}));
		return tab;
	}

	/**
	 * Closing a TAB is not deleting a conversation: the store drops it from the strip and keeps it
	 * in history (an empty unnamed one it garbage-collects, the way upstream disposes an untouched
	 * chat). It may leave a different conversation active, so it goes through `mutate`.
	 */
	closeTab(id: string): void {
		this.mutate(store => store.closeTab(id));
		this._onDidCloseTab.fire(id);
	}

	/** Same prompt as VS Code's rename (F2) — empty input restores the derived title. */
	private async renameSession(id: string): Promise<void> {
		const current = this.sessions.listAll().find(session => session.id === id);
		const title = await this.quickInputService.input({
			prompt: t('chat.header.renamePrompt'),
			value: current?.title ?? '',
		});
		if (title === undefined) { return; }
		this.sessions.rename(id, title);
		this.render();
	}

	/** Deleting is irreversible, so it confirms first — word for word VS Code's dialog. */
	private async deleteSession(id: string): Promise<void> {
		const target = this.sessions.listAll().find(session => session.id === id);
		const { confirmed } = await this.dialogService.confirm({
			message: t('chat.header.deleteOne', target?.title ?? ''),
			detail: t('chat.header.irreversible'),
			primaryButton: t('chat.header.delete'),
		});
		if (!confirmed) { return; }
		this.mutate(store => store.delete(id));
	}

	private async deleteAllSessions(): Promise<void> {
		const count = this.sessions.listAll().length;
		if (!count) { return; }
		const { confirmed } = await this.dialogService.confirm({
			message: count === 1 ? t('chat.header.deleteOnly') : t('chat.header.deleteMany', count),
			detail: t('chat.header.irreversible'),
			primaryButton: t('chat.header.deleteAll'),
		});
		if (!confirmed) { return; }
		this.mutate(store => store.deleteAll());
	}

	/**
	 * `+ ▾`, the terminal panel's split control (`DropdownWithPrimaryActionViewItem`): the `+` half
	 * RUNS the default action and only the `▾` half opens the menu. Ours was a single button whose
	 * two halves both opened the picker — it looked like the terminal's and behaved like neither,
	 * which is the inconsistency this fixes. Two real buttons, so each half gets its own tooltip,
	 * its own focus stop and its own accessible name; ←/→ move between them the way upstream does,
	 * instead of tabbing out of the control.
	 */
	private createSplitNew(parent: HTMLElement): { readonly primary: HTMLButtonElement; readonly chevron: HTMLButtonElement } {
		const container = append(parent, $('div.openide-chat-head-split'));
		const primary = this.createHeadButton(container, 'add', t('chat.header.new'), () => this.newSessionOfActiveKind());
		const chevron = this.createHeadButton(container, 'chevron-down', t('chat.header.newKind'), () => {
			this._kebabMenu.close();
			this._kindPicker.toggle(this._element, chevron);
		});
		chevron.classList.add('openide-chat-head-split-chevron');
		this._register(addDisposableListener(primary, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'ArrowRight') { event.stopPropagation(); chevron.focus(); }
		}));
		this._register(addDisposableListener(chevron, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft') { event.stopPropagation(); primary.focus(); }
		}));
		return { primary, chevron };
	}

	/**
	 * The `+` half: another conversation with the agent already on screen, without asking. Same
	 * contract as the terminal's `+`, which opens the DEFAULT profile rather than the profile menu
	 * — here the default is whatever you are talking to right now.
	 */
	private newSessionOfActiveKind(): void {
		this._kebabMenu.close();
		this._kindPicker.close();
		const cli = getOpenideCli(this.sessions.metaOf(this.sessions.activeSessionId())?.cliId);
		if (cli) {
			this._onDidChooseNewKind.fire({ kind: 'cli', cli });
		} else {
			this.newSession();
		}
	}

	/**
	 * The toggle fills while the panel is open, the same outline→solid pair every other panel
	 * toggle in the title bar uses: `layout-sidebar-right` is the theme's filled variant and
	 * `-off` the hollow one. Without this it was the only toggle in the IDE that never said
	 * whether the thing it opens is already open.
	 */
	setSessionsOpen(open: boolean): void {
		const icon = this._sessionsToggle.querySelector('.codicon');
		icon?.classList.toggle(`codicon-${SESSIONS_ICON_OPEN}`, open);
		icon?.classList.toggle(`codicon-${SESSIONS_ICON_CLOSED}`, !open);
	}

	private createHeadButton(parent: HTMLElement, icon: string, tooltip: string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.openide-chat-head-btn', { type: 'button', title: tooltip }));
		button.setAttribute('aria-label', tooltip);
		append(button, $(`span.codicon.codicon-${icon}`));
		this._register(addDisposableListener(button, 'click', event => {
			event.stopPropagation();
			onClick();
		}));
		return button;
	}

	/** Public: the "New chat" command of the view pane routes through here. */
	newSession(): void {
		this._kebabMenu.close();
		const id = this.sessions.create();
		this._listMode = false;
		this.render();
		this._onDidChangeActiveSession.fire(id);
	}

	/** Public: the "Fork" command of the view pane routes through here. */
	forkSession(id: string): void {
		const forked = this.sessions.fork(id);
		if (!forked) {
			return;
		}
		this._listMode = false;
		this.render();
		this._onDidChangeActiveSession.fire(forked);
	}

	/** Public: the Sessions panel (or a new CLI session) makes a conversation active. */
	switchSession(id: string): void {
		const wasListMode = this._listMode;
		this._listMode = false;
		if (id === this.sessions.activeSessionId() && !wasListMode) {
			this.render();
			return;
		}
		this.sessions.activate(id);
		this.render();
		this._onDidChangeActiveSession.fire(id);
	}

	/** Public: the Sessions panel changed the store (archive, delete); reconcile the chrome. */
	afterExternalMutation(): void {
		this.mutate(() => { });
	}

	/** Public: confirm-and-delete, shared with the Sessions panel. Resolves whether it happened. */
	async deleteSessionWithConfirm(id: string): Promise<boolean> {
		const before = this.sessions.listAll().length;
		await this.deleteSession(id);
		return this.sessions.listAll().length < before;
	}

	/**
	 * Applies a mutation that MAY drop the active conversation (close, archive, delete): the store
	 * reactivates another one, and only then is a reload worth announcing.
	 */
	private mutate(fn: (sessions: OpenideChatSessions) => void): void {
		const previous = this.sessions.activeSessionId();
		fn(this.sessions);
		const next = this.sessions.ensureActive();
		this.render();
		if (next !== previous) {
			this._onDidChangeActiveSession.fire(next);
		}
	}
}
