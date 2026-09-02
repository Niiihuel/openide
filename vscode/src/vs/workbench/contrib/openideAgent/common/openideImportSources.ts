/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — where other editors and agent CLIs keep what a user would want to bring over.
 *
 *  Pure: paths are derived from a home directory and a platform, files are parsed from text.
 *  The Settings page (`browser/openideImportSettingsSection.ts`) does the reading and the
 *  writing; this is the part a test can pin down without a disk.
 *--------------------------------------------------------------------------------------------*/

export type OpenideImportPlatform = 'linux' | 'darwin' | 'win32';

export interface IOpenideImportHome {
	readonly home: string;
	readonly platform: OpenideImportPlatform;
}

export interface IOpenideImportIde {
	readonly kind: 'ide';
	readonly id: 'vscode' | 'vscodium' | 'cursor' | 'windsurf';
	readonly label: string;
	/** Folder name under the platform's config root (`~/.config/<dir>/User`). */
	readonly configDir: string;
	/** Dot-folder in the home with `extensions/extensions.json`. */
	readonly homeDir: string;
	/** Provider brand for the mark, when one exists. */
	readonly brand?: string;
	/** The launcher on the PATH: the editor is installed even before it wrote any config. */
	readonly binary: string;
}

export interface IOpenideImportCli {
	readonly kind: 'cli';
	readonly id: 'claude' | 'codex' | 'opencode' | 'gemini';
	readonly label: string;
	readonly brand: string;
	/** The CLI on the PATH, the same name the dock resolves. */
	readonly binary: string;
	/** The file with the MCP servers, relative to home. */
	readonly mcpFile: string;
	readonly mcpFormat: 'claude-json' | 'codex-toml' | 'opencode-json' | 'gemini-json';
	/** The global instructions file, relative to home. */
	readonly rulesFile: string;
}

export type OpenideImportSource = IOpenideImportIde | IOpenideImportCli;

export const OPENIDE_IMPORT_SOURCES: readonly OpenideImportSource[] = [
	{ kind: 'ide', id: 'vscode', label: 'Visual Studio Code', configDir: 'Code', homeDir: '.vscode', brand: 'vscode', binary: 'code' },
	{ kind: 'ide', id: 'vscodium', label: 'VSCodium', configDir: 'VSCodium', homeDir: '.vscode-oss', brand: 'vscodium', binary: 'codium' },
	{ kind: 'ide', id: 'cursor', label: 'Cursor', configDir: 'Cursor', homeDir: '.cursor', brand: 'cursor', binary: 'cursor' },
	{ kind: 'ide', id: 'windsurf', label: 'Windsurf', configDir: 'Windsurf', homeDir: '.windsurf', brand: 'windsurf', binary: 'windsurf' },
	{ kind: 'cli', id: 'claude', label: 'Claude Code', brand: 'claude', binary: 'claude', mcpFile: '.claude.json', mcpFormat: 'claude-json', rulesFile: '.claude/CLAUDE.md' },
	{ kind: 'cli', id: 'codex', label: 'Codex', brand: 'openai', binary: 'codex', mcpFile: '.codex/config.toml', mcpFormat: 'codex-toml', rulesFile: '.codex/AGENTS.md' },
	{ kind: 'cli', id: 'opencode', label: 'opencode', brand: 'opencode', binary: 'opencode', mcpFile: '.config/opencode/opencode.json', mcpFormat: 'opencode-json', rulesFile: '.config/opencode/AGENTS.md' },
	{ kind: 'cli', id: 'gemini', label: 'Gemini CLI', brand: 'gemini', binary: 'gemini', mcpFile: '.gemini/settings.json', mcpFormat: 'gemini-json', rulesFile: '.gemini/GEMINI.md' },
];

function join(...parts: string[]): string {
	return parts.join('/').replace(/\/+/g, '/');
}

/** `<config root>/<Name>/User`: settings.json, keybindings.json and snippets/ live there. */
export function ideUserDir(ide: IOpenideImportIde, where: IOpenideImportHome): string {
	switch (where.platform) {
		case 'darwin': return join(where.home, 'Library', 'Application Support', ide.configDir, 'User');
		case 'win32': return join(where.home, 'AppData', 'Roaming', ide.configDir, 'User');
		default: return join(where.home, '.config', ide.configDir, 'User');
	}
}

export function ideExtensionsFile(ide: IOpenideImportIde, where: IOpenideImportHome): string {
	return join(where.home, ide.homeDir, 'extensions', 'extensions.json');
}

export function cliFile(cli: IOpenideImportCli, where: IOpenideImportHome, which: 'mcp' | 'rules'): string {
	return join(where.home, which === 'mcp' ? cli.mcpFile : cli.rulesFile);
}

/** One MCP server as OpenIDE's `mcp.json` spells it. */
export interface IOpenideImportMcpServer {
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	readonly url?: string;
}

/** `extensions.json` in an extensions folder: `[{ identifier: { id }, ... }]`, ids `publisher.name`. */
export function parseExtensionsJson(text: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	const ids = new Set<string>();
	for (const entry of parsed) {
		const id = (entry as { identifier?: { id?: unknown } })?.identifier?.id;
		if (typeof id === 'string' && /^[\w-]+\.[\w-]+$/.test(id)) {
			ids.add(id.toLowerCase());
		}
	}
	return [...ids].sort();
}

function serverFromJson(raw: unknown): IOpenideImportMcpServer | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const value = raw as Record<string, unknown>;
	const url = typeof value.url === 'string' ? value.url : typeof value.httpUrl === 'string' ? value.httpUrl : undefined;
	let command = typeof value.command === 'string' ? value.command : undefined;
	let args = Array.isArray(value.args) ? value.args.filter((a): a is string => typeof a === 'string') : undefined;
	// opencode: `command: ["npx", "-y", "server"]` — the executable is the first element.
	if (!command && Array.isArray(value.command)) {
		const list = value.command.filter((a): a is string => typeof a === 'string');
		command = list[0];
		args = list.slice(1);
	}
	const envRaw = (value.env ?? value.environment) as unknown;
	const env = envRaw && typeof envRaw === 'object'
		? Object.fromEntries(Object.entries(envRaw as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
		: undefined;
	if (!command && !url) {
		return undefined;
	}
	return { command, args: args?.length ? args : undefined, env: env && Object.keys(env).length ? env : undefined, url };
}

/** Claude Code's `~/.claude.json`, Gemini's `settings.json`: `mcpServers`. opencode: `mcp`. */
export function parseMcpFromJson(text: string, format: 'claude-json' | 'gemini-json' | 'opencode-json'): Record<string, IOpenideImportMcpServer> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	const servers: Record<string, IOpenideImportMcpServer> = {};
	const collect = (root: unknown) => {
		if (!root || typeof root !== 'object') {
			return;
		}
		for (const [name, raw] of Object.entries(root as Record<string, unknown>)) {
			const server = serverFromJson(raw);
			if (server && !(name in servers)) {
				servers[name] = server;
			}
		}
	};
	const doc = parsed as Record<string, unknown> | null;
	collect(doc?.[format === 'opencode-json' ? 'mcp' : 'mcpServers']);
	if (format === 'claude-json' && doc?.projects && typeof doc.projects === 'object') {
		// Claude Code keeps most servers per project (`claude mcp add` without `-s user`); the
		// user thinks of them as "my servers" all the same, so they are offered too, the global
		// ones first when a name repeats.
		for (const project of Object.values(doc.projects as Record<string, unknown>)) {
			collect((project as Record<string, unknown> | null)?.mcpServers);
		}
	}
	return servers;
}

/**
 * Codex's `config.toml`, the `[mcp_servers.<name>]` tables only. A small reader on purpose:
 * `key = "string"`, `key = ["a", "b"]`, `key = { A = "x" }` and the `[mcp_servers.<name>.env]`
 * sub-table are all Codex documents; anything else in the file is skipped, never mis-read.
 */
export function parseMcpFromCodexToml(text: string): Record<string, IOpenideImportMcpServer> {
	const servers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string }> = {};
	let current: { name: string; sub?: string } | undefined;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+#.*$/, '').trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const table = line.match(/^\[\s*mcp_servers\.("?)([^\]".]+)\1(?:\.(\w+))?\s*\]$/);
		if (table) {
			current = { name: table[2], sub: table[3] || undefined };
			servers[current.name] ??= {};
			continue;
		}
		if (line.startsWith('[')) {
			current = undefined;
			continue;
		}
		if (!current) {
			continue;
		}
		const pair = line.match(/^(\w+)\s*=\s*(.+)$/);
		if (!pair) {
			continue;
		}
		const [, key, value] = pair;
		const server = servers[current.name];
		if (current.sub === 'env') {
			const str = tomlString(value);
			if (str !== undefined) {
				(server.env ??= {})[key] = str;
			}
			continue;
		}
		if (current.sub) {
			continue;
		}
		if (key === 'command' || key === 'url') {
			const str = tomlString(value);
			if (str !== undefined) {
				server[key] = str;
			}
		} else if (key === 'args') {
			server.args = tomlStringArray(value);
		} else if (key === 'env') {
			const inline = value.match(/^\{(.*)\}$/);
			if (inline) {
				for (const item of splitTopLevel(inline[1])) {
					const kv = item.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/);
					const str = kv ? tomlString(kv[2]) : undefined;
					if (kv && str !== undefined) {
						(server.env ??= {})[kv[1]] = str;
					}
				}
			}
		}
	}
	const result: Record<string, IOpenideImportMcpServer> = {};
	for (const [name, server] of Object.entries(servers)) {
		if (server.command || server.url) {
			result[name] = { command: server.command, args: server.args?.length ? server.args : undefined, env: server.env, url: server.url };
		}
	}
	return result;
}

function tomlString(value: string): string | undefined {
	const match = value.trim().match(/^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/);
	if (!match) {
		return undefined;
	}
	return match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : match[2];
}

function tomlStringArray(value: string): string[] {
	const inner = value.trim().match(/^\[(.*)\]$/);
	if (!inner) {
		return [];
	}
	return splitTopLevel(inner[1]).map(tomlString).filter((s): s is string => s !== undefined);
}

/** Splits `a, b, c` at the commas outside quotes. */
function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let current = '';
	let quote: string | undefined;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			current += ch;
			if (ch === '\\' && quote === '"') {
				current += text[++i] ?? '';
			} else if (ch === quote) {
				quote = undefined;
			}
		} else if (ch === '"' || ch === '\'') {
			quote = ch;
			current += ch;
		} else if (ch === ',') {
			parts.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	if (current.trim()) {
		parts.push(current.trim());
	}
	return parts;
}

export function parseMcp(text: string, format: IOpenideImportCli['mcpFormat']): Record<string, IOpenideImportMcpServer> {
	return format === 'codex-toml' ? parseMcpFromCodexToml(text) : parseMcpFromJson(text, format);
}

/**
 * Adds servers to an OpenIDE `mcp.json` (root key `mcpServers`). A name already present is
 * left alone: what the user configured here wins over what is being imported. Returns the new
 * text and how many were added.
 */
export function mergeMcpJson(existingText: string | undefined, incoming: Record<string, IOpenideImportMcpServer>): { text: string; added: number } {
	let root: Record<string, unknown> = {};
	if (existingText?.trim()) {
		try {
			const parsed = JSON.parse(existingText);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				root = parsed;
			}
		} catch {
			// unreadable: replaced by a fresh document rather than corrupted further
		}
	}
	const servers = (root.mcpServers && typeof root.mcpServers === 'object' ? root.mcpServers : {}) as Record<string, unknown>;
	let added = 0;
	for (const [name, server] of Object.entries(incoming)) {
		if (name in servers) {
			continue;
		}
		servers[name] = server;
		added++;
	}
	root.mcpServers = servers;
	return { text: JSON.stringify(root, undefined, 2) + '\n', added };
}

/** Keybindings from another editor, minus the ones already in ours (same key and command). */
export function mergeKeybindings(existing: readonly unknown[], incoming: readonly unknown[]): { entries: unknown[]; added: number } {
	const seen = new Set(existing.map(keybindingKey).filter(Boolean));
	const entries = [...existing];
	let added = 0;
	for (const entry of incoming) {
		const key = keybindingKey(entry);
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		entries.push(entry);
		added++;
	}
	return { entries, added };
}

function keybindingKey(entry: unknown): string | undefined {
	if (!entry || typeof entry !== 'object') {
		return undefined;
	}
	const { key, command, when } = entry as { key?: unknown; command?: unknown; when?: unknown };
	if (typeof key !== 'string' || typeof command !== 'string') {
		return undefined;
	}
	return `${key.toLowerCase()}\0${command}\0${typeof when === 'string' ? when : ''}`;
}
