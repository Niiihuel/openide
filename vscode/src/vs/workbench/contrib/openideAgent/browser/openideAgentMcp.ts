/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — manager de servers MCP del usuario (lado workbench). Lee `.openide/mcp.json` del
 *  the project's plus the profile-global one (merge: global first, project overrides by name), connects
 *  each server through the MAIN channel (IOpenideAgentHostService — the renderer spawns nothing)
 *  and registers its tools in OpenideToolRegistry as `mcp_<server>_<tool>`: risk 'exec' unless
 *  annotations.readOnlyHint ⇒ 'safe'. No snapshot: the turn's list derives from the live
 *  registry, and when a server drops (state event) its tools are DEREGISTERED — never ghost tools.
 *  ROBUSTNESS: an unparked drop ⇒ automatic reconnection with backoff (2s/8s/30s, fresh config
 *  on each attempt); parked (3+ consecutive failures in main) ⇒ manual revival only via
 *  "Reload MCP servers". A watcher on both mcp.json files ⇒ hot reload with debounce.
 *  tools/list_changed from the server ⇒ re-registration (main re-listed and notifies by event).
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, timeout } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import {
	clampSeconds,
	IOpenideAgentHostService,
	McpServerConfig,
	McpToolInfo,
	MCP_CALL_TIMEOUT_DEFAULT_SECONDS,
	MCP_CALL_TIMEOUT_MAX_SECONDS,
	MCP_CALL_TIMEOUT_MIN_SECONDS,
	OPENIDE_AGENT_HOST_CHANNEL,
	isMcpToolAllowed,
	sanitizeMcpToolName,
	validateMcpServerConfig,
} from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { t } from '../common/openideStrings.js';
import { IAgentTool, OpenideToolRegistry } from './openideTools.js';

/** Global kill-switch (settings): without it nothing connects and no tool is registered. */
const MCP_ENABLED_KEY = 'openide.agent.mcp.enabled';

/** Cap on each tool's description at registration (system prompt token budget). */
const TOOL_DESC_CAP = 1000;

/** Bounded wait on the FIRST runMessages: fast servers make it into the first turn; slow ones
 *  finish connecting in the background and join the next turn (live registry). */
const FIRST_RUN_WAIT_MS = 1500;

/** Backoff for automatic reconnection after an UNPARKED drop (dead process, connection
 *  failure). Once the attempts run out, the server waits for a "Reload MCP servers". */
const RECONNECT_BACKOFF_MS = [2000, 8000, 30000];

/** Debounce for the mcp.json watcher (hand edits or UI edits ⇒ hot reload). */
const CONFIG_WATCH_DEBOUNCE_MS = 800;

interface IConnectSummary {
	servers: number;
	tools: number;
	errors: string[];
}

export class OpenideMcpManager extends Disposable {

	private readonly client: IOpenideAgentHostService;
	private readonly clientId = generateUuid();
	private readonly ownerToken = generateUuid();
	private readonly heartbeatTimer: ReturnType<typeof setInterval>;
	private registry: OpenideToolRegistry | undefined;
	/** Names (already sanitized) registered per server — what has to be removed if the server drops. */
	private readonly registeredTools = new Map<string, string[]>();
	/** Servers we tried to connect in the current cycle (for the reload's disconnect). */
	private readonly activeServers = new Set<string>();
	private readonly serverGenerations = new Map<string, number>();
	/** Lazy-eager connection: triggered on the first runMessages, not at IDE startup. */
	private startPromise: Promise<IConnectSummary> | undefined;
	private connectionGeneration = 0;
	/** Last merged config per server (for re-registration on tools/list_changed). */
	private lastConfigs = new Map<string, McpServerConfig>();
	/** Automatic reconnection with backoff: id → attempt consumed / pending timer. */
	private readonly retryAttempts = new Map<string, number>();
	private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly retryAfter = new Map<string, number>();
	private readonly configWatchScheduler: RunOnceScheduler;

	constructor(
		mainProcessService: IMainProcessService,
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
		private readonly workspaceTrust: IWorkspaceTrustManagementService,
		private readonly configurationService: IConfigurationService,
		private readonly logService: ILogService,
	) {
		super();
		this.client = ProxyChannel.toService<IOpenideAgentHostService>(mainProcessService.getChannel(OPENIDE_AGENT_HOST_CHANNEL));
		this.heartbeatTimer = setInterval(() => { void this.client.mcpHeartbeat(this.clientId, this.ownerToken).catch(() => undefined); }, 60_000);
		(this.heartbeatTimer as unknown as { unref?: () => void }).unref?.();
		void this.client.mcpHeartbeat(this.clientId, this.ownerToken).catch(() => undefined);
		// Server down (process exit, parking after 3 failures, disconnect): tools OUT immediately.
		// If the drop is NOT a parking, an automatic reconnection with backoff is scheduled.
		this._register(this.client.onDidChangeMcpServerStatus(status => {
			if (status.clientId !== this.clientId) { return; }
			if (this.serverGenerations.get(status.id) !== status.generation) { return; }
			if (status.retryAfter) { this.retryAfter.set(status.id, status.retryAfter); } else { this.retryAfter.delete(status.id); }
			if (status.state === 'error' || status.state === 'disconnected') {
				this.deregisterServer(status.id);
				if (status.state === 'error' && !status.parked) {
					this.scheduleReconnect(status.id);
				}
			} else if (status.state === 'connected') {
				this.retryAttempts.delete(status.id); // conexión sana: el backoff arranca de cero
			}
		}));
		// The server announced tools/list_changed and main already re-listed: re-register (deregister +
		// register) so the NEXT turn sees the new list — no snapshot, live registry.
		this._register(this.client.onDidChangeMcpServerTools(e => {
			if (e.clientId !== this.clientId) { return; }
			if (this.serverGenerations.get(e.id) !== e.generation) { return; }
			const config = this.lastConfigs.get(e.id);
			if (config && this.activeServers.has(e.id) && this.enabled()) {
				const count = this.registerServerTools(e.id, config, e.tools);
				this.logService.info(`[openide-mcp] ${e.id}: tools re-registradas tras list_changed (${count})`);
			}
		}));
		// Kill-switch: turning it off disconnects and deregisters everything; turning it on rearms the lazy connection.
		this._register(this.workspaceTrust.onDidChangeTrust(trusted => {
			this.connectionGeneration++;
			this.startPromise = undefined;
			if (!trusted) { this.disconnectAll().catch(() => undefined); }
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(MCP_ENABLED_KEY)) {
				this.connectionGeneration++;
				this.startPromise = undefined;
				if (!this.enabled()) {
					this.disconnectAll().catch(() => { /* best-effort */ });
				}
			}
		}));
		// Hot reload: editing mcp.json (by hand or from the Extensions UI) reloads on its own,
		// with debounce — the UI status pill stays honest without a manual "Reload".
		this.configWatchScheduler = this._register(new RunOnceScheduler(() => {
			this.reload()
				.then(summary => this.logService.info(`[openide-mcp] mcp.json changed — reload: ${summary}`))
				.catch(e => this.logService.warn(`[openide-mcp] watcher reload failed: ${e instanceof Error ? e.message : String(e)}`));
		}, CONFIG_WATCH_DEBOUNCE_MS));
		const watched = [this.globalConfigUri(), this.projectConfigUri()].filter((u): u is URI => !!u);
		for (const uri of watched) {
			this._register(this.fileService.watch(uri));
		}
		this._register(this.fileService.onDidFilesChange(e => {
			if (watched.some(uri => e.affects(uri))) {
				this.configWatchScheduler.schedule();
			}
		}));
	}

	override dispose(): void {
		clearInterval(this.heartbeatTimer);
		this.clearRetries();
		void this.disconnectAll();
		super.dispose();
	}

	/** The service hands us its registry (same pattern as browserAutomation.registerTools). */
	registerTools(registry: OpenideToolRegistry): void { this.registry = registry; }
	getClientId(): string { return this.clientId; }
	getOwnerToken(): string { return this.ownerToken; }

	private enabled(): boolean {
		return this.workspaceTrust.isWorkspaceTrusted() && this.configurationService.getValue<boolean>(MCP_ENABLED_KEY) !== false;
	}

	/** Called at the start of every runMessages. The FIRST time it triggers the connection of all
	 *  enabled servers and waits, bounded (1.5s); afterwards it is a no-op — the turn uses whatever
	 *  is already connected and the rest joins the next turn (getDefinitions reads the live registry). */
	async ensureStarted(): Promise<void> {
		if (!this.enabled() || !this.registry) {
			return;
		}
		if (!this.startPromise) {
			this.startPromise = this.connectAll();
			await Promise.race([this.startPromise, timeout(FIRST_RUN_WAIT_MS)]);
		}
	}

	/** Recarga completa (comando "Recargar servers MCP" / la UI de Fase 5): disconnect all +
	 *  re-read of the mcp.json files + reconnect. Returns a readable summary for the notification. */
	async reload(): Promise<string> {
		this.connectionGeneration++;
		this.startPromise = undefined;
		await this.disconnectAll();
		if (!this.enabled()) {
			return t('service.mcp.disabled');
		}
		if (!this.registry) {
			return t('service.mcp.registryNotReady');
		}
		this.startPromise = this.connectAll();
		const summary = await this.startPromise;
		if (!summary.servers && !summary.errors.length) {
			return t('service.mcp.noServers');
		}
		const ok = t('service.mcp.summary', summary.servers, summary.tools);
		return summary.errors.length ? t('service.mcp.summaryErrors', ok, summary.errors.join(' · ')) : ok;
	}

	// ---- lectura y merge de mcp.json ----

	private projectConfigUri(): URI | undefined {
		const folder = this.contextService.getWorkspace().folders[0];
		return folder ? joinPath(folder.uri, '.openide', 'mcp.json') : undefined;
	}

	private globalConfigUri(): URI {
		return joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'mcp.json');
	}

	/** Reads an mcp.json (root key `mcpServers`). Unreadable/missing/malformed ⇒ empty. */
	private async readConfigFile(uri: URI | undefined): Promise<Record<string, McpServerConfig>> {
		if (!uri) {
			return {};
		}
		try {
			const raw = JSON.parse((await this.fileService.readFile(uri)).value.toString());
			const servers = raw?.mcpServers;
			return servers && typeof servers === 'object' && !Array.isArray(servers) ? servers : {};
		} catch {
			return {}; // sin archivo todavía, o JSON roto: el resto de los servers sigue
		}
	}

	/** Merge: global first, project overrides by name. Invalid entries are skipped with a warning. */
	private async loadConfigs(): Promise<Map<string, McpServerConfig>> {
		const [global, project] = await Promise.all([
			this.readConfigFile(this.globalConfigUri()),
			this.readConfigFile(this.projectConfigUri()),
		]);
		const out = new Map<string, McpServerConfig>();
		for (const [name, config] of [...Object.entries(global), ...Object.entries(project)]) {
			const invalid = validateMcpServerConfig(name, config ?? {});
			if (invalid) {
				this.logService.warn(`[openide-mcp] mcp.json: ${invalid} — server skipeado`);
				out.delete(name); // el proyecto pisa al global incluso para invalidarlo
				continue;
			}
			out.set(name, config);
		}
		return out;
	}

	// ---- automatic reconnection with backoff ----

	/** Schedules ONE reconnection attempt after an unparked drop. The attempt re-reads the config
	 *  from disk (an edit may have been exactly the fix). If mcpConnect fails again,
	 *  el evento 'error' resultante agenda el siguiente — hasta agotar RECONNECT_BACKOFF_MS o
	 *  until main parks it; from then on, manual revival ("Reload MCP servers"). */
	private scheduleReconnect(id: string): void {
		if (!this.enabled() || !this.activeServers.has(id) || this.retryTimers.has(id)) {
			return;
		}
		const attempt = this.retryAttempts.get(id) ?? 0;
		if (attempt >= RECONNECT_BACKOFF_MS.length) {
			this.logService.warn(`[openide-mcp] ${id}: retries exhausted — stays down until "Reload MCP servers"`);
			return;
		}
		this.retryAttempts.set(id, attempt + 1);
		const generation = this.connectionGeneration;
		const timer = setTimeout(async () => {
			this.retryTimers.delete(id);
			if (generation !== this.connectionGeneration) { return; }
			if (!this.enabled() || !this.activeServers.has(id)) {
				return; // reload/kill-switch en el medio: ese ciclo ya no es el vigente
			}
			try {
				const config = (await this.loadConfigs()).get(id);
				if (generation !== this.connectionGeneration || !this.enabled() || !this.activeServers.has(id)) { return; }
				if (!config || config.enabled === false) {
					return; // lo sacaron o deshabilitaron mientras esperaba el backoff
				}
				this.lastConfigs.set(id, config);
				this.serverGenerations.set(id, generation);
				const result = await this.client.mcpConnect(this.clientId, this.ownerToken, id, config, generation);
				if (generation !== this.connectionGeneration || result.generation !== generation || !this.enabled() || !this.activeServers.has(id)) { await this.client.mcpDisconnect(this.clientId, this.ownerToken, id, generation); return; }
				this.registerServerTools(id, config, result.tools);
				this.logService.info(`[openide-mcp] ${id}: reconnected (attempt ${attempt + 1}, ${result.tools.length} tools)`);
			} catch (e) {
				// the 'error' state main emitted already scheduled (or parked) the next step
				this.logService.warn(`[openide-mcp] ${id}: retry ${attempt + 1} failed — ${e instanceof Error ? e.message : String(e)}`);
			}
		}, Math.max(RECONNECT_BACKOFF_MS[attempt], (this.retryAfter.get(id) ?? 0) - Date.now()));
		this.retryTimers.set(id, timer);
	}

	private clearRetries(): void {
		for (const timer of this.retryTimers.values()) {
			clearTimeout(timer);
		}
		this.retryTimers.clear();
		this.retryAttempts.clear();
		this.retryAfter.clear();
	}

	// ---- connection and tool registration ----

	/** Connects every enabled server IN PARALLEL. It never rejects: per-server failures end up in
	 *  the summary (and the log) — one broken server does not take down the others. */
	private async connectAll(): Promise<IConnectSummary> {
		const generation = ++this.connectionGeneration;
		const configs = await this.loadConfigs();
		if (generation !== this.connectionGeneration || !this.enabled()) { return { servers: 0, tools: 0, errors: [] }; }
		this.lastConfigs = configs;
		const summary: IConnectSummary = { servers: 0, tools: 0, errors: [] };
		await Promise.all([...configs.entries()].map(async ([id, config]) => {
			if (config.enabled === false || generation !== this.connectionGeneration || !this.enabled()) { return; }
			this.activeServers.add(id); this.serverGenerations.set(id, generation);
			try {
				const result = await this.client.mcpConnect(this.clientId, this.ownerToken, id, config, generation);
				if (generation !== this.connectionGeneration || result.generation !== generation || !this.enabled() || !this.activeServers.has(id)) { await this.client.mcpDisconnect(this.clientId, this.ownerToken, id, generation); return; }
				const count = this.registerServerTools(id, config, result.tools);
				summary.servers++;
				summary.tools += count;
			} catch (e) {
				// the error already arrives redacted from main (redactSecrets over env/headers)
				const msg = e instanceof Error ? e.message : String(e);
				this.logService.warn(`[openide-mcp] ${id}: did not connect — ${msg}`);
				summary.errors.push(`${id}: ${msg}`);
			}
		}));
		return summary;
	}

	/** include beats exclude (when there is an include, it is a strict whitelist). */
	private toolAllowed(config: McpServerConfig, toolName: string): boolean { return isMcpToolAllowed(config, toolName); }

	/** Registers a connected server's tools. Returns how many made it into the registry. */
	private registerServerTools(id: string, config: McpServerConfig, tools: McpToolInfo[]): number {
		if (!this.registry) {
			return 0;
		}
		this.deregisterServer(id); // reconexión: primero afuera lo viejo (la lista pudo cambiar)
		const timeoutMs = clampSeconds(config.timeout, MCP_CALL_TIMEOUT_DEFAULT_SECONDS, MCP_CALL_TIMEOUT_MIN_SECONDS, MCP_CALL_TIMEOUT_MAX_SECONDS) * 1000;
		const names: string[] = [];
		for (const tool of tools) {
			if (!this.toolAllowed(config, tool.name)) {
				continue;
			}
			const name = sanitizeMcpToolName(id, tool.name);
			if (this.registry.hasTool(name)) {
				// collision guard: NEVER overwrite a built-in (nor another server's tool)
				this.logService.warn(`[openide-mcp] ${id}: tool "${name}" collides with an already registered one — skipped`);
				continue;
			}
			this.registry.registerTool(this.buildTool(id, tool, name, timeoutMs));
			names.push(name);
		}
		this.registeredTools.set(id, names);
		return names.length;
	}

	/** Every MCP tool is exec: annotations.readOnlyHint is unauthenticated server metadata and
	 * can never skip the approval gate. */
	private buildTool(serverId: string, tool: McpToolInfo, name: string, timeoutMs: number): IAgentTool {
		const generation = this.serverGenerations.get(serverId) ?? -1;
		const description = (tool.description || `Tool "${tool.name}" from MCP server "${serverId}".`).slice(0, TOOL_DESC_CAP);
		const parameters = (tool.inputSchema && typeof tool.inputSchema === 'object') ? tool.inputSchema as object : { type: 'object', properties: {} };
		return {
			risk: 'exec',
			def: { name, description, parameters },
			approvalInfo: () => ({ title: 'Ejecutar tool MCP', detail: `${serverId} → ${tool.name}` }),
			invoke: async (args) => {
				if (!this.enabled() || this.serverGenerations.get(serverId) !== generation) { return 'Error: the MCP connection is no longer authorized.'; }
				const result = await this.client.mcpCallTool(this.clientId, this.ownerToken, serverId, generation, tool.name, args ?? {}, timeoutMs);
				if (result.isError) {
					return result.text.startsWith('Error') ? result.text : `Error: ${result.text}`;
				}
				return result.text || '(no output)';
			},
		};
	}

	/** Removes a server's tools from the registry (idempotent: called by event AND by reload). */
	private deregisterServer(id: string): void {
		const names = this.registeredTools.get(id);
		if (!names || !this.registry) {
			return;
		}
		for (const name of names) {
			this.registry.deregisterTool(name);
		}
		this.registeredTools.delete(id);
	}

	/** Deregisters everything and cuts all main connections (reload / kill-switch off). */
	private async disconnectAll(): Promise<void> {
		this.clearRetries(); // los reintentos pendientes son del ciclo viejo
		const ids = new Set([...this.registeredTools.keys(), ...this.activeServers]);
		const connections = [...ids].map(id => ({ id, generation: this.serverGenerations.get(id) }));
		this.activeServers.clear();
		this.serverGenerations.clear();
		for (const id of ids) { this.deregisterServer(id); }
		await Promise.all(connections.map(({ id, generation }) => this.client.mcpDisconnect(this.clientId, this.ownerToken, id, generation).catch(() => { /* best-effort */ })));
	}
}
