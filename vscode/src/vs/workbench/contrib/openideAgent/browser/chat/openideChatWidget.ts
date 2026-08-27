/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getTotalHeight, reset } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { AgentMode } from '../../common/openideAgentTypes.js';
import { onDidAcceptOpenideChatModeSuggestion } from './parts/openideChatModeSuggestionPart.js';
import { onDidRequestOpenideChatSubagentAction } from './parts/openideChatSubagentPart.js';
import { onDidRequestOpenideChatContinue, OPENIDE_CHAT_CONTINUE_PROMPT } from './parts/openideChatNoticePart.js';
import { autorun, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { ITreeRenderer } from '../../../../../base/browser/ui/tree/tree.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenideChatItem, IOpenideChatRequestItem } from '../../common/chat/openideChatItem.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { IOpenideProjectMapLearningService } from '../openideProjectMapLearningService.js';
import { IChatSessionUsage, OpenideChatSessions } from '../openideChatSessions.js';
import { IOpenideCliChangesService, OpenideCliChangesService } from '../openideCliChangesService.js';
import { applyOpenideSurfaceCss } from '../openideSurfaceStyle.js';
import { IOpenideChatNotice, OpenideChatController } from './openideChatController.js';
import { IOpenideComposerSubmit, OpenideChatComposer } from './openideChatComposer.js';
import { IOpenideChatCapabilityCounts, OPENIDE_CHAT_EMPTY_CAPABILITIES } from '../../common/chat/openideChatContextBreakdown.js';
import { buildOpenideChatSlashSuggestions, IOpenideChatSuggestSources } from '../../common/chat/openideChatSlashCommands.js';
import {
	OPENIDE_CHAT_AUTO_SCROLL_KEY, OPENIDE_CHAT_CLAMP_LINES_KEY, OPENIDE_CHAT_DENSITY_KEY, OPENIDE_CHAT_FONT_SIZE_KEY,
	resolveChatAutoScroll, resolveChatClampLines, resolveChatDensity, resolveChatFontSize,
} from '../../common/chat/openideChatConfig.js';
import { getIconClasses } from '../../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { FileKind } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { OpenideChatHeader } from './openideChatHeader.js';
import { OpenideChatListWidget } from './openideChatListWidget.js';
import { OpenideChatRequestRenderer } from './openideChatRequestRenderer.js';
import { OpenideChatResponseRenderer } from './openideChatResponseRenderer.js';
import { OPENIDE_CHAT_TRANSCRIPT_COPIED, OPENIDE_CHAT_TRANSCRIPT_EMPTY, openideChatTranscriptToMarkdown } from './openideChatTranscriptExport.js';
import { creditOpenideChatFileOutcome } from './parts/openideChatEditLearning.js';
import { OpenideChatFilesTray } from './parts/openideChatFilesTray.js';
import { OpenideChatAgentTerminalPane } from './parts/openideChatAgentTerminalPane.js';
import { OpenideChatSessionsPane } from './openideChatSessionsPane.js';
import { OpenideChatSessionKindChoice } from './openideChatSessionKindPicker.js';
import { OpenideClaudeHooks } from '../openideAgentCliHooks.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { t } from '../../common/openideStrings.js';
import { OpenideChatTerminalsTray } from './parts/openideChatTerminalsTray.js';
import './media/openideChatNative.css';
import './media/openideChatRequest.css';

/**
 * Same sentence the webview shows when the turn has no `messageId` yet (openideChatHtml.ts:2728):
 * the transaction is keyed by that id, so with no id there is nothing to revert — and staying
 * silent would read as a dead button.
 */
const ROLLBACK_UNREGISTERED = 'Todavía no se puede volver a este mensaje: el turno no llegó a registrarse.';

/**
 * Root of the native chat: a virtualized transcript with a composer under it.
 *
 * It owns the layout contract and nothing else — the events come from `OpenideChatController`,
 * the rows from the two renderers, the DOM of a row from the content parts. Keeping the widget
 * this thin is what lets Stage 3 add fifteen parts without touching this file.
 *
 * The composer's height is read through an observable rather than pushed as an event on purpose:
 * a height change re-layouts the LIST only. Re-entering the full `layout()` from there would lay
 * the composer out again, which can change its height again, which is the layout loop that the
 * plan's exit criterion 3 is about.
 */
/** The Sessions column beside the transcript (upstream's side-by-side AgentSessionsControl). */
const SESSIONS_SIDE_WIDTH = 300;

export class OpenideChatWidget extends Disposable {

	private readonly _root: HTMLElement;
	private readonly _listHost: HTMLElement;
	private readonly _notice: HTMLElement;

	private readonly _header: OpenideChatHeader;
	private readonly _list: OpenideChatListWidget;
	private readonly _filesTray: OpenideChatFilesTray;
	private readonly _terminalsTray: OpenideChatTerminalsTray;
	private readonly _composer: OpenideChatComposer;
	private readonly _terminalPane: OpenideChatAgentTerminalPane;
	private readonly _sessionsPane: OpenideChatSessionsPane;
	private readonly _hooks: OpenideClaudeHooks;
	private _cliActive = false;
	/** No conversation on screen: the Sessions panel is the body (upstream's stacked control). */
	private _listMode = false;
	private _capabilityCounts: IOpenideChatCapabilityCounts = OPENIDE_CHAT_EMPTY_CAPABILITIES;
	private readonly _controller: OpenideChatController;

	/** Handed to every content part so a reflowing part reacts to a resize without being rebuilt. */
	private readonly _currentWidth: ISettableObservable<number>;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());

	private _dimension: { readonly height: number; readonly width: number } | undefined;

	get domNode(): HTMLElement { return this._root; }

	get controller(): OpenideChatController { return this._controller; }

	constructor(
		parent: HTMLElement,
		private readonly sessions: OpenideChatSessions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenideCliChangesService private readonly _cliChanges: OpenideCliChangesService,
		@IOpenideProjectMapLearningService private readonly learningService: IOpenideProjectMapLearningService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
	) {
		super();

		// The `--oi-*` tokens the stylesheet is written against live in a TypeScript string that
		// the webviews inline; on native DOM somebody has to install it, and it is idempotent.
		applyOpenideSurfaceCss();

		this._currentWidth = observableValue<number>('openideChatWidth', 0);

		// `show-file-icons` is the per-container opt-in the file icon theme CSS is gated on
		// (fileIconThemeData.ts:261): without it every `getIconClasses` span renders an empty box.
		// Copilot's chat does the same on each of its surfaces (chatAttachmentWidgets.ts:133).
		this._root = append(parent, $('.openide-chat-native.show-file-icons'));
		// Vertical order is the webview's: session strip, transcript, composer. Building the header
		// first is what puts it there — everything below appends after it.
		this._header = this._register(instantiationService.createInstance(OpenideChatHeader, this._root, sessions));
		this._listHost = append(this._root, $('.openide-chat-list-host'));

		const responseRenderer = this._register(instantiationService.createInstance(
			OpenideChatResponseRenderer, this._currentWidth, this._onDidChangeVisibility.event,
		));
		const requestRenderer = this._register(new OpenideChatRequestRenderer({
			rollbackTo: element => this._rollbackTo(element),
			clampLines: () => resolveChatClampLines(this.configurationService.getValue(OPENIDE_CHAT_CLAMP_LINES_KEY)),
		}));
		const renderers: ITreeRenderer<IOpenideChatItem, FuzzyScore, unknown>[] = [
			requestRenderer,
			responseRenderer,
		];

		this._list = this._register(instantiationService.createInstance(OpenideChatListWidget, this._listHost, { renderers }));
		// The live terminal of an external agent session takes the transcript's place (and the
		// composer's: the TUI has its own prompt) while such a session is the active tab.
		this._terminalPane = this._register(instantiationService.createInstance(OpenideChatAgentTerminalPane, this._root));
		this._notice = append(this._root, $('.openide-chat-notice.hidden'));
		// Between the transcript and the composer, which is where the webview's dock puts it: the
		// pending changes are the thing you decide on BEFORE writing the next message.
		// Composer first: the tray mounts inside it, so its host has to exist already. Mounting the
		// tray on the root instead left it outside the dock, whose fade gradient then painted over it.
		this._composer = this._register(instantiationService.createInstance(OpenideChatComposer, this._root, this._suggestSources()));
		this._filesTray = this._register(instantiationService.createInstance(OpenideChatFilesTray, this._composer.trayHost));
		// Stacked UNDER the changed files, which is the webview's order too (openideChatHtml.ts's
		// #filesStack appends `terms` after `files`): the files are a decision waiting for the user,
		// the terminals are just running — the thing to act on sits closest to the composer.
		this._terminalsTray = this._register(instantiationService.createInstance(OpenideChatTerminalsTray, this._composer.trayHost));
		this._controller = this._register(instantiationService.createInstance(OpenideChatController, sessions));
		// Appended LAST: it overlays everything under the header, so it must paint on top.
		this._sessionsPane = this._register(instantiationService.createInstance(OpenideChatSessionsPane, this._root, sessions, (id: string) => this._header.deleteSessionWithConfirm(id)));
		this._hooks = this._register(instantiationService.createInstance(OpenideClaudeHooks));
		this._wireSessions();

		this._register(responseRenderer.onDidChangeItemHeight(event => this._list.updateItemHeight(event.element, event.height)));
		this._register(requestRenderer.onDidChangeItemHeight(event => this._list.updateItemHeight(event.element, event.height)));
		this._register(this._controller.onDidChangeItems(() => this._list.setItems(this._controller.items)));
		// Both trays live INSIDE the composer's dock, so their height is the composer's height: they
		// ask it to re-measure and the autorun below re-lays out the list. Laying out the list here
		// instead would run it against a `composer.height` that has not seen the tray yet.
		this._register(this._filesTray.onDidChangeHeight(() => this._composer.remeasure()));
		this._register(this._terminalsTray.onDidChangeHeight(() => this._composer.remeasure()));
		this._register(this._filesTray.onDidRequestStop(() => this._controller.abort()));
		this._register(this._filesTray.onDidResolveFiles(resolved => {
			// Accepting or reverting is the strongest signal the project map gets about whether the
			// entities it surfaced were the right ones; the webview host credits it the same way
			// (openideChatView.ts:1017-1035) and dropping it here would silently degrade retrieval.
			const messageIds = creditOpenideChatFileOutcome(this.sessions, this._controller.activeConversationId, resolved.paths);
			if (messageIds.length) {
				this.learningService.recordOutcome(messageIds, resolved.signal);
			}
		}));
		this._register(this._controller.onDidChangeBusy(busy => {
			this._composer.setBusy(busy);
			this._filesTray.setBusy(busy);
			// `autoScroll: always` re-arms the tail on every turn boundary: the user who scrolled up
			// to re-read still lands on the fresh reply the moment the run settles.
			if (!busy && resolveChatAutoScroll(this.configurationService.getValue(OPENIDE_CHAT_AUTO_SCROLL_KEY)) === 'always') {
				this._list.setFollowTail(true);
				this._list.scrollToEnd();
			}
			// The store derives a conversation's title from its first turn when it saves it, which
			// happens on both edges of a run; repainting on every streamed delta instead would rebuild
			// the whole tab strip per token.
			this._header.render();
		}));
		this._register(this._header.onDidChangeActiveSession(id => this._switchSession(id)));
		this._register(this._header.onDidRequestExportTranscript(() => void this._exportTranscript()));
		this._register(this._controller.onDidPublishNotice(notice => this._showNotice(notice)));
		this._register(this._controller.onDidChangeSessions(() => this._header.render()));
		// The other half of accepting a mode suggestion: the part unblocked the run, the controller
		// re-runs the request in the new mode. `fork` is the widget's own — it owns the header.
		this._register(onDidAcceptOpenideChatModeSuggestion(accepted => {
			if (accepted.mode === 'fork') {
				this._controller.resumeInMode('fork', undefined);
				this.forkActiveSession();
				return;
			}
			this._controller.resumeInMode(accepted.mode, accepted.prompt);
		}));
		this._register(this._controller.onDidResumeInMode(mode => this._composer.setMode(mode)));
		this._register(onDidRequestOpenideChatSubagentAction(({ runId, action }) => {
			if (action === 'cancel') {
				this.agentService.cancelSubagent(runId);
				return;
			}
			const sessionId = this._controller.subagentSessionOf(runId);
			if (sessionId) {
				this.sessions.activate(sessionId);
				this._header.render();
				this._switchSession(sessionId);
			}
		}));
		this._register(onDidRequestOpenideChatContinue(() => {
			if (this._controller.isBusy) { return; }
			this._composer.value = OPENIDE_CHAT_CONTINUE_PROMPT;
			this._composer.submit();
		}));
		this._register(this._composer.onDidSubmit(request => this._send(request)));
		this._register(this._composer.onDidRequestStop(() => this._controller.abort()));
		this._register(this._composer.onDidRequestCompact(() => this.compact()));
		this._register(this._composer.onDidReject(message => this._showNotice({ severity: 'info', message })));
		this._register(this._composer.onDidFailVoice(message => this._showNotice({ severity: 'warning', message })));
		this._register(this._controller.onDidChangeUsage(usage => this._composer.setUsage(usage, this._capabilityCounts)));

		this._register(autorun(reader => {
			this._composer.height.read(reader);
			this._layoutList();
		}));

		this._applyAppearance();
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(OPENIDE_CHAT_FONT_SIZE_KEY) || event.affectsConfiguration(OPENIDE_CHAT_DENSITY_KEY)) {
				this._applyAppearance();
				// Row heights change with both knobs; the rows re-measure themselves as they repaint.
				this._list.rerenderAll();
			}
		}));

		this._restoreTranscript();
	}

	/** Transcript font size and density, both live: they only touch a CSS variable and a class. */
	private _applyAppearance(): void {
		const fontSize = resolveChatFontSize(this.configurationService.getValue(OPENIDE_CHAT_FONT_SIZE_KEY));
		this._root.style.setProperty('--openide-chat-font-size', `${fontSize}px`);
		this._root.classList.toggle('density-compact', resolveChatDensity(this.configurationService.getValue(OPENIDE_CHAT_DENSITY_KEY)) === 'compact');
	}

	/**
	 * Opens (or closes) the session-info popover — what `openide.agent.showContext` and the status
	 * bar's token count both route through.
	 *
	 * There used to be a SECOND surface here: a "Uso de contexto" card that opened over the
	 * composer and said the same thing in its own layout, with its own arithmetic and its own copy
	 * of the segment list. It is gone. Two panels for one number meant every change had to be made
	 * twice and they drifted apart anyway.
	 *
	 * The capability counts are re-read on every open rather than cached for the session: an MCP
	 * server can connect or drop, and a skill can be written, while the chat stays open — a stale
	 * "MCP · 0" next to a segment with tokens in it is worse than a moment's delay.
	 */
	showContextPanel(): void {
		this._composer.setUsage(this._controller.usage, this._capabilityCounts);
		this._composer.toggleSessionInfo();
		void this._refreshCapabilityCounts();
	}

	/** "New chat": a new conversation tab, activated. The header owns the tab strip, so it goes first. */
	newSession(): void {
		this._header.newSession();
	}

	/** Fork of the active conversation: an independent branch with the inherited context. */
	forkActiveSession(): void {
		const active = this.sessions.activeSessionId();
		if (active) {
			this._header.forkSession(active);
		}
	}

	/** A Canvas choice: lands in the composer and waits for the user. Never sends on its own. */
	injectCanvasChoice(label: string): void {
		this._composer.value = label;
		this._composer.focus();
	}

	/** A Canvas button's prompt: fills the composer and, unless told otherwise, sends it. */
	injectCanvasPrompt(prompt: string, send: boolean): void {
		this._composer.value = prompt;
		this._composer.focus();
		if (send) {
			this._composer.submit();
		}
	}

	/** Manual `/compact`, from the composer or a command. */
	compact(): void {
		this._hideNotice();
		void this._controller.compact();
	}

	get onDidFinishRun(): Event<{ readonly hadError: boolean }> {
		return this._controller.onDidFinishRun;
	}

	get onDidChangeUsage(): Event<IChatSessionUsage> {
		return this._controller.onDidChangeUsage;
	}

	get usage(): IChatSessionUsage {
		return this._controller.usage;
	}

	private async _refreshCapabilityCounts(): Promise<void> {
		try {
			const capabilities = await this.agentService.listComposerCapabilities();
			this._capabilityCounts = {
				tools: capabilities.filter(capability => capability.kind === 'tool').length,
				mcp: capabilities.filter(capability => capability.kind === 'mcp').length,
				skills: capabilities.filter(capability => capability.kind === 'skill').length,
			};
		} catch {
			// A registry that failed to answer leaves the previous counts standing. The webview host
			// zeroed them instead (openideChatView.ts:1833), which reads as "nothing is loaded" —
			// a statement, and the wrong one.
		}
		// Unconditionally: the counts feed the popover's breakdown, and it reads them when it opens.
		// This used to sit inside `if (panel.isOpen)`, so the footer's ring kept whatever counts it
		// had from before an MCP server connected.
		this._composer.setUsage(this._controller.usage, this._capabilityCounts);
	}

	/**
	 * The header already persisted the switch; what is left is the part it cannot see. The run in
	 * flight belongs to the conversation being left, so it is cancelled before the transcript is
	 * replaced — a late delta would otherwise stream into the reply of a different conversation.
	 * The composer is cleared for the same reason a half-typed message does not follow a tab switch.
	 */
	private _switchSession(id: string): void {
		this._leaveListMode();
		this._controller.abort();
		this._hideNotice();
		this._composer.value = '';
		this._restoreTranscript(id);
	}

	// ---- Sessions panel + external agents (VS Code Agent Sessions, Orca's hosted TUIs)

	private _wireSessions(): void {
		this._register(this._header.onDidRequestToggleSessions(() => {
			if (this._listMode) { return; } // the list IS the body; nothing to toggle
			this._sessionsPane.toggle();
		}));
		this._register(this._header.onDidChooseNewKind(choice => this._newSessionOfKind(choice)));
		this._register(this._sessionsPane.onDidChangeOpen(() => {
			this._layoutList();
			this._header.setSessionsOpen(this._sessionsPane.isOpen);
		}));
		this._register(this._sessionsPane.onDidOpenSession(id => {
			const wasListMode = this._listMode;
			this._header.switchSession(id);
			if (wasListMode && id === this.sessions.activeSessionId()) {
				// Same session as before the list: no active-session event fired, leave by hand.
				this._leaveListMode();
			}
			// Stacked over the transcript, the panel would hide what was just opened.
			if (this._sessionsPane.mode === 'stacked') {
				this._sessionsPane.setOpen(false);
			}
			this._sessionsPane.render();
		}));
		this._register(this._sessionsPane.onDidRequestCloseSession(id => {
			this.sessions.closeTab(id);
			this._header.afterExternalMutation();
			this._reconcileTerminals();
			this._sessionsPane.render();
		}));
		this._register(this._sessionsPane.onDidMutate(() => {
			this._header.afterExternalMutation();
			this._reconcileTerminals();
		}));
		this._register(this._header.onDidChangeActiveSession(() => this._reconcileTerminals()));
		this._register(this._header.onDidCloseTab(() => this._reconcileTerminals()));
		// Nothing to show yet: open on the sessions overview, as VS Code does.
		if (!this.sessions.activeSessionId()) {
			this._enterListMode();
		}
		this._register(this._terminalPane.onDidChangeStatus(({ sessionId, status }) => {
			// The Changes view reads the SAME transition the status dot does, so the two can never
			// disagree about whether the agent is working — which is what makes a turn's file list
			// line up with the turn the user watched happen.
			const meta = this.sessions.metaOf(sessionId);
			if (meta?.kind === 'cli' && meta.cliId && meta.cwd) {
				this._cliChanges.noteStatus(
					{ id: sessionId, cliId: meta.cliId, cwd: meta.cwd, title: meta.title },
					status,
					this._terminalPane.isHooked(sessionId),
				);
			}
			if (this.sessions.setStatus(sessionId, status)) {
				this._header.render();
				this._sessionsPane.render();
			}
		}));
		this._register(this._terminalPane.onDidChangeTyping(({ sessionId, typing }) => this._cliChanges.noteTyping(sessionId, typing)));
		this._register(this._terminalPane.onDidResolveProviderSession(({ sessionId, providerSessionId }) => this.sessions.setProviderSession(sessionId, providerSessionId)));
		this._register(this._terminalPane.onDidRequestRelaunch(sessionId => {
			this._terminalPane.forget(sessionId);
			const meta = this.sessions.metaOf(sessionId);
			if (meta) {
				void this._terminalPane.open(meta);
			}
		}));
		this._register(this._hooks.onDidInstall(() => this.notificationService.info(t('sessions.cli.hooksInstalled'))));
		this._register(this._hooks.onDidReceive(payload => {
			// Match by the CLI's own session id when we already know it, else by cwd — and learn
			// the id on the way, which is what `--resume` needs later.
			const cwd = payload.cwd.replace(/\/+$/, '');
			// Any Claude session of the store, hosted or not: a payload that lands before the PTY
			// is registered (or after a reload) still carries the id `--resume` will need.
			const claude = this.sessions.listAll().filter(session => session.kind === 'cli' && session.cliId === 'claude');
			// Learning the id matches by cwd alone (a session that has never carried one, newest
			// first) so a reopened session recovers its `--resume` id; driving the live status also
			// needs a hosted PTY.
			const known = claude.find(session => session.providerSessionId === payload.sessionId);
			const target = known ?? claude.filter(session => !session.providerSessionId && (session.cwd ?? '').replace(/\/+$/, '') === cwd).sort((a, b) => b.updatedAt - a.updatedAt)[0];
			if (!target) {
				return;
			}
			if (!target.providerSessionId) {
				this.sessions.setProviderSession(target.id, payload.sessionId);
				this._header.render();
			}
			if (this._terminalPane.has(target.id)) {
				this._terminalPane.applyHookEvent(target.id, payload.event);
			}
		}));
	}

	/** The list becomes the body: transcript (or terminal) out, panel in full mode. */
	private _enterListMode(): void {
		if (this._listMode) { return; }
		this._listMode = true;
		this._header.setListMode(true);
		this._terminalPane.hide();
		this._cliActive = false;
		this._root.classList.remove('openide-chat-cli-active');
		// The transcript host stays in flow (the panel paints over it): removing it would let the
		// dock float up to the header instead of staying at the bottom.
		this._root.classList.add('openide-chat-list-mode');
		this._sessionsPane.setFull(true);
		this._sessionsPane.render();
		this._layoutList();
	}

	private _leaveListMode(): void {
		if (!this._listMode) { return; }
		this._listMode = false;
		this._header.setListMode(false);
		this._sessionsPane.setFull(false);
		this._root.classList.remove('openide-chat-list-mode');
		if (this._sessionsPane.mode === 'stacked') {
			this._sessionsPane.setOpen(false);
		}
		this._layoutList();
	}

	private _newSessionOfKind(choice: OpenideChatSessionKindChoice): void {
		this._leaveListMode();
		// Stacked over the transcript, the panel would cover the session it just created.
		if (this._sessionsPane.isOpen && this._sessionsPane.mode === 'stacked') {
			this._sessionsPane.setOpen(false);
		}
		if (choice.kind === 'native') {
			this._header.newSession();
			return;
		}
		const folder = this.contextService.getWorkspace().folders[0];
		const cwd = folder?.uri.scheme === 'file' ? folder.uri.fsPath : undefined;
		// "Claude Code · dnmusic": the folder is what tells two sessions of the same agent apart.
		const folderName = folder?.name ? ` · ${folder.name}` : '';
		const id = this.sessions.createCli(choice.cli.id, `${choice.cli.name}${folderName}`, cwd);
		this._header.switchSession(id);
		this._switchSession(id);
	}

	/** Terminals whose tab was closed (or session deleted) release their PTY. */
	private _reconcileTerminals(): void {
		const open = new Set(this.sessions.openTabs().map(session => session.id));
		for (const session of this.sessions.listAll()) {
			if (!open.has(session.id) && this._terminalPane.has(session.id)) {
				this._terminalPane.close(session.id);
			}
		}
	}

	/** Flips the dock between transcript+composer and the hosted terminal for the active tab. */
	private _syncCliMode(id: string | undefined): void {
		const meta = this.sessions.metaOf(id);
		const cli = meta?.kind === 'cli';
		this._cliActive = cli;
		this._root.classList.toggle('openide-chat-cli-active', cli);
		if (cli && meta) {
			if (meta.cliId === 'claude') {
				void this._hooks.ensure();
			}
			void this._terminalPane.open(meta);
		} else {
			this._terminalPane.hide();
		}
		this._layoutList();
	}

	/**
	 * Loads a conversation and lands on its LAST turn, like the webview's `restoreThread` ending in
	 * `scrollDown()`.
	 *
	 * Re-arming the tail is the load-bearing part, not the `scrollToEnd` call: rows are measured
	 * asynchronously, so the position right after `setItems` is provisional and only the tail lock
	 * keeps re-pinning the list as each row reports its real height. If the user had scrolled up in
	 * the conversation being left, the lock would still be off and the new one would open somewhere
	 * in the middle of its own history.
	 */
	private _restoreTranscript(id?: string): void {
		this._syncCliMode(id ?? this.sessions.activeSessionId());
		this._list.setFollowTail(true);
		this._controller.restore(id);
		// The queue of messages typed while a run was busy is per conversation: the composer swaps
		// it together with the transcript.
		this._composer.setConversation(this._controller.activeConversationId);
		// So does the context: `usage` is per conversation (`usageOf(activeId)`), but nothing pushed
		// it on a switch — the ring kept showing the PREVIOUS conversation's percentage until that
		// one's next turn produced a `usage` event, which on an idle conversation is never.
		this._composer.setUsage(this._controller.usage, this._capabilityCounts);
		this._list.scrollToEnd();
	}

	/**
	 * What the composer's `@` and `/` menus query. Built here and not inside the composer so the
	 * composer never touches `OpenideAgentCommands` or the file icon theme — the widget already
	 * has both, and the menus stay unit-testable against a stub.
	 */
	private _suggestSources(): IOpenideChatSuggestSources {
		return {
			queryFiles: async query => {
				const paths = await this.agentService.searchWorkspaceFiles(query).catch(() => [] as string[]);
				return paths.map(path => ({
					path,
					iconClasses: getIconClasses(this.modelService, this.languageService, URI.file('/' + path), FileKind.FILE).join(' '),
				}));
			},
			queryCommands: async query => {
				const [commands, capabilities] = await Promise.all([
					this._controller.commands.scan().catch(() => []),
					this.agentService.listComposerCapabilities().catch(() => []),
				]);
				return buildOpenideChatSlashSuggestions(query, commands, capabilities);
			},
		};
	}

	private async _exportTranscript(): Promise<void> {
		const markdown = openideChatTranscriptToMarkdown(this.sessions.messagesOf(this.sessions.activeSessionId()));
		if (!markdown) {
			this.notificationService.info(OPENIDE_CHAT_TRANSCRIPT_EMPTY);
			return;
		}
		await this.clipboardService.writeText(markdown);
		this.notificationService.info(OPENIDE_CHAT_TRANSCRIPT_COPIED);
	}

	private _send(request: IOpenideComposerSubmit): void {
		// Typing from the sessions overview starts a fresh local conversation, like upstream.
		if (this._listMode) {
			this._header.newSession();
		}
		this._hideNotice();
		void this._controller.send({
			text: request.text,
			displayText: request.displayText,
			images: request.images.length ? request.images : undefined,
			pick: request.pick,
			capabilities: request.capabilities?.length ? request.capabilities : undefined,
			references: request.references?.length ? request.references : undefined,
			mode: request.mode,
			providerId: request.providerId,
			modelId: request.modelId,
		}).then(accepted => {
			if (!accepted) {
				// The composer clears optimistically, so a rejected turn has to be handed back whole
				// — text, attachments and the picked element — or the user silently loses it.
				this._composer.restore(request);
			}
		});
	}

	/**
	 * The rollback of a user turn: reverts that turn's file transaction, truncates the transcript
	 * from it and hands the text back to the composer so it can be edited and resent.
	 *
	 * The transaction itself is NOT reimplemented here — `OpenideChatController` runs it inside
	 * `OpenideChatRollbackBarrier`, which is what keeps a send that is already past its first await
	 * from writing over files this operation just restored. The widget only owns the three things
	 * the controller deliberately leaves to its caller: the learning signal, the composer, and
	 * saying out loud when something could not be reverted.
	 */
	private async _rollbackTo(element: IOpenideChatRequestItem): Promise<boolean> {
		const messageId = element.messageId;
		if (!messageId) {
			this._showNotice({ severity: 'info', message: ROLLBACK_UNREGISTERED });
			return false;
		}
		this._hideNotice();
		const outcome = await this._controller.rollbackToUserMessage(messageId, true);
		if (!outcome.committed) {
			this._showNotice({ severity: 'error', message: outcome.warning ?? ROLLBACK_UNREGISTERED });
			return false;
		}
		// Strong, precise negative signal: those are exactly the turns whose work the user
		// discarded, so the entities shown to the model did not help (openideChatView.ts:2019).
		if (outcome.removedMessageIds.length) {
			this.learningService.recordOutcome(outcome.removedMessageIds, 'rollback');
		}
		if (outcome.composer) {
			// The whole turn comes back, not just its text: the images and the capability chips were
			// part of what the user wrote, and a resend without them is a different message.
			this._composer.restore({
				text: outcome.composer.text,
				images: outcome.composer.images ?? [],
				capabilities: outcome.composer.capabilities ?? [],
				references: [],
				mode: (outcome.mode ?? 'agent') as AgentMode,
				providerId: outcome.providerId ?? '',
				modelId: outcome.modelId ?? '',
			});
			// The mode travels with the text: resending the turn from a different mode than the one
			// it was written in silently changes what the model is allowed to do.
			if (outcome.mode) { this._composer.setMode(outcome.mode); }
			this._composer.focus();
		}
		// A file that could not be reverted is a warning, not a failure: the transcript was still
		// truncated, and the user has to know the workspace does not fully match it.
		if (outcome.warning) {
			this._showNotice({ severity: 'warning', message: outcome.warning });
		}
		return true;
	}

	private _showNotice(notice: IOpenideChatNotice): void {
		reset(this._notice, notice.message);
		this._notice.classList.remove('hidden');
		this._notice.classList.toggle('openide-chat-notice-error', notice.severity === 'error');
		this._notice.classList.toggle('openide-chat-notice-warning', notice.severity === 'warning');
		// A notice sits between the transcript and the composer, so it changes the list's height.
		this._layoutList();
	}

	private _hideNotice(): void {
		if (this._notice.classList.contains('hidden')) {
			return;
		}
		this._notice.classList.add('hidden');
		this._layoutList();
	}

	/**
	 * Splits the pane between transcript and composer. The composer and the notice strip are
	 * measured, never assumed: the textarea grows with the text and the strip appears and goes.
	 */
	private _layoutList(): void {
		if (!this._dimension) {
			return; // the autorun runs once at construction, before the view pane has a size
		}
		const { height, width } = this._dimension;
		// A layout at width 0 is not merely useless, it is DESTRUCTIVE, and it is the reason a
		// restored conversation used to open blank.
		//
		// `PaneView.addPane` lays every pane out once while the container is still detached, and it
		// passes width 0. The list runs with `supportDynamicHeights`, so that layout re-probes every
		// rendered row — at width 0 each one measures 0, and the view stores those zeros as the item
		// sizes. `contentHeight` collapses to 0, so no row is rendered any more, so nothing is left
		// to re-measure: the transcript is dead with its items still in the tree and no error
		// anywhere. It reproduced on every single window open (`setItems n=8 content=672`, then
		// `layout w=0` → `content=0`).
		//
		// The pane lays out again with real dimensions the moment it is attached, and that layout is
		// the one that was always the meaningful one.
		if (width <= 0 || !this._root.isConnected) {
			return;
		}
		// Measured rather than derived from the root's own box: the list host is the element being
		// sized here, so reading it back to decide its size is circular. The header is measured too
		// and not assumed to be 35px, because the workbench can scale the font it is laid out in.
		// The trays are NOT measured here: they mount inside the composer's dock, so their height is
		// already inside `composer.height`. Adding them again is what used to leave a gap the size
		// of the changed-files tray under the transcript.
		const side = this._sessionsPane.isOpen && !this._listMode && this._sessionsPane.mode === 'side';
		this._root.classList.toggle('sessions-side', side);
		// Beside the panel the transcript, notice and composer give up its 300px column.
		const contentWidth = side ? Math.max(0, width - SESSIONS_SIDE_WIDTH) : width;
		this._composer.layout(contentWidth);
		const belowHeader = Math.max(0, height - this._header.height);
		const composerBlock = this._composer.height.get() + getTotalHeight(this._notice);
		this._sessionsPane.layout(width, this._header.height, this._listMode ? composerBlock : 0);
		if (this._cliActive && !this._listMode) {
			this._terminalPane.layout(contentWidth, belowHeader);
			return;
		}
		const listHeight = Math.max(0, belowHeader - composerBlock);
		this._listHost.style.height = `${listHeight}px`;
		if (!this._listMode) {
			this._list.layout(listHeight, contentWidth);
		}
	}

	layout(height: number, width: number): void {
		this._dimension = { height, width };
		this._root.style.height = `${height}px`;
		this._root.style.width = `${width}px`;
		this._currentWidth.set(width, undefined);
		this._layoutList();
	}

	setVisible(visible: boolean): void {
		this._list.setVisible(visible);
		this._onDidChangeVisibility.fire(visible);
		if (visible) {
			// Becoming visible is not always accompanied by a resize — reopening the auxiliary bar at
			// the same width is the common case — and any layout that ran while the pane was detached
			// was skipped by the guard above. Without this the list would keep the geometry it had
			// before it was hidden.
			this._composer.remeasure();
			this._layoutList();
		}
	}

	focus(): void {
		if (this._cliActive) {
			this._terminalPane.focus();
			return;
		}
		this._composer.focus();
	}

	get onDidChangeBusy(): Event<boolean> {
		return this._controller.onDidChangeBusy;
	}
}
