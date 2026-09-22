/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IDialogService, IFileDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { IOpenideNativeServices } from '../../../common/openideNativeServices.js';
import { IOpenideCodexGoalResult } from '../../../../../../platform/openideAgentHost/common/openideCodexGoal.js';
import { $, addDisposableListener, append, clearNode, getWindow } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { TerminalLocation } from '../../../../../../platform/terminal/common/terminal.js';
import { ITerminalInstance, ITerminalService } from '../../../../terminal/browser/terminal.js';
import { buildOpenideCliLaunch, getOpenideCli, IOpenideCliDefinition, IOpenideCliRuntimeState, OpenideCliSessionEvent, OpenideCliSessionStatus, reduceOpenideCliRuntime, OPENIDE_CLI_INITIAL_STATE, OPENIDE_HOSTED_CLI_ENV_RESET } from '../../../common/openideAgentCliCatalog.js';
import { appendOpenideCliDraft, buildOpenideCliPaste, canPasteOpenideCliDraft, OPENIDE_CLI_TEXT_ATTACHMENT_LIMIT } from '../../../common/openideCliComposer.js';
import { t } from '../../../common/openideStrings.js';
import { OPENIDE_CLI_HOOK_OWNER } from '../../../common/openideCliHookOwner.js';
import { buildSnippetContext, IComposerSnippet, snippetRange } from '../../../common/chat/openideChatSnippet.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideCliChangesService, OpenideCliChangesService } from '../../openideCliChangesService.js';
import { IOpenideIdeServerService, OpenideIdeServerService } from '../../openideIdeServerService.js';
import { IChatSessionMeta } from '../../openideChatSessions.js';
import '../media/openideChatCli.css';

/**
 * The live xterm of an external agent session, hosted INSIDE the chat dock.
 *
 * VS Code's own chat never does this: its agent-host sessions speak a protocol with the CLI and
 * render the native transcript; its `chatTerminalCommandMirror` uses a DETACHED xterm, which has
 * no process. Orca and OpenChamber host the real TUI, which is what the product wants, so this
 * takes the two-step route the fork already uses for the skills CLI (openideSkillInstallerEditor):
 * a real `ITerminalInstance` created `hideFromUser` (a PTY with no tab in the panel) and then
 * `attachToElement` on a container the dock owns. Switching tabs detaches and re-attaches the
 * SAME instance — the PTY never dies (Orca's pane reparenting, `pane-lifecycle.ts`).
 *
 * Status is derived here through typed hooks or a structured control connection. Output and
 * silence never prove that a CLI is waiting for user input.
 */

interface IHostedTerminal {
	readonly sessionId: string;
	readonly cli: IOpenideCliDefinition;
	readonly instance: ITerminalInstance;
	readonly store: DisposableStore;
	readonly launchedAt: number;
	structuredGoal?: boolean;
	runtime: IOpenideCliRuntimeState;
	/** True once a native hook reported for this session. */
	hooked: boolean;
	exited: boolean;
	/** The user has typed into this TUI recently. */
	typing?: boolean;
	typingTimer?: ReturnType<typeof setTimeout>;
	pasting?: boolean;
	/** Keep the provider session identity when a resume fails instead of silently starting over. */
	resumeFailed?: boolean;
}

export interface IOpenideCliStatusChange {
	readonly sessionId: string;
	readonly status: OpenideCliSessionStatus;
}

/**
 * How soon after launch a non-zero exit counts as "the resume never happened".
 *
 * Long enough for a slow CLI bootstrap, short enough that a session the user actually worked in
 * and then quit is never mistaken for a failed launch and restarted underneath them.
 */
const RESUME_FAILURE_WINDOW_MS = 8_000;

/** How long after the last keystroke the user still counts as typing. */
const TYPING_IDLE_MS = 1_600;

export class OpenideChatAgentTerminalPane extends Disposable {

	readonly domNode: HTMLElement;

	private readonly _opening = new Map<string, { cancelled: boolean; promise?: Promise<void> }>();
	private _disposed = false;
	private readonly _terminals = new Map<string, IHostedTerminal>();
	private _shown: string | undefined;
	private integrationLabel: HTMLElement | undefined;
	private discoveryLabel: HTMLElement | undefined;
	private statusLabel: HTMLElement | undefined;
	private provenanceLabel: HTMLElement | undefined;
	private terminalHost: HTMLElement | undefined;
	private draftInput: HTMLTextAreaElement | undefined;
	private pasteButton: HTMLButtonElement | undefined;
	private composerError: HTMLElement | undefined;
	private readonly drafts = new Map<string, string>();
	private readonly _viewStore = this._register(new DisposableStore());
	private _dimension: { readonly width: number; readonly height: number } | undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<IOpenideCliStatusChange>());
	readonly onDidChangeStatus: Event<IOpenideCliStatusChange> = this._onDidChangeStatus.event;

	private readonly _onDidChangeTyping = this._register(new Emitter<{ readonly sessionId: string; readonly typing: boolean }>());
	/**
	 * The user is typing into this agent's TUI.
	 *
	 * Separate from the status because it is about the HUMAN, not the agent: a status of
	 * `needs-input` says the agent is waiting, and this says whether anybody is answering it. A
	 * surface that shows only the first cannot tell "abandoned" from "being answered right now".
	 */
	readonly onDidChangeTyping: Event<{ readonly sessionId: string; readonly typing: boolean }> = this._onDidChangeTyping.event;

	private readonly _onDidResolveProviderSession = this._register(new Emitter<{ readonly sessionId: string; readonly providerSessionId: string }>());
	readonly onDidResolveProviderSession = this._onDidResolveProviderSession.event;

	private readonly _onDidChangeGoalSupport = this._register(new Emitter<{ sessionId: string; supported: boolean; reason?: string }>());
	readonly onDidChangeGoalSupport = this._onDidChangeGoalSupport.event;
	private readonly _onDidInterruptGoal = this._register(new Emitter<{ sessionId: string; reason: string }>());
	readonly onDidInterruptGoal = this._onDidInterruptGoal.event;
	supportsGoal(sessionId: string): boolean { return this._terminals.get(sessionId)?.structuredGoal === true; }
	async runGoalTurn(sessionId: string, runId: string, prompt: string, token: CancellationToken): Promise<IOpenideCodexGoalResult> {
		if (!this.supportsGoal(sessionId)) { throw new Error('Codex structured goal control is not connected.'); }
		if (token.isCancellationRequested) { return { report: '', stop: true }; }
		const cancellation = token.onCancellationRequested(() => { void this.native.host.codexGoalInterrupt(sessionId, runId); });
		try { return await this.native.host.codexGoalRun(sessionId, runId, prompt); } finally { cancellation.dispose(); }
	}
	private readonly _onDidRequestRelaunch = this._register(new Emitter<string>());
	/** The user asked to reopen an exited session (Enter / the button on the exit banner). */
	readonly onDidRequestRelaunch: Event<string> = this._onDidRequestRelaunch.event;

	constructor(
		parent: HTMLElement,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IOpenideCliChangesService private readonly cliChanges: OpenideCliChangesService,
		@IFileService private readonly fileService: IFileService,
		@IOpenideNativeServices private readonly native: IOpenideNativeServices,
		@IDialogService private readonly dialogs: IDialogService,
		@IOpenideIdeServerService private readonly ideServer: OpenideIdeServerService,
		@IFileDialogService private readonly fileDialogs: IFileDialogService,
	) {
		super();
		this.domNode = append(parent, $('.openide-chat-agent-terminal.openide-cli-workspace.hidden'));
		this._register(this.native.host.onDidChangeCodexGoal(event => {
			const hosted = this._terminals.get(event.sessionId); if (!hosted?.structuredGoal) { return; }
			if (event.kind === 'activity') {
				this._apply(hosted, event.status === 'in-progress' ? { type: 'hook:prompt' } : event.status === 'needs-input' ? { type: 'hook:notification', reason: event.waitingReason }
					: { type: 'hook:stop', failed: event.status === 'failed' }, 'control');
			} else if (event.kind === 'approval') {
				this._apply(hosted, { type: 'hook:notification', reason: 'permission' }, 'control');
				void this.dialogs.confirm({ message: t('codexGoal.approval'), detail: `${event.title}\n\n${event.detail}`, primaryButton: t('codexGoal.approve') }).then(async result => {
					await this.native.host.codexGoalRespond(event.sessionId, event.approvalId, result.confirmed);
					this._apply(hosted, { type: 'hook:tool-complete' }, 'control');
				}).catch(() => {});
			} else {
				if (event.kind === 'disconnected') { hosted.structuredGoal = false; this._apply(hosted, { type: 'connection:lost' }); this._onDidChangeGoalSupport.fire({ sessionId: event.sessionId, supported: false, reason: event.reason }); }
				this._onDidInterruptGoal.fire({ sessionId: event.sessionId, reason: event.reason });
			}
		}));
		this._register(this.ideServer.onDidChangeIntegration(() => this.renderIntegrationStatus()));
		this._register(toDisposable(() => {
			this._disposed = true;
			for (const id of this._opening.keys()) { this.close(id); }
			for (const hosted of this._terminals.values()) {
				this._disposeHosted(hosted);
			}
			this._terminals.clear();
		}));
	}

	has(sessionId: string): boolean {
		return this._terminals.has(sessionId) || this._opening.get(sessionId)?.cancelled === false;
	}

	statusOf(sessionId: string): OpenideCliSessionStatus | undefined {
		return this._terminals.get(sessionId)?.runtime.status;
	}

	runtimeOf(sessionId: string): IOpenideCliRuntimeState | undefined { return this._terminals.get(sessionId)?.runtime; }

	/**
	 * Creates the PTY for a CLI session if it does not exist yet, and shows it. Resolves the
	 * executable through the agent service (login-shell PATH) so a `claude` installed by npm in
	 * `~/.npm-global/bin` is found even though the IDE's own PATH may not include it.
	 */
	open(session: IChatSessionMeta): Promise<void> {
		if (this._disposed) { return Promise.resolve(); }
		const pending = this._opening.get(session.id);
		if (pending) { return pending.promise!; }
		const state: { cancelled: boolean; promise?: Promise<void> } = { cancelled: false };
		this._opening.set(session.id, state);
		state.promise = this._open(session, state).catch(error => {
			if (state.cancelled || this._disposed) { return; }
			this._onDidChangeStatus.fire({ sessionId: session.id, status: 'failed' });
			if (this._shown === session.id) {
				this._renderBanner(t('openide.cli.launchFailed', getOpenideCli(session.cliId)?.name ?? session.title, error instanceof Error ? error.message : String(error)), true);
			}
			throw error;
		}).finally(() => { if (this._opening.get(session.id) === state) { this._opening.delete(session.id); } });
		return state.promise;
	}

	private async _open(session: IChatSessionMeta, state: { cancelled: boolean }): Promise<void> {
		const targetWindowId = getWindow(this.domNode).vscodeWindowId;
		const existing = this._terminals.get(session.id);
		if (existing) {
			this.show(session.id);
			return;
		}
		const cli = getOpenideCli(session.cliId);
		if (!cli) {
			return;
		}
		this.show(session.id);
		this._renderBanner(t('sessions.cli.launching', cli.name));
		const executable = await this.agentService.resolveExecutable(cli.binary);
		if (state.cancelled || this._disposed || this._terminals.has(session.id)) {
			return; // a concurrent open won
		}
		if (!executable) {
			if (this._shown === session.id) { this._renderBanner(t('sessions.cli.notFound', cli.binary), true); }
			this._onDidChangeStatus.fire({ sessionId: session.id, status: 'failed' });
			return;
		}
		// OpenIDE's own tools reach the CLI as a normal MCP server, injected for THIS launch only.
		// Anthropic's extension keeps serving the standard IDE tools; this adds what only OpenIDE
		// has (browser, diagrams, project map) without either side fighting over the other.
		const mcpEndpoint = await this.ideServer.mcpEndpointFor(session.id, cli, executable, session.cwd, targetWindowId);
		if (state.cancelled || this._disposed) { return; }
		let launch = buildOpenideCliLaunch(cli, executable, session.providerSessionId, mcpEndpoint);
		let structuredGoal = false;
		let goalSupportReason: string | undefined;
		if (cli.id === 'codex' && this.native.available && session.cwd) {
			try {
				const configuration = mcpEndpoint && cli.mcpInjection ? cli.mcpInjection(mcpEndpoint) : { args: [], env: {} };
				const connection = await this.native.host.codexGoalPrepare({ sessionId: session.id, executable, cwd: session.cwd, configurationArgs: configuration.args, env: { ...this.ideServer.launchEnvironment(), ...configuration.env }, providerSessionId: session.providerSessionId });
				if (state.cancelled || this._disposed) { await this.native.host.codexGoalDispose(session.id); return; }
				launch = { ...launch, args: ['resume', connection.threadId, '--remote', connection.endpoint] };
				structuredGoal = true;
				this._onDidResolveProviderSession.fire({ sessionId: session.id, providerSessionId: connection.threadId });
			} catch (error) {
				goalSupportReason = error instanceof Error ? error.message : 'Structured Codex control unavailable.';
				this._onDidChangeGoalSupport.fire({ sessionId: session.id, supported: false, reason: goalSupportReason });
			}
		}
		if (state.cancelled || this._disposed) { return; }
		try {
			await this.cliChanges.prepareSession({ id: session.id, cliId: cli.id, cwd: session.cwd ?? '', title: session.title });
			if (state.cancelled || this._disposed) { if (structuredGoal) { await this.native.host.codexGoalDispose(session.id); } return; }
			const instance = await this.terminalService.createTerminal({
				cwd: session.cwd,
				location: TerminalLocation.Panel,
				config: {
					name: t('sessions.cli.title', cli.name),
					executable: launch.executable,
					args: launch.args,
					cwd: session.cwd,
					hideFromUser: true,
					isFeatureTerminal: true,
					// The reset goes FIRST: it clears the session marks a `claude` that started the IDE
					// would otherwise pass down (see OPENIDE_HOSTED_CLI_ENV_RESET), and everything
					// OpenIDE sets on purpose is layered on top of it.
					// CLAUDE_CODE_SSE_PORT is what makes the CLI adopt THIS window instead of picking
					// whichever lockfile in ~/.claude/ide happens to match its cwd — with two OpenIDE
					// windows on the same repo, the wrong one is a coin flip. Empty when the IDE
					// server is off or has no folder to publish, which simply means no IDE tools.
					env: { ...OPENIDE_HOSTED_CLI_ENV_RESET, OPENIDE_SESSION_ID: session.id, OPENIDE_HOOK_OWNER: OPENIDE_CLI_HOOK_OWNER, ...this.ideServer.launchEnvironment(), ...launch.env },
				},
			});
			if (state.cancelled || this._disposed) { instance.dispose(); if (structuredGoal) { await this.native.host.codexGoalDispose(session.id); } return; }
			const store = new DisposableStore();
			const hosted: IHostedTerminal = { sessionId: session.id, cli, instance, store, launchedAt: Date.now(), runtime: OPENIDE_CLI_INITIAL_STATE, hooked: false, exited: false, structuredGoal };
			this._terminals.set(session.id, hosted);
			this._onDidChangeGoalSupport.fire({ sessionId: session.id, supported: structuredGoal, reason: goalSupportReason });
			this._onDidChangeStatus.fire({ sessionId: session.id, status: 'unknown' });

			// PTY bytes are deliberately not a turn signal. Prompt repaints and long-running
			// silent tools must never move the conversation into a fabricated waiting state.
			// Keystrokes the user sends INTO the TUI. It decays on its own: nothing tells us when
			// somebody stopped typing, so a flag that only ever turned on would stick forever.
			store.add(instance.onDidInputData(() => {
				this.ideServer.setSessionWindowId(session.id, getWindow(this.domNode).vscodeWindowId);
				if (!hosted.typing) {
					hosted.typing = true;
					this._onDidChangeTyping.fire({ sessionId: session.id, typing: true });
				}
				if (hosted.typingTimer) {
					clearTimeout(hosted.typingTimer);
				}
				hosted.typingTimer = setTimeout(() => {
					hosted.typingTimer = undefined;
					hosted.typing = false;
					this._onDidChangeTyping.fire({ sessionId: session.id, typing: false });
				}, TYPING_IDLE_MS);
			}));
			store.add(instance.onExit(exit => {
				hosted.exited = true;
				this.cliChanges.noteExited(session.id);
				const code = typeof exit === 'number' ? exit : exit?.code;
				// A failed resume may indicate another active writer. Preserve the provider id and
				// offer an explicit retry; a fresh launch here would silently lose conversation continuity.
				hosted.resumeFailed = !!session.providerSessionId && code !== 0 && Date.now() - hosted.launchedAt < RESUME_FAILURE_WINDOW_MS;
				this._apply(hosted, { type: 'exit', code });
				if (this._shown === session.id) {
					this._renderExit(hosted, code);
				}
			}));
			// Resume IDs come from an owned hook or control connection. The newest transcript
			// in a shared cwd/day may belong to another live CLI and must never be adopted.
			if (this._shown === session.id) {
				this._attach(hosted);
			}
		} catch (error) { if (structuredGoal) { await this.native.host.codexGoalDispose(session.id); } throw error; }
	}

	/** Makes `sessionId` the visible terminal (attaching it) and hides the rest. */
	show(sessionId: string): void {
		if (this._shown === sessionId && this._terminals.get(sessionId)) {
			return;
		}
		this._detachShown();
		this._shown = sessionId;
		this.domNode.classList.remove('hidden');
		const hosted = this._terminals.get(sessionId);
		if (hosted) {
			if (hosted.exited) {
				this._renderExit(hosted, undefined);
			} else {
				this._attach(hosted);
			}
		}
	}

	hide(): void {
		this._detachShown();
		this._shown = undefined;
		this.domNode.classList.add('hidden');
	}

	get visible(): boolean {
		return this._shown !== undefined;
	}

	/** Drops the PTY of a session that was closed or deleted. */
	close(sessionId: string): void {
		const pending = this._opening.get(sessionId);
		if (pending) { pending.cancelled = true; void this.native.host.codexGoalDispose(sessionId); }
		const hosted = this._terminals.get(sessionId);
		if (!hosted) {
			return;
		}
		if (this._shown === sessionId) {
			this.hide();
		}
		this._terminals.delete(sessionId);
		this._disposeHosted(hosted);
	}

	/** Relaunch after exit: forgets the dead instance so `open` creates a fresh one. */
	forget(sessionId: string): void {
		const hosted = this._terminals.get(sessionId);
		if (!hosted) {
			return;
		}
		this._terminals.delete(sessionId);
		this._disposeHosted(hosted);
	}

	/** An owned native hook reported a turn event for this session. */
	applyHookEvent(sessionId: string, event: OpenideCliSessionEvent): void {
		const hosted = this._terminals.get(sessionId);
		if (!hosted) {
			return;
		}
		hosted.hooked = true;
		this._apply(hosted, event);
	}

	/** Moves the existing PTY presentation. Reattachment lets xterm adopt the target window. */
	moveTo(parent: HTMLElement, focus = true): void {
		if (this.domNode.parentElement === parent) { return; }
		const hosted = this._shown ? this._terminals.get(this._shown) : undefined;
		if (hosted && !hosted.exited) { hosted.instance.detachFromElement(); }
		parent.appendChild(this.domNode);
		if (hosted && !hosted.exited) { this._attach(hosted, focus); }
	}

	layout(width: number, height: number): void {
		this._dimension = { width, height };
		this.domNode.style.height = `${height}px`;
		this.layoutTerminal();
	}

	focus(): void {
		const hosted = this._shown ? this._terminals.get(this._shown) : undefined;
		hosted?.instance.focus(true);
	}

	private _attach(hosted: IHostedTerminal, focus = true): void {
		this._viewStore.clear();
		clearNode(this.domNode);
		const details = append(this.domNode, $<HTMLDetailsElement>('details.openide-cli-tools'));
		const summary = append(details, $('summary', { 'aria-label': t('cli.tools.help') }));
		this.statusLabel = append(summary, $('span.openide-cli-status', { role: 'status', 'aria-live': 'polite' }));
		this.integrationLabel = append(summary, $('span'));
		this.provenanceLabel = append(details, $('p'));
		this.discoveryLabel = append(details, $('p'));
		append(details, $('p', undefined, t('cli.integration.capabilities')));
		append(details, $('p', undefined, t('cli.tools.guidance')));
		this.renderIntegrationStatus();
		this.terminalHost = append(this.domNode, $('.openide-chat-agent-terminal-host'));
		hosted.instance.attachToElement(this.terminalHost);
		hosted.instance.setVisible(true);
		this.renderComposer(hosted);
		const observer = new (getWindow(this.domNode).ResizeObserver)(() => this.layoutTerminal());
		this._viewStore.add(toDisposable(() => observer.disconnect()));
		observer.observe(this.terminalHost);
		this.layoutTerminal();
		if (focus) {
			if (this.drafts.get(hosted.sessionId)) { this.draftInput?.focus(); }
			else { hosted.instance.focus(true); }
		}
	}

	private layoutTerminal(): void {
		const hosted = this._shown ? this._terminals.get(this._shown) : undefined;
		if (!hosted || hosted.exited || !this.terminalHost) { return; }
		const width = this.terminalHost.clientWidth || this._dimension?.width || 0;
		const height = this.terminalHost.clientHeight;
		if (width > 0 && height > 0) { hosted.instance.layout({ width, height }); }
	}

	private renderComposer(hosted: IHostedTerminal): void {
		const composer = append(this.domNode, $('.openide-cli-composer'));
		append(composer, $('span.openide-cli-composer-route', undefined, t('cli.composer.route', hosted.cli.name)));
		const input = this.draftInput = append(composer, $<HTMLTextAreaElement>('textarea', { rows: 2, placeholder: t('cli.composer.placeholder'), 'aria-label': t('cli.composer.route', hosted.cli.name) }));
		input.value = this.drafts.get(hosted.sessionId) ?? '';
		const actions = append(composer, $('.openide-cli-composer-actions'));
		const attach = append(actions, $<HTMLButtonElement>('button.oi-btn', { type: 'button', 'aria-label': t('cli.composer.attachTitle') }, t('cli.composer.attach')));
		this.pasteButton = append(actions, $<HTMLButtonElement>('button.oi-btn.primary', { type: 'button' }, t('cli.composer.paste', hosted.cli.name)));
		this.pasteButton.disabled = !input.value.trim();
		append(composer, $('span.openide-cli-composer-hint', undefined, t('cli.composer.hint')));
		this.composerError = append(composer, $('span.openide-cli-composer-error', { role: 'status' }));
		this._viewStore.add(addDisposableListener(input, 'input', () => {
			this.drafts.set(hosted.sessionId, input.value);
			if (this.pasteButton) { this.pasteButton.disabled = !input.value.trim(); }
		}));
		this._viewStore.add(addDisposableListener(this.pasteButton, 'click', () => void this.pasteDraft(hosted)));
		this._viewStore.add(addDisposableListener(attach, 'click', () => void this.attachTextFile(hosted.sessionId)));
		this._viewStore.add(addDisposableListener(input, 'keydown', event => {
			// Plain Enter is always a newline. A shortcut only pastes, just like the labeled button.
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
				event.preventDefault();
				void this.pasteDraft(hosted);
			}
		}));
	}

	/** Routes review comments and selected editor code to the exact conversation draft. */
	stagePrompt(sessionId: string, text: string): boolean {
		const hosted = this._terminals.get(sessionId);
		if (hosted?.exited || !hosted && this._opening.get(sessionId)?.cancelled !== false) { return false; }
		this.drafts.set(sessionId, appendOpenideCliDraft(this.drafts.get(sessionId) ?? '', text));
		if (this._shown !== sessionId) { this.show(sessionId); }
		this.refreshDraft(sessionId);
		this.draftInput?.focus();
		return true;
	}

	private refreshDraft(sessionId: string): void {
		if (this._shown !== sessionId || !this.draftInput) { return; }
		this.draftInput.value = this.drafts.get(sessionId) ?? '';
		if (this.pasteButton) { this.pasteButton.disabled = !this.draftInput.value.trim(); }
	}

	private async pasteDraft(hosted: IHostedTerminal): Promise<void> {
		if (hosted.exited || this._terminals.get(hosted.sessionId) !== hosted || hosted.pasting) { return; }
		const draft = this.drafts.get(hosted.sessionId) ?? '';
		if (!draft.trim()) { return; }
		if (!canPasteOpenideCliDraft(draft, hosted.instance.xterm?.raw.modes.bracketedPasteMode === true)) {
			if (this._shown === hosted.sessionId && this.composerError) { this.composerError.textContent = t('cli.composer.pasteUnsupported'); }
			return;
		}
		hosted.pasting = true;
		if (this._shown === hosted.sessionId && this.pasteButton) { this.pasteButton.disabled = true; this.pasteButton.textContent = t('cli.composer.pasting'); }
		try {
			await hosted.instance.sendText(buildOpenideCliPaste(draft), false, true);
			if (this._terminals.get(hosted.sessionId) !== hosted || hosted.exited) { return; }
			if (this.drafts.get(hosted.sessionId) === draft) { this.drafts.delete(hosted.sessionId); }
			if (this._shown === hosted.sessionId) { hosted.instance.focus(true); if (this.composerError) { this.composerError.textContent = ''; } }
		} catch {
			if (this._shown === hosted.sessionId && this.composerError) { this.composerError.textContent = t('cli.composer.pasteFailed'); }
		} finally {
			hosted.pasting = false;
			if (this._shown === hosted.sessionId && this.pasteButton) { this.pasteButton.textContent = t('cli.composer.paste', hosted.cli.name); }
			this.refreshDraft(hosted.sessionId);
		}
	}

	private async attachTextFile(sessionId: string): Promise<void> {
		try {
			const files = await this.fileDialogs.showOpenDialog({ title: t('cli.composer.attachTitle'), canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
			if (!files?.[0]) { return; }
			const file = files[0];
			const stat = await this.fileService.stat(file);
			if (stat.size > OPENIDE_CLI_TEXT_ATTACHMENT_LIMIT) { throw new Error(t('cli.composer.fileTooLarge')); }
			const content = await this.fileService.readFile(file, { limits: { size: OPENIDE_CLI_TEXT_ATTACHMENT_LIMIT } });
			const text = content.value.toString();
			if (text.includes('\0') || text.includes('\uFFFD')) { throw new Error(t('cli.composer.binaryFile')); }
			const snippet = { path: file.path, uri: file.toString(), startLine: 1, endLine: text.split('\n').length, text };
			const block = buildSnippetContext([snippet]);
			if (!block || !this._terminals.has(sessionId)) { return; }
			this.drafts.set(sessionId, appendOpenideCliDraft(this.drafts.get(sessionId) ?? '', block));
			this.refreshDraft(sessionId);
		} catch (error) {
			if (this._shown === sessionId && this.composerError) { this.composerError.textContent = error instanceof Error ? error.message : t('cli.composer.fileFailed'); }
		}
	}

	private renderIntegrationStatus(): void {
		if (!this._shown || !this.integrationLabel) { return; }
		const state = this.ideServer.integrationState(this._shown);
		this.integrationLabel.textContent = t(`cli.tools.${state}`);
		const discovery = this.ideServer.discoveryStatus;
		const hosted = this._terminals.get(this._shown);
		if (hosted && this.statusLabel) {
			const { status, waitingReason, source } = hosted.runtime;
			this.statusLabel.dataset.status = status;
			this.statusLabel.textContent = status === 'needs-input' ? t(`cli.integration.${waitingReason ?? 'prompt'}`)
				: t(`cli.integration.${status === 'in-progress' ? 'working' : status}`);
			if (this.provenanceLabel) {
				this.provenanceLabel.textContent = source === 'hooks' ? t('cli.integration.hooks') : source === 'control' ? t('cli.integration.control')
					: t(hosted.cli.supportsHooks ? 'cli.integration.hooksPending' : 'cli.integration.unverified');
			}
		}
		if (this.discoveryLabel) {
			this.discoveryLabel.textContent = discovery.toolsListedAt ? t('cli.tools.windowListed', discovery.toolCount)
				: discovery.initializedAt ? t('cli.tools.windowInitialized') : '';
		}
	}

	private _detachShown(): void {
		const hosted = this._shown ? this._terminals.get(this._shown) : undefined;
		if (hosted && !hosted.exited) {
			hosted.instance.setVisible(false);
			hosted.instance.detachFromElement();
		}
		clearNode(this.domNode);
		this._viewStore.clear();
		this.integrationLabel = undefined;
		this.discoveryLabel = undefined;
		this.statusLabel = undefined;
		this.provenanceLabel = undefined;
		this.terminalHost = undefined;
		this.draftInput = undefined;
		this.pasteButton = undefined;
		this.composerError = undefined;
	}

	/** Stages the editor selection for review; the explicit paste action hands it to the CLI. */
	sendSnippet(sessionId: string, snippet: IComposerSnippet): boolean {
		const block = buildSnippetContext([snippet]) ?? `${snippet.path}:${snippetRange(snippet)}`;
		return this.stagePrompt(sessionId, block);
	}

	/** Whether turn boundaries are observed through a hook or the structured control connection. */
	isHooked(sessionId: string): boolean {
		const hosted = this._terminals.get(sessionId);
		return hosted?.hooked === true || hosted?.runtime.source === 'control';
	}

	private _renderBanner(message: string, error = false): void {
		this._viewStore.clear();
		clearNode(this.domNode);
		const banner = append(this.domNode, $('.openide-chat-agent-terminal-banner'));
		banner.classList.toggle('error', error);
		banner.textContent = message;
	}

	private _renderExit(hosted: IHostedTerminal, code: number | undefined): void {
		this._viewStore.clear();
		hosted.instance.detachFromElement();
		clearNode(this.domNode);
		const banner = append(this.domNode, $('.openide-chat-agent-terminal-banner'));
		append(banner, $('span', undefined, hosted.resumeFailed ? t('cli.integration.resumeFailed', hosted.cli.name) : t('sessions.cli.exited', hosted.cli.name, code ?? '?')));
		const button = append(banner, $<HTMLButtonElement>('button.openide-chat-agent-terminal-relaunch.oi-btn.primary', { type: 'button' }, t('sessions.cli.relaunch')));
		this._viewStore.add(addDisposableListener(button, 'click', () => this._onDidRequestRelaunch.fire(hosted.sessionId)));
		button.focus();
	}

	private _apply(hosted: IHostedTerminal, event: OpenideCliSessionEvent, source: 'hooks' | 'control' = 'hooks'): void {
		if (this._terminals.get(hosted.sessionId) !== hosted) { return; }
		const next = reduceOpenideCliRuntime(hosted.runtime, event, source);
		if (next === hosted.runtime) { return; }
		const previous = hosted.runtime;
		hosted.runtime = next;
		if (next.status !== previous.status) { this._onDidChangeStatus.fire({ sessionId: hosted.sessionId, status: next.status }); }
		if (this._shown === hosted.sessionId) { this.renderIntegrationStatus(); }
	}

	private _disposeHosted(hosted: IHostedTerminal): void {
		if (hosted.structuredGoal) { hosted.structuredGoal = false; void this.native.host.codexGoalDispose(hosted.sessionId); this._onDidChangeGoalSupport.fire({ sessionId: hosted.sessionId, supported: false }); }
		if (hosted.typingTimer) { clearTimeout(hosted.typingTimer); }
		hosted.store.dispose();
		hosted.instance.detachFromElement();
		hosted.instance.dispose();
		this.cliChanges.noteExited(hosted.sessionId);
	}
}
