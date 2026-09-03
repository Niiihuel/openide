/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — reading, writing and sanitizing mcp.json, with no DOM and no services.
 *
 *  It lives apart from the Settings section because these are the consequential decisions: which
 *  pasted JSON shapes are accepted, how secrets are masked, and how the file is written without
 *  clobbering somebody else's edits. All of that is testable without standing up any UI.
 *--------------------------------------------------------------------------------------------*/

import { McpServerConfig } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';

/** Secret mask shown to the UI; on save it means "keep the value already in the file". */
export const MCP_SECRET_MASK = '•••';

/** Valid MCP server name (the same criterion as validateMcpServerConfig). */
export const MCP_SERVER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface IMcpConfigInspection {
	/** El archivo existe en disco. */
	readonly exists: boolean;
	/** Servers read; empty when the file does not exist or does not parse. */
	readonly servers: Record<string, McpServerConfig>;
	/** The file exists but could not be read as config: it needs fixing by hand. */
	readonly invalid: boolean;
}

/**
 * Interprets the contents of an mcp.json. A broken file is NOT the same as a missing one:
 * without that distinction, JSON with one comma too many looks exactly like "you have not
 * configured anything yet" and the user has no way to learn their servers stopped loading.
 */
export function inspectMcpConfig(raw: string | undefined): IMcpConfigInspection {
	if (raw === undefined) {
		return { exists: false, servers: {}, invalid: false };
	}
	if (!raw.trim()) {
		return { exists: true, servers: {}, invalid: false }; // archivo recién creado
	}
	let json: any;
	try {
		json = JSON.parse(raw);
	} catch {
		return { exists: true, servers: {}, invalid: true };
	}
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		return { exists: true, servers: {}, invalid: true };
	}
	const servers = json.mcpServers;
	if (servers === undefined) {
		return { exists: true, servers: {}, invalid: false };
	}
	if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
		return { exists: true, servers: {}, invalid: true };
	}
	return { exists: true, servers, invalid: false };
}

/**
 * Upsert/delete of ONE entry against the file text. Returns the new JSON.
 * It touches only that key: a concurrent hand-edit of ANOTHER server is not clobbered.
 */
export function writeMcpServer(raw: string | undefined, name: string, entry: McpServerConfig | undefined, originalName?: string): string {
	let json: any = {};
	try {
		json = raw ? JSON.parse(raw) : {};
	} catch { /* sin archivo o roto: se arranca de cero */ }
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		json = {};
	}
	if (!json.mcpServers || typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers)) {
		json.mcpServers = {};
	}
	if (originalName && originalName !== name) {
		delete json.mcpServers[originalName]; // rename: afuera la clave vieja
	}
	if (entry === undefined) {
		delete json.mcpServers[name];
	} else {
		json.mcpServers[name] = entry;
	}
	return JSON.stringify(json, null, '\t') + '\n';
}

/** Re-mergea los secretos enmascarados desde la entrada guardada. */
export function mergeMcpSecrets(entry: any, previous: McpServerConfig | undefined): any {
	for (const field of ['env', 'headers'] as const) {
		const values = entry?.[field];
		if (values && typeof values === 'object' && !Array.isArray(values)) {
			for (const key of Object.keys(values)) {
				if (values[key] === MCP_SECRET_MASK) {
					const stored = (previous?.[field] as Record<string, string> | undefined)?.[key];
					if (typeof stored === 'string') {
						values[key] = stored;
					} else {
						delete values[key]; // máscara sin valor guardado: clave nueva sin valor
					}
				} else {
					values[key] = String(values[key] ?? '');
				}
			}
			if (!Object.keys(values).length) {
				delete entry[field];
			}
		}
	}
	return entry;
}

/** Copy of an entry with env/header values masked: this is the only thing ever displayed. */
export function redactMcpEntry(config: McpServerConfig): any {
	const clone: any = JSON.parse(JSON.stringify(config ?? {}));
	for (const field of ['env', 'headers']) {
		if (clone[field] && typeof clone[field] === 'object') {
			for (const key of Object.keys(clone[field])) {
				clone[field][key] = MCP_SECRET_MASK;
			}
		}
	}
	return clone;
}

/** Split estilo shell respetando comillas ("npx -y @scope/pkg" → 3 tokens). */
export function splitCommandLine(raw: string): string[] {
	const out: string[] = [];
	for (const match of raw.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
		out.push(match[1] ?? match[2] ?? match[3]);
	}
	return out;
}

/** Name suggested from the last package-looking token (server-github → github). */
export function suggestNameFromCommand(parts: readonly string[]): string {
	for (let i = parts.length - 1; i >= 0; i--) {
		const token = parts[i];
		if (token.startsWith('-')) {
			continue;
		}
		const base = token.split('/').pop()!.replace(/@[\w.^~-]*$/, '').replace(/^(mcp-server-|server-|mcp-)/, '').replace(/(-mcp|-server)$/, '');
		const clean = base.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
		if (clean && /[a-zA-Z]/.test(clean)) {
			return clean.toLowerCase();
		}
	}
	return 'mi-server';
}

/**
 * Acepta `{"mcpServers":{…}}` (clientes MCP comunes), `{"servers":{…}}` (VS Code), un mapa pelado
 * or a bare entry `{command|url:…}` (key '' ⇒ the name is asked for). The JSON people copy from
 * a README comes in any of those shapes: rejecting them on form alone would force the user to
 * hand-translate something we can simply recognize.
 * Returns a string on failure: that string is the message for the user.
 */
export function parseMcpPaste(text: string): Record<string, McpServerConfig> | string {
	let json: any;
	try {
		// tolera trailing commas (copy-paste de READMEs)
		json = JSON.parse(text.trim().replace(/,\s*([}\]])/g, '$1'));
	} catch {
		return 'No parsea como JSON — pegá el bloque completo, con sus llaves.';
	}
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		return 'Tiene que ser un objeto JSON.';
	}
	const map: Record<string, any> =
		(json.mcpServers && typeof json.mcpServers === 'object' && !Array.isArray(json.mcpServers)) ? json.mcpServers
			: (json.servers && typeof json.servers === 'object' && !Array.isArray(json.servers)) ? json.servers
				: (typeof json.command === 'string' || typeof json.url === 'string' || typeof json.serverUrl === 'string') ? { '': json }
					: json;
	const out: Record<string, McpServerConfig> = {};
	for (const [key, value] of Object.entries(map)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			continue;
		}
		const entry: any = { ...(value as object) };
		if (typeof entry.serverUrl === 'string' && !entry.url) {
			entry.url = entry.serverUrl; // variante de algunos READMEs
		}
		delete entry.serverUrl;
		delete entry.type; // formato VS Code ("stdio"/"http"): el transporte acá se infiere
		if (typeof entry.command !== 'string' && typeof entry.url !== 'string') {
			continue;
		}
		out[key] = entry;
	}
	if (!Object.keys(out).length) {
		return 'No encontré ningún server (a cada entrada le falta "command" o "url").';
	}
	return out;
}
