/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — curated catalog of popular MCP servers for the "Add server" wizard of the
 *  Agent Extensions page (integrated gallery pattern: one-click guided
 *  installation, with native prompts only for the missing data — secrets, paths).
 *
 *  Each entry declares the base config (command/args or url) plus `prompts` with what has to be
 *  asked of the user. Secrets carry `secret: true` (password input, they end up in mcp.json's
 *  env/headers and the UI masks them as always). `defaultValue: 'workspaceRoot'`
 *  resolves to the folder open at install time.
 *--------------------------------------------------------------------------------------------*/

export interface IMcpCatalogPrompt {
	/** Where the value lands: environment variable, HTTP header or positional argument (append). */
	readonly kind: 'env' | 'header' | 'arg';
	/** Nombre de la env var / header (ignorado para kind 'arg'). */
	readonly key?: string;
	/** Texto del prompt nativo. */
	readonly label: string;
	readonly placeholder?: string;
	readonly secret?: boolean;
	/** When false and the user leaves it empty, the key is simply not written. */
	readonly required?: boolean;
	/** 'workspaceRoot' resolves to the open folder; any other string goes in literally. */
	readonly defaultValue?: string;
}

export interface IMcpCatalogEntry {
	/** Suggested server name in mcp.json (deduplicated when it already exists). */
	readonly name: string;
	readonly label: string;
	/** One-line description for the QuickPick (detail). */
	readonly description: string;
	readonly transport: 'stdio' | 'http';
	readonly command?: string;
	readonly args?: readonly string[];
	readonly url?: string;
	readonly prompts?: readonly IMcpCatalogPrompt[];
}

export const MCP_CATALOG: readonly IMcpCatalogEntry[] = [
	{
		name: 'filesystem', label: 'Filesystem', transport: 'stdio',
		description: 'Lectura/escritura sobre una carpeta local (el server oficial de referencia).',
		command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'],
		prompts: [{ kind: 'arg', label: 'Carpeta a exponer al agente', defaultValue: 'workspaceRoot', required: true }],
	},
	{
		name: 'github', label: 'GitHub', transport: 'stdio',
		description: 'Repos, issues y pull requests con tu token personal (PAT).',
		command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
		prompts: [{ kind: 'env', key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Token personal de GitHub (Settings → Developer settings → Tokens)', placeholder: 'ghp_…', secret: true, required: true }],
	},
	{
		name: 'playwright', label: 'Playwright', transport: 'stdio',
		description: 'Automatiza un navegador real: navegar, clickear, screenshots, tests.',
		command: 'npx', args: ['-y', '@playwright/mcp@latest'],
	},
	{
		name: 'memory', label: 'Memory', transport: 'stdio',
		description: 'Memoria persistente tipo grafo de conocimiento (entidades y relaciones).',
		command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'],
	},
	{
		name: 'context7', label: 'Context7', transport: 'stdio',
		description: 'Documentación actualizada de librerías y frameworks para el agente.',
		command: 'npx', args: ['-y', '@upstash/context7-mcp'],
		prompts: [{ kind: 'env', key: 'CONTEXT7_API_KEY', label: 'API key de Context7 (opcional — sube el rate limit)', placeholder: 'vacío para saltear', secret: true, required: false }],
	},
	{
		name: 'sequential-thinking', label: 'Sequential Thinking', transport: 'stdio',
		description: 'Razonamiento paso a paso estructurado para problemas complejos.',
		command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
	},
	{
		name: 'postgres', label: 'PostgreSQL', transport: 'stdio',
		description: 'Consultas de solo lectura y esquema de una base PostgreSQL.',
		command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'],
		prompts: [{ kind: 'arg', label: 'Connection string de la base', placeholder: 'postgresql://usuario:clave@localhost:5432/mi_db', required: true }],
	},
	{
		name: 'deepwiki', label: 'DeepWiki', transport: 'http',
		description: 'Documentación de cualquier repo público de GitHub (remoto, sin cuenta).',
		url: 'https://mcp.deepwiki.com/mcp',
	},
	{
		name: 'github-remote', label: 'GitHub (remoto)', transport: 'http',
		description: 'El server MCP remoto oficial de GitHub — sin npx local, requiere PAT.',
		url: 'https://api.githubcopilot.com/mcp/',
		prompts: [{ kind: 'header', key: 'Authorization', label: 'Header Authorization (con el prefijo Bearer)', placeholder: 'Bearer ghp_…', secret: true, required: true }],
	},
	{
		name: 'everything', label: 'Everything (prueba)', transport: 'stdio',
		description: 'El server de prueba oficial del protocolo: tools de ejemplo para verificar que MCP anda.',
		command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'],
	},
];
