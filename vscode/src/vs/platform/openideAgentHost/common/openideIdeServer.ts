/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the wire contract of the IDE server: what OpenIDE offers to an external CLI agent.
 *
 *  This is the INVERSE of openideAgentHost.ts. There, OpenIDE is an MCP *client* dialing out to
 *  somebody else's server. Here OpenIDE *is* the server, and the CLIs hosted in the dock
 *  (Claude Code, Codex, Gemini, opencode, …) are the clients that call in to reach the live
 *  workbench: its editors, its selection, its diagnostics, its diff review.
 *
 *  Everything here is pure — no DOM, no node, no services — because the same definitions are
 *  needed in three places that cannot import each other:
 *      - electron-main, which frames the bytes (WebSocket / Streamable HTTP) and answers
 *        `tools/list` without waking the renderer;
 *      - the workbench renderer, which actually executes a tool against the live editor;
 *      - the tests, which pin the wire shapes so a refactor cannot silently change them.
 *
 *  ── Why the tool names and return shapes look strange ──────────────────────────────────────
 *  The Tier 1 catalogue below is NOT a design of ours. It is the tool surface Claude Code's
 *  own system prompt already knows how to drive, transcribed exactly: camelCase everywhere
 *  except `close_tab`, results wrapped in an MCP content array, and most payloads delivered as
 *  a JSON string INSIDE a text block rather than as structured content. Every one of those
 *  quirks is load-bearing — the model was trained against them — so `jsonText()` exists to make
 *  the double encoding explicit instead of something a reader would "fix".
 *
 *  Transcribed from coder/claudecode.nvim's PROTOCOL.md and its `lua/claudecode/tools/*.lua`,
 *  cross-checked against the strings in the Claude Code binary (2.1.245): the lockfile fields,
 *  `CLAUDE_CODE_SSE_PORT`, the `Ide-Authorization` header and the `ws-ide` transport tag all
 *  match. Tier 2 (OPENIDE_TOOLS) is ours and is namespaced precisely so this file never has to
 *  guess which half it is allowed to change.
 *--------------------------------------------------------------------------------------------*/

/**
 * MCP protocol version answered on `initialize`.
 *
 * 2024-11-05 and NOT the 2025-03-26 the protocol doc names: it is what the VS Code extension
 * and claudecode.nvim both report, and the field is a compatibility handshake, not a feature
 * flag. Claiming a version whose semantics we do not implement buys nothing and risks a client
 * enabling something we do not answer.
 */
export const IDE_PROTOCOL_VERSION = '2024-11-05';

/** WebSocket header carrying the lockfile's `authToken`. Compared in constant time, always. */
export const IDE_AUTH_HEADER = 'x-claude-code-ide-authorization';

/** Env var naming the port; set on the CLI's process so it picks OUR window, not a sibling. */
export const IDE_PORT_ENV = 'CLAUDE_CODE_SSE_PORT';

/** Bytes of CSPRNG entropy behind an auth token — 128 bits, hex-encoded to 32 chars. */
export const IDE_AUTH_TOKEN_BYTES = 16;

/** A well-formed token: exactly what `randomBytes(16).toString('hex')` produces. */
export const IDE_AUTH_TOKEN_RE = /^[0-9a-f]{32}$/;

/** The port range the discovery file lives in; also the range we bind inside. */
export const IDE_PORT_MIN = 10_000;
export const IDE_PORT_MAX = 65_535;

/**
 * A port derived from the workspace, so a CLI registered once keeps reaching us tomorrow.
 *
 * A random port is fine for CLIs OpenIDE launches itself — it hands them the address. It is
 * useless for the ones that have no per-session config hook (grok among them), because a
 * persistent registration written today points at a dead port after the next restart. Deriving
 * it from the workspace makes that registration hold.
 *
 * FNV-1a: no cryptographic claim is being made here — the only requirement is that the same
 * folders always land on the same port and different projects mostly do not collide. When the
 * port IS taken, the caller falls back to a random one and the session still works; only the
 * persistent registration stops matching, which is the mild failure of the two.
 */
export function stableIdePort(workspaceFolders: readonly string[]): number {
	let hash = 0x811c9dc5;
	for (const folder of [...workspaceFolders].sort()) {
		for (let index = 0; index < folder.length; index++) {
			hash ^= folder.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		hash ^= 0x2f; // separator, so ['ab','c'] and ['a','bc'] differ
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return IDE_PORT_MIN + (hash % (IDE_PORT_MAX - IDE_PORT_MIN + 1));
}

/**
 * The discovery file at `<claude-config-dir>/ide/<port>.lock`.
 *
 * `workspaceFolders` is what the CLI matches its cwd against to decide whether a given window
 * is *its* window, so a wrong or stale value here does not fail loudly — it silently connects
 * the agent to the wrong project. It is the one field worth being paranoid about.
 */
export interface IIdeLockFile {
	readonly pid: number;
	readonly workspaceFolders: readonly string[];
	readonly ideName: string;
	readonly transport: 'ws';
	readonly authToken: string;
	/** Only meaningful when the IDE runs on Windows and the CLI inside WSL. */
	readonly runningInWindows?: boolean;
}

/** Rejects a lockfile we would not have written. Used on read-back and in tests. */
export function isValidIdeLockFile(value: unknown): value is IIdeLockFile {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const lock = value as Record<string, unknown>;
	if (typeof lock['pid'] !== 'number' || !Number.isInteger(lock['pid']) || lock['pid'] <= 0) {
		return false;
	}
	if (!Array.isArray(lock['workspaceFolders']) || !lock['workspaceFolders'].every(f => typeof f === 'string' && f.length > 0)) {
		return false;
	}
	if (typeof lock['ideName'] !== 'string' || !lock['ideName']) {
		return false;
	}
	if (lock['transport'] !== 'ws') {
		return false;
	}
	return typeof lock['authToken'] === 'string' && IDE_AUTH_TOKEN_RE.test(lock['authToken']);
}

// ---- JSON-RPC 2.0 envelope ------------------------------------------------------------------

export const IDE_RPC_PARSE_ERROR = -32700;
export const IDE_RPC_INVALID_REQUEST = -32600;
export const IDE_RPC_METHOD_NOT_FOUND = -32601;
export const IDE_RPC_INVALID_PARAMS = -32602;
export const IDE_RPC_INTERNAL_ERROR = -32603;
/** Server-defined range (-32000..-32099); a tool that failed on its own terms lands here. */
export const IDE_RPC_TOOL_ERROR = -32000;

export type IdeRpcId = string | number;

export interface IIdeRpcRequest {
	readonly jsonrpc: '2.0';
	readonly id?: IdeRpcId | null;
	readonly method: string;
	readonly params?: unknown;
}

export interface IIdeRpcError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

/**
 * Parses one frame. Returns the error object to answer with, never throws.
 *
 * A notification (no `id`) is a request whose `id` is absent — the caller MUST NOT answer it,
 * which is why the distinction is preserved here rather than defaulted away.
 */
export type IdeRpcParse =
	| { readonly ok: true; readonly request: IIdeRpcRequest }
	| { readonly ok: false; readonly error: IIdeRpcError };

export function parseIdeRpc(raw: string): IdeRpcParse {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { ok: false, error: { code: IDE_RPC_PARSE_ERROR, message: 'Parse error', data: 'Invalid JSON' } };
	}
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		return { ok: false, error: { code: IDE_RPC_INVALID_REQUEST, message: 'Invalid Request', data: 'Not an object' } };
	}
	const message = json as Record<string, unknown>;
	if (message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string') {
		return { ok: false, error: { code: IDE_RPC_INVALID_REQUEST, message: 'Invalid Request', data: 'Not a valid JSON-RPC 2.0 request' } };
	}
	const id = message['id'];
	if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') {
		return { ok: false, error: { code: IDE_RPC_INVALID_REQUEST, message: 'Invalid Request', data: 'id must be a string or a number' } };
	}
	return { ok: true, request: { jsonrpc: '2.0', id: id as IdeRpcId | null | undefined, method: message['method'], params: message['params'] } };
}

export function ideRpcResult(id: IdeRpcId | null | undefined, result: unknown): string {
	return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result });
}

export function ideRpcError(id: IdeRpcId | null | undefined, error: IIdeRpcError): string {
	return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error });
}

export function ideRpcNotification(method: string, params: unknown): string {
	return JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} });
}

// ---- MCP tool results -----------------------------------------------------------------------

export type IdeContentBlock =
	| { readonly type: 'text'; readonly text: string }
	| { readonly type: 'image'; readonly data: string; readonly mimeType: string };

export interface IIdeToolResult {
	readonly content: readonly IdeContentBlock[];
	readonly isError?: boolean;
}

/** A bare text block — for the tools whose whole answer is a sentinel word or one sentence. */
export function text(value: string): IIdeToolResult {
	return { content: [{ type: 'text', text: value }] };
}

/**
 * A JSON payload delivered as a *string* inside a text block.
 *
 * Deliberate double encoding, not an oversight: it is the shape the VS Code extension emits and
 * therefore the shape the model expects to unpack. Returning structured content here would be
 * cleaner and would break the reader on the other end.
 */
export function jsonText(value: unknown): IIdeToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

export function toolError(message: string): IIdeToolResult {
	return { content: [{ type: 'text', text: JSON.stringify({ success: false, message }) }], isError: true };
}

// ---- The tool catalogue ---------------------------------------------------------------------

export interface IIdeToolSchema {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: { readonly type: 'object'; readonly properties?: Record<string, unknown>; readonly required?: readonly string[]; readonly additionalProperties?: boolean };
	/**
	 * The tool parks the request until a human answers. The transport must keep the id pending
	 * across an arbitrary wait and — critically — settle it if the client vanishes first, or the
	 * CLI hangs forever on a diff nobody will ever close.
	 */
	readonly blocking?: boolean;
	/**
	 * Registered and callable, but withheld from `tools/list`.
	 *
	 * `close_tab` is the case this exists for: the VS Code extension calls it internally and the
	 * CLI knows it out of band, so advertising it would only spend prompt budget.
	 */
	readonly hidden?: boolean;
}

const STRING = { type: 'string' } as const;
const BOOLEAN = { type: 'boolean' } as const;

/**
 * TIER 1 — the compatibility surface. Names, arguments and result shapes are fixed by Claude
 * Code; nothing here is ours to redesign. Twelve tools, matching the VS Code extension.
 */
export const IDE_COMPAT_TOOLS: readonly IIdeToolSchema[] = [
	{
		name: 'openFile',
		description: 'Open a file in the editor and optionally select a range of text',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: { ...STRING, description: 'Path to the file to open' },
				preview: { ...BOOLEAN, description: 'Whether to open the file in preview mode' },
				startText: { ...STRING, description: 'Text pattern marking the start of the selection' },
				endText: { ...STRING, description: 'Text pattern marking the end of the selection' },
				selectToEndOfLine: { ...BOOLEAN, description: 'Extend the selection to the end of the line' },
				makeFrontmost: { ...BOOLEAN, description: 'Make the file the active editor tab' },
			},
			required: ['filePath'],
		},
	},
	{
		name: 'openDiff',
		description: 'Open a diff view comparing old file content with new file content',
		inputSchema: {
			type: 'object',
			properties: {
				old_file_path: { ...STRING, description: 'Path to the old file to compare' },
				new_file_path: { ...STRING, description: 'Path to the new file to compare' },
				new_file_contents: { ...STRING, description: 'Contents for the new file version' },
				tab_name: { ...STRING, description: 'Name for the diff tab/view' },
			},
			required: ['old_file_path', 'new_file_path', 'new_file_contents', 'tab_name'],
			additionalProperties: false,
		},
		blocking: true,
	},
	{ name: 'getCurrentSelection', description: 'Get the current text selection in the active editor', inputSchema: { type: 'object', properties: {} } },
	{ name: 'getLatestSelection', description: 'Get the most recent text selection, even if it is no longer in the active editor', inputSchema: { type: 'object', properties: {} } },
	{ name: 'getOpenEditors', description: 'Get information about the editors currently open in the IDE', inputSchema: { type: 'object', properties: {} } },
	{ name: 'getWorkspaceFolders', description: 'Get all workspace folders currently open in the IDE', inputSchema: { type: 'object', properties: {} } },
	{
		name: 'getDiagnostics',
		description: 'Get language diagnostics (errors, warnings) from the IDE',
		inputSchema: {
			type: 'object',
			properties: { uri: { ...STRING, description: 'File URI to get diagnostics for; omit for every file' } },
		},
	},
	{
		name: 'checkDocumentDirty',
		description: 'Check if a document has unsaved changes',
		inputSchema: { type: 'object', properties: { filePath: { ...STRING, description: 'Path to the file to check' } }, required: ['filePath'] },
	},
	{
		name: 'saveDocument',
		description: 'Save a document with unsaved changes',
		inputSchema: { type: 'object', properties: { filePath: { ...STRING, description: 'Path to the file to save' } }, required: ['filePath'] },
	},
	{
		name: 'close_tab',
		description: 'Close a tab by name',
		inputSchema: { type: 'object', properties: { tab_name: { ...STRING, description: 'Name of the tab to close' } }, required: ['tab_name'] },
		hidden: true,
	},
	{ name: 'closeAllDiffTabs', description: 'Close all open diff tabs in the editor', inputSchema: { type: 'object', properties: {} } },
	{
		name: 'executeCode',
		description: 'Execute python code in the Jupyter kernel for the current notebook file',
		inputSchema: { type: 'object', properties: { code: { ...STRING, description: 'The code to be executed on the kernel' } }, required: ['code'] },
	},
];

/** Sentinels `openDiff` answers with. The CLI branches on the exact string. */
export const IDE_DIFF_SAVED = 'FILE_SAVED';
export const IDE_DIFF_REJECTED = 'DIFF_REJECTED';

/** `close_tab`'s answer. Also an exact-string contract. */
export const IDE_TAB_CLOSED = 'TAB_CLOSED';

export function ideClosedDiffTabs(count: number): string {
	return `CLOSED_${count}_DIFF_TABS`;
}

// ---- Notifications, IDE → agent -------------------------------------------------------------

export interface IIdeSelectionPosition {
	readonly line: number;
	readonly character: number;
}

export interface IIdeSelectionNotification {
	readonly text: string;
	readonly filePath: string;
	readonly fileUrl: string;
	readonly selection: {
		readonly start: IIdeSelectionPosition;
		readonly end: IIdeSelectionPosition;
		readonly isEmpty: boolean;
	};
}

/** Fired as the user moves the caret: it is how the agent knows what is on screen. */
export const IDE_NOTIFY_SELECTION_CHANGED = 'selection_changed';

/** Fired when the user deliberately pushes a range in as context ("send to agent"). */
export const IDE_NOTIFY_AT_MENTIONED = 'at_mentioned';

// ---- Notifications, agent → IDE ---------------------------------------------------------------

/**
 * Sent by Claude Code right after `notifications/initialized`, carrying its own pid.
 *
 * Undocumented: it is in neither the protocol write-up nor claudecode.nvim, and was found by
 * recording a live 2.1.245 session. It matters more than it looks — the pid is the only thing
 * on the wire that ties a connection to the process the dock spawned, which is what lets
 * "which files did THIS session touch" have an answer at all.
 */
export const IDE_NOTIFY_CONNECTED = 'ide_connected';

export interface IIdeConnectedNotification {
	readonly pid: number;
}

export interface IIdeAtMentionNotification {
	readonly filePath: string;
	readonly lineStart: number;
	readonly lineEnd: number;
}

// ---- Client identity ------------------------------------------------------------------------

/**
 * Which dock session a connection belongs to.
 *
 * Without this every CLI in the window shares one anonymous identity, and "which files did THIS
 * session touch" — the whole point of the Changes view — has no answer. WebSocket clients are
 * matched by the port they dialled (one server per window, one session per connection);
 * HTTP clients carry the session in their URL, which is why the token below is per session and
 * not per window.
 */
export interface IIdeClientIdentity {
	readonly connectionId: string;
	/** Dock session that launched the CLI, when it was launched by us. */
	readonly sessionId?: string;
	/** `claude`, `codex`, … as reported on initialize, for display only. */
	readonly clientName?: string;
	readonly clientVersion?: string;
}

// ---- Types crossing the main ↔ workbench channel ---------------------------------------------

export interface IIdeServerStartOptions {
	/** Shown by the CLI as "connected to X". */
	readonly ideName: string;
	/** Absolute paths. A CLI only adopts a window whose folders contain its cwd. */
	readonly workspaceFolders: readonly string[];
	/**
	 * Directory holding the `ide/` lock directory — `~/.claude` unless the caller runs the CLI
	 * against a managed home, in which case it MUST be that home or the lockfile lands where
	 * nothing will read it.
	 */
	readonly lockRootDir: string;
	/**
	 * Advertise this window in `<lockRootDir>/ide/<port>.lock` so a CLI discovers it on its own.
	 *
	 * Off by default. Anthropic's extension may already publish a lock for the same window, and
	 * two locks with the same ideName make the CLI's choice a coin flip. The HTTP door needs no
	 * lockfile and is the one every CLI can use, so discovery is the exception, not the rule.
	 */
	readonly publishLockfile?: boolean;
	/**
	 * Bind here if it is free. Omitted means a random port.
	 *
	 * Paired with a stable `authToken`, this is what makes a one-time registration in a CLI that
	 * has no per-session hook survive a restart.
	 */
	readonly preferredPort?: number;
	/**
	 * Reuse this token instead of minting one.
	 *
	 * A token that changes every launch breaks a persistent registration just as thoroughly as a
	 * changing port does — the CLI reconnects to the right address and gets a 401.
	 */
	readonly authToken?: string;
}

export interface IIdeServerInfo {
	readonly port: number;
	readonly authToken: string;
	/** Undefined when the server did not publish a discovery lockfile. */
	readonly lockPath?: string;
}

/** A `tools/call` parked in main, waiting for the workbench to execute it. */
export interface IIdeToolRequest {
	readonly requestId: string;
	readonly connectionId: string;
	readonly tool: string;
	readonly args: unknown;
}
