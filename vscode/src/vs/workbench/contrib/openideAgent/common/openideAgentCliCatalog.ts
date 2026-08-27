/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The external coding agents the chat dock can host as a TUI in an embedded terminal, with
 * everything the dock needs to know about each: how to launch it, how to resume one of its
 * sessions, and whether it reports its state through native hooks.
 *
 * Transcribed from Orca's `tui-agent.ts` + `agent-session-resume.ts` + `agent-resume-launch-
 * command.ts`, trimmed to the agents that resume and that the product ships icons for. The
 * launch and resume argv are DATA, not shell strings: the terminal service takes an executable
 * plus args and does its own quoting, so the session id never goes through a shell.
 *
 * Also here, because they are the same domain and pure: the session status vocabulary (VS
 * Code's `ChatSessionStatus` semantics: in-progress / needs-input / completed / failed), its
 * reducer over the events a CLI emits, and the recency grouping the sessions pane uses.
 */

export type OpenideCliId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'amp' | 'droid' | 'copilot' | 'grok';

export interface IOpenideCliDefinition {
	readonly id: OpenideCliId;
	/** Display name. */
	readonly name: string;
	/** Executable name looked up on PATH. */
	readonly binary: string;
	/** Extra args for a fresh interactive session. */
	readonly launchArgs: readonly string[];
	/**
	 * Builds the argv (after the executable) that resumes `sessionId`; undefined when the CLI
	 * cannot resume by id.
	 */
	readonly resumeArgs?: (sessionId: string) => readonly string[];
	/** The CLI reports working / waiting through native hooks OpenIDE can install. */
	readonly supportsHooks: boolean;
	/** Key into `OPENIDE_PROVIDER_BRANDS` — the mark the dock paints for this agent. */
	readonly icon: string;
	/** Where the CLI writes its transcripts, relative to the user's home — for resume ids. */
	readonly transcriptDir?: string;
	/**
	 * How to hand this CLI an MCP server for ONE launch, without editing any file it owns.
	 * Undefined ⇒ the CLI has no per-session mechanism and must be configured by hand.
	 */
	readonly mcpInjection?: OpenideMcpInjection;
	/**
	 * Contents of the launch-scoped config file this CLI needs, when it takes one.
	 *
	 * Each CLI wants its own shape and its own key, so the builder lives with the CLI rather than
	 * with the caller: the caller only has to write whatever string comes back, 0600, and hand
	 * back the path.
	 */
	readonly mcpConfigBuilder?: (endpoint: IOpenideMcpEndpoint) => string;
	/**
	 * Argv for a ONE-TIME registration in the CLI's own config, for the ones with no per-session
	 * hook. Only meaningful because the port and the token are stable per workspace — against a
	 * random port this would write an entry that is dead by tomorrow.
	 */
	readonly mcpRegisterArgs?: (endpoint: IOpenideMcpEndpoint) => readonly string[];
}

/**
 * OpenIDE's own MCP endpoint, as a CLI needs to be told about it.
 *
 * `tokenEnvVar` rather than the token itself wherever the CLI supports it: argv on Linux is
 * world-readable through /proc, and this token opens tools that read and write the user's files.
 * Where only a file will do, it is written 0600 — never inlined into a command line.
 */
export interface IOpenideMcpEndpoint {
	/** Server name the CLI will show and the model will prefix its tools with. */
	readonly name: string;
	readonly url: string;
	readonly token: string;
	/** Env var the launch will carry the token in. */
	readonly tokenEnvVar: string;
	/**
	 * Absolute path to a 0600 JSON config the caller has already written, for CLIs that accept
	 * a config file. Undefined when the caller could not write one.
	 */
	readonly configFile?: string;
}

export interface IOpenideMcpInjectionResult {
	readonly args: readonly string[];
	readonly env: Record<string, string>;
}

export type OpenideMcpInjection = (endpoint: IOpenideMcpEndpoint) => IOpenideMcpInjectionResult;

/**
 * Claude Code: `--mcp-config` takes a JSON string OR a path. Always the path — the string form
 * would put the bearer token in argv for every process on the box to read.
 * No `--strict-mcp-config`: that would silence the servers the user configured themselves, and
 * OpenIDE is adding a server, not taking over their setup.
 */
const claudeMcpInjection: OpenideMcpInjection = endpoint =>
	endpoint.configFile ? { args: ['--mcp-config', endpoint.configFile], env: {} } : { args: [], env: {} };

/**
 * opencode: `OPENCODE_CONFIG` names a config file loaded BETWEEN the global and project ones, so
 * the user's own servers, providers and keys all survive — this adds a server, it does not take
 * over their setup. Verified against opencode 1.17.12.
 */
const opencodeMcpInjection: OpenideMcpInjection = endpoint => {
	const env: Record<string, string> = {};
	if (endpoint.configFile) {
		env['OPENCODE_CONFIG'] = endpoint.configFile;
	}
	return { args: [], env };
};

export function buildOpencodeMcpConfig(endpoint: IOpenideMcpEndpoint): string {
	return JSON.stringify({
		mcp: {
			[endpoint.name]: {
				type: 'remote',
				url: endpoint.url,
				headers: { Authorization: `Bearer ${endpoint.token}` },
				enabled: true,
			},
		},
	}, null, '\t') + '\n';
}

/**
 * grok: no per-session hook (GROK_HOME swaps the whole home and takes the user's auth with it,
 * and GROK_MANAGED_CONFIG ignores a local file — measured against 0.2.118). What it does have is
 * `grok mcp add` with `-H` for headers, so a single registration carries the bearer and keeps
 * working, now that the address it points at no longer moves.
 */
const grokMcpRegisterArgs = (endpoint: IOpenideMcpEndpoint): readonly string[] => [
	'mcp', 'add', endpoint.name, endpoint.url,
	'--transport', 'http',
	'--scope', 'user',
	'--header', `Authorization: Bearer ${endpoint.token}`,
];

/**
 * Codex: `-c` overrides config.toml for this run only, and it reads the bearer from an env var
 * by name, so the token never reaches the command line.
 */
const codexMcpInjection: OpenideMcpInjection = endpoint => ({
	args: [
		'-c', `mcp_servers.${endpoint.name}.url="${endpoint.url}"`,
		'-c', `mcp_servers.${endpoint.name}.bearer_token_env_var="${endpoint.tokenEnvVar}"`,
		'-c', `mcp_servers.${endpoint.name}.tool_timeout_sec=${Math.round(OPENIDE_MCP_TOOL_TIMEOUT_MS / 1000)}`,
	],
	env: { [endpoint.tokenEnvVar]: endpoint.token },
});

/**
 * How long a tool of ours may take before the CLI gives up on it, in ms.
 *
 * Set per server rather than through MCP_TOOL_TIMEOUT, which is process-wide and would silently
 * change the behaviour of every OTHER server the user configured. Generous because one of our
 * tools waits on a person reading a plan: measured against Claude Code 2.1.245, a parked call
 * was still alive at 269s on defaults, and this stops that from being luck. Our own side always
 * settles first (30s for ordinary tools, an hour for blocking ones), so nothing hangs on this.
 */
export const OPENIDE_MCP_TOOL_TIMEOUT_MS = 3_600_000;

/** The JSON `--mcp-config` expects. Written to a 0600 file by the caller, never to argv. */
export function buildClaudeMcpConfig(endpoint: IOpenideMcpEndpoint): string {
	return JSON.stringify({
		mcpServers: {
			[endpoint.name]: {
				type: 'http',
				url: endpoint.url,
				headers: { Authorization: `Bearer ${endpoint.token}` },
				timeout: OPENIDE_MCP_TOOL_TIMEOUT_MS,
			},
		},
	}, null, '\t') + '\n';
}

export const OPENIDE_CLI_CATALOG: readonly IOpenideCliDefinition[] = [
	{ id: 'claude', name: 'Claude Code', binary: 'claude', launchArgs: [], resumeArgs: id => ['--resume', id], supportsHooks: true, icon: 'anthropic', transcriptDir: '.claude/projects', mcpInjection: claudeMcpInjection, mcpConfigBuilder: buildClaudeMcpConfig },
	{ id: 'codex', name: 'Codex', binary: 'codex', launchArgs: [], resumeArgs: id => ['resume', id], supportsHooks: false, icon: 'openai-codex', transcriptDir: '.codex/sessions', mcpInjection: codexMcpInjection },
	{ id: 'gemini', name: 'Gemini CLI', binary: 'gemini', launchArgs: [], resumeArgs: id => ['--resume', id], supportsHooks: false, icon: 'gemini' },
	{ id: 'opencode', name: 'opencode', binary: 'opencode', launchArgs: [], resumeArgs: id => ['--session', id], supportsHooks: false, icon: 'opencode', mcpInjection: opencodeMcpInjection, mcpConfigBuilder: buildOpencodeMcpConfig },
	{ id: 'amp', name: 'Amp', binary: 'amp', launchArgs: [], supportsHooks: false, icon: 'amp' },
	{ id: 'droid', name: 'Factory Droid', binary: 'droid', launchArgs: [], supportsHooks: false, icon: 'droid' },
	{ id: 'copilot', name: 'Copilot CLI', binary: 'copilot', launchArgs: [], supportsHooks: false, icon: 'copilot' },
	{ id: 'grok', name: 'Grok', binary: 'grok', launchArgs: [], resumeArgs: id => ['--resume', id], supportsHooks: false, icon: 'xai', mcpRegisterArgs: grokMcpRegisterArgs },
];

// ---- Probing which agents are installed ------------------------------------------------------

/** Marker the probe prints after each candidate, so one capture can be split per binary. */
const BIN_MARK = 'OPENIDE_BIN_MARK';

/** A name we are willing to put in a shell command. */
const SAFE_BINARY_RE = /^[A-Za-z0-9._-]+$/;

/**
 * ONE shell command that reports every binary at once.
 *
 * One command and not one per agent, because the probe runs through the shared agent terminal:
 * seven concurrent `command -v` calls interleave their output there, each listener resolves on
 * whichever finished first, and most of them parse somebody else's answer and conclude the agent
 * is not installed. That is why the session picker showed one CLI while four were on PATH.
 *
 * On POSIX only `;`, `echo` and `command -v` — the three things sh, bash, zsh and fish all agree
 * on. The user's login shell is whatever they chose, and fish does not parse a `for` loop the way
 * sh does. On Windows the same shape through `where`, which cmd chains with `&`.
 */
export function buildExecutableProbe(names: readonly string[], windows = false): string {
	const safe = names.filter(name => SAFE_BINARY_RE.test(name));
	return windows
		? safe.map(name => `where ${name} 2>nul & echo ${BIN_MARK} ${name}`).join(' & ')
		: safe.map(name => `command -v ${name} 2>/dev/null; echo ${BIN_MARK} ${name}`).join('; ');
}

/**
 * Splits one capture into a path per binary.
 *
 * A candidate only counts when the line looks like a path AND ends with the name we asked
 * about: the capture also carries prompt chrome and, sometimes, the tail of a previous command.
 */
export function parseExecutableProbe(names: readonly string[], output: string): Map<string, string | undefined> {
	const result = new Map<string, string | undefined>(names.map(name => [name, undefined]));
	let pending: string[] = [];
	for (const raw of output.split(/\r?\n/)) {
		const line = raw.trim();
		const mark = line.startsWith(`${BIN_MARK} `) ? line.slice(BIN_MARK.length + 1).trim() : undefined;
		if (mark === undefined) {
			pending.push(line);
			continue;
		}
		if (result.has(mark)) {
			const path = pending.reverse().find(candidate => candidate.startsWith('/') && (candidate === mark || candidate.endsWith(`/${mark}`)));
			result.set(mark, path);
		}
		pending = [];
	}
	return result;
}

export function getOpenideCli(id: string | undefined): IOpenideCliDefinition | undefined {
	return OPENIDE_CLI_CATALOG.find(cli => cli.id === id);
}

export function isOpenideCliId(value: unknown): value is OpenideCliId {
	return typeof value === 'string' && OPENIDE_CLI_CATALOG.some(cli => cli.id === value);
}

/** Orca's `hasUnsafeProviderSessionIdChars`: an id only ever reaches argv if it is boring. */
export function isSafeProviderSessionId(value: string): boolean {
	return /^[A-Za-z0-9._-]{1,200}$/.test(value);
}

export interface IOpenideCliLaunch {
	readonly executable: string;
	readonly args: string[];
	/** Extra environment the args depend on — today, the MCP bearer token. */
	readonly env: Record<string, string>;
}

/**
 * Argv for a fresh or resumed session.
 *
 * Claude keeps the guard Orca found necessary: any `--resume/-r/--continue/-c` already in the
 * launch args is stripped before the authoritative id goes on, or the CLI would see two and
 * pick the wrong one. The joined `-r<id>` form is deliberately not matched — `-r…` could be an
 * unrelated flag on another agent.
 */
export function buildOpenideCliLaunch(cli: IOpenideCliDefinition, executable: string, resumeSessionId?: string, mcpEndpoint?: IOpenideMcpEndpoint): IOpenideCliLaunch {
	let args = [...cli.launchArgs];
	if (resumeSessionId && cli.resumeArgs && isSafeProviderSessionId(resumeSessionId)) {
		if (cli.id === 'claude') {
			args = stripClaudeResumeArgs(args);
		}
		args = [...args, ...cli.resumeArgs(resumeSessionId)];
	}
	let env: Record<string, string> = {};
	if (mcpEndpoint && cli.mcpInjection) {
		const injected = cli.mcpInjection(mcpEndpoint);
		// MCP flags go BEFORE the resume argv: `codex resume <id>` is a subcommand, and a global
		// option placed after it is parsed as the subcommand's, which codex rejects.
		args = [...injected.args, ...args];
		env = injected.env;
	}
	return { executable, args, env };
}

export function stripClaudeResumeArgs(args: readonly string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const token = args[i];
		const isResumeFlag = token === '--resume' || token === '-r' || token === '--continue' || token === '-c';
		if (isResumeFlag) {
			// `--resume <id>`: the id that follows goes too, unless it is another flag.
			const next = args[i + 1];
			if ((token === '--resume' || token === '-r') && next !== undefined && !next.startsWith('-')) {
				i++;
			}
			continue;
		}
		if (token.startsWith('--resume=') || token.startsWith('--continue=') || token.startsWith('-r=') || token.startsWith('-c=')) {
			continue;
		}
		result.push(token);
	}
	return result;
}

// ---- Session status

/** VS Code's `ChatSessionStatus`, spelled out. */
export type OpenideCliSessionStatus = 'in-progress' | 'needs-input' | 'completed' | 'failed';

/**
 * What a hosted CLI can tell the dock. `hook:*` come from native hooks (Claude Code's
 * UserPromptSubmit / Stop / Notification / PreToolUse), `quiet` from the output heuristic, `exit`
 * from the process.
 */
export type OpenideCliSessionEvent =
	| { readonly type: 'launched' }
	| { readonly type: 'hook:prompt' }
	| { readonly type: 'hook:tool' }
	| { readonly type: 'hook:stop'; readonly failed?: boolean }
	| { readonly type: 'hook:notification' }
	| { readonly type: 'output' }
	| { readonly type: 'quiet' }
	| { readonly type: 'exit'; readonly code: number | undefined };

/**
 * Pure transition table. Hooks are authoritative: once a session has reported through hooks the
 * output heuristic stops moving it (`hooked`), otherwise a burst of output on a waiting agent
 * would mark it working again although it is only repainting its prompt.
 */
export function reduceOpenideCliStatus(current: OpenideCliSessionStatus, event: OpenideCliSessionEvent, hooked: boolean): OpenideCliSessionStatus {
	switch (event.type) {
		case 'launched':
			return 'in-progress';
		case 'hook:prompt':
		case 'hook:tool':
			return 'in-progress';
		case 'hook:stop':
			return event.failed ? 'failed' : 'needs-input';
		case 'hook:notification':
			return 'needs-input';
		case 'output':
			return hooked || current === 'completed' || current === 'failed' ? current : 'in-progress';
		case 'quiet':
			return hooked || current !== 'in-progress' ? current : 'needs-input';
		case 'exit':
			return event.code === undefined || event.code === 0 ? 'completed' : 'failed';
	}
}

export function isOpenideCliSessionStatus(value: unknown): value is OpenideCliSessionStatus {
	return value === 'in-progress' || value === 'needs-input' || value === 'completed' || value === 'failed';
}

// ---- Recency groups

export type OpenideSessionGroup = 'today' | 'yesterday' | 'week' | 'month' | 'older';

const DAY = 24 * 60 * 60 * 1000;

/** The bucket a timestamp falls into relative to `now` — VS Code's `AgentSessionSection`. */
export function openideSessionGroupOf(timestamp: number, now: number): OpenideSessionGroup {
	const date = new Date(now);
	const startOfToday = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	if (timestamp >= startOfToday) { return 'today'; }
	if (timestamp >= startOfToday - DAY) { return 'yesterday'; }
	if (timestamp >= startOfToday - 7 * DAY) { return 'week'; }
	if (timestamp >= startOfToday - 30 * DAY) { return 'month'; }
	return 'older';
}

export const OPENIDE_SESSION_GROUP_ORDER: readonly OpenideSessionGroup[] = ['today', 'yesterday', 'week', 'month', 'older'];

export function groupOpenideSessions<T extends { readonly updatedAt: number }>(sessions: readonly T[], now: number): { readonly group: OpenideSessionGroup; readonly sessions: T[] }[] {
	const buckets = new Map<OpenideSessionGroup, T[]>();
	for (const session of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
		const group = openideSessionGroupOf(session.updatedAt, now);
		let bucket = buckets.get(group);
		if (!bucket) {
			bucket = [];
			buckets.set(group, bucket);
		}
		bucket.push(session);
	}
	return OPENIDE_SESSION_GROUP_ORDER.filter(group => buckets.has(group)).map(group => ({ group, sessions: buckets.get(group)! }));
}
