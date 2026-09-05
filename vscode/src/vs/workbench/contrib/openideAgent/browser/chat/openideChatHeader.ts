/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, getTotalHeight, getWindow } from '../../../../../base/browser/dom.js';
import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IChatSessionMeta, OpenideChatSessions } from '../openideChatSessions.js';
import { OpenideChatKebabMenu } from './openideChatKebabMenu.js';
import { OpenideChatSessionKindChoice, OpenideChatSessionKindPicker, OpenideCliAvailability } from './openideChatSessionKindPicker.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { createProviderIcon } from '../openideProviderIcons.js';
import { getOpenideCli, OPENIDE_CLI_CATALOG, OpenideCliId } from '../../common/openideAgentCliCatalog.js';
import './media/openideChatHeader.css';
import { onDidChangeOpenideLanguage, t } from '../../common/openideStrings.js';
import { setupChatTooltip } from './openideChatHover.js';

/**
 * The dock's header: ONE 32px row, Cursor's chat chrome economy on VS Code's anatomy.
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

/**
 * The toolbar folded away, per profile. It is a layout preference about a strip the user looks at
 * all day, so it outlives the window the way the sessions panel's own state does.
 */
const OPTIONS_COLLAPSED_KEY = 'openide.chat.header.optionsCollapsed';
/**
 * ONE chevron that turns, not two that swap: the tree's twistie is a single glyph with a
 * `transform: rotate()` (tree.css), which is what lets the direction change ride the same
 * transition as the fold instead of popping halfway through it.
 */
const COLLAPSE_ICON = 'chevron-right';
/** paneview.css's own duration for a fold. Matched so the dock folds like every pane in the IDE. */
const COLLAPSE_ANIMATION_MS = 150;

/** The project's other view: the same index drawn as an architecture diagram. */

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
	/** `+ ▾`, ▣, ⚙ and ⋯: everything the collapse toggle folds away. */
	private readonly _options: HTMLElement;
	/** The grid that animates the fold; `_options` is the flex row of buttons inside it. */
	private readonly _optionsWrap: HTMLElement;
	private readonly _collapseToggle: HTMLButtonElement;
	private _optionsCollapsed: boolean;
	private _optionsPreference: boolean | undefined;
	private _animationTimer: number | undefined;

	/** Cleared and refilled on every repaint: the view tabs are rebuilt, never patched. */
	private readonly _tabStore = this._register(new DisposableStore());
	private _listMode = false;
	private _probedAvailability = false;
	/** The conversation being dragged along the strip, while a drag is in flight. */
	private _dragTabId: string | undefined;

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
		@IStorageService private readonly storageService: IStorageService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();

		this._element = append(parent, $('div.openide-chat-headbar'));
		const strip = append(this._element, $('div.openide-chat-header'));
		this._tabs = append(strip, $('div.openide-chat-tabs', { role: 'tablist' }));
		this.installStripScrolling();
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

		// `‹ | + ▾`, ▣, ⚙, ⋯ | ⛶, ✕ — upstream's ChatViewTitle order, separator before the window
		// pair, and the collapse toggle in front of the cluster it folds.
		//
		// The cluster is 187px of fixed width. A dock at its default 290px therefore leaves the tab
		// strip ~90px, which clips a SINGLE conversation's title mid-word and pushes its close box
		// off the row — the strip that is supposed to answer "which conversation" cannot. Folding
		// the cluster is what upstream does with a toolbar that outgrows its bar (the `⋯` overflow
		// of an action bar), with an automatic initial fold in narrow docks. An explicit user choice
		// takes precedence over that responsive default.
		this._optionsPreference = this.storageService.getBoolean(OPTIONS_COLLAPSED_KEY, StorageScope.PROFILE);
		this._optionsCollapsed = this._optionsPreference ?? false;
		this._collapseToggle = this.createHeadButton(actions, COLLAPSE_ICON, () => t(this._optionsCollapsed ? 'chat.header.showOptions' : 'chat.header.hideOptions'), () => {
			this.setOptionsCollapsed(!this._optionsCollapsed);
		});
		this._collapseToggle.classList.add('openide-chat-head-collapse');
		this._optionsWrap = append(actions, $('div.openide-chat-head-options-wrap'));
		this._options = append(this._optionsWrap, $('div.openide-chat-head-options'));
		this.createSplitNew(this._options);
		this._sessionsToggle = this.createHeadButton(this._options, SESSIONS_ICON_CLOSED, () => t('chat.header.sessions'), () => this._onDidRequestToggleSessions.fire());
		this.createHeadButton(this._options, 'settings-gear', () => t('chat.header.settings'), () => {
			void this.commandService.executeCommand(SETTINGS_COMMAND, SETTINGS_QUERY);
		});
		this._kebabButton = this.createHeadButton(this._options, 'toolbar-more', () => t('chat.header.more'), () => {
			this._kindPicker.close();
			this._kebabMenu.toggle(this._element, this._kebabButton);
		});
		append(actions, $('span.openide-chat-head-sep'));
		this.createHeadButton(actions, 'screen-full', () => t('chat.header.maximize'), () => {
			void this.commandService.executeCommand(MAXIMIZE_COMMAND);
		});
		this.createHeadButton(actions, 'close', () => t('chat.header.close'), () => {
			void this.commandService.executeCommand(CLOSE_COMMAND);
		});

		this.applyOptionsCollapsed();
		// The fold is a 150ms grid transition, so the strip only reaches its new width when it ends:
		// measured at the click, the tabs would be laid out for the row the toolbar just left.
		this._register(addDisposableListener(this._optionsWrap, 'transitionend', () => this.layoutStrip()));

		this._register(onDidChangeOpenideLanguage(() => {
			// Nothing to retranslate by hand any more: every tip is a factory over `t()`, and the
			// hover reads it when it is shown. This only has to repaint what is ALREADY on screen —
			// the accessible names (`setupChatTooltip` listens for the same event) and the tabs.
			this.applyOptionsCollapsed();
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
		const open = this.sessions.openTabs();
		for (const session of open) {
			append(this._tabs, this.createTab(session, session.id === activeId));
		}
		// ONE conversation is not a strip, it is the dock's title: it takes the whole row up to the
		// toolbar, so a long title reads instead of ellipsising into a 160px stub with empty space
		// beside it. From two on it is a strip again — capped width, natural order, scrolling —
		// because there the widths have to be comparable for the row to say which is which.
		this._tabs.classList.toggle('single', open.length === 1);
		this.layoutStrip();
		this.probeAvailability();
	}

	/**
	 * The two things that depend on the strip's WIDTH rather than on its contents: where it is
	 * scrolled, and which edge is hiding a tab. Every repaint and every resize goes through here.
	 *
	 * How wide each tab ends up is the stylesheet's business alone, and it is one rule: the tabs
	 * SHARE the row — growing into whatever is free, shrinking together when there is not enough —
	 * down to a floor, and past the floor the strip scrolls. That is the whole answer to the case
	 * the header was never laid out for, MORE THAN ONE conversation: it holds with the toolbar
	 * folded, where the strip has the row, and unfolded, where it has the ~75px the cluster leaves.
	 */
	private layoutStrip(): void {
		// Until the user chooses a toolbar state, reserve enough room to identify a
		// conversation in the default narrow dock. Resizing never overwrites that choice.
		const width = this._element.clientWidth;
		if (this._optionsPreference === undefined && width > 0) {
			const collapsed = width < 440;
			if (collapsed !== this._optionsCollapsed) {
				this._optionsCollapsed = collapsed;
				this._kebabMenu.close();
				this._kindPicker.close();
				this.applyOptionsCollapsed();
				return;
			}
		}
		this.revealActiveTab();
		this.updateOverflowAffordance();
	}

	/**
	 * The strip's overflow, done the way the editor's is. Upstream wraps its tabs in a
	 * `ScrollableElement`, which turns a vertical wheel into a horizontal scroll and paints a
	 * scrollbar; ours is a plain overflow box whose scrollbar is hidden by design, so both halves
	 * have to be added by hand — otherwise a tab that falls off the row is unreachable AND
	 * unannounced, which is what happens as soon as there is more than one conversation.
	 */
	private installStripScrolling(): void {
		this._register(addDisposableListener(this._tabs, 'wheel', (event: WheelEvent) => {
			if (this._tabs.scrollWidth <= this._tabs.clientWidth) { return; }
			const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (!delta) { return; }
			event.preventDefault();
			// A wheel that reports LINES (deltaMode 1, some mice and most of X11) sends units of
			// rows, not pixels: scrolled raw it moves the strip by three pixels per notch.
			this._tabs.scrollLeft += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * 16 : delta;
		}, { passive: false }));
		this._register(addDisposableListener(this._tabs, 'scroll', () => this.updateOverflowAffordance()));
	}

	/**
	 * Fades the edge that still has a tab behind it. With the scrollbar hidden, this is the only
	 * thing that says the strip continues — the editor's own strip says it with its scrollbar and
	 * its overflow chevrons, and a strip that says nothing reads as "these are all the
	 * conversations you have open".
	 */
	private updateOverflowAffordance(): void {
		const max = this._tabs.scrollWidth - this._tabs.clientWidth;
		this._tabs.classList.toggle('overflow-start', this._tabs.scrollLeft > 1);
		this._tabs.classList.toggle('overflow-end', this._tabs.scrollLeft < max - 1);
	}

	/**
	 * Scrolls the strip so the conversation you are IN is on screen.
	 *
	 * The strip overflows by scrolling (tabs keep their natural width; letting flex shrink them
	 * collapses every title at once), and nothing was ever scrolling it: with the dock at its
	 * default width and two conversations open, switching to the second one left the strip showing
	 * the FIRST — the one control whose job is to say which conversation you are in was pointing at
	 * a different one. Every tab strip in the workbench reveals its active tab on layout
	 * (`multiEditorTabsControl.ts`'s `layoutTabs`); this is the same contract, done by hand because
	 * `scrollIntoView` would also scroll our ancestors.
	 */
	private revealActiveTab(): void {
		const tab = this._tabs.querySelector<HTMLElement>('.openide-chat-tab.active');
		if (tab) { this.revealTab(tab); }
	}

	/** The same scroll for any tab: the active one on layout, the focused one on ←/→. */
	private revealTab(tab: HTMLElement): void {
		// Zero width means the dock is not laid out yet (a hidden pane, or the first render before
		// the split view inserts it). `layout()` comes back for it.
		if (!this._tabs.clientWidth) { return; }
		const left = tab.offsetLeft;
		const right = left + tab.offsetWidth;
		// A tab wider than the strip cannot be revealed whole, and then its LEFT edge is the half
		// worth showing: the mark and the beginning of the title identify it, its tail does not.
		if (left < this._tabs.scrollLeft || tab.offsetWidth >= this._tabs.clientWidth) {
			this._tabs.scrollLeft = left;
		} else if (right > this._tabs.scrollLeft + this._tabs.clientWidth) {
			this._tabs.scrollLeft = right - this._tabs.clientWidth;
		}
		this.updateOverflowAffordance();
	}

	/** The dock resized (or the toolbar folded): the widths, the scroll and the fades are all stale. */
	layout(): void {
		this.layoutStrip();
	}

	override dispose(): void {
		if (typeof this._animationTimer === 'number') {
			getWindow(this._element).clearTimeout(this._animationTimer);
			this._animationTimer = undefined;
		}
		super.dispose();
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
			: $('span.openide-chat-tab-icon.openide-chat-conversation-icon', { 'aria-hidden': 'true' });
	}

	private createTab(session: IChatSessionMeta, active: boolean): HTMLElement {
		const tab = $('button.openide-chat-tab', { type: 'button', role: 'tab' });
		tab.classList.toggle('active', active);
		tab.classList.toggle('unread', !!session.unread);
		tab.setAttribute('aria-selected', String(active));
		// A tablist is ONE stop in the tab order and ←/→ walk it (`aria-practices`, and what every
		// strip in the workbench does): with a button per conversation left focusable, Tab had to be
		// pressed once per open conversation just to get past the header.
		tab.tabIndex = active ? 0 : -1;
		tab.draggable = true;
		const title = session.kind !== 'cli' && session.empty ? t('chat.header.newTitle') : session.title || t('chat.header.newTitle');
		tab.setAttribute('aria-label', title);
		// The strip ellipsises, so the whole "agent · conversation" is what the hover is FOR. It goes
		// in `_tabStore` and not `_register`: the tabs are rebuilt on every repaint, and a hover per
		// repaint parked on the header's own store would never be released.
		this._tabStore.add(setupChatTooltip(this.hoverService, tab, () => `${this.agentLabel(session)} · ${title}`, { position: HoverPosition.BELOW }));

		append(tab, this.createTabIcon(session, this._tabs.ownerDocument));
		if (session.status === 'needs-input' || session.status === 'in-progress') {
			append(tab, $(`span.openide-chat-tab-dot.${session.status}`));
		}
		append(tab, $('span.openide-chat-tab-title', undefined, title));

		const close = append(tab, $<HTMLButtonElement>('span.openide-chat-tab-close', { role: 'button' }));
		this._tabStore.add(setupChatTooltip(this.hoverService, close, () => t('chat.header.closeTab'), { position: HoverPosition.BELOW }));
		// The hover fires on `mouseover`, which BUBBLES: without this the tab's own tooltip would win
		// over the close box's, because the tab's listener runs after the box's own. The native title
		// attribute resolved this by itself (the innermost one wins); a listener has to be told.
		this._tabStore.add(addDisposableListener(close, 'mouseover', event => event.stopPropagation()));
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
		this._tabStore.add(addDisposableListener(tab, 'keydown', (event: KeyboardEvent) => {
			const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
			if (!step) { return; }
			event.preventDefault();
			const all = Array.from(this._tabs.querySelectorAll<HTMLElement>('.openide-chat-tab'));
			const next = all[(all.indexOf(tab) + step + all.length) % all.length];
			if (!next) { return; }
			// Focus moves, the conversation does not: activating is Enter/Space, so walking the strip
			// with the keyboard never tears down a run the way switching would.
			next.tabIndex = 0;
			next.focus();
			this.revealTab(next);
		}));
		this.installTabDragAndDrop(tab, session.id, title);
		return tab;
	}

	/**
	 * Drag to reorder, the strip's missing half. `OpenideChatSessions.reorderTab` and the drop
	 * feedback in the stylesheet (`.dragging`, `.drop-target-left/right`) were both already here and
	 * tested; nothing ever started a drag, so the order of the tabs was whatever the order of
	 * creation had been. The halves-of-the-tab contract is the editor strip's:
	 * `multiEditorTabsControl.ts` drops BEFORE the tab the pointer is on the left of, and after it
	 * otherwise.
	 */
	private installTabDragAndDrop(tab: HTMLElement, id: string, title: string): void {
		this._tabStore.add(addDisposableListener(tab, 'dragstart', (event: DragEvent) => {
			this._dragTabId = id;
			tab.classList.add('dragging');
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
				// Chromium cancels a drag whose DataTransfer carries nothing.
				event.dataTransfer.setData('text/plain', title);
			}
		}));
		this._tabStore.add(addDisposableListener(tab, 'dragend', () => {
			this._dragTabId = undefined;
			tab.classList.remove('dragging');
			this.clearDropFeedback();
		}));
		this._tabStore.add(addDisposableListener(tab, 'dragover', (event: DragEvent) => {
			// Anything that is not one of OUR tabs (a file onto the composer, an editor onto the
			// dock) is left alone: no `preventDefault`, so the drop goes wherever it was headed.
			if (!this._dragTabId || this._dragTabId === id) { return; }
			event.preventDefault();
			if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
			const after = this.dropsAfter(tab, event);
			this.clearDropFeedback();
			tab.classList.toggle('drop-target-left', !after);
			tab.classList.toggle('drop-target-right', after);
		}));
		this._tabStore.add(addDisposableListener(tab, 'dragleave', () => {
			tab.classList.remove('drop-target-left', 'drop-target-right');
		}));
		this._tabStore.add(addDisposableListener(tab, 'drop', (event: DragEvent) => {
			const dragged = this._dragTabId;
			this.clearDropFeedback();
			if (!dragged || dragged === id) { return; }
			event.preventDefault();
			this._dragTabId = undefined;
			this.sessions.reorderTab(dragged, id, this.dropsAfter(tab, event));
			this.render();
		}));
	}

	/** Which side of the tab the pointer is on — the drop lands after it from the midpoint on. */
	private dropsAfter(tab: HTMLElement, event: DragEvent): boolean {
		const rect = tab.getBoundingClientRect();
		return event.clientX > rect.left + rect.width / 2;
	}

	private clearDropFeedback(): void {
		for (const other of this._tabs.querySelectorAll('.openide-chat-tab')) {
			other.classList.remove('drop-target-left', 'drop-target-right');
		}
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
		const primary = this.createHeadButton(container, 'add', () => t('chat.header.new'), () => this.newSessionOfActiveKind());
		const chevron = this.createHeadButton(container, 'chevron-down', () => t('chat.header.newKind'), () => {
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
	 * Folds the option cluster away (or brings it back) and remembers the choice.
	 *
	 * The two popovers are anchored to buttons inside the cluster, so they close with it: a menu
	 * left hanging off a `display: none` anchor renders at the top-left of the window.
	 */
	private setOptionsCollapsed(collapsed: boolean): void {
		if (this._optionsCollapsed === collapsed) { return; }
		this._optionsPreference = collapsed;
		this._optionsCollapsed = collapsed;
		this._kebabMenu.close();
		this._kindPicker.close();
		this.storageService.store(OPTIONS_COLLAPSED_KEY, collapsed, StorageScope.PROFILE, StorageTarget.USER);
		this.animate();
		this.applyOptionsCollapsed();
	}

	/**
	 * Arms the transition for exactly one fold, `paneview.ts:672`'s contract.
	 *
	 * The transition hangs off a class the toggle adds and a timer removes, instead of living on
	 * the element for good. Two things would otherwise animate that must not: the FIRST paint,
	 * where the constructor restores a collapsed cluster and the user would watch the toolbar fold
	 * itself on every window open, and any relayout that happens to change the row's width.
	 */
	private animate(): void {
		const window = getWindow(this._element);
		if (typeof this._animationTimer === 'number') {
			window.clearTimeout(this._animationTimer);
		}
		this._element.classList.add('animated');
		this._animationTimer = window.setTimeout(() => {
			this._animationTimer = undefined;
			this._element.classList.remove('animated');
		}, COLLAPSE_ANIMATION_MS);
	}

	/** Paints the current state. Separate from the setter so the constructor can reuse it. */
	private applyOptionsCollapsed(): void {
		// `collapsed`, not `hidden`: `display: none` cannot be transitioned, and the grid it folds
		// to (0fr) is what makes the fold end at the cluster's REAL width instead of a guessed one.
		this._optionsWrap.classList.toggle('collapsed', this._optionsCollapsed);
		this._collapseToggle.classList.toggle('collapsed', this._optionsCollapsed);
		// The tip itself is a factory over the same state, so only the accessible name is repainted.
		this._collapseToggle.setAttribute('aria-label', t(this._optionsCollapsed ? 'chat.header.showOptions' : 'chat.header.hideOptions'));
		this._collapseToggle.setAttribute('aria-expanded', String(!this._optionsCollapsed));
		this.layoutStrip();
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

	/**
	 * No `title=`: the tip is the workbench's own hover, resolved from the button's accessible name
	 * when it is shown, so a language change only has to rewrite `aria-label`. The row sits under
	 * the title bar, so the widget hangs BELOW it the way the title bar's own actions do.
	 */
	private createHeadButton(parent: HTMLElement, icon: string, tooltip: () => string, onClick: () => void): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.openide-chat-head-btn', { type: 'button' }));
		this._register(setupChatTooltip(this.hoverService, button, tooltip, { position: HoverPosition.BELOW }));
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
