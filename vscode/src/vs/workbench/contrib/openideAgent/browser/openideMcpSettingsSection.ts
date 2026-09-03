/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — DOM section for Settings > AI Agent > MCP.
 *
 *  An MCP server is an mcp.json entry, not a config key: the page is 100% section. The scope
 *  comes from the header tabs (User/Workspace) and the search from the native search box.
 *
 *  Two things govern the design:
 *    - The file is the truth. The page shows which file it read, whether it exists and whether it
 *        parses — a broken mcp.json must NOT look like an empty one, or servers vanish silently.
 *    - env/header secrets are NEVER displayed: they arrive masked and on save they are re-merged
 *        from the file. Upserts are PER SERVER over a fresh read, so a concurrent hand-edit of
 *        another server is not clobbered.
 *
 *  Additions are native QuickInput wizards (upstream's "MCP: Add Server..." pattern):
 *  each decision is a step, and cancelling aborts cleanly. There are no add forms here.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import {
	IOpenideAgentHostService,
	McpServerConfig,
	McpServerStatus,
	OPENIDE_AGENT_HOST_CHANNEL,
	validateMcpServerConfig,
} from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { OpenideSectionRenderer, ISectionStatus } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import {
	inspectMcpConfig,
	IMcpConfigInspection,
	MCP_SECRET_MASK,
	MCP_SERVER_NAME_RE,
	mergeMcpSecrets,
	parseMcpPaste,
	redactMcpEntry,
	splitCommandLine,
	suggestNameFromCommand,
	writeMcpServer,
} from '../common/openideMcpConfig.js';
import { IMcpCatalogEntry, MCP_CATALOG } from './openideAgentMcpCatalog.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { t } from '../common/openideStrings.js';

type ConfigScope = 'project' | 'global';

/** Prefix for TEST connection ids: they are not real servers — the manager ignores them. */
const TEST_ID_PREFIX = 'uitest_';

const MCP_ENABLED_KEY = 'openide.agent.mcp.enabled';

interface IServerRow {
	readonly name: string;
	readonly scope: ConfigScope;
	readonly enabled: boolean;
	readonly transport: 'stdio' | 'http';
	/** A project server with the same name wins: the global one has no effect. */
	readonly shadowed: boolean;
	/** Message explaining why the entry is unusable; empty = valid. */
	readonly invalid: string;
	readonly entry: any;
}

/** Draft of the edit form. While it exists, the section does NOT repaint on its own: a live
 *  state event must not erase what somebody is typing. */
interface IMcpDraft {
	readonly key: string;
	readonly originalName: string;
	scope: ConfigScope;
	name: string;
	transport: 'stdio' | 'http';
	command: string;
	argsText: string;
	url: string;
	envRows: { k: string; v: string }[];
	headerRows: { k: string; v: string }[];
	enabled: boolean;
	extras: Record<string, unknown>;
	advanced: boolean;
	rawMode: boolean;
	rawJson: string;
	touched: boolean;
	test?: { busy: boolean; ok?: boolean; message?: string };
}

export class OpenideMcpSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings: readonly string[] = [MCP_ENABLED_KEY];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private readonly hostClient: IOpenideAgentHostService;
	private readonly testClientId = generateUuid();
	private readonly testOwnerToken = generateUuid();
	private testGeneration = 0;

	private root: HTMLElement | undefined;
	private context: IOpenideSettingsSectionContext = { scope: 'workspace', query: '' };
	private generation = 0;
	private draft: IMcpDraft | undefined;
	private status: readonly McpServerStatus[] = [];
	private readonly watched = new Set<string>();

	constructor(
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.hostClient = ProxyChannel.toService<IOpenideAgentHostService>(mainProcessService.getChannel(OPENIDE_AGENT_HOST_CHANNEL));

		// Live state (the "Connected (N tools)" / "Error" pill), hand edits to the file and
		// settings changes: everything ends in a single batched repaint.
		const refresh = this._register(new RunOnceScheduler(() => this.paint(), 300));
		this._register(this.hostClient.onDidChangeMcpServerStatus(() => refresh.schedule()));
		this._register(this.agentService.onDidChange(() => refresh.schedule()));
		this._register(this.fileService.onDidFilesChange(event => {
			for (const key of this.watched) {
				if (event.affects(URI.parse(key))) { refresh.schedule(); return; }
			}
		}));
		for (const scope of ['project', 'global'] as const) {
			const uri = this.mcpJsonUri(scope);
			if (uri) { this.watch(uri); }
		}
	}

	render(container: HTMLElement, context: IOpenideSettingsSectionContext): void {
		this.context = context;
		// The editor rebuilt its DOM: the form that might have been open no longer exists.
		this.draft = undefined;
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
	}

	// ---- rutas y lectura ----

	private get scope(): ConfigScope { return this.context.scope === 'user' ? 'global' : 'project'; }
	private projectRoot(): URI | undefined { return this.contextService.getWorkspace().folders[0]?.uri; }
	private globalRoot(): URI { return joinPath(this.environmentService.userRoamingDataHome, 'openideAgent'); }

	private mcpJsonUri(scope: ConfigScope): URI | undefined {
		if (scope === 'global') { return joinPath(this.globalRoot(), 'mcp.json'); }
		const root = this.projectRoot();
		return root ? joinPath(root, '.openide', 'mcp.json') : undefined;
	}

	private watch(uri: URI): void {
		const key = uri.toString();
		if (!this.watched.has(key)) {
			this.watched.add(key);
			this._register(this.fileService.watch(uri));
		}
	}

	private async inspect(scope: ConfigScope): Promise<IMcpConfigInspection> {
		const uri = this.mcpJsonUri(scope);
		if (!uri) { return { exists: false, servers: {}, invalid: false }; }
		try {
			return inspectMcpConfig((await this.fileService.readFile(uri)).value.toString());
		} catch {
			return inspectMcpConfig(undefined); // no existe todavía
		}
	}

	private async writeServer(scope: ConfigScope, name: string, entry: McpServerConfig | undefined, originalName?: string): Promise<void> {
		const uri = this.mcpJsonUri(scope);
		if (!uri) { throw new Error(t('openide.mcp.noProject')); }
		let raw: string | undefined;
		try { raw = (await this.fileService.readFile(uri)).value.toString(); } catch { raw = undefined; }
		await this.fileService.writeFile(uri, VSBuffer.fromString(writeMcpServer(raw, name, entry, originalName)));
	}

	// ---- pintado ----

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) { return; }
		// With a form open, repainting means erasing what the user is typing.
		if (this.draft) { return; }
		this.renderStore.clear();
		clearNode(root);
		const token = ++this.generation;
		void this.paintAll(root, token);
	}

	/** Repaints even with an open draft (after saving, removing or cancelling). */
	private repaint(): void {
		this.draft = undefined;
		this.paint();
	}

	private async paintAll(root: HTMLElement, token: number): Promise<void> {
		const [project, global, status] = await Promise.all([
			this.inspect('project'),
			this.inspect('global'),
			this.hostClient.mcpStatus(this.agentService.mcpClientId(), this.agentService.mcpOwnerToken()).catch(() => [] as McpServerStatus[]),
		]);
		if (token !== this.generation || !root.isConnected) { return; }
		this.status = status.filter(entry => !entry.id.startsWith(TEST_ID_PREFIX));

		const scope = this.scope;
		const inspection = scope === 'global' ? global : project;
		const rows: IServerRow[] = Object.entries(inspection.servers).map(([name, config]) => ({
			name,
			scope,
			enabled: config?.enabled !== false,
			transport: config?.url ? 'http' : 'stdio',
			shadowed: scope === 'global' && name in project.servers,
			invalid: validateMcpServerConfig(name, config ?? {}) ?? '',
			entry: redactMcpEntry(config ?? {}),
		}));

		const enabled = this.configurationService.getValue<boolean>(MCP_ENABLED_KEY) !== false;
		const body = this.ui.section(root, {
			title: t('openide.mcp.title'),
			description: t('openide.mcp.desc'),
			keywords: ['mcp', 'model context protocol', 'servidor', 'server', 'herramienta', 'tool'],
			actions: [
				{ label: t('openide.mcp.add'), icon: 'add', primary: true, run: () => void this.runAddWizard() },
				{ label: t('openide.mcp.reload'), icon: 'refresh', run: () => void this.reload() },
			],
		});

		this.ui.row(body, {
			name: t('openide.mcp.enabledName'),
			description: t('openide.mcp.enabledDesc'),
			keywords: ['mcp', 'habilitar', 'deshabilitar', 'kill switch'],
			toggle: { checked: enabled, change: on => void this.setEnabled(on) },
		});

		if (scope === 'project' && !this.projectRoot()) {
			this.ui.empty(body, {
				title: t('openide.mcp.noProjectTitle'),
				description: t('openide.mcp.noProjectDesc'),
			});
			this.paintFiles(root, project, global);
			return;
		}

		if (rows.length) {
			const connected = rows.filter(row => this.statusOf(row.name)?.state === 'connected').length;
			const tools = this.status.reduce((sum, entry) => sum + (entry.state === 'connected' ? entry.toolCount : 0), 0);
			this.ui.metrics(body, [
				{ value: String(rows.length), label: t('openide.mcp.metricServers') },
				{ value: String(connected), label: t('openide.mcp.metricConnected') },
				{ value: String(tools), label: t('openide.mcp.metricTools') },
			]);
		}

		if (!rows.length) {
			this.ui.empty(body, {
				title: t('openide.mcp.emptyTitle'),
				description: t('openide.mcp.emptyDesc'),
				actions: [{ label: t('openide.mcp.add'), icon: 'add', primary: true, run: () => void this.runAddWizard() }],
			});
		}

		for (const row of rows) {
			this.paintServer(body, row, enabled);
		}
		this.paintFiles(root, project, global);
	}

	private statusOf(name: string): McpServerStatus | undefined {
		return this.status.find(entry => entry.id === name);
	}

	/** Translates the manager's state into the pill. "Verifying" is a state of its own: while it
	 *  connects we can claim neither that it works nor that it failed. */
	private statusFor(row: IServerRow, mcpEnabled: boolean): ISectionStatus {
		if (!mcpEnabled) { return { tone: 'neutral', label: t('openide.mcp.stOff') }; }
		if (!row.enabled) { return { tone: 'neutral', label: t('openide.mcp.stDisabled') }; }
		if (row.invalid) { return { tone: 'error', label: t('openide.mcp.stInvalid'), title: row.invalid }; }
		const status = this.statusOf(row.name);
		if (status?.state === 'connected') {
			return { tone: 'ok', label: t('openide.mcp.stConnected', status.toolCount) };
		}
		if (status?.state === 'connecting') { return { tone: 'neutral', busy: true, label: t('openide.mcp.stConnecting') }; }
		if (status?.state === 'error') {
			// parked = 3+ consecutive failures: no automatic reconnection, it revives with "Reload"
			const detail = status.parked
				? t('openide.mcp.stParkedTip')
				: t('openide.mcp.stRetryTip');
			return {
				tone: 'error',
				label: status.parked ? t('openide.mcp.stParked') : t('openide.mcp.stError'),
				title: status.error ? `${status.error} — ${detail}` : detail,
			};
		}
		return { tone: 'neutral', label: t('openide.mcp.stIdle') };
	}

	private paintServer(body: HTMLElement, row: IServerRow, mcpEnabled: boolean): void {
		const entry = row.entry ?? {};
		const summary = row.transport === 'http'
			? String(entry.url ?? '')
			: [entry.command, ...((entry.args as string[]) ?? [])].filter(Boolean).join(' ');
		const badges: string[] = [row.transport];
		if (row.shadowed) { badges.push(t('openide.mcp.shadowed')); }

		this.ui.row(body, {
			name: row.name,
			mono: true,
			description: summary || t('openide.mcp.noSummary'),
			badges,
			status: this.statusFor(row, mcpEnabled),
			keywords: ['mcp', 'servidor', 'server', row.transport],
			toggle: {
				checked: row.enabled,
				title: t('openide.mcp.toggleTip'),
				change: on => void this.toggleServer(row, on),
			},
			expand: host => this.paintForm(host, row),
		});
	}

	// ---- edit form ----

	private draftFrom(row: IServerRow): IMcpDraft {
		const entry = row.entry ?? {};
		const known = ['command', 'args', 'env', 'url', 'headers', 'enabled'];
		const extras: Record<string, unknown> = {};
		for (const key of Object.keys(entry)) {
			if (!known.includes(key)) { extras[key] = entry[key]; }
		}
		const rowsOf = (value: any) => Object.entries(value ?? {}).map(([k, v]) => ({ k, v: String(v) }));
		return {
			key: `${row.scope}/${row.name}`,
			originalName: row.name,
			scope: row.scope,
			name: row.name,
			transport: row.transport,
			command: String(entry.command ?? ''),
			argsText: ((entry.args as string[]) ?? []).join('\n'),
			url: String(entry.url ?? ''),
			envRows: rowsOf(entry.env),
			headerRows: rowsOf(entry.headers),
			enabled: row.enabled,
			extras,
			advanced: false,
			rawMode: false,
			rawJson: '',
			touched: false,
		};
	}

	private composeEntry(draft: IMcpDraft): any {
		const entry: any = {};
		if (draft.transport === 'stdio') {
			if (draft.command.trim()) { entry.command = draft.command.trim(); }
			const args = draft.argsText.split('\n').map(arg => arg.trim()).filter(Boolean);
			if (args.length) { entry.args = args; }
			const env = this.objectOf(draft.envRows);
			if (env) { entry.env = env; }
		} else {
			if (draft.url.trim()) { entry.url = draft.url.trim(); }
			const headers = this.objectOf(draft.headerRows);
			if (headers) { entry.headers = headers; }
		}
		for (const [key, value] of Object.entries(draft.extras)) {
			if (key !== 'command' && key !== 'url') { entry[key] = value; }
		}
		if (!draft.enabled) { entry.enabled = false; }
		return entry;
	}

	private objectOf(rows: readonly { k: string; v: string }[]): Record<string, string> | undefined {
		let out: Record<string, string> | undefined;
		for (const row of rows) {
			if (row.k.trim()) { out = out ?? {}; out[row.k.trim()] = row.v; }
		}
		return out;
	}

	private draftError(draft: IMcpDraft): string {
		const name = draft.name.trim();
		if (!MCP_SERVER_NAME_RE.test(name)) {
			return t('openide.mcp.errName');
		}
		if (draft.rawMode) {
			try { JSON.parse(draft.rawJson); } catch { return t('openide.mcp.errJson'); }
			return '';
		}
		if (draft.transport === 'stdio' && !draft.command.trim()) {
			return t('openide.mcp.errCommand');
		}
		if (draft.transport === 'http' && !/^https?:\/\/\S+$/i.test(draft.url.trim())) {
			return t('openide.mcp.errUrl');
		}
		return '';
	}

	private paintForm(host: HTMLElement, row: IServerRow): void {
		const key = `${row.scope}/${row.name}`;
		if (this.draft?.key !== key) { this.draft = this.draftFrom(row); }
		const draft = this.draft!;
		const redraw = () => { clearNode(host); this.paintForm(host, row); };

		this.ui.input(host, {
			label: t('openide.mcp.fieldName'),
			value: draft.name,
			placeholder: 'github, notion…',
			mono: true,
			change: value => { draft.name = value; draft.touched = true; },
		});
		this.ui.segmented(host, {
			label: t('openide.mcp.fieldTransport'),
			options: [{ id: 'stdio', label: 'stdio (command)' }, { id: 'http', label: 'HTTP (url)' }],
			value: draft.transport,
			change: id => { draft.transport = id as 'stdio' | 'http'; redraw(); },
		});

		if (draft.transport === 'stdio') {
			this.ui.input(host, {
				label: 'Command', value: draft.command, placeholder: 'npx', mono: true,
				change: value => { draft.command = value; draft.touched = true; },
			});
			this.ui.textarea(host, {
				label: t('openide.mcp.fieldArgs'),
				value: draft.argsText, rows: 3, mono: true, placeholder: '-y\n@modelcontextprotocol/server-github',
				change: value => { draft.argsText = value; },
			});
			this.ui.keyValue(host, {
				label: 'Env',
				description: t('openide.mcp.envDesc'),
				rows: draft.envRows, secret: true, mask: MCP_SECRET_MASK,
				addLabel: t('openide.mcp.addEnv'),
				changed: redraw,
			});
		} else {
			this.ui.input(host, {
				label: 'URL', value: draft.url, placeholder: 'https://mcp.ejemplo.com/mcp', mono: true,
				change: value => { draft.url = value; draft.touched = true; },
			});
			this.ui.keyValue(host, {
				label: 'Headers',
				description: t('openide.mcp.headersDesc'),
				rows: draft.headerRows, secret: true, mask: MCP_SECRET_MASK,
				addLabel: t('openide.mcp.addHeader'),
				changed: redraw,
			});
		}

		this.ui.disclosure(host, {
			label: t('openide.mcp.advanced'),
			open: draft.advanced,
			toggle: () => {
				draft.advanced = !draft.advanced;
				if (draft.advanced && !draft.rawMode) { draft.rawJson = JSON.stringify(this.composeEntry(draft), null, 2); }
				redraw();
			},
		});
		if (draft.advanced) {
			this.ui.textarea(host, {
				label: t('openide.mcp.advancedLabel'), value: draft.rawJson, rows: 8, mono: true,
				description: t('openide.mcp.advancedDesc', MCP_SECRET_MASK),
				change: value => { draft.rawJson = value; draft.rawMode = true; draft.touched = true; },
			});
		}

		if (draft.touched) {
			const error = this.draftError(draft);
			if (error) { this.ui.errorLine(host, error); }
		}
		if (draft.test && !draft.test.busy && draft.test.message) {
			const line = append(host, $(draft.test.ok ? '.openide-settings-field-desc' : '.openide-settings-errline'));
			line.textContent = draft.test.message;
		}

		const actions = append(host, $('.openide-settings-section-actions'));
		this.ui.button(actions, {
			label: draft.test?.busy ? t('openide.mcp.testing') : t('openide.mcp.test'),
			icon: draft.test?.busy ? 'loading' : 'beaker',
			enabled: !draft.test?.busy,
			run: () => { draft.touched = true; if (this.draftError(draft)) { redraw(); return; } void this.testServer(draft, redraw); },
		});
		this.ui.button(actions, {
			label: t('openide.mcp.save'), icon: 'save', primary: true,
			run: () => { draft.touched = true; if (this.draftError(draft)) { redraw(); return; } void this.saveServer(draft); },
		});
		this.ui.button(actions, {
			label: t('openide.mcp.openJson'), icon: 'go-to-file',
			run: () => void this.openJson(draft.scope),
		});
		this.ui.button(actions, {
			label: t('openide.mcp.remove'), icon: 'trash', danger: true,
			confirm: t('openide.mcp.removeConfirm'),
			run: () => void this.removeServer(draft.scope, draft.originalName),
		});
	}

	// ---- configuration files (pattern: the file is the truth) ----

	private paintFiles(root: HTMLElement, project: IMcpConfigInspection, global: IMcpConfigInspection): void {
		const body = this.ui.section(root, {
			title: t('openide.mcp.filesTitle'),
			description: t('openide.mcp.filesDesc'),
			keywords: ['mcp.json', 'archivo', 'config', 'json'],
		});
		const projectUri = this.mcpJsonUri('project');
		const entries: { scope: ConfigScope; label: string; path: string; inspection: IMcpConfigInspection }[] = [];
		if (projectUri) {
			entries.push({ scope: 'project', label: '.openide/mcp.json', path: projectUri.fsPath, inspection: project });
		}
		entries.push({ scope: 'global', label: 'mcp.json', path: this.mcpJsonUri('global')!.fsPath, inspection: global });

		for (const entry of entries) {
			const count = Object.keys(entry.inspection.servers).length;
			const status: ISectionStatus = entry.inspection.invalid
				? { tone: 'error', label: t('openide.mcp.fileInvalid') }
				: !entry.inspection.exists
					? { tone: 'neutral', label: t('openide.mcp.fileMissing') }
					: { tone: count ? 'ok' : 'neutral', label: t('openide.mcp.fileServers', count) };
			this.ui.row(body, {
				name: entry.label,
				mono: true,
				description: entry.scope === 'project'
					? t('openide.mcp.fileProject')
					: t('openide.mcp.fileGlobal'),
				keywords: ['mcp.json', entry.path],
				status,
				iconActions: entry.inspection.exists
					? [{ label: t('openide.mcp.fileOpen'), icon: 'go-to-file', run: () => void this.openJson(entry.scope) }]
					: [{ label: t('openide.mcp.fileCreate'), icon: 'new-file', run: () => void this.openJson(entry.scope) }],
			});
		}
	}

	// ---- acciones ----

	private async setEnabled(on: boolean): Promise<void> {
		await this.configurationService.updateValue(MCP_ENABLED_KEY, on);
		this.repaint();
	}

	private async reload(): Promise<void> {
		const summary = await this.agentService.reloadMcpServers();
		this.notificationService.notify({ severity: Severity.Info, message: summary });
		this.repaint();
	}

	private async openJson(scope: ConfigScope): Promise<void> {
		const uri = this.mcpJsonUri(scope);
		if (!uri) { return; }
		if (!(await this.fileService.exists(uri))) {
			await this.fileService.writeFile(uri, VSBuffer.fromString('{\n\t"mcpServers": {\n\t}\n}\n'));
		}
		await this.editorService.openEditor({ resource: uri, options: { pinned: true } });
	}

	private async toggleServer(row: IServerRow, on: boolean): Promise<void> {
		const inspection = await this.inspect(row.scope);
		const stored = inspection.servers[row.name];
		if (!stored) { return; }
		// el manager watchea mcp.json: la escritura dispara el reload en caliente sola.
		await this.writeServer(row.scope, row.name, { ...stored, enabled: on });
		this.repaint();
	}

	private async removeServer(scope: ConfigScope, name: string): Promise<void> {
		try {
			await this.writeServer(scope, name, undefined);
			this.repaint();
		} catch (error) {
			this.fail(error);
		}
	}

	private async saveServer(draft: IMcpDraft): Promise<void> {
		try {
			const name = draft.name.trim();
			const inspection = await this.inspect(draft.scope);
			const previous = inspection.servers[draft.originalName || name];
			let entry = draft.rawMode ? JSON.parse(draft.rawJson) : this.composeEntry(draft);
			entry = mergeMcpSecrets(entry, previous);
			const invalid = validateMcpServerConfig(name, entry);
			if (invalid) { this.fail(invalid); return; }
			await this.writeServer(draft.scope, name, entry, draft.originalName || undefined);
			this.notificationService.notify({
				severity: Severity.Info,
				message: t('openide.mcp.saved', name),
			});
			this.repaint();
		} catch (error) {
			this.fail(error);
		}
	}

	private async testServer(draft: IMcpDraft, redraw: () => void): Promise<void> {
		const name = draft.name.trim();
		const testId = TEST_ID_PREFIX + (name || 'server');
		const generation = ++this.testGeneration;
		draft.test = { busy: true };
		redraw();
		try {
			const inspection = await this.inspect(draft.scope);
			let entry = draft.rawMode ? JSON.parse(draft.rawJson) : this.composeEntry(draft);
			entry = mergeMcpSecrets(entry, inspection.servers[name]);
			const invalid = validateMcpServerConfig(name || 'server', { ...entry });
			if (invalid) { draft.test = { busy: false, ok: false, message: invalid }; redraw(); return; }
			const result = await this.hostClient.mcpConnect(this.testClientId, this.testOwnerToken, testId, entry, generation);
			const tools = result.tools.map(tool => tool.name);
			const shown = tools.slice(0, 8).join(', ') + (tools.length > 8 ? '…' : '');
			draft.test = { busy: false, ok: true, message: t('openide.mcp.testOk', tools.length, shown ? `: ${shown}` : '') };
		} catch (error) {
			// the error already arrives redacted from main (without env/header values)
			draft.test = { busy: false, ok: false, message: error instanceof Error ? error.message : String(error) };
		} finally {
			this.hostClient.mcpDisconnect(this.testClientId, this.testOwnerToken, testId, generation).catch(() => { /* best-effort */ });
			redraw();
		}
	}

	private fail(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.logService.warn(`[openide-mcp] ${message}`);
		this.notificationService.notify({ severity: Severity.Error, message });
	}

	// ---- wizards nativos (QuickInput) ----

	private async pickScope(placeHolder: string): Promise<ConfigScope | undefined> {
		if (!this.projectRoot()) { return 'global'; }
		type ScopeItem = IQuickPickItem & { id: ConfigScope };
		const items: ScopeItem[] = [
			{ id: 'global', label: t('openide.mcp.scopeUser'), description: t('openide.mcp.scopeUserDesc') },
			{ id: 'project', label: t('openide.mcp.scopeProject'), description: t('openide.mcp.scopeProjectDesc') },
		];
		const pick = await this.quickInputService.pick(items, { placeHolder, activeItem: items[this.scope === 'global' ? 0 : 1] });
		return pick?.id;
	}

	private async uniqueName(base: string): Promise<string> {
		const [project, global] = await Promise.all([this.inspect('project'), this.inspect('global')]);
		const existing = { ...global.servers, ...project.servers };
		let name = base;
		for (let i = 2; existing[name]; i++) { name = `${base}-${i}`; }
		return name;
	}

	private async askName(suggested: string): Promise<string | undefined> {
		const name = await this.quickInputService.input({
			prompt: t('openide.mcp.namePrompt'),
			value: suggested,
			ignoreFocusLost: true,
			validateInput: async value => MCP_SERVER_NAME_RE.test(value.trim())
				? undefined
				: t('openide.mcp.errName'),
		});
		return name?.trim() || undefined;
	}

	private async finishAdd(entry: McpServerConfig, suggestedName: string): Promise<void> {
		const name = await this.askName(await this.uniqueName(suggestedName));
		if (!name) { return; }
		const scope = await this.pickScope(t('openide.mcp.scopeAsk', name));
		if (!scope) { return; }
		const invalid = validateMcpServerConfig(name, entry);
		if (invalid) { this.fail(invalid); return; }
		await this.writeServer(scope, name, entry);
		this.notificationService.notify({
			severity: Severity.Info,
			message: t('openide.mcp.added', name),
		});
		this.repaint();
	}

	/** Guided install from the catalog: it only asks for what is missing (secrets, paths). */
	private async installFromCatalog(catalog: IMcpCatalogEntry): Promise<void> {
		const entry: { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> } = catalog.transport === 'stdio'
			? { command: catalog.command, args: [...(catalog.args ?? [])] }
			: { url: catalog.url };
		for (const prompt of catalog.prompts ?? []) {
			const defaultValue = prompt.defaultValue === 'workspaceRoot' ? (this.projectRoot()?.fsPath ?? '') : (prompt.defaultValue ?? '');
			const value = await this.quickInputService.input({
				prompt: prompt.label,
				placeHolder: prompt.placeholder ?? '',
				password: !!prompt.secret,
				value: defaultValue,
				ignoreFocusLost: true,
				validateInput: async candidate => (prompt.required && !candidate.trim())
					? t('openide.mcp.promptRequired', catalog.label)
					: undefined,
			});
			if (value === undefined) { return; } // cancelado
			const trimmed = value.trim();
			if (!trimmed) { continue; } // opcional vacío: la clave no se escribe
			if (prompt.kind === 'arg') { entry.args = [...(entry.args ?? []), trimmed]; }
			else if (prompt.kind === 'env') { entry.env = { ...(entry.env ?? {}), [prompt.key!]: trimmed }; }
			else { entry.headers = { ...(entry.headers ?? {}), [prompt.key!]: trimmed }; }
		}
		await this.finishAdd(entry, catalog.name);
	}

	private async importPastedJson(): Promise<void> {
		const raw = await this.quickInputService.input({
			prompt: t('openide.mcp.pastePrompt'),
			placeHolder: '{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "…"] } } }',
			ignoreFocusLost: true,
			validateInput: async value => {
				if (!value.trim()) { return undefined; }
				const parsed = parseMcpPaste(value);
				return typeof parsed === 'string' ? parsed : undefined;
			},
		});
		if (!raw?.trim()) { return; }
		const parsed = parseMcpPaste(raw);
		if (typeof parsed === 'string') { this.fail(parsed); return; }

		let entries = Object.entries(parsed);
		// a bare entry with no name: a single server, the name is asked for in finishAdd
		if (entries.length === 1 && entries[0][0] === '') {
			const config = entries[0][1];
			const parts = splitCommandLine(`${config.command ?? config.url ?? ''} ${(config.args ?? []).join(' ')}`);
			await this.finishAdd(config, suggestNameFromCommand(parts));
			return;
		}
		if (entries.length > 1) {
			type PasteItem = IQuickPickItem & { key: string };
			const items: PasteItem[] = entries.map(([name, config]) => ({
				key: name, label: name, picked: true,
				description: config.url ? 'http' : 'stdio',
				detail: config.url ?? [config.command, ...(config.args ?? [])].join(' '),
			}));
			const picked = await this.quickInputService.pick(items, {
				canPickMany: true,
				placeHolder: t('openide.mcp.pastePick', entries.length),
			});
			if (!picked?.length) { return; }
			entries = entries.filter(([name]) => picked.some(item => item.key === name));
		}
		const scope = await this.pickScope(t('openide.mcp.pasteScope'));
		if (!scope) { return; }
		const saved: string[] = [];
		for (const [name, entry] of entries) {
			const invalid = validateMcpServerConfig(name, entry);
			if (invalid) { this.fail(`${name}: ${invalid}`); continue; }
			await this.writeServer(scope, name, entry);
			saved.push(name);
		}
		if (saved.length) {
			this.notificationService.notify({
				severity: Severity.Info,
				message: t('openide.mcp.pasteSaved', saved.length, saved.join(', ')),
			});
		}
		this.repaint();
	}

	/** "Add MCP server" wizard: paste JSON, configure by hand, or the curated gallery. */
	private async runAddWizard(): Promise<void> {
		type AddItem = IQuickPickItem & { id: string; entry?: IMcpCatalogEntry };
		const items: QuickPickInput<AddItem>[] = [
			{ type: 'separator', label: t('openide.mcp.sepManual') },
			{ id: 'json', label: '$(json) ' + t('openide.mcp.addJson'), detail: t('openide.mcp.addJsonDetail') },
			{ id: 'stdio', label: '$(terminal) ' + t('openide.mcp.addStdio'), detail: t('openide.mcp.addStdioDetail') },
			{ id: 'http', label: '$(globe) ' + t('openide.mcp.addHttp'), detail: t('openide.mcp.addHttpDetail') },
			{ type: 'separator', label: t('openide.mcp.sepCatalog') },
			...MCP_CATALOG.map(entry => ({
				id: 'catalog', entry, label: entry.label,
				description: entry.transport === 'http' ? 'remoto' : 'local',
				detail: entry.description,
			})),
		];
		const pick = await this.quickInputService.pick(items, {
			placeHolder: t('openide.mcp.addPlaceholder'),
			matchOnDetail: true,
			matchOnDescription: true,
		});
		if (!pick) { return; }
		if (pick.id === 'catalog' && pick.entry) { await this.installFromCatalog(pick.entry); return; }
		if (pick.id === 'json') { await this.importPastedJson(); return; }
		if (pick.id === 'stdio') {
			const raw = await this.quickInputService.input({
				prompt: t('openide.mcp.stdioPrompt'),
				placeHolder: 'npx -y @modelcontextprotocol/server-github',
				ignoreFocusLost: true,
				validateInput: async value => value.trim() ? undefined : t('openide.mcp.stdioRequired'),
			});
			if (!raw?.trim()) { return; }
			const parts = splitCommandLine(raw);
			const entry: { command: string; args?: string[] } = { command: parts[0] };
			if (parts.length > 1) { entry.args = parts.slice(1); }
			await this.finishAdd(entry, suggestNameFromCommand(parts));
			return;
		}
		const url = await this.quickInputService.input({
			prompt: t('openide.mcp.httpPrompt'),
			placeHolder: 'https://mcp.ejemplo.com/mcp',
			ignoreFocusLost: true,
			validateInput: async value => /^https?:\/\/\S+$/i.test(value.trim()) ? undefined : t('openide.mcp.httpInvalid'),
		});
		if (!url?.trim()) { return; }
		const auth = await this.quickInputService.input({
			prompt: t('openide.mcp.httpAuthPrompt'),
			placeHolder: 'Bearer eyJ…',
			password: true,
			ignoreFocusLost: true,
		});
		if (auth === undefined) { return; }
		const entry: { url: string; headers?: Record<string, string> } = { url: url.trim() };
		if (auth.trim()) { entry.headers = { Authorization: auth.trim() }; }
		let host = 'server-http';
		try {
			const parts = new URL(url.trim()).hostname.split('.');
			host = (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) || host;
		} catch { /* nombre por defecto */ }
		await this.finishAdd(entry, host.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'));
	}
}
