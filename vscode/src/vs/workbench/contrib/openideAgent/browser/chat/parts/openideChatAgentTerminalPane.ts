/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { TerminalLocation } from '../../../../../../platform/terminal/common/terminal.js';
import { IPathService } from '../../../../../services/path/common/pathService.js';
import { ITerminalInstance, ITerminalService } from '../../../../terminal/browser/terminal.js';
import { buildOpenideCliLaunch, getOpenideCli, IOpenideCliDefinition, OpenideCliSessionEvent, OpenideCliSessionStatus, reduceOpenideCliStatus, OPENIDE_HOSTED_CLI_ENV_RESET } from '../../../common/openideAgentCliCatalog.js';
import { t } from '../../../common/openideStrings.js';
import { buildSnippetContext, IComposerSnippet, snippetRange } from '../../../common/chat/openideChatSnippet.js';
import { IOpenideAgentService } from '../../openideAgentService.js';
import { IOpenideIdeServerService, OpenideIdeServerService } from '../../openideIdeServerService.js';
import { IChatSessionMeta } from '../../openideChatSessions.js';

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
 * Status is derived here and only here, through the pure reducer: hooks (Claude Code) win, the
 * quiet-after-output heuristic the run_command tool already uses is the fallback.
 */

interface IHostedTerminal {
	readonly sessionId: string;
	readonly cli: IOpenideCliDefinition;
	readonly instance: ITerminalInstance;
	readonly store: DisposableStore;
	readonly launchedAt: number;
	status: OpenideCliSessionStatus;
	/** True once a native hook reported for this session: the heuristic stands down. */
	hooked: boolean;
	quietTimer: ReturnType<typeof setTimeout> | undefined;
	exited: boolean;
	/** The user has typed into this TUI recently. */
	typing?: boolean;
	typingTimer?: ReturnType<typeof setTimeout>;
	/** A resume already failed for this session; the retry is fresh and happens ONCE. */
	resumeAbandoned?: boolean;
}

export interface IOpenideCliStatusChange {
	readonly sessionId: string;
	readonly status: OpenideCliSessionStatus;
}

/** Quiet-after-output window before an unhooked agent is assumed to be waiting on the user. */
const QUIET_MS = 2500;
/** How long after launch the transcript directory is polled for the CLI's own session id. */
const RESUME_ID_POLL_MS = 4000;
const RESUME_ID_POLL_LIMIT = 30;

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

	private readonly _terminals = new Map<string, IHostedTerminal>();
	private _shown: string | undefined;
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

	private readonly _onDidRequestRelaunch = this._register(new Emitter<string>());
	/** The user asked to reopen an exited session (Enter / the button on the exit banner). */
	readonly onDidRequestRelaunch: Event<string> = this._onDidRequestRelaunch.event;

	constructor(
		parent: HTMLElement,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IOpenideIdeServerService private readonly ideServer: OpenideIdeServerService,
	) {
		super();
		this.domNode = append(parent, $('.openide-chat-agent-terminal.hidden'));
		this._register(toDisposable(() => {
			for (const hosted of this._terminals.values()) {
				this._disposeHosted(hosted);
			}
			this._terminals.clear();
		}));
	}

	has(sessionId: string): boolean {
		return this._terminals.has(sessionId);
	}

	statusOf(sessionId: string): OpenideCliSessionStatus | undefined {
		return this._terminals.get(sessionId)?.status;
	}

	/**
	 * Creates the PTY for a CLI session if it does not exist yet, and shows it. Resolves the
	 * executable through the agent service (login-shell PATH) so a `claude` installed by npm in
	 * `~/.npm-global/bin` is found even though the IDE's own PATH may not include it.
	 */
	async open(session: IChatSessionMeta): Promise<void> {
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
		if (this._terminals.has(session.id)) {
			return; // a concurrent open won
		}
		if (!executable) {
			this._renderBanner(t('sessions.cli.notFound', cli.binary), true);
			this._onDidChangeStatus.fire({ sessionId: session.id, status: 'failed' });
			return;
		}
		// OpenIDE's own tools reach the CLI as a normal MCP server, injected for THIS launch only.
		// Anthropic's extension keeps serving the standard IDE tools; this adds what only OpenIDE
		// has (browser, diagrams, project map) without either side fighting over the other.
		const mcpEndpoint = await this.ideServer.mcpEndpointFor(session.id, cli);
		const launch = buildOpenideCliLaunch(cli, executable, session.providerSessionId, mcpEndpoint);
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
				env: { ...OPENIDE_HOSTED_CLI_ENV_RESET, OPENIDE_SESSION_ID: session.id, ...this.ideServer.launchEnvironment(), ...launch.env },
			},
		});
		const store = new DisposableStore();
		const hosted: IHostedTerminal = { sessionId: session.id, cli, instance, store, launchedAt: Date.now(), status: 'in-progress', hooked: false, quietTimer: undefined, exited: false };
		this._terminals.set(session.id, hosted);
		this._onDidChangeStatus.fire({ sessionId: session.id, status: 'in-progress' });

		store.add(instance.onData(() => this._apply(hosted, { type: 'output' })));
		// Keystrokes the user sends INTO the TUI. It decays on its own: nothing tells us when
		// somebody stopped typing, so a flag that only ever turned on would stick forever.
		store.add(instance.onDidInputData(() => {
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
			const code = typeof exit === 'number' ? exit : exit?.code;
			// A resumed session that dies within seconds did not fail: it never started. The
			// common cause is the CLI refusing to attach to a conversation another process still
			// holds — codex says `already has an active writer`, and after a window reload the
			// previous agent can easily still be alive. Leaving a dead pane and a raw error there
			// makes the user debug a lock they cannot see, so the session is reopened fresh, once,
			// and told what happened.
			const stillborn = !!session.providerSessionId && code !== 0 && Date.now() - hosted.launchedAt < RESUME_FAILURE_WINDOW_MS;
			if (stillborn && !hosted.resumeAbandoned) {
				hosted.resumeAbandoned = true;
				this._renderBanner(t('sessions.cli.resumeBusy', cli.name), true);
				this.forget(session.id);
				void this.open({ ...session, providerSessionId: undefined });
				return;
			}
			this._apply(hosted, { type: 'exit', code });
			if (this._shown === session.id) {
				this._renderExit(hosted, code);
			}
		}));
		if (!session.providerSessionId && cli.transcriptDir) {
			this._pollProviderSessionId(hosted, session.cwd, store);
		}
		if (this._shown === session.id) {
			this._attach(hosted);
		}
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

	/** A native hook reported about this session; from here on the heuristic is inert. */
	applyHookEvent(sessionId: string, event: OpenideCliSessionEvent): void {
		const hosted = this._terminals.get(sessionId);
		if (!hosted) {
			return;
		}
		hosted.hooked = true;
		if (hosted.quietTimer) {
			clearTimeout(hosted.quietTimer);
			hosted.quietTimer = undefined;
		}
		this._apply(hosted, event);
	}

	layout(width: number, height: number): void {
		this._dimension = { width, height };
		this.domNode.style.height = `${height}px`;
		const hosted = this._shown ? this._terminals.get(this._shown) : undefined;
		if (hosted && !hosted.exited && width > 0 && height > 0) {
			hosted.instance.layout({ width, height });
		}
	}

	focus(): void {
		const hosted = this._shown ? this._terminals.get(this._shown) : undefined;
		hosted?.instance.focus(true);
	}

	private _attach(hosted: IHostedTerminal): void {
		clearNode(this.domNode);
		const host = append(this.domNode, $('.openide-chat-agent-terminal-host'));
		hosted.instance.attachToElement(host);
		hosted.instance.setVisible(true);
		if (this._dimension) {
			hosted.instance.layout(this._dimension);
		}
		hosted.instance.focus(true);
	}

	private _detachShown(): void {
		const hosted = this._shown ? this._terminals.get(this._shown) : undefined;
		if (hosted && !hosted.exited) {
			hosted.instance.setVisible(false);
			hosted.instance.detachFromElement();
		}
		clearNode(this.domNode);
	}

	/**
	 * Whether this session's state comes from the CLI's own hooks rather than the output
	 * heuristic. It changes what a turn's file list is worth, so it travels with the turn.
	 */
	/**
	 * The editor selection, into the CLI's prompt: the same fenced block the local chat carries,
	 * pasted with bracketed paste so a TUI takes it as one paste and not as keystrokes (Claude
	 * Code shows it as `[Pasted text #1 +N lines]`). False when the session has no live
	 * terminal, and the caller falls back to the composer.
	 */
	sendSnippet(sessionId: string, snippet: IComposerSnippet): boolean {
		const hosted = this._terminals.get(sessionId);
		if (!hosted || hosted.exited) {
			return false;
		}
		const block = buildSnippetContext([snippet]) ?? `${snippet.path}:${snippetRange(snippet)}`;
		void hosted.instance.sendText(block, false, true);
		this.show(sessionId);
		this.focus();
		return true;
	}

	isHooked(sessionId: string): boolean {
		return this._terminals.get(sessionId)?.hooked === true;
	}

	private _renderBanner(message: string, error = false): void {
		clearNode(this.domNode);
		const banner = append(this.domNode, $('.openide-chat-agent-terminal-banner'));
		banner.classList.toggle('error', error);
		banner.textContent = message;
	}

	private _renderExit(hosted: IHostedTerminal, code: number | undefined): void {
		hosted.instance.detachFromElement();
		clearNode(this.domNode);
		const banner = append(this.domNode, $('.openide-chat-agent-terminal-banner'));
		append(banner, $('span', undefined, t('sessions.cli.exited', hosted.cli.name, code ?? '?')));
		const button = append(banner, $<HTMLButtonElement>('button.openide-chat-agent-terminal-relaunch', { type: 'button' }, t('sessions.cli.relaunch')));
		hosted.store.add(addDisposableListener(button, 'click', () => this._onDidRequestRelaunch.fire(hosted.sessionId)));
		button.focus();
	}

	private _apply(hosted: IHostedTerminal, event: OpenideCliSessionEvent): void {
		const next = reduceOpenideCliStatus(hosted.status, event, hosted.hooked);
		if (event.type === 'output' && !hosted.hooked && !hosted.exited) {
			if (hosted.quietTimer) {
				clearTimeout(hosted.quietTimer);
			}
			hosted.quietTimer = setTimeout(() => {
				hosted.quietTimer = undefined;
				this._apply(hosted, { type: 'quiet' });
			}, QUIET_MS);
		}
		if (next === hosted.status) {
			return;
		}
		hosted.status = next;
		this._onDidChangeStatus.fire({ sessionId: hosted.sessionId, status: next });
	}

	/**
	 * Claude Code and Codex write one transcript per session under the user's home; the newest
	 * file created after our launch IS this session, and its name carries the id `--resume`
	 * wants. Claude's directory is the cwd with every `/` and `.` replaced by `-` (Orca's
	 * `agent-session-resume.ts`); Codex nests by date and suffixes the uuid.
	 */
	private _pollProviderSessionId(hosted: IHostedTerminal, cwd: string | undefined, store: DisposableStore): void {
		let attempts = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const stop: IDisposable = toDisposable(() => { if (timer) { clearTimeout(timer); } });
		store.add(stop);
		const tick = async (): Promise<void> => {
			attempts++;
			const id = await this._findProviderSessionId(hosted.cli, cwd, hosted.launchedAt).catch(() => undefined);
			if (store.isDisposed) {
				return;
			}
			if (id) {
				this._onDidResolveProviderSession.fire({ sessionId: hosted.sessionId, providerSessionId: id });
				return;
			}
			if (attempts < RESUME_ID_POLL_LIMIT && !hosted.exited) {
				timer = setTimeout(() => void tick(), RESUME_ID_POLL_MS);
			}
		};
		timer = setTimeout(() => void tick(), RESUME_ID_POLL_MS);
	}

	private async _findProviderSessionId(cli: IOpenideCliDefinition, cwd: string | undefined, since: number): Promise<string | undefined> {
		const home = this.pathService.userHome({ preferLocal: true });
		if (cli.id === 'claude') {
			if (!cwd) {
				return undefined;
			}
			const slug = cwd.replace(/[/.]/g, '-');
			const dir = URI.joinPath(home, '.claude', 'projects', slug);
			return this._newestJsonlName(dir, since);
		}
		if (cli.id === 'codex') {
			const now = new Date(since);
			const dir = URI.joinPath(home, '.codex', 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
			const name = await this._newestJsonlName(dir, since);
			// rollout-2026-08-24T15-00-00-<uuid>.jsonl
			const match = name?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
			return match?.[1];
		}
		return undefined;
	}

	private async _newestJsonlName(dir: URI, since: number): Promise<string | undefined> {
		const stat = await this.fileService.resolve(dir, { resolveMetadata: true });
		const candidates = (stat.children ?? [])
			.filter(child => child.isFile && child.name.endsWith('.jsonl') && (child.mtime ?? 0) >= since - 1000)
			.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
		const newest = candidates[0];
		return newest ? newest.name.replace(/\.jsonl$/, '') : undefined;
	}

	private _disposeHosted(hosted: IHostedTerminal): void {
		if (hosted.quietTimer) {
			clearTimeout(hosted.quietTimer);
		}
		hosted.store.dispose();
		hosted.instance.detachFromElement();
		hosted.instance.dispose();
	}
}
