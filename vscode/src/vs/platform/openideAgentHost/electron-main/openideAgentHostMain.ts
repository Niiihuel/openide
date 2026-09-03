/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — agent host (main process). Two responsibilities that CANNOT live in the
 *  renderer (el workbench no spawnea procesos):
 *      - MCP client: stdio (spawn with a WHITELISTED env + JSON-RPC 2.0 one-object-per-line —
 *          the same wire as openideDiagramsMcpServer.ts, but on the client side) and Streamable HTTP
 *          (fetch with a Content-Type preflight and an Mcp-Session-Id session);
 *      - shell hook execution (spawn shell:false + one-line JSON stdin / JSON stdout;
 *          what to do with the result is the browser's decision, here it is only executed with a timeout).
 *  SECURITY: EVERY error leaving the service goes through redactSecrets (env/header values from
 *  the config never travel in messages); the process tree is killed on disconnect and on the
 *  app's will-quit (no npx→node zombies); each server's stderr goes to its own log file.
 *  Per-server state: connecting|connected|error|disconnected + parking after 3 failures
 *  transporte consecutivos (revive con mcpConnect de nuevo). Eventos onDid* → ProxyChannel.
 *  ROBUSTNESS: keepalive ping to idle stdio servers (a hung process ⇒ drop + tree kill)
 *  y notifications/tools/list_changed ⇒ re-list debounced + onDidChangeMcpServerTools para
 *  so the workbench re-registers (never ghost tools NOR stale tools in the prompt).
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { accessSync, constants as fsConstants, createWriteStream, statSync, truncateSync, WriteStream } from 'fs';
import { homedir } from 'os';
import { delimiter, isAbsolute, join, resolve as resolvePath } from 'path';
import { app, dialog } from 'electron';
import { lookup } from 'dns/promises';
import { createHash } from 'crypto';
import { Emitter, Event } from '../../../base/common/event.js';
import { isWindows } from '../../../base/common/platform.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILogService } from '../../log/common/log.js';
import { OpenideWebFetchRequest, OpenideWebFetchResponse, validatePublicWebUrl, isPrivateWebAddress, WEB_DEFAULT_MAX_RESPONSE_BYTES, WEB_MAX_REDIRECTS } from '../common/openideWebResearch.js';
import { clampSeconds, HookExecRequest, HookExecResult, HOOK_INPUT_MAX_BYTES, HOOK_TIMEOUT_DEFAULT_SECONDS, HOOK_TIMEOUT_MAX_SECONDS, HOOK_TIMEOUT_MIN_SECONDS, IOpenideAgentHostService, MCP_CALL_TIMEOUT_DEFAULT_SECONDS, MCP_CALL_TIMEOUT_MAX_SECONDS, MCP_CALL_TIMEOUT_MIN_SECONDS, MCP_CONNECT_TIMEOUT_DEFAULT_SECONDS, MCP_MAX_JSONRPC_MESSAGE_BYTES, MCP_MAX_STDERR_LOG_BYTES, consumeMcpJsonLines, McpConnectResult, McpServerConfig, McpServerState, McpServerStatus, McpServerToolsEvent, isMcpToolAllowed, McpRequestBudget, McpToolInfo, McpToolResult, redactSecrets, sanitizeMcpStdioEnvironment, shlexSplit, validateMcpServerConfig } from '../common/openideAgentHost.js';
import { getOpenideOauthPage } from '../common/openideOauthPage.js';
import { IIdeServerInfo, IIdeServerStartOptions, IIdeToolRequest, IIdeToolResult, IIdeToolSchema } from '../common/openideIdeServer.js';
import { OpenideIdeServerMain } from './openideIdeServerMain.js';

const PROTOCOL_VERSION = '2025-03-26';
const CLIENT_INFO = { name: 'openide', version: '1.0.0' };
const MAX_CONSECUTIVE_FAILURES = 3; // fallos de TRANSPORTE seguidos ⇒ parking (isError de tool no cuenta)
const RESULT_CAP = 262_144; // 256k chars: un resultado gigante no viaja entero por IPC ni entra al prompt
const HOOK_OUTPUT_CAP = 65_536; // 64k por stream, igual que hermes
const MAX_ACTIVE_HOOKS = 8;
const MAX_MCP_SERVERS_PER_OWNER = 32;
const MAX_MCP_SERVERS_GLOBAL = 128;
const MAX_MCP_OWNERS = 32;
const GIT_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_OUTPUT_CAP = 64_000;
const GIT_OUTPUT_CAP = 4_000_000; // a status this large means something is very wrong with the repo
const MAX_TOOLS_PER_SERVER = 500; // freno a la paginación de tools/list
const MAX_TOOL_LIST_PAGES = 50;
const MAX_TOOL_CATALOG_BYTES = 2_097_152;
const MAX_TOOL_NAME_CHARS = 256;
const MAX_TOOL_DESCRIPTION_CHARS = 4_096;
const MAX_TOOL_SCHEMA_BYTES = 65_536;
const KEEPALIVE_INTERVAL_MS = 60_000; // ping periódico a servers stdio conectados (detecta procesos COLGADOS, no muertos — esos ya los agarra el 'exit')
const KEEPALIVE_TIMEOUT_MS = 15_000;
const TOOLS_REFRESH_DEBOUNCE_MS = 300; // coalesce de ráfagas de notifications/tools/list_changed
const CONNECT_RETRY_BASE_MS = 2_000;
const CONNECT_RETRY_MAX_MS = 30_000;

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function expandTilde(token: string): string {
	return token === '~' ? homedir() : token.startsWith('~/') ? join(homedir(), token.slice(2)) : token;
}

// ---- env allowlist para servers stdio ----

/** Resolves a bare command (npx, node, uvx…) against the whitelisted env's PATH — spawning
 *  with a custom env does not always re-resolve, and on Windows it adds PATHEXT (npx is npx.cmd). */
function resolveCommandAgainstPath(command: string, env: Record<string, string>): string {
	if (command.includes('/') || command.includes('\\')) {
		return command; // ruta explícita: se respeta tal cual
	}
	const dirs = (env['PATH'] ?? '').split(delimiter).filter(Boolean);
	const exts = isWindows ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [];
	for (const dir of dirs) {
		for (const ext of ['', ...exts]) {
			const candidate = join(dir, command + ext);
			try {
				accessSync(candidate, fsConstants.X_OK);
				return candidate;
			} catch { /* siguiente candidato */ }
		}
	}
	return command; // que spawn falle con un ENOENT claro
}

/** Kills the ENTIRE tree (the "npx spawning a child node" case). On posix it depends on the
 *  process having been spawned with detached:true (its own group ⇒ signal to -pid). */
function killProcessTree(proc: ChildProcess): void {
	const pid = proc.pid;
	if (typeof pid !== 'number') {
		return;
	}
	if (isWindows) {
		try { spawn('taskkill', ['/pid', String(pid), '/T', '/F']); } catch { /* best effort */ }
	} else {
		try { process.kill(-pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* ya murió */ } }
		const hardKill = setTimeout(() => {
			try { process.kill(-pid, 'SIGKILL'); } catch { /* ya murió */ }
		}, 1500);
		// Node timer in main: unref so it does not hold the process during quit
		(hardKill as unknown as { unref?: () => void }).unref?.();
	}
}

// ---- transport: shared stdio/HTTP contract ----

export class McpApplicationError extends Error { }

interface IMcpTransport {
	request(method: string, params: unknown, timeoutMs: number): Promise<any>;
	notify(method: string, params?: unknown): void | Promise<void>;
	close(): void;
}

interface IPendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	requestBytes: number;
}

/** Newline-delimited JSON-RPC 2.0 client over a spawned process's stdin/stdout (the
 *  transporte stdio de MCP). Somos el espejo de openideDiagramsMcpServer.ts. */
export class StdioMcpConnection implements IMcpTransport {

	private nextId = 1;
	private buffer = '';
	private closed = false;
	private readonly requestBudget = new McpRequestBudget();
	private stderrBytes = 0;
	private readonly pending = new Map<number, IPendingRequest>();
	private stderrLog: WriteStream | undefined;

	constructor(
		private readonly proc: ChildProcess,
		stderrLogPath: string,
		private readonly onUnexpectedExit: (detail: string) => void,
		private readonly onNotification: (method: string) => void,
	) {
		try {
			const existingSize = statSync(stderrLogPath).size;
			if (existingSize > MCP_MAX_STDERR_LOG_BYTES) { truncateSync(stderrLogPath, 0); }
			else { this.stderrBytes = existingSize; }
		} catch { /* archivo nuevo o no accesible */ }
		try {
			this.stderrLog = createWriteStream(stderrLogPath, { flags: 'a', mode: 0o600 });
			this.stderrLog.on('error', () => { this.stderrLog?.destroy(); this.stderrLog = undefined; });
		} catch { /* sin log de stderr: no es fatal */ }
		proc.stdin?.on('error', e => { const detail = `stdin MCP falló: ${errText(e)}`; this.failAll(detail); killProcessTree(this.proc); this.drop(detail); });
		proc.stdout?.setEncoding('utf8');
		proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
		proc.stderr?.setEncoding('utf8');
		proc.stderr?.on('data', (chunk: string) => {
			if (!this.stderrLog || this.stderrBytes >= MCP_MAX_STDERR_LOG_BYTES) { return; }
			const remaining = MCP_MAX_STDERR_LOG_BYTES - this.stderrBytes;
			const data = Buffer.from(chunk).subarray(0, remaining);
			this.stderrBytes += data.byteLength;
			this.stderrLog.write(data);
		});
		proc.on('error', e => {
			this.failAll(`no se pudo ejecutar el proceso MCP: ${errText(e)}`);
			this.drop(`no se pudo ejecutar el proceso MCP: ${errText(e)}`);
		});
		proc.on('exit', (code, signal) => {
			const detail = `el proceso MCP terminó inesperadamente (${signal ?? `exit ${code}`})`;
			this.failAll(detail);
			this.drop(detail);
		});
	}

	private drop(detail: string): void {
		if (!this.closed) {
			this.closed = true;
			this.stderrLog?.end();
			this.onUnexpectedExit(detail);
		}
	}

	private failAll(message: string): void {
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(new Error(message));
		}
		this.pending.clear();
		this.requestBudget.clear();
	}

	private onData(chunk: string): void {
		if (this.closed) { return; }
		const consumed = consumeMcpJsonLines(this.buffer, chunk);
		this.buffer = consumed.rest;
		if (consumed.error) { this.failAll(consumed.error); this.drop(consumed.error); killProcessTree(this.proc); return; }
		for (const rawLine of consumed.lines) {
			const line = rawLine.trim();
			if (!line) { continue; }
			let msg: any;
			try { msg = JSON.parse(line); } catch { continue; } // línea no-JSON: ruido en stdout, se ignora
			if (msg?.method !== undefined && msg?.id !== undefined && msg.id !== null) {
				const result = msg.method === 'ping' ? {} : undefined;
				this.write(result !== undefined ? { jsonrpc: '2.0', id: msg.id, result } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `método no soportado: ${msg.method}` } });
			} else if (msg?.jsonrpc === '2.0' && msg?.method === undefined && typeof msg?.id === 'number' && (Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error')) && this.pending.has(msg.id)) {
				const entry = this.pending.get(msg.id)!;
				this.pending.delete(msg.id);
				this.requestBudget.release(entry.requestBytes);
				clearTimeout(entry.timer);
				if (msg.error) {
					entry.reject(new McpApplicationError(String(msg.error.message ?? 'error MCP sin mensaje')));
				} else {
					entry.resolve(msg.result);
				}
			} else if (typeof msg?.method === 'string') {
				// server→client notification (e.g. notifications/tools/list_changed)
				this.onNotification(msg.method);
			}
		}
	}

	/** Are there requests in flight? The keepalive does not disturb a busy server (a server
	 *  single-threaded procesando un tool-call largo NO es un server colgado). */
	hasPending(): boolean {
		return this.pending.size > 0;
	}

	private write(msg: unknown): void {
		try {
			this.proc.stdin?.write(JSON.stringify(msg) + '\n');
		} catch { /* proceso muerto: los requests pendientes ya fallan por 'exit' */ }
	}

	request(method: string, params: unknown, timeoutMs: number): Promise<any> {
		if (this.closed) { return Promise.reject(new Error('el server MCP no está conectado')); }
		const id = this.nextId++;
		const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
		const requestBytes = Buffer.byteLength(payload, 'utf8');
		const budgetError = this.requestBudget.reserve(requestBytes);
		if (budgetError) { return Promise.reject(new Error(budgetError)); }
		return new Promise<any>((resolve, reject) => {
			const timer = setTimeout(() => {
				const pending = this.pending.get(id);
				if (pending) { this.pending.delete(id); this.requestBudget.release(pending.requestBytes); }
				reject(new Error(`timeout tras ${Math.round(timeoutMs / 1000)}s esperando ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer, requestBytes });
			try { this.proc.stdin?.write(payload); }
			catch { this.pending.delete(id); this.requestBudget.release(requestBytes); clearTimeout(timer); reject(new Error('no se pudo escribir al server MCP')); }
		});
	}

	notify(method: string, params?: unknown): void {
		this.write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.failAll('conexión MCP cerrada');
		this.stderrLog?.end();
		try { this.proc.stdin?.end(); } catch { /* ya cerrado */ }
		killProcessTree(this.proc);
	}
}

/** Streamable HTTP client: POST per JSON-RPC request; the response may arrive as direct JSON
 *  or as an SSE stream with the result inside. Mcp-Session-Id is captured on initialize
 *  and resent on every request (as the spec requires). */
class HttpMcpConnection implements IMcpTransport {

	private nextId = 1;
	private sessionId: string | undefined;
	private closed = false;
	private readonly requestBudget = new McpRequestBudget();
	private readonly controllers = new Set<AbortController>();

	constructor(
		private readonly url: string,
		private readonly headers: Readonly<Record<string, string>>,
	) { }

	private buildHeaders(): Record<string, string> {
		const result: Record<string, string> = { ...this.headers };
		result['Content-Type'] = 'application/json';
		result['Accept'] = 'application/json, text/event-stream';
		result['MCP-Protocol-Version'] = PROTOCOL_VERSION;
		if (this.sessionId) {
			result['Mcp-Session-Id'] = this.sessionId;
		}
		return result;
	}

	async request(method: string, params: unknown, timeoutMs: number): Promise<any> {
		if (this.closed) { throw new Error('el server MCP no está conectado'); }
		const id = this.nextId++;
		const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
		const payloadBytes = Buffer.byteLength(payload, 'utf8');
		const budgetError = this.requestBudget.reserve(payloadBytes);
		if (budgetError) { throw new Error(budgetError); }
		const controller = new AbortController(); this.controllers.add(controller);
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(this.url, {
				method: 'POST',
				headers: this.buildHeaders(),
				body: payload,
				signal: controller.signal,
			});
			if (method === 'initialize') {
				this.sessionId = response.headers.get('mcp-session-id') ?? undefined;
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} llamando ${method}`);
			}
			// Content-Type preflight: if the endpoint returns HTML, it is a page, not MCP
			const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
			let msg: any;
			if (contentType.includes('application/json')) {
				const responseText = await readLimitedResponse(response, MCP_MAX_JSONRPC_MESSAGE_BYTES);
				try { msg = JSON.parse(responseText); } catch { throw new Error('la respuesta MCP contiene JSON inválido'); }
			} else if (contentType.includes('text/event-stream')) {
				msg = await readSseResponse(response, id, MCP_MAX_JSONRPC_MESSAGE_BYTES);
			} else {
				throw new Error(`la URL respondió Content-Type "${contentType || 'desconocido'}": parece una página web, no un endpoint MCP (Streamable HTTP)`);
			}
			if (msg?.jsonrpc !== '2.0' || msg?.id !== id) { throw new Error(`respuesta MCP no correlacionada para ${method}`); }
			if (msg?.error) {
				throw new McpApplicationError(String(msg.error.message ?? 'error MCP sin mensaje'));
			}
			return msg?.result;
		} catch (e) {
			if (controller.signal.aborted) {
				throw new Error(`timeout tras ${Math.round(timeoutMs / 1000)}s esperando ${method}`);
			}
			throw e;
		} finally {
			clearTimeout(timer); this.controllers.delete(controller); this.requestBudget.release(payloadBytes);
		}
	}

	async notify(method: string, params?: unknown): Promise<void> {
		if (this.closed || this.controllers.size >= 1) { return; }
		const payload = JSON.stringify(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
		if (Buffer.byteLength(payload, 'utf8') > MCP_MAX_JSONRPC_MESSAGE_BYTES) { return; }
		const controller = new AbortController(); this.controllers.add(controller);
		const timer = setTimeout(() => controller.abort(), 15_000);
		try {
			const response = await fetch(this.url, { method: 'POST', headers: this.buildHeaders(), body: payload, signal: controller.signal });
			if (!response.ok && response.status !== 202) { throw new Error(`HTTP ${response.status} enviando ${method}`); }
		} finally { clearTimeout(timer); this.controllers.delete(controller); }
	}

	close(): void {
		if (this.closed) { return; }
		this.closed = true;
		for (const controller of this.controllers) { controller.abort(); }
		this.controllers.clear(); this.requestBudget.clear();
		if (this.sessionId) {
			const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5_000);
			fetch(this.url, { method: 'DELETE', headers: this.buildHeaders(), signal: controller.signal }).catch(() => undefined).finally(() => clearTimeout(timer));
			this.sessionId = undefined;
		}
	}
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
	if (!response.body) { return ''; }
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) { break; }
			bytes += value.byteLength;
			if (bytes > maxBytes) { await reader.cancel(); throw new Error(`respuesta MCP excede ${maxBytes} bytes`); }
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally { reader.releaseLock(); }
}

async function readSseResponse(response: Response, id: number, maxBytes: number): Promise<any> {
	if (!response.body) { throw new Error('la respuesta SSE no tiene body'); }
	const reader = response.body.getReader(); const decoder = new TextDecoder();
	let bytes = 0; let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) { break; }
			bytes += value.byteLength;
			if (bytes > maxBytes) { throw new Error(`respuesta MCP excede ${maxBytes} bytes`); }
			buffer += decoder.decode(value, { stream: true });
			let boundary: number;
			while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
				const block = buffer.slice(0, boundary); const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0].length ?? 2; buffer = buffer.slice(boundary + separator);
				const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
				if (!data) { continue; }
				try { const msg = JSON.parse(data); if (msg?.id === id) { await reader.cancel(); return msg; } } catch { /* evento no JSON */ }
			}
		}
	} finally {
		try { await reader.cancel(); } catch { /* stream ya cerrado */ }
		reader.releaseLock();
	}
	throw new Error('la respuesta SSE no trajo el resultado del request');
}

/** Flattens a tools/call content to text (non-text items are annotated, not lost). */
function appendCappedUtf8(current: string, chunk: string, maxBytes: number): string {
	const currentBytes = Buffer.byteLength(current, 'utf8');
	if (currentBytes >= maxBytes) { return current; }
	const source = Buffer.from(chunk);
	return current + source.subarray(0, maxBytes - currentBytes).toString('utf8');
}

function extractContentText(result: any): string {
	const content = Array.isArray(result?.content) ? result.content : [];
	const parts: string[] = [];
	for (const item of content) {
		if (item?.type === 'text') {
			parts.push(String(item.text ?? ''));
		} else if (item?.type === 'resource' && item.resource?.text !== undefined) {
			parts.push(String(item.resource.text));
		} else if (item?.type) {
			parts.push(`[contenido ${item.type} omitido]`);
		}
	}
	if (!parts.length) {
		return result?.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : JSON.stringify(result ?? null);
	}
	return parts.join('\n');
}

// ---- servicio ----

interface IServerEntry {
	config: McpServerConfig;
	clientId: string;
	serverId: string;
	generation: number;
	state: McpServerState;
	connection: IMcpTransport | undefined;
	tools: McpToolInfo[];
	serverInfo: { name: string; version: string } | undefined;
	/** Fallos de transporte consecutivos (parking al llegar a MAX_CONSECUTIVE_FAILURES).
	 *  It is PRESERVED across reconnections and cleared only on a successful connect: that way the
	 *  workbench's backoff that retries and fails really ends up parked. */
	failures: number;
	/** Did initialize announce capabilities.tools? */
	supportsTools: boolean;
	supportsToolsListChanged: boolean;
	/** Keepalive ping en vuelo (no encimar pings si el server tarda). */
	pinging: boolean;
	/** Debounce del re-list tras notifications/tools/list_changed. */
	toolsRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	/** env/header values from the config: redacted from EVERY error leaving the service. */
	secrets: string[];
	error: string | undefined;
	/** Host-side backoff: avoids reconnect storms from multiple windows/workbench clients. */
	retryAfter: number;
	lastToolsRefresh: number;
	toolsRefreshGeneration: number;
}

export class OpenideAgentHostMainService implements IOpenideAgentHostService {

	private readonly servers = new Map<string, IServerEntry>();
	private readonly ownerTokens = new Map<string, { token: string; heartbeatAt: number }>();
	private readonly serverReservations = new Map<string, string>();
	private serverKey(clientId: string, serverId: string): string { return `${clientId}\0${serverId}`; }
	private authorizeOwner(clientId: string, token: string): boolean {
		const owner = this.ownerTokens.get(clientId);
		if (!owner) { if (this.ownerTokens.size >= MAX_MCP_OWNERS || clientId.length > 128 || token.length > 128) { return false; } this.ownerTokens.set(clientId, { token, heartbeatAt: Date.now() }); return true; }
		if (owner.token !== token) { return false; }
		owner.heartbeatAt = Date.now(); return true;
	}

	private readonly _onDidChangeMcpServerStatus = new Emitter<McpServerStatus>();
	readonly onDidChangeMcpServerStatus: Event<McpServerStatus> = this._onDidChangeMcpServerStatus.event;

	private readonly _onDidChangeMcpServerTools = new Emitter<McpServerToolsEvent>();
	readonly onDidChangeMcpServerTools: Event<McpServerToolsEvent> = this._onDidChangeMcpServerTools.event;

	/**
	 * The inbound half of this service: OpenIDE serving its own tools to the CLIs in the dock.
	 * Composed rather than merged — it shares this channel and this process lifetime, and
	 * nothing else. Its events are re-exported below so the workbench sees one service.
	 */
	private readonly ideServer = new OpenideIdeServerMain(this.logService);

	readonly onDidRequestIdeTool: Event<IIdeToolRequest> = this.ideServer.onDidRequestTool;
	readonly onDidChangeIdeConnections: Event<number> = this.ideServer.onDidChangeConnections;

	ideServerStart(options: IIdeServerStartOptions, extraTools: readonly IIdeToolSchema[]): Promise<IIdeServerInfo> {
		return this.ideServer.start(options, extraTools);
	}

	async ideRespondTool(requestId: string, result: IIdeToolResult): Promise<void> {
		this.ideServer.respondTool(requestId, result);
	}

	async ideNotify(method: string, params: unknown): Promise<void> {
		this.ideServer.notify(method, params);
	}

	async ideWriteMcpConfig(sessionId: string, contents: string): Promise<string> {
		return this.ideServer.writeSessionMcpConfig(sessionId, contents);
	}

	async ideSetExtraTools(tools: readonly IIdeToolSchema[]): Promise<void> {
		this.ideServer.setExtraTools(tools);
	}

	ideRegisterInCli(executable: string, args: readonly string[]): Promise<string> {
		return this.ideServer.registerInCli(executable, args);
	}

	/**
	 * `git` in a working directory, for the change tracking that watches what an external CLI did.
	 *
	 * In main and not through the workbench's shared agent terminal on purpose: that terminal is
	 * the agent's own, and a status query fired on every turn boundary would contend with the
	 * commands the user is watching — the same interleaving that made the CLI picker report
	 * installed agents as missing.
	 *
	 * `shell: false`, a hardcoded executable and argv built by the caller from a fixed vocabulary,
	 * so nothing here is re-split by a shell.
	 */
	/**
	 * One short command in the user's login shell, captured, with no terminal involved.
	 *
	 * A login shell and not this process's environment because that is where the user's PATH is:
	 * a GUI-launched editor inherits a minimal one, and the agents live in `~/.local/bin`,
	 * `~/.npm-global/bin` and the like. The command is built from a fixed vocabulary by the
	 * caller — it never contains anything a user typed.
	 */
	async probeShell(command: string): Promise<string> {
		if (typeof command !== 'string' || !command || command.length > 8_192 || command.includes('\0')) {
			return '';
		}
		const shell = isWindows ? (process.env['ComSpec'] || 'cmd.exe') : (process.env['SHELL'] || '/bin/sh');
		const args = isWindows ? ['/d', '/c', command] : ['-l', '-c', command];
		return new Promise(resolve => {
			let child;
			try {
				child = spawn(shell, args, { shell: false, windowsHide: true });
			} catch {
				return resolve('');
			}
			let stdout = '';
			child.stdout?.on('data', chunk => {
				if (stdout.length < PROBE_OUTPUT_CAP) {
					stdout += String(chunk);
				}
			});
			child.stderr?.on('data', () => { /* a login shell prints its own noise; not our business */ });
			const timer = setTimeout(() => { child.kill(); resolve(''); }, PROBE_TIMEOUT_MS);
			child.on('error', () => { clearTimeout(timer); resolve(''); });
			child.on('exit', () => { clearTimeout(timer); resolve(stdout); });
		});
	}

	async runGit(cwd: string, args: readonly string[]): Promise<{ stdout: string; ok: boolean }> {
		if (typeof cwd !== 'string' || !cwd || cwd.includes('\0') || args.length > 64 || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
			return { stdout: '', ok: false };
		}
		return new Promise(resolve => {
			let child;
			try {
				child = spawn('git', [...args], { cwd, shell: false, windowsHide: true });
			} catch {
				return resolve({ stdout: '', ok: false }); // no git on this machine
			}
			let stdout = '';
			let truncated = false;
			child.stdout?.on('data', chunk => {
				if (stdout.length > GIT_OUTPUT_CAP) { truncated = true; return; }
				stdout += String(chunk);
			});
			child.stderr?.on('data', () => { /* git's diagnostics are not the caller's business */ });
			const timer = setTimeout(() => { child.kill(); resolve({ stdout: '', ok: false }); }, GIT_TIMEOUT_MS);
			child.on('error', () => { clearTimeout(timer); resolve({ stdout: '', ok: false }); });
			child.on('exit', code => {
				clearTimeout(timer);
				// A truncated status is worse than none: it would report the files it happened to
				// fit and silently drop the rest, which reads as "the agent only touched these".
				resolve({ stdout: truncated ? '' : stdout, ok: code === 0 && !truncated });
			});
		});
	}

	async ideServerStop(): Promise<void> {
		this.ideServer.stop();
	}

	constructor(
		private readonly logService: ILogService,
		private readonly environmentMainService: IEnvironmentMainService,
	) {
		// keepalive: detecta servers stdio COLGADOS (los muertos ya disparan 'exit')
		const keepalive = setInterval(() => this.keepaliveTick(), KEEPALIVE_INTERVAL_MS);
		(keepalive as unknown as { unref?: () => void }).unref?.();
		// no zombies: on app close every still-alive MCP process tree is torn down
		app.once('will-quit', () => {
			clearInterval(keepalive);
			// The lockfile has to go with the window, or the next CLI dials a dead port.
			this.ideServer.stop();
			this.disposeAll();
		});
	}

	private statusOf(id: string, entry: IServerEntry): McpServerStatus {
		return {
			id: entry.serverId,
			clientId: entry.clientId,
			generation: entry.generation,
			state: entry.state,
			toolCount: entry.tools.length,
			error: entry.error,
			serverName: entry.serverInfo?.name,
			// parked = accumulated failures hit the ceiling: the workbench no longer auto-retries
			parked: entry.state === 'error' && entry.failures >= MAX_CONSECUTIVE_FAILURES,
			retryAfter: entry.retryAfter > Date.now() ? entry.retryAfter : undefined,
		};
	}

	private emitStatus(id: string, entry: IServerEntry): void {
		this._onDidChangeMcpServerStatus.fire(this.statusOf(id, entry));
	}

	/** The process/endpoint went down on its own (unexpected exit): parking + a notice to the
	 *  workbench so it deregisters the tools (never ghost tools in the prompt). */
	private onServerDropped(id: string, detail: string): void {
		const entry = this.servers.get(id);
		if (!entry || (entry.state !== 'connected' && entry.state !== 'connecting')) {
			return;
		}
		entry.state = 'error';
		entry.error = redactSecrets(detail, entry.secrets);
		entry.connection = undefined;
		entry.tools = [];
		entry.failures++; // una caída también acerca al parking (un server que muere en loop no reintenta infinito)
		entry.retryAfter = Date.now() + Math.min(CONNECT_RETRY_MAX_MS, CONNECT_RETRY_BASE_MS * (2 ** Math.max(0, entry.failures - 1)));
		this.logService.warn(`[openide-mcp] ${id}: ${entry.error}`);
		this.emitStatus(id, entry);
	}

	/** Asynchronous notification from a stdio server. tools/list_changed ⇒ re-list (debounced)
	 *  + event to the workbench to re-register — the live registry is the turn's source. */
	private onServerNotification(id: string, method: string): void {
		if (method !== 'notifications/tools/list_changed') {
			return;
		}
		const entry = this.servers.get(id);
		if (!entry || entry.state !== 'connected' || !entry.supportsTools || !entry.supportsToolsListChanged) {
			return;
		}
		if (entry.toolsRefreshTimer) { clearTimeout(entry.toolsRefreshTimer); }
		entry.toolsRefreshGeneration++; entry.tools = [];
		this._onDidChangeMcpServerTools.fire({ id: entry.serverId, clientId: entry.clientId, generation: entry.generation, tools: [] });
		this.emitStatus(entry.serverId, entry);
		entry.toolsRefreshTimer = setTimeout(() => {
			entry.toolsRefreshTimer = undefined;
			this.refreshTools(id);
		}, TOOLS_REFRESH_DEBOUNCE_MS);
	}

	private async refreshTools(id: string): Promise<void> {
		const entry = this.servers.get(id);
		if (!entry || entry.state !== 'connected' || !entry.connection) {
			return;
		}
		const timeoutMs = clampSeconds(entry.config.connectTimeout, MCP_CONNECT_TIMEOUT_DEFAULT_SECONDS, 5, 120) * 1000;
		const refreshGeneration = ++entry.toolsRefreshGeneration;
		try {
			const connection = entry.connection;
			const tools = await this.listAllTools(connection, timeoutMs);
			if (this.servers.get(id) !== entry || entry.connection !== connection || entry.state !== 'connected' || entry.toolsRefreshGeneration !== refreshGeneration) { return; }
			entry.tools = tools;
			this.logService.info(`[openide-mcp] ${id}: tools/list_changed — ahora ${entry.tools.length} tools`);
			this.emitStatus(id, entry);
			this._onDidChangeMcpServerTools.fire({ id: entry.serverId, clientId: entry.clientId, generation: entry.generation, tools: entry.tools });
		} catch (e) {
			if (this.servers.get(id) === entry && entry.state === 'connected' && entry.toolsRefreshGeneration === refreshGeneration) {
				entry.tools = [];
				this._onDidChangeMcpServerTools.fire({ id: entry.serverId, clientId: entry.clientId, generation: entry.generation, tools: [] });
				this.emitStatus(entry.serverId, entry);
			}
			this.logService.warn(`[openide-mcp] ${id}: re-list tras tools/list_changed falló — catálogo invalidado — ${redactSecrets(errText(e), entry.secrets)}`);
		}
	}

	/** Ping to every connected and IDLE stdio server. Only a TIMEOUT counts as hung: an error
	 *  response means the transport is alive (some servers have no ping implemented). */
	private keepaliveTick(): void {
		const staleBefore = Date.now() - 180_000;
		for (const [clientId, owner] of this.ownerTokens) {
			if (owner.heartbeatAt < staleBefore) {
				for (const [key, entry] of [...this.servers]) {
					if (entry.clientId === clientId) {
						entry.toolsRefreshGeneration++; entry.tools = []; entry.state = 'disconnected'; entry.connection?.close(); entry.connection = undefined;
						this.emitStatus(entry.serverId, entry); this._onDidChangeMcpServerTools.fire({ id: entry.serverId, clientId, generation: entry.generation, tools: [] }); this.servers.delete(key);
					}
				}
				this.ownerTokens.delete(clientId);
			}
		}
		for (const [id, entry] of this.servers) {
			const connection = entry.connection;
			if (entry.state === 'connected' && entry.supportsTools && Date.now() - entry.lastToolsRefresh > 60_000 && !entry.pinging) {
				entry.lastToolsRefresh = Date.now(); void this.refreshTools(id);
			}
			if (entry.state !== 'connected' || !(connection instanceof StdioMcpConnection) || connection.hasPending() || entry.pinging) {
				continue;
			}
			entry.pinging = true;
			connection.request('ping', {}, KEEPALIVE_TIMEOUT_MS)
				.catch(e => {
					if (this.servers.get(id) === entry && entry.state === 'connected' && errText(e).startsWith('timeout')) {
						this.onServerDropped(id, 'no respondió al keepalive ping — proceso colgado');
						connection.close(); // el proceso sigue vivo pero colgado: abajo el árbol
					}
				})
				.finally(() => { entry.pinging = false; });
		}
	}

	private spawnStdio(key: string, id: string, config: McpServerConfig): StdioMcpConnection {
		const env = sanitizeMcpStdioEnvironment(process.env, config.env);
		const command = resolveCommandAgainstPath(expandTilde(String(config.command)), env);
		const proc = spawn(command, (config.args ?? []).map(String), {
			env,
			// .cmd/.bat cannot be spawned without a shell in modern Node (EINVAL post-CVE)
			shell: isWindows && /\.(cmd|bat)$/i.test(command),
			detached: !isWindows, // grupo de procesos propio ⇒ killProcessTree mata a los hijos
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const ownerHash = createHash('sha256').update(key).digest('hex').slice(0, 16);
		const logPath = join(this.environmentMainService.logsHome.fsPath, `openide-mcp-${id}-${ownerHash}.log`);
		return new StdioMcpConnection(proc, logPath, detail => this.onServerDropped(key, detail), method => this.onServerNotification(key, method));
	}

	async mcpConnect(clientId: string, ownerToken: string, id: string, config: McpServerConfig, generation: number): Promise<McpConnectResult> {
		if (!this.authorizeOwner(clientId, ownerToken)) { throw new Error('owner MCP no autorizado'); }
		const invalid = validateMcpServerConfig(id, config);
		if (invalid) { throw new Error(invalid); }
		const key = this.serverKey(clientId, id);
		const ownerReserved = [...this.serverReservations.values()].filter(owner => owner === clientId).length;
		const existingForOwner = [...this.servers.values()].filter(entry => entry.clientId === clientId && this.serverKey(clientId, entry.serverId) !== key).length;
		if (!this.servers.has(key) && !this.serverReservations.has(key) && (existingForOwner + ownerReserved >= MAX_MCP_SERVERS_PER_OWNER || this.servers.size + this.serverReservations.size >= MAX_MCP_SERVERS_GLOBAL)) { throw new Error('límite de servers MCP alcanzado'); }
		this.serverReservations.set(key, clientId);
		const approval = await dialog.showMessageBox({ type: 'warning', buttons: ['Conectar una vez', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true, title: 'OpenIDE — Conectar servidor MCP', message: config.command ? 'Un servidor MCP solicita ejecutar un proceso local.' : 'Un servidor MCP solicita contactar un endpoint de red.', detail: config.command ? `${config.command.slice(0, 2_048)} ${(config.args ?? []).join(' ').slice(0, 2_048)}` : String(config.url).slice(0, 4_096) });
		if (approval.response !== 0) { this.serverReservations.delete(key); throw new Error('conexión MCP rechazada por el usuario'); }
		// accumulated failures are preserved across reconnection (only a successful connect clears
		// them): that way the workbench's backoff retries really end up parked
		const previous = this.servers.get(key);
		const prevFailures = previous?.failures ?? 0;
		if (previous?.retryAfter && previous.retryAfter > Date.now() && prevFailures < MAX_CONSECUTIVE_FAILURES) {
			this.serverReservations.delete(key); throw new Error(`"${id}": reintento demasiado temprano; esperá ${Math.ceil((previous.retryAfter - Date.now()) / 1000)}s`);
		}
		await this.mcpDisconnect(clientId, ownerToken, id); // reconexión limpia del mismo owner
		const entry: IServerEntry = {
			config,
			clientId,
			serverId: id,
			generation,
			state: 'connecting',
			connection: undefined,
			tools: [],
			serverInfo: undefined,
			failures: prevFailures,
			supportsTools: false,
			supportsToolsListChanged: false,
			pinging: false,
			toolsRefreshTimer: undefined,
			secrets: [...Object.values(config.env ?? {}), ...Object.values(config.headers ?? {})].map(String),
			error: undefined,
			retryAfter: 0,
			lastToolsRefresh: 0,
			toolsRefreshGeneration: 0,
		};
		this.servers.set(key, entry); this.serverReservations.delete(key);
		this.emitStatus(id, entry);
		let generationConnection: IMcpTransport | undefined;
		try {
			const connectTimeoutMs = clampSeconds(config.connectTimeout, MCP_CONNECT_TIMEOUT_DEFAULT_SECONDS, 5, 120) * 1000;
			const connection: IMcpTransport = config.command ? this.spawnStdio(key, id, config) : new HttpMcpConnection(String(config.url), config.headers ?? {});
			entry.connection = connection;
			generationConnection = connection;
			const generationEntry = entry;
			const init = await connection.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, connectTimeoutMs);
			if (this.servers.get(key) !== generationEntry || generationEntry.connection !== connection) { connection.close(); throw new Error('conexión MCP reemplazada durante initialize'); }
			if (init?.protocolVersion !== PROTOCOL_VERSION) { throw new Error(`versión MCP incompatible: ${String(init?.protocolVersion ?? 'ausente')}`); }
			if (!init?.capabilities || typeof init.capabilities !== 'object' || Array.isArray(init.capabilities)) { throw new Error('capabilities MCP inválidas'); }
			await connection.notify('notifications/initialized');
			if (init?.serverInfo?.name) {
				entry.serverInfo = { name: String(init.serverInfo.name), version: String(init.serverInfo.version ?? '') };
			}
			// capability gating: tools/list ONLY if the server announces tools on initialize
			if (init.capabilities.tools !== undefined && (!init.capabilities.tools || typeof init.capabilities.tools !== 'object' || Array.isArray(init.capabilities.tools))) { throw new Error('capability tools MCP inválida'); }
			entry.supportsTools = !!init.capabilities.tools;
			entry.supportsToolsListChanged = config.command ? init.capabilities.tools?.listChanged === true : false;
			entry.tools = entry.supportsTools ? await this.listAllTools(connection, connectTimeoutMs) : [];
			if (this.servers.get(key) !== generationEntry || generationEntry.connection !== connection) { connection.close(); throw new Error('conexión MCP reemplazada durante tools/list'); }
			entry.state = 'connected';
			entry.failures = 0;
			entry.retryAfter = 0;
			entry.error = undefined;
			this.logService.info(`[openide-mcp] ${id}: conectado (${entry.tools.length} tools)`);
			this.emitStatus(id, entry);
			return { clientId, generation: entry.generation, tools: entry.tools, serverInfo: entry.serverInfo };
		} catch (e) {
			const message = redactSecrets(errText(e), entry.secrets);
			generationConnection?.close();
			if (this.servers.get(key) !== entry || entry.connection !== generationConnection || entry.state !== 'connecting') { throw new Error(message); }
			entry.connection = undefined;
			entry.tools = [];
			entry.state = 'error';
			entry.error = message;
			entry.failures++;
			entry.retryAfter = Date.now() + Math.min(CONNECT_RETRY_MAX_MS, CONNECT_RETRY_BASE_MS * (2 ** Math.max(0, entry.failures - 1)));
			this.logService.warn(`[openide-mcp] ${id}: fallo de conexión — ${message}`);
			this.emitStatus(id, entry);
			throw new Error(message);
		}
	}

	private async listAllTools(connection: IMcpTransport, timeoutMs: number): Promise<McpToolInfo[]> {
		const tools: McpToolInfo[] = [];
		const seenCursors = new Set<string>();
		let catalogBytes = 0;
		const deadline = Date.now() + timeoutMs;
		let cursor: string | undefined;
		let pages = 0;
		do {
			if (++pages > MAX_TOOL_LIST_PAGES) { throw new Error(`tools/list excede ${MAX_TOOL_LIST_PAGES} páginas`); }
			const remaining = deadline - Date.now();
			if (remaining <= 0) { throw new Error('timeout total durante tools/list'); }
			const res = await connection.request('tools/list', cursor ? { cursor } : {}, remaining);
			if (!res || typeof res !== 'object' || Array.isArray(res) || !Array.isArray(res.tools)) { throw new Error('respuesta tools/list inválida'); }
			if (res.nextCursor !== undefined && (typeof res.nextCursor !== 'string' || !res.nextCursor)) { throw new Error('nextCursor inválido'); }
			for (const t of res.tools) {
				if (tools.length >= MAX_TOOLS_PER_SERVER) { break; }
				if (!t || typeof t !== 'object' || Array.isArray(t) || typeof t.name !== 'string' || !t.name || t.name.length > MAX_TOOL_NAME_CHARS || (t.description !== undefined && typeof t.description !== 'string') || !t.inputSchema || typeof t.inputSchema !== 'object' || Array.isArray(t.inputSchema) || t.inputSchema.type !== 'object' || (t.inputSchema.properties !== undefined && (!t.inputSchema.properties || typeof t.inputSchema.properties !== 'object' || Array.isArray(t.inputSchema.properties))) || (t.inputSchema.required !== undefined && (!Array.isArray(t.inputSchema.required) || t.inputSchema.required.some((item: unknown) => typeof item !== 'string'))) || (t.inputSchema.additionalProperties !== undefined && typeof t.inputSchema.additionalProperties !== 'boolean' && (typeof t.inputSchema.additionalProperties !== 'object' || !t.inputSchema.additionalProperties))) { throw new Error('definición de tool MCP inválida'); }
				{
					const name = t.name;
					const description = String(t.description ?? '').slice(0, MAX_TOOL_DESCRIPTION_CHARS);
					const inputSchema = t.inputSchema ?? { type: 'object', properties: {} };
					const annotations = t.annotations?.readOnlyHint === true ? { readOnlyHint: true } : undefined;
					let schemaBytes = 0;
					try { schemaBytes = Buffer.byteLength(JSON.stringify(inputSchema), 'utf8'); } catch { throw new Error(`schema inválido para tool "${name}"`); }
					if (schemaBytes > MAX_TOOL_SCHEMA_BYTES) { throw new Error(`schema de tool "${name}" excede ${MAX_TOOL_SCHEMA_BYTES} bytes`); }
					catalogBytes += Buffer.byteLength(name + description, 'utf8') + schemaBytes;
					if (catalogBytes > MAX_TOOL_CATALOG_BYTES) { throw new Error(`catálogo MCP excede ${MAX_TOOL_CATALOG_BYTES} bytes`); }
					tools.push({ name, description, inputSchema, annotations });
				}
			}
			cursor = typeof res?.nextCursor === 'string' && res.nextCursor ? res.nextCursor : undefined;
			if (cursor && seenCursors.has(cursor)) { throw new Error(`tools/list repitió el cursor "${cursor}"`); }
			if (cursor) { seenCursors.add(cursor); }
		} while (cursor && tools.length < MAX_TOOLS_PER_SERVER);
		return tools;
	}

	async mcpCallTool(clientId: string, ownerToken: string, id: string, generation: number, tool: string, args: unknown, timeoutMs: number): Promise<McpToolResult> {
		if (!this.authorizeOwner(clientId, ownerToken)) { return { text: 'Error: owner MCP no autorizado.', isError: true }; }
		const entry = this.servers.get(this.serverKey(clientId, id));
		if (entry && entry.generation !== generation) { return { text: 'Error: la conexión MCP fue reemplazada.', isError: true }; }
		if (entry && (!entry.tools.some(candidate => candidate.name === tool) || !isMcpToolAllowed(entry.config, tool))) { return { text: 'Error: tool MCP no autorizada por el catálogo vigente.', isError: true }; }
		if (!entry || entry.state !== 'connected' || !entry.connection) {
			const why = entry?.error ? ` (${entry.error})` : '';
			return { text: `Error: el server MCP "${id}" no está conectado${why}.`, isError: true };
		}
		const ms = clampSeconds(timeoutMs / 1000, MCP_CALL_TIMEOUT_DEFAULT_SECONDS, MCP_CALL_TIMEOUT_MIN_SECONDS, MCP_CALL_TIMEOUT_MAX_SECONDS) * 1000;
		try {
			const result = await entry.connection.request('tools/call', { name: tool, arguments: args ?? {} }, ms);
			entry.failures = 0; // el transporte respondió: isError de la TOOL no cuenta como fallo
			return { text: extractContentText(result).slice(0, RESULT_CAP), isError: !!result?.isError };
		} catch (e) {
			const message = redactSecrets(errText(e), entry.secrets);
			if (e instanceof McpApplicationError) { entry.failures = 0; return { text: `Error: ${message}`, isError: true }; }
			if (entry.state !== 'connected' || !entry.connection) { return { text: `Error: ${message}`, isError: true }; }
			entry.failures++;
			if (entry.failures >= MAX_CONSECUTIVE_FAILURES && entry.state === 'connected') {
				// parking: 3 fallos de transporte seguidos ⇒ error + tools afuera; revive con mcpConnect
				entry.state = 'error';
				entry.error = `${message} (parkeado tras ${entry.failures} fallos seguidos)`;
				entry.connection?.close();
				entry.connection = undefined;
				entry.tools = [];
				this.logService.warn(`[openide-mcp] ${id}: parkeado — ${message}`);
				this.emitStatus(id, entry);
			}
			return { text: `Error: ${message}`, isError: true };
		}
	}

	async mcpDisconnect(clientId: string, ownerToken: string, id: string, generation?: number): Promise<void> {
		if (!this.authorizeOwner(clientId, ownerToken)) { return; }
		const key = this.serverKey(clientId, id);
		const entry = this.servers.get(key);
		if (entry && generation !== undefined && entry.generation !== generation) { return; }
		if (!entry) {
			this.serverReservations.delete(key);
			if (![...this.servers.values()].some(candidate => candidate.clientId === clientId) && ![...this.serverReservations.values()].includes(clientId)) { this.ownerTokens.delete(clientId); }
			return;
		}
		if (entry.toolsRefreshTimer) {
			clearTimeout(entry.toolsRefreshTimer);
			entry.toolsRefreshTimer = undefined;
		}
		const connection = entry.connection;
		entry.connection = undefined; // antes de close(): que el 'exit' del proceso no dispare onServerDropped
		entry.tools = [];
		const wasActive = entry.state !== 'disconnected';
		entry.state = 'disconnected';
		entry.error = undefined;
		entry.retryAfter = 0;
		connection?.close();
		if (wasActive) { this.emitStatus(id, entry); }
		this.servers.delete(key); this.serverReservations.delete(key);
		if (![...this.servers.values()].some(candidate => candidate.clientId === clientId) && ![...this.serverReservations.values()].includes(clientId)) { this.ownerTokens.delete(clientId); }
	}

	async mcpStatus(clientId: string, ownerToken: string): Promise<McpServerStatus[]> {
		if (!this.authorizeOwner(clientId, ownerToken)) { return []; }
		return [...this.servers.entries()].filter(([, entry]) => entry.clientId === clientId).map(([, entry]) => this.statusOf(entry.serverId, entry));
	}
	async mcpHeartbeat(clientId: string, ownerToken: string): Promise<void> {
		if (!this.authorizeOwner(clientId, ownerToken)) { throw new Error('owner MCP no autorizado'); }
	}

	async webFetch(request: OpenideWebFetchRequest): Promise<OpenideWebFetchResponse> {
		const maxBytes = Math.max(64_000, Math.min(10_000_000, Number(request?.maxBytes) || WEB_DEFAULT_MAX_RESPONSE_BYTES));
		const deadline = Date.now() + Math.max(1_000, Math.min(60_000, Number(request?.timeoutMs) || 15_000));
		let current = validatePublicWebUrl(String(request?.url ?? ''), request);
		for (let redirects = 0; redirects <= WEB_MAX_REDIRECTS; redirects++) {
			const records = await lookup(current.hostname, { all: true, verbatim: true });
			if (!records.length || records.some(record => isPrivateWebAddress(record.address))) { throw new Error('El host web resuelve a una dirección privada o no válida'); }
			const controller = new AbortController(); const remaining = deadline - Date.now();
			if (remaining <= 0) { throw new Error('Timeout total explorando la web'); }
			const timer = setTimeout(() => controller.abort(), remaining);
			let response: Response;
			try { response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'Accept': 'text/html,text/plain,application/json,text/markdown;q=0.9', 'User-Agent': 'OpenIDE-WebResearch/1.0' } }); }
			finally { clearTimeout(timer); }
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location'); if (!location || redirects >= WEB_MAX_REDIRECTS) { throw new Error('Redirección web inválida o excesiva'); }
				const next = validatePublicWebUrl(new URL(location, current).toString(), request);
				if (current.protocol === 'https:' && next.protocol !== 'https:') { throw new Error('Downgrade HTTPS no permitido'); }
				current = next; continue;
			}
			const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
			if (!['text/html', 'text/plain', 'text/markdown', 'application/json'].includes(contentType)) { throw new Error(`Content-Type web no permitido: ${contentType || 'ausente'}`); }
			if (!response.ok) { throw new Error(`HTTP ${response.status} leyendo la web`); }
			const reader = response.body?.getReader(); if (!reader) { throw new Error('Respuesta web sin body'); }
			const decoder = new TextDecoder(); let body = ''; let bytes = 0;
			try { while (true) { const chunk = await reader.read(); if (chunk.done) { break; } bytes += chunk.value.byteLength; if (bytes > maxBytes) { await reader.cancel(); throw new Error(`Respuesta web excede ${maxBytes} bytes`); } body += decoder.decode(chunk.value, { stream: true }); } body += decoder.decode(); }
			finally { reader.releaseLock(); }
			return { url: current.toString(), status: response.status, contentType, body, bytes };
		}
		throw new Error('Demasiadas redirecciones web');
	}

	async execHook(clientId: string, ownerToken: string, req: HookExecRequest): Promise<HookExecResult> {
		if (!this.authorizeOwner(clientId, ownerToken)) { return { exitCode: null, stdout: '', stderr: 'owner de hook no autorizado', timedOut: false }; }
		if (!req || typeof req !== 'object' || typeof req.command !== 'string' || typeof req.stdinJson !== 'string' || typeof req.cwd !== 'string' || typeof req.timeoutMs !== 'number') { return { exitCode: null, stdout: '', stderr: 'payload de hook inválido', timedOut: false }; }
		const stdinJson = req.stdinJson;
		if (Buffer.byteLength(stdinJson, 'utf8') > HOOK_INPUT_MAX_BYTES) {
			return { exitCode: null, stdout: '', stderr: `stdin del hook excede ${HOOK_INPUT_MAX_BYTES} bytes`, timedOut: false };
		}
		const commandText = String(req?.command ?? '');
		if (Buffer.byteLength(commandText, 'utf8') > 65_536 || Buffer.byteLength(String(req?.cwd ?? ''), 'utf8') > 16_384) { return { exitCode: null, stdout: '', stderr: 'comando o cwd de hook demasiado grande', timedOut: false }; }
		if (commandText.includes('\0') || String(req?.cwd ?? '').includes('\0')) { return { exitCode: null, stdout: '', stderr: 'comando o cwd de hook inválido', timedOut: false }; }
		if (this.activeHooks.size + this.pendingHookApprovals >= MAX_ACTIVE_HOOKS) { return { exitCode: null, stdout: '', stderr: `límite de ${MAX_ACTIVE_HOOKS} hooks concurrentes alcanzado`, timedOut: false }; }
		this.pendingHookApprovals++;
		let approval;
		try { approval = await dialog.showMessageBox({ type: 'warning', buttons: ['Permitir una vez', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true, title: 'OpenIDE — Ejecutar hook', message: 'Un hook solicita ejecutar un proceso con el entorno completo del usuario.', detail: req.command.slice(0, 4_096) }); }
		finally { this.pendingHookApprovals--; }
		if (approval.response !== 0) { return { exitCode: null, stdout: '', stderr: 'hook rechazado por el usuario', timedOut: false }; }
		const argv = shlexSplit(commandText).map(expandTilde);
		if (!argv.length || argv.length > 256 || argv.some(arg => arg.includes('\0') || Buffer.byteLength(arg, 'utf8') > 16_384)) {
			return { exitCode: null, stdout: '', stderr: 'comando de hook vacío', timedOut: false };
		}
		const cwd = req.cwd && isAbsolute(req.cwd) ? req.cwd : process.cwd();
		// comando relativo CON separador ⇒ contra el workspace root; pelado ⇒ PATH normal
		const command = !isAbsolute(argv[0]) && (argv[0].includes('/') || argv[0].includes('\\'))
			? resolvePath(cwd, argv[0])
			: argv[0];
		const timeoutMs = clampSeconds(req.timeoutMs / 1000, HOOK_TIMEOUT_DEFAULT_SECONDS, HOOK_TIMEOUT_MIN_SECONDS, HOOK_TIMEOUT_MAX_SECONDS) * 1000;
		return new Promise<HookExecResult>(resolve => {
			// hooks run with the user's FULL env (unlike MCP servers): they are their scripts, with
			// their credentials — which is exactly what the consent dialog says
			const proc = spawn(command, argv.slice(1), {
				cwd,
				shell: isWindows && /\.(cmd|bat)$/i.test(command),
				detached: !isWindows,
				env: process.env as Record<string, string>,
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			this.activeHooks.add(proc);
			let stdout = '';
			let stderr = '';
			let timedOut = false;
			let settled = false;
			const done = (exitCode: number | null) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolve({ exitCode, stdout: stdout.slice(0, HOOK_OUTPUT_CAP), stderr: stderr.slice(0, HOOK_OUTPUT_CAP), timedOut });
			};
			const timer = setTimeout(() => {
				timedOut = true;
				killProcessTree(proc);
				done(null);
			}, timeoutMs);
			proc.stdin?.on('error', e => { stderr = appendCappedUtf8(stderr, (stderr ? '\n' : '') + errText(e), HOOK_OUTPUT_CAP); killProcessTree(proc); done(null); });
			proc.stdout?.setEncoding('utf8');
			proc.stdout?.on('data', (chunk: string) => { stdout = appendCappedUtf8(stdout, chunk, HOOK_OUTPUT_CAP); });
			proc.stderr?.setEncoding('utf8');
			proc.stderr?.on('data', (chunk: string) => { stderr = appendCappedUtf8(stderr, chunk, HOOK_OUTPUT_CAP); });
			proc.on('error', e => {
				stderr = appendCappedUtf8(stderr, (stderr ? '\n' : '') + errText(e), HOOK_OUTPUT_CAP);
				done(null);
			});
			proc.on('close', code => { this.activeHooks.delete(proc); done(code); });
			try {
				proc.stdin?.write(stdinJson + '\n');
				proc.stdin?.end();
			} catch { /* si el proceso ya murió, 'error'/'close' resuelven igual */ }
		});
	}

	// ---- OAuth loopback (Google-style: redirect a http://localhost:<puerto>/oauth2callback) ----
	// The renderer cannot start http servers: the Google account login flow (Gemini CLI /
	// Antigravity) redirects to localhost and the callback is captured here, in main.

	private readonly activeHooks = new Set<ChildProcess>();
	private pendingHookApprovals = 0;
	private readonly oauthLoopbacks = new Map<string, {
		server: import('http').Server;
		port: number;
		result?: { code?: string; state?: string; error?: string };
		waiter?: (r: { code?: string; state?: string; error?: string; timedOut?: boolean }) => void;
	}>();

	async oauthLoopbackStart(options?: { readonly port?: number; readonly callbackPath?: string }): Promise<{ id: string; port: number }> {
		if (this.oauthLoopbacks.size >= 8) { throw new Error('demasiados loopbacks OAuth activos'); }
		const http = await import('http');
		// El redirect_uri de Google (ej: Antigravity http://localhost:51121/oauth-callback) lleva
		// a FIXED port and FIXED path registered against the client_id. The server MUST listen on
		// that exact port and answer that path — otherwise Google redirects to a localhost where
		// nothing is listening and the login hangs on "localhost error". Without options (legacy) it
		// falls back to the Gemini CLI's ephemeral port + /oauth2callback.
		const listenPort = options?.port ?? 0;
		const callbackPath = options?.callbackPath ?? '/oauth2callback';
		const id = `lb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				const url = new URL(req.url ?? '/', 'http://127.0.0.1');
				if (url.pathname !== callbackPath) {
					res.writeHead(404);
					res.end();
					return;
				}
				const existing = this.oauthLoopbacks.get(id);
				if (existing?.result) { res.writeHead(409); res.end(); return; }
				const result = {
					code: url.searchParams.get('code') ?? undefined,
					state: url.searchParams.get('state') ?? undefined,
					error: url.searchParams.get('error') ?? undefined,
				};
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(getOpenideOauthPage({ failed: !!result.error, detail: result.error }));
				const entry = this.oauthLoopbacks.get(id);
				if (entry) {
					entry.result = result;
					try { entry.server.close(); } catch { /* callback capturado */ }
					if (entry.waiter) {
						entry.waiter(result);
						entry.waiter = undefined;
						this.closeLoopback(id);
					}
				}
			});
			server.on('error', reject);
			server.listen(listenPort, '127.0.0.1', () => {
				const address = server.address();
				const port = typeof address === 'object' && address ? address.port : 0;
				if (!port) {
					try { server.close(); } catch { /* best effort */ }
					reject(new Error('No se pudo abrir el puerto del loopback OAuth.'));
					return;
				}
				this.oauthLoopbacks.set(id, { server, port });
				resolve({ id, port });
			});
		});
	}

	async oauthLoopbackWait(id: string, timeoutMs: number): Promise<{ code?: string; state?: string; error?: string; timedOut?: boolean }> {
		const entry = this.oauthLoopbacks.get(id);
		if (!entry) {
			return { timedOut: true };
		}
		if (entry.result) {
			this.closeLoopback(id);
			return entry.result;
		}
		return new Promise(resolve => {
			const timer = setTimeout(() => {
				entry.waiter = undefined;
				this.closeLoopback(id);
				resolve({ timedOut: true });
			}, Math.max(10_000, Math.min(timeoutMs || 300_000, 600_000)));
			entry.waiter = r => {
				clearTimeout(timer);
				resolve(r);
			};
		});
	}

	async oauthLoopbackCancel(id: string): Promise<void> {
		const entry = this.oauthLoopbacks.get(id);
		if (entry?.waiter) {
			entry.waiter({ timedOut: true });
			entry.waiter = undefined;
		}
		this.closeLoopback(id);
	}

	private closeLoopback(id: string): void {
		const entry = this.oauthLoopbacks.get(id);
		if (entry) {
			this.oauthLoopbacks.delete(id);
			try { entry.server.close(); } catch { /* best effort */ }
		}
	}

	private disposeAll(): void {
		for (const proc of this.activeHooks) { killProcessTree(proc); }
		this.activeHooks.clear();
		for (const id of [...this.oauthLoopbacks.keys()]) {
			this.closeLoopback(id);
		}
		for (const [id, entry] of this.servers) {
			if (entry.toolsRefreshTimer) {
				clearTimeout(entry.toolsRefreshTimer);
				entry.toolsRefreshTimer = undefined;
			}
			const connection = entry.connection;
			entry.connection = undefined;
			entry.state = 'disconnected';
			entry.tools = [];
			try { connection?.close(); } catch { /* shutdown: best effort */ }
			this.logService.trace(`[openide-mcp] ${id}: desconectado por shutdown`);
		}
	}
}
