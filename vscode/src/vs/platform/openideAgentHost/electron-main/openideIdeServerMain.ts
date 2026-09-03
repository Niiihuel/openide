/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the IDE server: the door an external CLI agent comes in through to reach this
 *  window. It lives in main because the renderer cannot listen on a socket, and it is the exact
 *  mirror of openideAgentHostMain's MCP client: same JSON-RPC wire, opposite direction.
 *
 *  ── One dispatcher, two doors ──────────────────────────────────────────────────────────────
 *  Both doors terminate on the SAME `dispatch()`; only the framing differs. That is the whole
 *  design, and the reason a tool is written once and reachable from every CLI:
 *
 *    · WebSocket + lockfile — what Claude Code discovers on its own. We write
 *      `<config>/ide/<port>.lock`, launch the CLI with CLAUDE_CODE_SSE_PORT, and it connects
 *      unprompted. Non-standard and reverse-engineered, but it is also the only door that
 *      carries `selection_changed` / `at_mentioned` back to the agent.
 *
 *    · Streamable HTTP — plain MCP 2025-03-26. Codex reaches it with `url`, Gemini with
 *      `httpUrl`, opencode as a remote server, and so does anything written next year. This is
 *      the door that makes the feature outlive the protocol above: if Anthropic changes the
 *      lockfile handshake tomorrow, every other agent keeps working.
 *
 *  A stdio shim (openideIdeStdioBridge) is the third door for CLIs that speak only stdio; it is
 *  a client of the HTTP door, not another dispatcher, and so is not in this file.
 *
 *  ── Where the tools actually run ───────────────────────────────────────────────────────────
 *  Nowhere near here. `tools/call` is parked, forwarded to the renderer as an event, and
 *  answered later through `respondTool`. Main owns bytes, ports and lifetime; the workbench
 *  owns meaning. `tools/list` is the deliberate exception — it is answered from the static
 *  catalogue so a CLI can enumerate while every window is busy.
 *
 *  SECURITY: bound to 127.0.0.1 and nothing else; the auth token is 128 bits of CSPRNG compared
 *  in constant time; the lockfile is written 0600 into a 0700 directory through a temp file that
 *  refuses to follow a symlink. A pending tool call is ALWAYS settled — on answer, on timeout,
 *  on the client vanishing, on shutdown — because the one failure mode with no recovery is a
 *  CLI blocked forever on a diff nobody will ever close.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { timingSafeEqual, randomBytes, randomInt } from 'crypto';
import { mkdirSync, chmodSync, openSync, writeSync, closeSync, renameSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../base/common/path.js';
import type * as wsTypes from 'ws';
import type * as httpTypes from 'http';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import {
	IDE_AUTH_HEADER, IDE_AUTH_TOKEN_BYTES, IDE_AUTH_TOKEN_RE, IDE_COMPAT_TOOLS, IDE_PORT_MAX, IDE_PORT_MIN,
	IDE_PROTOCOL_VERSION, IDE_RPC_INTERNAL_ERROR, IDE_RPC_INVALID_PARAMS, IDE_RPC_METHOD_NOT_FOUND,
	IDE_NOTIFY_CONNECTED, IdeRpcId, IIdeLockFile, IIdeServerInfo, IIdeServerStartOptions,
	IIdeToolRequest, IIdeToolResult, IIdeToolSchema, ideRpcError, ideRpcNotification, ideRpcResult,
	parseIdeRpc,
} from '../common/openideIdeServer.js';

/** How long a non-blocking tool may take before the call is failed. */
const TOOL_TIMEOUT_MS = 30_000;

/** A blocking tool waits on a human, so it gets an hour — but never forever. */
const BLOCKING_TOOL_TIMEOUT_MS = 60 * 60_000;

/** Ports tried before giving up. Collisions are rare; an occupied range is not our problem. */
const PORT_ATTEMPTS = 20;

/** Keepalive for idle websockets, matching what the reference implementations use. */
const PING_INTERVAL_MS = 30_000;

const SERVER_INFO = { name: 'openide-ide', version: '1.0.0' };

interface IPendingTool {
	resolve(result: IIdeToolResult): void;
	reject(error: Error): void;
	readonly connectionId: string;
	/** The JSON-RPC id this call must be answered under, so teardown can answer it directly. */
	readonly rpcId: IdeRpcId | null;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Thrown when the transport has ALREADY put an answer on the wire for a parked call.
 *
 * It exists because rejecting the promise is not enough on shutdown: the rejection lands in a
 * microtask, and by the time the catch runs the socket is closed, so the error frame never
 * leaves. Teardown therefore writes the frame itself and throws this so the normal catch does
 * not write a second one.
 */
class IdeCallSettled extends Error { }

interface IConnection {
	readonly id: string;
	readonly socket: wsTypes.WebSocket;
	clientName?: string;
	/** The agent's own pid, from its `ide_connected` notification. */
	agentPid?: number;
}

const COMPAT_BLOCKING_TOOLS = new Set(IDE_COMPAT_TOOLS.filter(t => t.blocking).map(t => t.name));

function listedTools(extra: readonly IIdeToolSchema[]): unknown[] {
	return [...IDE_COMPAT_TOOLS, ...extra]
		.filter(tool => !tool.hidden)
		.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
}

/** Length-safe constant-time comparison: `timingSafeEqual` throws on a length mismatch. */
function secretEquals(a: string, b: string): boolean {
	const left = Buffer.from(a, 'utf8');
	const right = Buffer.from(b, 'utf8');
	if (left.length !== right.length) {
		return false;
	}
	return timingSafeEqual(left, right);
}

export class OpenideIdeServerMain extends Disposable {

	private readonly _onDidRequestTool = this._register(new Emitter<IIdeToolRequest>());
	/** A CLI called a tool; the workbench answers through `respondTool`. */
	readonly onDidRequestTool: Event<IIdeToolRequest> = this._onDidRequestTool.event;

	private readonly _onDidChangeConnections = this._register(new Emitter<number>());
	/** Live client count — the dock paints "1 agent connected" from this. */
	readonly onDidChangeConnections: Event<number> = this._onDidChangeConnections.event;

	private wss: wsTypes.WebSocketServer | undefined;
	private httpServer: httpTypes.Server | undefined;
	private info: IIdeServerInfo | undefined;
	private pingTimer: ReturnType<typeof setInterval> | undefined;

	private readonly connections = new Map<string, IConnection>();
	private readonly pending = new Map<string, IPendingTool>();
	/** Tools contributed by the workbench on top of the compat catalogue (Tier 2). */
	private extraTools: readonly IIdeToolSchema[] = [];

	private counter = 0;

	/** Per-session MCP config files written for CLIs that take a path; removed on stop. */
	private readonly sessionConfigs = new Set<string>();

	constructor(private readonly logService: ILogService) {
		super();
		this._register(toDisposable(() => this.stop()));
	}

	get serverInfo(): IIdeServerInfo | undefined {
		return this.info;
	}

	/**
	 * Binds, writes the lockfile and starts accepting agents. Idempotent: a second call returns
	 * the running server rather than opening a second port, because two lockfiles for one window
	 * is how a CLI ends up talking to a dead listener.
	 */
	async start(options: IIdeServerStartOptions, extraTools: readonly IIdeToolSchema[] = []): Promise<IIdeServerInfo> {
		this.extraTools = extraTools;
		if (this.info) {
			return this.info;
		}
		const [ws, http] = await Promise.all([import('ws'), import('http')]);
		// A caller-supplied token is honoured only if it is well formed: a malformed one would be
		// accepted here and then rejected on every connection, which looks like a network fault.
		const authToken = options.authToken && IDE_AUTH_TOKEN_RE.test(options.authToken)
			? options.authToken
			: randomBytes(IDE_AUTH_TOKEN_BYTES).toString('hex');

		const server = http.createServer((req, res) => this.handleHttp(req, res, authToken));
		const port = await this.listen(server, options.preferredPort);

		const wss = new ws.WebSocketServer({
			server,
			verifyClient: (info: { req: httpTypes.IncomingMessage }, cb: (ok: boolean, code?: number, message?: string) => void) => {
				const header = info.req.headers[IDE_AUTH_HEADER];
				const provided = Array.isArray(header) ? header[0] : header;
				if (typeof provided !== 'string' || !secretEquals(provided, authToken)) {
					this.logService.warn('[openide-ide] connection rejected: bad or missing auth header');
					cb(false, 401, 'Unauthorized');
					return;
				}
				cb(true);
			},
		});
		wss.on('connection', socket => this.acceptConnection(socket));
		wss.on('error', err => this.logService.error('[openide-ide] websocket server error', err));

		// Publishing a lockfile is what turns this into a discoverable IDE, and Anthropic's own
		// extension may already be publishing one for this same window. Two locks with the same
		// ideName for one workspace make `--ide` a coin flip, so it is opt-in: the HTTP door needs
		// no lockfile, and that is the door every CLI can use.
		const lockPath = options.publishLockfile ? this.writeLockFile(options, port, authToken) : undefined;

		this.httpServer = server;
		this.wss = wss;
		this.info = { port, authToken, lockPath };
		this.pingTimer = setInterval(() => this.pingAll(), PING_INTERVAL_MS);
		this.logService.info(`[openide-ide] listening on 127.0.0.1:${port} (lock: ${lockPath ?? 'none — HTTP only'})`);
		return this.info;
	}

	/** Binds the preferred port if it is free, otherwise a random one in the discovery range. */
	private listen(server: httpTypes.Server, preferred?: number): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			let attempts = 0;
			const tryOnce = () => {
				attempts++;
				// The preferred port gets exactly one try: if something else holds it, retrying it
				// would just fail again, and a working session on a random port beats no session.
				const port = attempts === 1 && preferred && preferred >= IDE_PORT_MIN && preferred <= IDE_PORT_MAX
					? preferred
					: randomInt(IDE_PORT_MIN, IDE_PORT_MAX);
				const onError = (err: NodeJS.ErrnoException) => {
					server.removeListener('listening', onListening);
					if (err.code === 'EADDRINUSE' && attempts < PORT_ATTEMPTS) {
						tryOnce();
						return;
					}
					reject(err);
				};
				const onListening = () => {
					server.removeListener('error', onError);
					const address = server.address();
					resolve(typeof address === 'object' && address ? address.port : port);
				};
				server.once('error', onError);
				server.once('listening', onListening);
				server.listen(port, '127.0.0.1');
			};
			tryOnce();
		});
	}

	/**
	 * Writes `<lockRoot>/ide/<port>.lock` atomically with 0600 inside a 0700 directory.
	 *
	 * `wx` (O_CREAT|O_EXCL) on the temp path is the point: it refuses to follow an existing file
	 * or a symlink somebody planted, so the token cannot be written somewhere else. The rename is
	 * what makes the final file appear complete or not at all — a CLI polling the directory must
	 * never read a half-written token and conclude the IDE is unreachable.
	 */
	private writeLockFile(options: IIdeServerStartOptions, port: number, authToken: string): string {
		const dir = join(options.lockRootDir, 'ide');
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		// mode applies only to directories mkdir creates; an older 0755 dir has to be tightened.
		try {
			chmodSync(dir, 0o700);
		} catch {
			// Not POSIX (or not ours): the failure is not worth refusing to start over.
		}
		const lock: IIdeLockFile = {
			pid: process.pid,
			workspaceFolders: [...options.workspaceFolders],
			ideName: options.ideName,
			transport: 'ws',
			authToken,
		};
		const lockPath = join(dir, `${port}.lock`);
		const tmpPath = `${lockPath}.tmp.${process.pid}.${Date.now()}`;
		const payload = Buffer.from(JSON.stringify(lock), 'utf8');
		const fd = openSync(tmpPath, 'wx', 0o600);
		try {
			let written = 0;
			// A short write is rare but real (quota, odd filesystem); looping is what keeps a
			// truncated token from being renamed into place.
			while (written < payload.length) {
				written += writeSync(fd, payload, written, payload.length - written, written);
			}
		} catch (error) {
			closeSync(fd);
			try { unlinkSync(tmpPath); } catch { /* nothing to clean */ }
			throw error;
		}
		closeSync(fd);
		renameSync(tmpPath, lockPath);
		return lockPath;
	}

	/**
	 * Writes a launch-scoped MCP config and returns its path.
	 *
	 * A file and not a `--mcp-config '<json>'` argument, because argv on Linux is readable by
	 * every process through /proc, and this token opens tools that read and write the user's
	 * files. 0600, and removed when the server stops.
	 */
	writeSessionMcpConfig(sessionId: string, contents: string): string {
		const dir = join(tmpdir(), 'openide-mcp');
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		try {
			chmodSync(dir, 0o700);
		} catch {
			// Not POSIX, or not ours: not a reason to refuse the launch.
		}
		const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'session';
		const path = join(dir, `${safe}.json`);
		try { unlinkSync(path); } catch { /* first write for this session */ }
		const fd = openSync(path, 'wx', 0o600);
		try {
			const payload = Buffer.from(contents, 'utf8');
			let written = 0;
			while (written < payload.length) {
				written += writeSync(fd, payload, written, payload.length - written, written);
			}
		} finally {
			closeSync(fd);
		}
		this.sessionConfigs.add(path);
		return path;
	}

	/**
	 * Runs a CLI's own `mcp add` so OpenIDE is registered in its config.
	 *
	 * We shell out to the CLI instead of writing its config file ourselves: the format belongs to
	 * them and will change, and a file we rewrote by pattern-matching is a file we eventually
	 * corrupt. `shell: false` — the argv is built from our own pure catalogue and never goes
	 * through a shell, so the bearer token cannot be re-split or land in a history file.
	 */
	registerInCli(executable: string, args: readonly string[]): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const child = spawn(executable, [...args], { shell: false, windowsHide: true });
			let output = '';
			const capture = (chunk: unknown) => { output += String(chunk).slice(0, 8_192); };
			child.stdout?.on('data', capture);
			child.stderr?.on('data', capture);
			const timer = setTimeout(() => {
				child.kill();
				reject(new Error('the CLI did not answer in time'));
			}, 30_000);
			child.on('error', error => { clearTimeout(timer); reject(error); });
			child.on('exit', code => {
				clearTimeout(timer);
				// The token may be echoed back in the CLI's own confirmation line; nothing that
				// leaves here carries it.
				const safe = output.replace(/Bearer\s+[0-9a-f]{32}/gi, 'Bearer •••').trim();
				code === 0 ? resolve(safe) : reject(new Error(safe || `exit ${code}`));
			});
		});
	}

	private acceptConnection(socket: wsTypes.WebSocket): void {
		const id = `ide-${++this.counter}`;
		this.connections.set(id, { id, socket });
		this.logService.trace(`[openide-ide] client connected: ${id}`);
		this._onDidChangeConnections.fire(this.connections.size);

		socket.on('message', (data: unknown) => this.handleFrame(id, String(data)));
		socket.on('error', err => this.logService.warn(`[openide-ide] client ${id} error`, err));
		socket.on('close', () => {
			this.connections.delete(id);
			// Anything this client was waiting on dies with it. Not settling here is how a diff
			// tab outlives the agent that asked for it and never resolves.
			this.failPending(pending => pending.connectionId === id, 'client disconnected', false);
			this._onDidChangeConnections.fire(this.connections.size);
			this.logService.trace(`[openide-ide] client disconnected: ${id}`);
		});
	}

	private pingAll(): void {
		for (const connection of this.connections.values()) {
			try {
				connection.socket.ping();
			} catch {
				// A socket that cannot be pinged will surface through 'close' on its own.
			}
		}
	}

	private async handleFrame(connectionId: string, raw: string): Promise<void> {
		const parsed = parseIdeRpc(raw);
		if (!parsed.ok) {
			this.send(connectionId, ideRpcError(null, parsed.error));
			return;
		}
		const { request } = parsed;
		// No id ⇒ a notification. Answering one is a protocol violation, so route and stop.
		if (request.id === undefined || request.id === null) {
			this.handleNotification(connectionId, request.method, request.params);
			return;
		}
		try {
			const result = await this.dispatch(connectionId, request.method, request.params, request.id);
			if (result === undefined) {
				this.send(connectionId, ideRpcError(request.id, { code: IDE_RPC_METHOD_NOT_FOUND, message: 'Method not found', data: request.method }));
				return;
			}
			this.send(connectionId, ideRpcResult(request.id, result));
		} catch (error) {
			if (error instanceof IdeCallSettled) {
				return; // teardown already answered this id; a second frame would be a protocol error
			}
			this.send(connectionId, ideRpcError(request.id, {
				code: IDE_RPC_INTERNAL_ERROR,
				message: 'Internal error',
				data: error instanceof Error ? error.message : String(error),
			}));
		}
	}

	/**
	 * Notifications from the agent. Unknown ones are dropped in silence on purpose: the CLI adds
	 * to this vocabulary between releases, and a server that errors on an unrecognised
	 * notification breaks on an upgrade it had no reason to care about.
	 */
	private handleNotification(connectionId: string, method: string, params: unknown): void {
		if (method !== IDE_NOTIFY_CONNECTED) {
			return;
		}
		const pid = (params as { pid?: unknown } | undefined)?.pid;
		const connection = this.connections.get(connectionId);
		if (connection && typeof pid === 'number') {
			connection.agentPid = pid;
			this._onDidChangeConnections.fire(this.connections.size);
		}
	}

	/**
	 * Replaces the Tier 2 catalogue and tells every connected agent to re-list.
	 *
	 * Tools show up after startup — the browser surface only exists once the agent service is
	 * alive — so a catalogue fixed at `start()` would be empty for exactly the sessions that are
	 * already open. `notifications/tools/list_changed` is what we promised in `initialize`.
	 */
	setExtraTools(tools: readonly IIdeToolSchema[]): void {
		this.extraTools = tools;
		if (this.connections.size) {
			this.notify('notifications/tools/list_changed', {});
		}
	}

	/** The pid of the agent on a connection, once it has announced itself. */
	agentPidOf(connectionId: string): number | undefined {
		return this.connections.get(connectionId)?.agentPid;
	}

	/**
	 * The single dispatcher both doors share. `undefined` means "no such method" — the caller
	 * turns that into the right framing for its transport.
	 */
	private async dispatch(connectionId: string, method: string, params: unknown, rpcId: IdeRpcId | null): Promise<unknown | undefined> {
		switch (method) {
			case 'initialize': {
				const info = (params as { clientInfo?: { name?: string; version?: string } } | undefined)?.clientInfo;
				const connection = this.connections.get(connectionId);
				if (connection && info?.name) {
					connection.clientName = String(info.name);
				}
				return {
					protocolVersion: IDE_PROTOCOL_VERSION,
					capabilities: { logging: {}, prompts: { listChanged: true }, tools: { listChanged: true } },
					serverInfo: SERVER_INFO,
				};
			}
			case 'ping':
				return {};
			case 'prompts/list':
				return { prompts: [] };
			case 'resources/list':
				return { resources: [] };
			case 'tools/list':
				return { tools: listedTools(this.extraTools) };
			case 'tools/call': {
				// The live CLI also sends `_meta.progressToken`. We never report progress, and the
				// spec makes that optional, so it is read and ignored rather than echoed.
				const call = params as { name?: unknown; arguments?: unknown } | undefined;
				const name = typeof call?.name === 'string' ? call.name : '';
				if (!name) {
					throw Object.assign(new Error('missing tool name'), { code: IDE_RPC_INVALID_PARAMS });
				}
				return await this.callTool(connectionId, name, call?.arguments ?? {}, rpcId);
			}
			default:
				return undefined;
		}
	}

	/** Parks the call, hands it to the renderer, and guarantees it is settled exactly once. */
	private callTool(connectionId: string, tool: string, args: unknown, rpcId: IdeRpcId | null): Promise<IIdeToolResult> {
		const requestId = `tool-${++this.counter}`;
		// Tier 2 declares its own blocking tools, and `plan_save` is one: it does not answer until
		// a person has read the plan. Reading only the compat set here would give a human review
		// the 30s budget meant for a tool that just reads a file.
		const blocking = COMPAT_BLOCKING_TOOLS.has(tool) || this.extraTools.some(candidate => candidate.name === tool && candidate.blocking);
		const timeoutMs = blocking ? BLOCKING_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS;
		return new Promise<IIdeToolResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`tool timed out: ${tool}`));
			}, timeoutMs);
			this.pending.set(requestId, { resolve, reject, connectionId, rpcId, timer });
			this._onDidRequestTool.fire({ requestId, connectionId, tool, args });
		});
	}

	/** The workbench answering a parked `tools/call`. Unknown ids are ignored, not fatal. */
	respondTool(requestId: string, result: IIdeToolResult): void {
		const pending = this.pending.get(requestId);
		if (!pending) {
			return;
		}
		this.pending.delete(requestId);
		clearTimeout(pending.timer);
		pending.resolve(result);
	}

	/**
	 * Settles parked calls. `respond` writes the error frame here and now — the only way an
	 * agent learns its call died when the transport is about to close under it.
	 */
	private failPending(predicate: (pending: IPendingTool) => boolean, reason: string, respond: boolean): void {
		for (const [id, pending] of [...this.pending]) {
			if (!predicate(pending)) {
				continue;
			}
			this.pending.delete(id);
			clearTimeout(pending.timer);
			if (respond) {
				this.send(pending.connectionId, ideRpcError(pending.rpcId, { code: IDE_RPC_INTERNAL_ERROR, message: 'Internal error', data: reason }));
			}
			pending.reject(new IdeCallSettled(reason));
		}
	}

	/** Pushes a notification (selection_changed, at_mentioned) to every connected agent. */
	notify(method: string, params: unknown): void {
		const frame = ideRpcNotification(method, params);
		for (const connection of this.connections.values()) {
			this.sendRaw(connection, frame);
		}
	}

	private send(connectionId: string, frame: string): void {
		const connection = this.connections.get(connectionId);
		if (connection) {
			this.sendRaw(connection, frame);
		}
	}

	private sendRaw(connection: IConnection, frame: string): void {
		try {
			connection.socket.send(frame);
		} catch (error) {
			this.logService.warn(`[openide-ide] send failed on ${connection.id}`, error);
		}
	}

	// ---- Door two: Streamable HTTP -----------------------------------------------------------

	/**
	 * Plain MCP over HTTP for every CLI that does not speak the lockfile dance.
	 *
	 * One POST carrying one JSON-RPC message, answered as `application/json`. The spec also
	 * allows an SSE reply, and GET to open a server→client stream; neither is implemented and
	 * both fail cleanly, because nothing this server sends is unsolicited except the selection
	 * notifications, and those only matter to the door that already carries them.
	 */
	private async handleHttp(req: httpTypes.IncomingMessage, res: httpTypes.ServerResponse, authToken: string): Promise<void> {
		// A websocket upgrade never reaches here; anything that does is a plain request.
		if (!req.url || !req.url.startsWith('/mcp')) {
			res.writeHead(404).end();
			return;
		}
		const header = req.headers['authorization'];
		const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
		if (!bearer || !secretEquals(bearer, authToken)) {
			res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
			return;
		}
		if (req.method !== 'POST') {
			// GET would open the optional SSE stream; we do not offer one.
			res.writeHead(405, { 'Allow': 'POST' }).end();
			return;
		}
		let body = '';
		let tooLarge = false;
		for await (const chunk of req) {
			body += chunk;
			if (body.length > 1_000_000) {
				tooLarge = true;
				break;
			}
		}
		if (tooLarge) {
			res.writeHead(413).end();
			return;
		}
		const parsed = parseIdeRpc(body);
		if (!parsed.ok) {
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(ideRpcError(null, parsed.error));
			return;
		}
		const { request } = parsed;
		// HTTP has no persistent identity, so calls arrive under one shared connection id.
		const connectionId = 'http';
		if (request.id === undefined || request.id === null) {
			res.writeHead(202).end();
			return;
		}
		try {
			const result = await this.dispatch(connectionId, request.method, request.params, request.id);
			const frame = result === undefined
				? ideRpcError(request.id, { code: IDE_RPC_METHOD_NOT_FOUND, message: 'Method not found', data: request.method })
				: ideRpcResult(request.id, result);
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(frame);
		} catch (error) {
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(ideRpcError(request.id, {
				code: IDE_RPC_INTERNAL_ERROR,
				message: 'Internal error',
				data: error instanceof Error ? error.message : String(error),
			}));
		}
	}

	// ---- Teardown -----------------------------------------------------------------------------

	stop(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = undefined;
		}
		// Settle before the sockets go: a rejected call still reaches the agent as an error,
		// whereas one dropped with the transport leaves it waiting on a reply that never comes.
		this.failPending(() => true, 'IDE server stopping', true);
		for (const connection of this.connections.values()) {
			try { connection.socket.close(); } catch { /* already gone */ }
		}
		this.connections.clear();
		this.wss?.close();
		this.wss = undefined;
		this.httpServer?.close();
		this.httpServer = undefined;
		if (this.info?.lockPath) {
			try {
				unlinkSync(this.info.lockPath);
			} catch {
				// Already removed, or never written: a stale lock is handled by the CLI's own
				// pid check, so failing to delete it is not worth surfacing.
			}
		}
		for (const path of this.sessionConfigs) {
			try { unlinkSync(path); } catch { /* already gone */ }
		}
		this.sessionConfigs.clear();
		this.info = undefined;
	}
}
