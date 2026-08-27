/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — agent host (common layer). The REAL service lives in the main process
 *  (electron-main/openideAgentHostMain.ts): MCP client (stdio + Streamable HTTP) and shell hook
 *  execution — none of which can run in the renderer (it cannot spawn processes). The workbench
 *  talks to it over IPC (ProxyChannel) using this contract. The PURE validations (server name,
 *  URL, env) that the "Agent Extensions" UI reuses also live here, along with the shared minimal
 *  shlex (hooks here; /commands use it for $1..$9 with quoting).
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { OpenideWebFetchRequest, OpenideWebFetchResponse } from './openideWebResearch.js';
import { IIdeServerInfo, IIdeServerStartOptions, IIdeToolRequest, IIdeToolResult, IIdeToolSchema } from './openideIdeServer.js';

export const OPENIDE_AGENT_HOST_CHANNEL = 'openideAgentHost';

// ---- timeouts (config speaks in SECONDS; the channel wire, in ms) ----

export const MCP_CALL_TIMEOUT_DEFAULT_SECONDS = 120;
export const MCP_CALL_TIMEOUT_MIN_SECONDS = 5;
export const MCP_CALL_TIMEOUT_MAX_SECONDS = 600;
export const MCP_CONNECT_TIMEOUT_DEFAULT_SECONDS = 30;
export const MCP_MAX_JSONRPC_MESSAGE_BYTES = 1_048_576;
export const MCP_MAX_PENDING_REQUESTS = 32;
export const MCP_MAX_PENDING_REQUEST_BYTES = 2_097_152;
export const MCP_MAX_STDERR_LOG_BYTES = 1_048_576;
export const HOOK_INPUT_MAX_BYTES = 1_048_576;

export class McpRequestBudget {
	private count = 0;
	private bytes = 0;

	reserve(requestBytes: number): string | undefined {
		if (!Number.isSafeInteger(requestBytes) || requestBytes < 0 || requestBytes > MCP_MAX_JSONRPC_MESSAGE_BYTES) { return `request MCP excede ${MCP_MAX_JSONRPC_MESSAGE_BYTES} bytes`; }
		if (this.count >= MCP_MAX_PENDING_REQUESTS) { return `cola MCP llena (${MCP_MAX_PENDING_REQUESTS} requests)`; }
		if (this.bytes + requestBytes > MCP_MAX_PENDING_REQUEST_BYTES) { return `cola MCP excede ${MCP_MAX_PENDING_REQUEST_BYTES} bytes`; }
		this.count++; this.bytes += requestBytes; return undefined;
	}

	release(requestBytes: number): void { this.count = Math.max(0, this.count - 1); this.bytes = Math.max(0, this.bytes - Math.max(0, requestBytes)); }
	clear(): void { this.count = 0; this.bytes = 0; }
	get pendingCount(): number { return this.count; }
}

export function consumeMcpJsonLines(buffer: string, chunk: string): { lines: string[]; rest: string; error?: string } {
	let rest = buffer + chunk;
	const lines: string[] = [];
	let index: number;
	while ((index = rest.indexOf('\n')) !== -1) {
		const line = rest.slice(0, index); rest = rest.slice(index + 1);
		if (new TextEncoder().encode(line).byteLength > MCP_MAX_JSONRPC_MESSAGE_BYTES) { return { lines, rest: '', error: `mensaje JSON-RPC excede ${MCP_MAX_JSONRPC_MESSAGE_BYTES} bytes` }; }
		lines.push(line);
	}
	if (new TextEncoder().encode(rest).byteLength > MCP_MAX_JSONRPC_MESSAGE_BYTES) { return { lines, rest: '', error: `mensaje JSON-RPC excede ${MCP_MAX_JSONRPC_MESSAGE_BYTES} bytes` }; }
	return { lines, rest };
}

export const HOOK_TIMEOUT_DEFAULT_SECONDS = 10;
export const HOOK_TIMEOUT_MIN_SECONDS = 1;
export const HOOK_TIMEOUT_MAX_SECONDS = 60;

/** Clamps a config value to [min..max]; when it is not a positive number, falls back to the default. */
export function clampSeconds(value: unknown, fallback: number, min: number, max: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

// ---- MCP types (POJOs: they travel over ProxyChannel, no raw Map/Error) ----

/** Una entrada de `mcpServers` de mcp.json (shape compatible clientes MCP comunes).
 *  Transporte INFERIDO: `command` ⇒ stdio, `url` ⇒ Streamable HTTP (excluyentes). */
export interface McpServerConfig {
	// stdio
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	// Streamable HTTP
	readonly url?: string;
	readonly headers?: Readonly<Record<string, string>>;
	// comunes
	readonly enabled?: boolean;
	/** Segundos por tool-call (default 120, clamp 5..600). */
	readonly timeout?: number;
	/** Segundos para el handshake initialize + tools/list (default 30). */
	readonly connectTimeout?: number;
	/** Reserved ("sse" is rejected with a warning in v1). */
	readonly transport?: string;
	readonly tools?: { readonly include?: readonly string[]; readonly exclude?: readonly string[] };
}

export interface McpToolInfo {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: unknown;
	readonly annotations?: { readonly readOnlyHint?: boolean; readonly [key: string]: unknown };
}

export interface McpToolResult {
	readonly text: string;
	readonly isError: boolean;
}

export type McpServerState = 'connecting' | 'connected' | 'error' | 'disconnected';

export interface McpServerStatus {
	readonly id: string;
	readonly clientId: string;
	/** Token the workbench chose for this connection; it discards stale IPC events. */
	readonly generation: number;
	readonly state: McpServerState;
	readonly toolCount: number;
	/** Message ALREADY redacted (no env/header values). Only with state 'error'. */
	readonly error?: string;
	/** serverInfo.name the server reported on initialize. */
	readonly serverName?: string;
	/** true = PARKED: 3+ consecutive transport failures ⇒ no automatic reconnection — it only
	 *  revives with an explicit mcpConnect ("Reload MCP servers"). Only with state 'error'. */
	readonly parked?: boolean;
	/** Earliest recommended moment for an automatic retry; undefined when it can be retried now. */
	readonly retryAfter?: number;
}

export interface McpConnectResult {
	readonly clientId: string;
	readonly generation: number;
	readonly tools: McpToolInfo[];
	readonly serverInfo?: { readonly name: string; readonly version: string };
}

/** Payload of onDidChangeMcpServerTools: the live list after the server's
 *  notifications/tools/list_changed (main already re-listed; the workbench re-registers in the registry — no snapshot). */
export interface McpServerToolsEvent {
	readonly id: string;
	readonly clientId: string;
	readonly generation: number;
	readonly tools: McpToolInfo[];
}

// ---- tipos de hooks ----

export interface HookExecRequest {
	/** Shell-style command line (parsed with shlexSplit, spawned with shell:false). */
	readonly command: string;
	/** JSON payload sent over stdin (one line, wire compatible with Claude Code). */
	readonly stdinJson: string;
	/** Milliseconds (the browser already clamped it to 1..60 s). */
	readonly timeoutMs: number;
	/** Workspace root: the process cwd AND the base for relative commands. */
	readonly cwd: string;
}

export interface HookExecResult {
	/** null when the process never ran or we killed it on timeout. */
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
}

// ---- contrato del servicio ----

export interface IOpenideAgentHostService {
	readonly onDidChangeMcpServerStatus: Event<McpServerStatus>;
	/** The server signalled notifications/tools/list_changed and main already re-listed its tools. */
	readonly onDidChangeMcpServerTools: Event<McpServerToolsEvent>;
	/** Connects (or RE-connects: it also revives a server parked by failures) and lists its tools. */
	mcpConnect(clientId: string, ownerToken: string, id: string, config: McpServerConfig, generation: number): Promise<McpConnectResult>;
	/** Runs a tool only against the exact connection that was approved/registered. */
	mcpCallTool(clientId: string, ownerToken: string, id: string, generation: number, tool: string, args: unknown, timeoutMs: number): Promise<McpToolResult>;
	mcpDisconnect(clientId: string, ownerToken: string, id: string, generation?: number): Promise<void>;
	mcpStatus(clientId: string, ownerToken: string): Promise<McpServerStatus[]>;
	/** Renews the owner's capability; main drops orphaned connections when it stops arriving. */
	mcpHeartbeat(clientId: string, ownerToken: string): Promise<void>;
	/** Hardened public download in main: DNS/IP/redirects/body limits; never uses browser cookies. */
	webFetch(request: OpenideWebFetchRequest): Promise<OpenideWebFetchResponse>;
	/** Runs a shell hook with JSON stdin. NEVER rejects: failures are reported in the result (fail-open on the browser side). */
	execHook(clientId: string, ownerToken: string, req: HookExecRequest): Promise<HookExecResult>;
	/** Loopback OAuth (Google-style): starts an ephemeral http server on 127.0.0.1 that waits for
	 *  ONE callback on /oauth2callback. Returns the port so the redirect_uri can be built. */
	oauthLoopbackStart(options?: { port?: number; callbackPath?: string }): Promise<{ id: string; port: number }>;
	/** Espera el callback (o timeout). Cierra el server al resolver. */
	oauthLoopbackWait(id: string, timeoutMs: number): Promise<{ code?: string; state?: string; error?: string; timedOut?: boolean }>;
	/** Cancels and closes the server (the user aborted the login). */
	oauthLoopbackCancel(id: string): Promise<void>;

	// ---- IDE server: OpenIDE AS a server, for the CLIs hosted in the dock -------------------

	/** A CLI called one of our tools; the workbench executes it and answers with ideRespondTool. */
	readonly onDidRequestIdeTool: Event<IIdeToolRequest>;
	/** Live agent connections. The dock paints its "connected" state from this. */
	readonly onDidChangeIdeConnections: Event<number>;
	/** Binds the port, writes the discovery lockfile, starts accepting agents. Idempotent. */
	ideServerStart(options: IIdeServerStartOptions, extraTools: readonly IIdeToolSchema[]): Promise<IIdeServerInfo>;
	/** Answers a parked tools/call. Unknown ids are dropped, never thrown. */
	ideRespondTool(requestId: string, result: IIdeToolResult): Promise<void>;
	/** Pushes selection_changed / at_mentioned to every connected agent. */
	ideNotify(method: string, params: unknown): Promise<void>;
	/** Writes a launch-scoped MCP config (0600) and returns its path. */
	ideWriteMcpConfig(sessionId: string, contents: string): Promise<string>;
	/** Replaces the Tier 2 catalogue and makes connected agents re-list. */
	ideSetExtraTools(tools: readonly IIdeToolSchema[]): Promise<void>;
	/** Runs a CLI's own `mcp add` to register OpenIDE in its config. Rejects with its output. */
	ideRegisterInCli(executable: string, args: readonly string[]): Promise<string>;
	/**
	 * Runs `git` in `cwd` and returns its stdout. Never rejects: a repo without git, or a folder
	 * that is not a repo, is an ordinary answer here and not an error to handle at every call.
	 */
	runGit(cwd: string, args: readonly string[]): Promise<{ stdout: string; ok: boolean }>;
	/**
	 * Runs a binary-discovery probe in the user's LOGIN shell and returns its stdout.
	 *
	 * In main, with no pty: the previous version drove the workbench's shared agent terminal,
	 * which put the raw `command -v …` line and its output on screen, and leaked one terminal per
	 * probe whenever shell integration did not resolve — the user ended up with a column of
	 * "OpenIDE Agent" tabs and a wall of markers.
	 */
	probeShell(command: string): Promise<string>;
	ideServerStop(): Promise<void>;
}

// ---- validaciones puras (compartidas main + workbench + UI) ----

export const MCP_SERVER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidMcpServerName(name: string): boolean {
	return MCP_SERVER_NAME_RE.test(String(name ?? ''));
}

export function isValidMcpUrl(raw: string): boolean {
	try {
		const url = new URL(String(raw ?? ''));
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/** Validates an mcpServers entry. Returns the error message, or undefined when it is OK. */
/** Minimal inherited env for MCP stdio. Config env may add explicit credentials, but never
 * loaders, NODE_OPTIONS or CA overrides capable of altering how Node/Electron executes. */
export function sanitizeMcpStdioEnvironment(baseEnv: Readonly<Record<string, string | undefined>>, configEnv: Readonly<Record<string, string>> | undefined): Record<string, string> {
	const inherited = new Set([
		'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'TMPDIR', 'TZ',
		'USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
		'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH',
		'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE',
	]);
	const blocked = /^(NODE_OPTIONS|ELECTRON_RUN_AS_NODE|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_REPL_EXTERNAL_MODULE)$/i;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		const upper = key.toUpperCase();
		if (value !== undefined && !blocked.test(key) && (inherited.has(upper) || upper.startsWith('XDG_'))) { result[key] = value; }
	}
	for (const [key, value] of Object.entries(configEnv ?? {})) {
		if (!blocked.test(key)) { result[key] = String(value); }
	}
	return result;
}

export function validateMcpServerConfig(name: string, config: McpServerConfig): string | undefined {
	if (!config || typeof config !== 'object' || Array.isArray(config)) { return `"${name}": configuración MCP debe ser un objeto`; }
	if (!isValidMcpServerName(name) || name.length > 128) {
		return `nombre de server MCP inválido: "${name}" (letras/números/guiones/underscore, empieza alfanumérico)`;
	}
	if (config.command !== undefined && typeof config.command !== 'string') { return `"${name}": command debe ser string`; }
	if (config.url !== undefined && typeof config.url !== 'string') { return `"${name}": url debe ser string`; }
	if (config.transport !== undefined && typeof config.transport !== 'string') { return `"${name}": transport debe ser string`; }
	if (config.enabled !== undefined && typeof config.enabled !== 'boolean') { return `"${name}": enabled debe ser boolean`; }
	if (config.timeout !== undefined && typeof config.timeout !== 'number') { return `"${name}": timeout debe ser número`; }
	if (config.connectTimeout !== undefined && typeof config.connectTimeout !== 'number') { return `"${name}": connectTimeout debe ser número`; }
	const hasCommand = typeof config.command === 'string' && !!config.command.trim();
	const hasUrl = typeof config.url === 'string' && !!config.url.trim();
	if ((hasCommand && (String(config.command).includes('\0') || String(config.command).length > 16_384)) || (hasUrl && String(config.url).length > 16_384)) { return `"${name}": command o url inválido/demasiado grande`; }
	if (hasCommand === hasUrl) {
		return hasCommand
			? `"${name}": command y url son excluyentes (stdio O Streamable HTTP, no ambos)`
			: `"${name}": falta command (stdio) o url (Streamable HTTP)`;
	}
	if (config.transport !== undefined) { return `"${name}": campo transport no soportado; usá command o url`; }
	if (hasUrl && !isValidMcpUrl(config.url!)) {
		return `"${name}": la url tiene que ser http(s) válida`;
	}
	if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string'))) { return `"${name}": args debe ser una lista de strings`; }
	if (config.env !== undefined && (!config.env || typeof config.env !== 'object' || Array.isArray(config.env) || Object.values(config.env).some(value => typeof value !== 'string'))) { return `"${name}": env debe ser un objeto de strings`; }
	if (config.headers !== undefined && (!config.headers || typeof config.headers !== 'object' || Array.isArray(config.headers) || Object.values(config.headers).some(value => typeof value !== 'string'))) { return `"${name}": headers debe ser un objeto de strings`; }
	if (config.tools !== undefined && (!config.tools || typeof config.tools !== 'object' || Array.isArray(config.tools))) { return `"${name}": tools debe ser un objeto`; }
	const envEntries = Object.entries(config.env ?? {});
	if (envEntries.length > 256 || envEntries.reduce((sum, [key, value]) => sum + key.length + value.length, 0) > 262_144) { return `"${name}": env demasiado grande`; }
	const headers = Object.entries(config.headers ?? {});
	const reservedHeaders = new Set(['mcp-session-id', 'mcp-protocol-version', 'content-type', 'accept']);
	if (headers.length > 128 || headers.some(([key, value]) => reservedHeaders.has(key.toLowerCase()) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || key.length > 256 || String(value).includes('\0') || String(value).length > 16_384) || headers.reduce((sum, [key, value]) => sum + key.length + String(value).length, 0) > 131_072) { return `"${name}": headers inválidos o demasiado grandes`; }
	for (const [key, value] of Object.entries(config.env ?? {})) {
		if (!ENV_NAME_RE.test(key)) {
			return `"${name}": nombre de variable de entorno inválido: "${key}"`;
		}
		if (/^(NODE_OPTIONS|ELECTRON_RUN_AS_NODE|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_REPL_EXTERNAL_MODULE)$/i.test(key)) {
			return `"${name}": variable de entorno bloqueada por seguridad: "${key}"`;
		}
		if (String(value).includes('\0') || String(value).length > 16_384) {
			return `"${name}": valor de entorno inválido o demasiado grande para "${key}"`;
		}
	}
	if ((config.args?.length ?? 0) > 256 || (Array.isArray(config.args) && config.args.some(arg => String(arg).includes('\0') || String(arg).length > 16_384))) {
		return `"${name}": args inválidos o demasiado grandes`;
	}
	for (const field of ['include', 'exclude'] as const) {
		const list = config.tools?.[field];
		if (list !== undefined && (!Array.isArray(list) || list.length > 500 || list.some(item => typeof item !== 'string' || !item || item.length > 256))) { return `"${name}": tools.${field} debe ser una lista acotada de nombres no vacíos`; }
	}
	return undefined;
}

/** Tool name for the agent registry: `mcp_<server>_<tool>` sanitized to [A-Za-z0-9_]. */
export function isMcpToolAllowed(config: McpServerConfig, tool: string): boolean {
	const include = config.tools?.include;
	if (Array.isArray(include) && include.length) { return include.includes(tool); }
	const exclude = config.tools?.exclude;
	return !(Array.isArray(exclude) && exclude.includes(tool));
}

export function sanitizeMcpToolName(server: string, tool: string): string {
	return ('mcp_' + server + '_' + tool).replace(/[^A-Za-z0-9_]/g, '_');
}

/** Replaces each secret (env/header values) with ••• in an error/log message.
 *  Values shorter than 4 chars are ignored (redacting "1" would wreck any message). */
export function redactSecrets(text: string, secrets: readonly string[]): string {
	let out = String(text ?? '');
	for (const secret of secrets) {
		if (secret && secret.length >= 4) {
			out = out.split(secret).join('•••');
		}
	}
	return out;
}

/** shlex-style split (minimal POSIX-ish): spaces separate, single/double quotes group,
 *  backslash escapes outside single quotes. No globs and no variable expansion: the spawn
 *  is shell:false on purpose (a hook that needs a shell can invoke `sh -c '...'`). */
export function shlexSplit(input: string): string[] {
	const out: string[] = [];
	let current = '';
	let hasToken = false;
	let quote: '"' | '\'' | undefined;
	const text = String(input ?? '');
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote === '\'') {
			if (ch === '\'') { quote = undefined; } else { current += ch; }
		} else if (quote === '"') {
			if (ch === '"') { quote = undefined; }
			else if (ch === '\\' && i + 1 < text.length && (text[i + 1] === '"' || text[i + 1] === '\\')) { current += text[++i]; }
			else { current += ch; }
		} else if (ch === '\'' || ch === '"') {
			quote = ch;
			hasToken = true;
		} else if (ch === '\\' && i + 1 < text.length) {
			current += text[++i];
			hasToken = true;
		} else if (ch === ' ' || ch === '\t') {
			if (hasToken) { out.push(current); current = ''; hasToken = false; }
		} else {
			current += ch;
			hasToken = true;
		}
	}
	if (hasToken) { out.push(current); }
	return out;
}
