/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — agent shell hooks. The user declares scripts in
 *  the project's `.openide/hooks.json` plus the profile-global one (merged by concatenation, project
 *  PRIMERO) que observan o bloquean el lifecycle: preToolUse, postToolUse, userPromptSubmit,
 *  sessionStart, stop, subagentStop. Wire compatible with Claude Code: stdin = one JSON line
 *  {"hook_event_name","tool_name","tool_input","session_id","cwd","extra"}; stdout opcional
 *  {"decision":"block","reason"} / {"action":"block","message"} (normalizados) o {"context"}.
 *  ALWAYS fail-open semantics: timeout / non-JSON stdout / broken hook = a logged no-op (the
 *  approval gate del IDE sigue siendo fail-closed y HARDLINE_DENY inapelable). Exit≠0 igual
 *  parses stdout: a script can fail AND block. First-time consent per pair
 *  (event, command) with drift detection via the script's mtime (APPLICATION storage). The
 *  real execution lives in MAIN (IOpenideAgentHostService.execHook — the renderer does not spawn).
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { t } from '../common/openideStrings.js';
import {
	clampSeconds,
	HookExecResult,
	HOOK_TIMEOUT_DEFAULT_SECONDS,
	HOOK_TIMEOUT_MAX_SECONDS,
	HOOK_TIMEOUT_MIN_SECONDS,
	IOpenideAgentHostService,
	OPENIDE_AGENT_HOST_CHANNEL,
	shlexSplit,
} from '../../../../platform/openideAgentHost/common/openideAgentHost.js';

export type HookEvent = 'preToolUse' | 'postToolUse' | 'userPromptSubmit' | 'sessionStart' | 'stop' | 'subagentStop';

const KNOWN_EVENTS: readonly HookEvent[] = ['preToolUse', 'postToolUse', 'userPromptSubmit', 'sessionStart', 'stop', 'subagentStop'];

/** Global kill-switch (settings): without it, no hook runs at all. */
const HOOKS_ENABLED_KEY = 'openide.agent.hooks.enabled';
/** Allowlist de consentimiento en IStorageService APPLICATION (estado de seguridad, no config). */
const ALLOWLIST_STORAGE_KEY = 'openide.agent.hooksAllowlist';
/** Cap on the context injected by userPromptSubmit (it goes to the user message, not the prompt). */
const CONTEXT_CAP = 8000;
/** Cap on texts travelling in the stdin payload (user prompt, tool result). */
export const HOOK_PAYLOAD_TEXT_CAP = 8000;

export interface IHookEntry {
	readonly event: HookEvent;
	/** Shell-style command line (shlex in main, spawn shell:false). */
	readonly command: string;
	/** Regex fullmatch against tool_name — only honoured in preToolUse/postToolUse. */
	readonly matcher?: string;
	/** Segundos YA clampeados (1..60, default 10). */
	readonly timeoutSeconds: number;
	readonly scope: 'project' | 'global';
}

/** Payload of a dispatch: serialized to the stdin wire (undefined fields do not travel). */
export interface IHookPayload {
	readonly toolName?: string;
	readonly toolInput?: unknown;
	readonly sessionId?: string;
	readonly extra?: Record<string, unknown>;
}

export interface IHookOutcome {
	readonly entry: IHookEntry;
	/** Present when the hook asked to block ({"decision":"block"} or {"action":"block"}, normalized). */
	readonly blockMessage?: string;
	/** Present when the hook returned {"context":"..."} (consumed by userPromptSubmit). */
	readonly context?: string;
}

/** Persisted allowlist entry: pair (event, command) plus the script's mtime at approval time. */
export interface IHookApproval {
	readonly event: string;
	readonly command: string;
	readonly approvedAt: number;
	/** Script mtime at approval time (0 = a PATH command, no drift detection). */
	readonly scriptMtime: number;
}

/** Result of the UI's "Test" button: raw exec plus what would have been interpreted. */
export interface IHookTestResult extends HookExecResult {
	readonly blockMessage?: string;
	readonly context?: string;
}

/** Synthetic payloads per event for testHook. */
const TEST_PAYLOADS: Record<HookEvent, IHookPayload> = {
	preToolUse: { toolName: 'run_command', toolInput: { command: 'echo hola' } },
	postToolUse: { toolName: 'run_command', toolInput: { command: 'echo hola' }, extra: { result: 'hola', duration_ms: 12, status: 'ok' } },
	userPromptSubmit: { extra: { prompt: 'Mensaje de prueba del usuario' } },
	sessionStart: {},
	stop: {},
	subagentStop: { extra: { title: 'Subagente de prueba', is_error: false } },
};

/** Edit distance with early exit (the "did you mean X?" suggestion during parsing). */
function editDistance(a: string, b: string, cap: number): number {
	if (Math.abs(a.length - b.length) > cap) {
		return cap + 1;
	}
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = row;
	}
	return prev[b.length];
}

/** Closest known event to an unknown one (case-insensitive, distance ≤ 3). */
function closestEvent(name: string): HookEvent | undefined {
	const lower = String(name ?? '').toLowerCase();
	let best: HookEvent | undefined;
	let bestD = 4;
	for (const ev of KNOWN_EVENTS) {
		const d = editDistance(lower, ev.toLowerCase(), 3);
		if (d < bestD) {
			bestD = d;
			best = ev;
		}
	}
	return best;
}

export class OpenideAgentHooks extends Disposable {

	private readonly client: IOpenideAgentHostService;
	private readonly clientId = generateUuid();
	private readonly ownerToken = generateUuid();
	/** Scan cache, tied to the mtime of both hooks.json files + invalidated by the watcher. */
	private cache: { key: string; items: IHookEntry[] } | undefined;
	private readonly watchedFiles = new Map<string, URI>();
	/** Consent decisions from THIS IDE session (allow and deny, with the mtime seen). */
	private readonly sessionConsent = new Map<string, { allow: boolean; mtime: number }>();
	/** Dedupe of concurrent prompts per pair (event, command) — one QuickPick at a time. */
	private readonly consentInFlight = new Map<string, Promise<boolean>>();

	constructor(
		mainProcessService: IMainProcessService,
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
		private readonly configurationService: IConfigurationService,
		private readonly storageService: IStorageService,
		private readonly quickInputService: IQuickInputService,
		private readonly pathService: IPathService,
		private readonly logService: ILogService,
	) {
		super();
		this.client = ProxyChannel.toService<IOpenideAgentHostService>(mainProcessService.getChannel(OPENIDE_AGENT_HOST_CHANNEL));
		this._register(this.fileService.onDidFilesChange(e => {
			for (const uri of this.watchedFiles.values()) {
				if (e.affects(uri)) {
					this.cache = undefined;
					return;
				}
			}
		}));
	}

	// ---- lectura y merge de hooks.json ----

	/** Files in execution PRECEDENCE order: project first, global afterwards
	 *  (list concatenation — "first block wins" respects this order). */
	private files(): { uri: URI; scope: 'project' | 'global' }[] {
		const out: { uri: URI; scope: 'project' | 'global' }[] = [];
		const folder = this.contextService.getWorkspace().folders[0];
		if (folder) {
			out.push({ uri: joinPath(folder.uri, '.openide', 'hooks.json'), scope: 'project' });
		}
		out.push({ uri: joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'hooks.json'), scope: 'global' });
		return out;
	}

	private watchFile(uri: URI): void {
		const key = uri.toString();
		if (!this.watchedFiles.has(key)) {
			this.watchedFiles.set(key, uri);
			this._register(this.fileService.watch(uri));
		}
	}

	/** Defensive parse of a hooks.json: unknown event = warning + skip (with a suggestion),
	 *  entry without a command = skip, matcher outside pre/postToolUse = warning + ignored. */
	private parseHooksFile(text: string, scope: 'project' | 'global'): IHookEntry[] {
		const label = `hooks.json (${scope})`;
		let raw: any;
		try {
			raw = JSON.parse(text);
		} catch {
			this.logService.warn(`[openide-hooks] ${label}: JSON inválido — archivo ignorado`);
			return [];
		}
		const hooks = raw?.hooks;
		if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
			return [];
		}
		const out: IHookEntry[] = [];
		for (const [eventName, list] of Object.entries(hooks)) {
			if (!KNOWN_EVENTS.includes(eventName as HookEvent)) {
				const near = closestEvent(eventName);
				this.logService.warn(`[openide-hooks] ${label}: evento desconocido "${eventName}"${near ? ` (¿quisiste decir "${near}"?)` : ''} — skipeado`);
				continue;
			}
			const event = eventName as HookEvent;
			if (!Array.isArray(list)) {
				this.logService.warn(`[openide-hooks] ${label}: "${event}" tiene que ser una lista — skipeado`);
				continue;
			}
			for (const item of list) {
				const command = typeof item?.command === 'string' ? item.command.trim() : '';
				if (!command) {
					this.logService.warn(`[openide-hooks] ${label}: entrada de "${event}" sin command — skipeada`);
					continue;
				}
				let matcher = typeof item?.matcher === 'string' && item.matcher ? item.matcher : undefined;
				if (matcher && event !== 'preToolUse' && event !== 'postToolUse') {
					this.logService.warn(`[openide-hooks] ${label}: matcher solo se honra en preToolUse/postToolUse — ignorado en "${event}"`);
					matcher = undefined;
				}
				out.push({
					event,
					command,
					matcher,
					timeoutSeconds: clampSeconds(item?.timeout, HOOK_TIMEOUT_DEFAULT_SECONDS, HOOK_TIMEOUT_MIN_SECONDS, HOOK_TIMEOUT_MAX_SECONDS),
					scope,
				});
			}
		}
		return out;
	}

	/** Merged hook list (project + global, in execution order). An unreadable or missing file
	 *  ⇒ carry on with the rest (same style as skills/mcp). */
	async scan(): Promise<IHookEntry[]> {
		const files = this.files();
		const key = (await Promise.all(files.map(async f => {
			try {
				return String((await this.fileService.stat(f.uri)).mtime ?? 0);
			} catch {
				return '0'; // sin archivo todavía
			}
		}))).join(':');
		if (this.cache && this.cache.key === key) {
			return this.cache.items;
		}
		const items: IHookEntry[] = [];
		for (const f of files) {
			this.watchFile(f.uri);
			let text: string;
			try {
				text = (await this.fileService.readFile(f.uri)).value.toString();
			} catch {
				continue; // sin hooks.json en este scope
			}
			items.push(...this.parseHooksFile(text, f.scope));
		}
		this.cache = { key, items };
		return items;
	}

	private enabled(): boolean {
		return this.configurationService.getValue<boolean>(HOOKS_ENABLED_KEY) !== false;
	}

	/** Cheap gate for the loop's call sites: is there any hook for this event? */
	async has(event: HookEvent): Promise<boolean> {
		if (!this.enabled()) {
			return false;
		}
		try {
			return (await this.scan()).some(e => e.event === event);
		} catch {
			return false;
		}
	}

	// ---- dispatch ----

	/** Runs ALL the event's hooks in order (project before global, array order),
	 *  each awaited with its own timeout. It NEVER rejects: failures are logged and we carry on
	 *  (fail-open). Los eventos observadores van por dispatchObserved (fire-and-forget). */
	async dispatch(event: HookEvent, payload: IHookPayload): Promise<IHookOutcome[]> {
		const outcomes: IHookOutcome[] = [];
		try {
			if (!this.enabled()) {
				return outcomes;
			}
			const entries = (await this.scan()).filter(e => e.event === event);
			if (!entries.length) {
				return outcomes;
			}
			const cwd = this.execCwd();
			const stdinJson = JSON.stringify({
				hook_event_name: event,
				tool_name: payload.toolName,
				tool_input: payload.toolInput,
				session_id: payload.sessionId ?? '',
				cwd,
				extra: payload.extra ?? {},
			});
			for (const entry of entries) {
				// matcher: regex fullmatch against tool_name, ONLY in pre/postToolUse (parsing already
				// discarded matchers from other events). An invalid regex = literal equality.
				if (entry.matcher && !this.matches(entry.matcher, payload.toolName ?? '')) {
					continue;
				}
				if (!(await this.ensureConsent(entry))) {
					this.logService.warn(`[openide-hooks] ${event} "${entry.command}": sin consentimiento del usuario — skipeado (jamás bloquea el turno)`);
					continue;
				}
				try {
					const result = await this.client.execHook(this.clientId, this.ownerToken, { command: entry.command, stdinJson, timeoutMs: entry.timeoutSeconds * 1000, cwd });
					outcomes.push(this.parseOutcome(entry, result));
				} catch (e) {
					// execHook does not reject by contract; this covers the IPC channel being down — fail-open
					this.logService.warn(`[openide-hooks] ${event} "${entry.command}": ${e instanceof Error ? e.message : String(e)} — ignorado (fail-open)`);
				}
			}
		} catch (e) {
			this.logService.warn(`[openide-hooks] dispatch(${event}) falló: ${e instanceof Error ? e.message : String(e)} — ignorado (fail-open)`);
		}
		return outcomes;
	}

	/** Eventos observadores (postToolUse, stop, sessionStart, subagentStop): fire-and-forget —
	 *  never hold up the loop or the send. */
	dispatchObserved(event: HookEvent, payload: IHookPayload): void {
		this.dispatch(event, payload).catch(() => { /* dispatch ya no rechaza; cinturón */ });
	}

	// ---- agregadores ----

	/** First block wins (deterministic order: project before global, array order). */
	getBlockMessage(outcomes: IHookOutcome[]): string | undefined {
		return outcomes.find(o => o.blockMessage !== undefined)?.blockMessage;
	}

	/** Injected contexts joined with \n\n (for the user MESSAGE, not the system prompt). */
	getInjectedContext(outcomes: IHookOutcome[]): string | undefined {
		const parts = outcomes.map(o => o.context).filter((c): c is string => !!c);
		return parts.length ? parts.join('\n\n').slice(0, CONTEXT_CAP) : undefined;
	}

	// ---- wire: matcher + parseo del stdout ----

	private matches(matcher: string, toolName: string): boolean {
		try {
			return new RegExp('^(?:' + matcher + ')$').test(toolName); // fullmatch
		} catch {
			return matcher === toolName; // regex inválida degrada a igualdad literal
		}
	}

	/** Normalizes a hook's result. Timeout ⇒ no-op; exit≠0 STILL parses stdout (a script can fail
	 *  AND block); non-JSON stdout ⇒ no-op. Everything logged, nothing blows up. */
	private parseOutcome(entry: IHookEntry, result: HookExecResult): IHookOutcome {
		if (result.timedOut) {
			this.logService.warn(`[openide-hooks] ${entry.event} "${entry.command}": timeout a los ${entry.timeoutSeconds}s — ignorado (fail-open)`);
			return { entry };
		}
		if (result.exitCode !== 0) {
			const err = result.stderr.trim().slice(0, 400);
			this.logService.warn(`[openide-hooks] ${entry.event} "${entry.command}": exit ${result.exitCode ?? 'null'}${err ? ` — ${err}` : ''} (el stdout se parsea igual)`);
		}
		const parsed = this.parseStdout(result.stdout);
		if (!parsed) {
			return { entry };
		}
		// {"decision":"block","reason"} y {"action":"block","message"} normalizados (compat Claude Code)
		let blockMessage: string | undefined;
		if (parsed.decision === 'block') {
			blockMessage = String(parsed.reason ?? '') || localize('openide.hooks.blockedDefault', "bloqueado por un hook del usuario");
		} else if (parsed.action === 'block') {
			blockMessage = String(parsed.message ?? '') || localize('openide.hooks.blockedDefault', "bloqueado por un hook del usuario");
		}
		const context = typeof parsed.context === 'string' && parsed.context ? parsed.context.slice(0, CONTEXT_CAP) : undefined;
		return { entry, blockMessage, context };
	}

	/** stdout → JSON object: the whole text first, then the last non-empty line (a script may
	 *  echo noise before the JSON). Nothing parseable ⇒ undefined (no-op). */
	private parseStdout(stdout: string): any | undefined {
		const trimmed = String(stdout ?? '').trim();
		if (!trimmed) {
			return undefined;
		}
		for (const candidate of [trimmed, trimmed.split('\n').filter(l => l.trim()).pop() ?? '']) {
			try {
				const obj = JSON.parse(candidate);
				if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
					return obj;
				}
			} catch { /* siguiente candidato */ }
		}
		return undefined;
	}

	// ---- consentimiento (primera vez por par evento+command, drift por mtime del script) ----

	private consentKey(event: string, command: string): string {
		return `${event}${command}`;
	}

	private readApprovals(): IHookApproval[] {
		try {
			const raw = JSON.parse(this.storageService.get(ALLOWLIST_STORAGE_KEY, StorageScope.APPLICATION) ?? '[]');
			return Array.isArray(raw) ? raw.filter(a => a && typeof a.event === 'string' && typeof a.command === 'string') : [];
		} catch {
			return [];
		}
	}

	private writeApprovals(list: IHookApproval[]): void {
		this.storageService.store(ALLOWLIST_STORAGE_KEY, JSON.stringify(list), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	/** Allowlist persistida (para la tab Hooks de la UI de Fase 5). */
	listApprovals(): IHookApproval[] {
		return this.readApprovals();
	}

	/** Consent state of a pair (event, command) for the UI pill: approved / pending /
	 *  modified since approval (drift detected via the script's mtime). */
	async approvalState(event: string, command: string): Promise<'approved' | 'pending' | 'drifted'> {
		const stored = this.readApprovals().find(a => a.event === event && a.command === command);
		if (!stored) {
			return 'pending';
		}
		return (await this.scriptMtime(command)) === stored.scriptMtime ? 'approved' : 'drifted';
	}

	/** Approves a pair (event, command) "always" without running it (the UI's Approve button). */
	async approveAlways(event: string, command: string): Promise<void> {
		const mtime = await this.scriptMtime(command);
		this.writeApprovals([
			...this.readApprovals().filter(a => !(a.event === event && a.command === command)),
			{ event, command, approvedAt: Date.now(), scriptMtime: mtime },
		]);
		this.sessionConsent.set(this.consentKey(event, command), { allow: true, mtime });
	}

	/** Revokes a pair's approval (event, command) — it asks again next time. */
	revokeApproval(event: string, command: string): void {
		this.writeApprovals(this.readApprovals().filter(a => !(a.event === event && a.command === command)));
		this.sessionConsent.delete(this.consentKey(event, command));
	}

	/** Can this hook run? Persistently approved with the SAME mtime ⇒ yes; a different mtime
	 *  (script modified since approval, drift detection) ⇒ ask again; first time ⇒ a native
	 *  QuickPick. Deny is remembered for the session (so it does not spam on every tool call). */
	private async ensureConsent(entry: IHookEntry): Promise<boolean> {
		const key = this.consentKey(entry.event, entry.command);
		const mtime = await this.scriptMtime(entry.command);
		const session = this.sessionConsent.get(key);
		if (session && session.mtime === mtime) {
			return session.allow;
		}
		const stored = this.readApprovals().find(a => a.event === entry.event && a.command === entry.command);
		if (stored && stored.scriptMtime === mtime) {
			this.sessionConsent.set(key, { allow: true, mtime });
			return true;
		}
		let pending = this.consentInFlight.get(key);
		if (!pending) {
			pending = this.promptConsent(entry, mtime, !!stored).finally(() => this.consentInFlight.delete(key));
			this.consentInFlight.set(key, pending);
		}
		return pending;
	}

	private async promptConsent(entry: IHookEntry, mtime: number, drifted: boolean): Promise<boolean> {
		const items: (IQuickPickItem & { id: 'session' | 'always' | 'deny' })[] = [
			{ id: 'session', label: t('hooks.allowSession') },
			{ id: 'always', label: localize('openide.hooks.allowAlways', "$(star-full) Permitir siempre") },
			{ id: 'deny', label: localize('openide.hooks.deny', "$(x) Denegar") },
		];
		const picked = await this.quickInputService.pick(items, {
			title: drifted
				? t('hooks.consentDrift', entry.event)
				: localize('openide.hooks.consentTitle', "Hook del agente ({0})", entry.event),
			placeHolder: localize('openide.hooks.consentPh', "\"{0}\" corre con tus credenciales completas. ¿Permitir?", entry.command),
			ignoreFocusLost: true,
		});
		const allow = picked?.id === 'session' || picked?.id === 'always';
		// deny (or Escape) is cached for the session too: do not re-ask on every tool call
		this.sessionConsent.set(this.consentKey(entry.event, entry.command), { allow, mtime });
		if (picked?.id === 'always') {
			this.writeApprovals([
				...this.readApprovals().filter(a => !(a.event === entry.event && a.command === entry.command)),
				{ event: entry.event, command: entry.command, approvedAt: Date.now(), scriptMtime: mtime },
			]);
		}
		return allow;
	}

	/** mtime of the hook's SCRIPT for drift detection: the first token of the command that
	 *  resuelva a un archivo stat-eable (cubre "script.sh args" y "node scripts/format.js").
	 *  Bare PATH commands ⇒ 0 (no drift detection possible from the renderer). */
	private async scriptMtime(command: string): Promise<number> {
		const cwd = this.contextService.getWorkspace().folders[0]?.uri;
		for (const token of shlexSplit(command).slice(0, 4)) {
			const uri = this.resolveScriptUri(token, cwd);
			if (!uri) {
				continue;
			}
			try {
				const stat = await this.fileService.stat(uri);
				if (!stat.isDirectory) {
					return stat.mtime ?? 0;
				}
			} catch { /* no existe: probar el siguiente token */ }
		}
		return 0;
	}

	private resolveScriptUri(token: string, cwd: URI | undefined): URI | undefined {
		if (token === '~' || token.startsWith('~/')) {
			const home = this.pathService.resolvedUserHome;
			return !home ? undefined : token === '~' ? home : joinPath(home, token.slice(2));
		}
		if (token.startsWith('/') || /^[A-Za-z]:[\\/]/.test(token)) {
			return URI.file(token);
		}
		if ((token.includes('/') || token.includes('\\')) && cwd) {
			return joinPath(cwd, token); // relativo CON separador: contra el workspace root
		}
		return undefined; // comando pelado del PATH (node, sh…): no stat-eable desde acá
	}

	// ---- test (the UI's "Test" button) ----

	/** Runs a hook with its event's synthetic payload (no consent gate: testing IS an explicit
	 *  user act) and returns the raw exec plus the normalized interpretation. */
	async testHook(event: HookEvent, entry: { command: string; timeout?: number }): Promise<IHookTestResult> {
		const cwd = this.execCwd();
		const payload = TEST_PAYLOADS[event] ?? {};
		const timeoutSeconds = clampSeconds(entry.timeout, HOOK_TIMEOUT_DEFAULT_SECONDS, HOOK_TIMEOUT_MIN_SECONDS, HOOK_TIMEOUT_MAX_SECONDS);
		const stdinJson = JSON.stringify({
			hook_event_name: event,
			tool_name: payload.toolName,
			tool_input: payload.toolInput,
			session_id: 'test',
			cwd,
			extra: payload.extra ?? {},
		});
		const result = await this.client.execHook(this.clientId, this.ownerToken, { command: String(entry.command ?? ''), stdinJson, timeoutMs: timeoutSeconds * 1000, cwd });
		const outcome = this.parseOutcome({ event, command: String(entry.command ?? ''), timeoutSeconds, scope: 'project' }, result);
		return { ...result, blockMessage: outcome.blockMessage, context: outcome.context };
	}

	/** Hook cwd: the workspace root (also the base for relative commands); with no folder
	 *  open it falls back to the user's home (and main falls back to its process.cwd() if empty). */
	private execCwd(): string {
		return this.contextService.getWorkspace().folders[0]?.uri.fsPath ?? this.pathService.resolvedUserHome?.fsPath ?? '';
	}
}
