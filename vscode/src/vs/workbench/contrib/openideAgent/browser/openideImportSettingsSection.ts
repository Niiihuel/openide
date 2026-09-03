/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — Settings › Import: bring over another editor's or an agent CLI's configuration.
 *
 *  One row per source the machine has (VS Code, Cursor, Windsurf, VSCodium; Claude Code, Codex,
 *  opencode, Gemini CLI), saying what was found and offering to import each part on its own:
 *  settings, keybindings, snippets and extensions from an editor; MCP servers and the global
 *  instructions file from a CLI. Nothing is merged silently and nothing here overwrites what is
 *  already configured in OpenIDE — a setting is set only when the import says so, a keybinding
 *  or an MCP server that already exists is skipped and counted.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { parse as parseJsonc } from '../../../../base/common/json.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { OpenideSectionRenderer, ISectionAction } from '../../openideSettings/browser/openideSettingsSectionBuilder.js';
import type { IOpenideSettingsSection, IOpenideSettingsSectionContext } from '../../openideSettings/browser/openideSettingsSection.js';
import { cliFile, ideExtensionsFile, ideUserDir, IOpenideImportCli, IOpenideImportHome, IOpenideImportIde, mergeKeybindings, mergeMcpJson, OPENIDE_IMPORT_SOURCES, OpenideImportSource, parseExtensionsJson, parseMcp } from '../common/openideImportSources.js';
import { t } from '../common/openideStrings.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { applyProviderIcon } from './openideProviderIcons.js';

interface IIdeInventory {
	readonly kind: 'ide';
	readonly source: IOpenideImportIde;
	/** Where the launcher was found on the login shell's PATH, the way the dock finds a CLI. */
	readonly installed?: string;
	readonly settings?: { readonly uri: URI; readonly count: number };
	readonly keybindings?: { readonly uri: URI; readonly count: number };
	readonly snippets?: { readonly uri: URI; readonly files: readonly URI[] };
	readonly extensions?: { readonly ids: readonly string[] };
}

interface ICliInventory {
	readonly kind: 'cli';
	readonly source: IOpenideImportCli;
	readonly installed?: string;
	readonly mcp?: { readonly uri: URI; readonly count: number };
	readonly rules?: { readonly uri: URI; readonly bytes: number };
}

type Inventory = IIdeInventory | ICliInventory;

/** Settings that describe the OTHER editor's identity or machine, not the user's preferences. */
const SKIPPED_SETTINGS = new Set(['window.zoomLevel', 'workbench.startupEditor', 'update.mode', 'telemetry.telemetryLevel', 'extensions.autoUpdate']);

export class OpenideImportSettingsSection extends Disposable implements IOpenideSettingsSection {
	readonly ownedSettings: readonly string[] = [];

	private readonly renderStore = this._register(new DisposableStore());
	private readonly ui = new OpenideSectionRenderer(this.renderStore, this.contextViewService);
	private root: HTMLElement | undefined;
	private inventories: Inventory[] | undefined;
	private scanning = false;
	/** Rows with an import in flight, by source id. */
	private readonly busy = new Set<string>();
	private generation = 0;

	constructor(
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IUserDataProfileService private readonly profileService: IUserDataProfileService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
	) {
		super();
	}

	render(container: HTMLElement, _context: IOpenideSettingsSectionContext): void {
		this.root = append(container, $('.openide-settings-sections'));
		this.paint();
		if (!this.inventories && !this.scanning) {
			void this.scan();
		}
	}

	// ---- what is on this machine -------------------------------------------------------------

	private async home(): Promise<IOpenideImportHome> {
		const home = await this.pathService.userHome();
		return { home: home.fsPath.replace(/\\/g, '/'), platform: isWindows ? 'win32' : isMacintosh ? 'darwin' : 'linux' };
	}

	private async scan(): Promise<void> {
		this.scanning = true;
		const token = ++this.generation;
		this.paint();
		try {
			const where = await this.home();
			// Installed = on the PATH, resolved through the login shell like the dock does for a
			// CLI: a Claude Code with no MCP servers yet is still Claude Code, and the row says so
			// instead of pretending it is not there.
			const onPath = await this.agentService.resolveExecutables(OPENIDE_IMPORT_SOURCES.map(source => source.binary)).catch(() => undefined);
			const found = await Promise.all(OPENIDE_IMPORT_SOURCES.map(source => this.inventory(source, where, onPath?.get(source.binary) ?? undefined)));
			if (token !== this.generation) {
				return;
			}
			this.inventories = found;
		} finally {
			if (token === this.generation) {
				this.scanning = false;
				this.paint();
			}
		}
	}

	private async inventory(source: OpenideImportSource, where: IOpenideImportHome, installed: string | undefined): Promise<Inventory> {
		if (source.kind === 'ide') {
			const user = URI.file(ideUserDir(source, where));
			const settingsUri = joinPath(user, 'settings.json');
			const keybindingsUri = joinPath(user, 'keybindings.json');
			const snippetsUri = joinPath(user, 'snippets');
			const extensionsUri = URI.file(ideExtensionsFile(source, where));
			const [settingsText, keybindingsText, snippetFiles, extensionsText] = await Promise.all([
				this.readText(settingsUri), this.readText(keybindingsUri), this.listFiles(snippetsUri), this.readText(extensionsUri),
			]);
			const settings = settingsText !== undefined ? Object.keys(this.parseObject(settingsText)).filter(key => !SKIPPED_SETTINGS.has(key)).length : 0;
			const keybindings = keybindingsText !== undefined ? this.parseArray(keybindingsText).length : 0;
			const extensions = extensionsText !== undefined ? parseExtensionsJson(extensionsText) : [];
			return {
				kind: 'ide', source, installed,
				settings: settings ? { uri: settingsUri, count: settings } : undefined,
				keybindings: keybindings ? { uri: keybindingsUri, count: keybindings } : undefined,
				snippets: snippetFiles.length ? { uri: snippetsUri, files: snippetFiles } : undefined,
				extensions: extensions.length ? { ids: extensions } : undefined,
			};
		}
		const mcpUri = URI.file(cliFile(source, where, 'mcp'));
		const rulesUri = URI.file(cliFile(source, where, 'rules'));
		const [mcpText, rulesText] = await Promise.all([this.readText(mcpUri), this.readText(rulesUri)]);
		const servers = mcpText !== undefined ? Object.keys(parseMcp(mcpText, source.mcpFormat)).length : 0;
		return {
			kind: 'cli', source, installed,
			mcp: servers ? { uri: mcpUri, count: servers } : undefined,
			rules: rulesText?.trim() ? { uri: rulesUri, bytes: rulesText.length } : undefined,
		};
	}

	private async readText(uri: URI): Promise<string | undefined> {
		try {
			return (await this.fileService.readFile(uri)).value.toString();
		} catch {
			return undefined;
		}
	}

	private async listFiles(dir: URI): Promise<URI[]> {
		try {
			const stat = await this.fileService.resolve(dir);
			return (stat.children ?? []).filter(child => child.isFile && /\.(code-snippets|json)$/.test(child.name)).map(child => child.resource);
		} catch {
			return [];
		}
	}

	/** settings.json and keybindings.json allow comments and trailing commas: JSONC, not JSON. */
	private parseObject(text: string): Record<string, unknown> {
		const parsed = parseJsonc(text);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	}

	private parseArray(text: string): unknown[] {
		const parsed = parseJsonc(text);
		return Array.isArray(parsed) ? parsed : [];
	}

	// ---- the page ------------------------------------------------------------------------------

	private paint(): void {
		const root = this.root;
		if (!root?.isConnected) {
			return;
		}
		this.renderStore.clear();
		clearNode(root);
		const body = this.ui.section(root, {
			title: t('settings.import.title'),
			description: t('settings.import.desc'),
			actions: [{ label: t('settings.import.scanning'), icon: 'refresh', ghost: true, enabled: !this.scanning, run: () => void this.scan() }],
		});
		if (!this.inventories) {
			this.ui.status(body, { label: t('settings.import.scanning'), tone: 'neutral', busy: true });
			return;
		}
		// Only what the machine has: a list of editors the user never installed is noise, and
		// the page says what it looked for in its description.
		const found = this.inventories.filter(inventory => inventory.installed || this.partsOf(inventory).length > 0);
		if (!found.length) {
			this.ui.empty(body, { title: t('settings.import.none'), description: t('settings.import.noneDesc') });
			return;
		}
		for (const kind of ['ide', 'cli'] as const) {
			const entries = found.filter(entry => entry.kind === kind);
			if (!entries.length) {
				continue;
			}
			append(body, $('.openide-settings-group-label', undefined, kind === 'ide' ? t('settings.import.ides') : t('settings.import.clis')));
			for (const inventory of entries) {
				this.paintRow(body, inventory);
			}
		}
	}

	private paintRow(parent: HTMLElement, inventory: Inventory): void {
		const parts = this.partsOf(inventory);
		const found = parts.length > 0;
		const busy = this.busy.has(inventory.source.id);
		const row = this.ui.row(parent, {
			name: inventory.source.label,
			description: found ? parts.map(part => part.label).join(' · ') : t('settings.import.installedNothing', inventory.installed ?? inventory.source.binary),
			keywords: ['import', 'importar', inventory.source.id],
			status: busy
				? { label: t('settings.import.scanning'), tone: 'neutral', busy: true }
				: inventory.installed
					? { label: t('settings.import.installed'), tone: 'ok', title: inventory.installed }
					: { label: t('settings.import.found'), tone: 'neutral' },
			expand: found ? (body: HTMLElement) => this.paintActions(body, inventory) : undefined,
		});
		// The mark goes INSIDE the title, before the name: the row is a two-column grid (copy,
		// control) and a third child in front of the copy pushed the copy into the control's
		// column. Every source is a brand: a provider mark where one ships, a monogram otherwise.
		const title = row.querySelector('.openide-settings-setting-title');
		const brand = inventory.source.brand;
		if (title && brand) {
			const mark = $('span.openide-provider-icon.openide-settings-import-mark');
			applyProviderIcon(mark, brand, inventory.source.label);
			title.prepend(mark);
		}
	}

	private partsOf(inventory: Inventory): { readonly label: string }[] {
		const parts: { readonly label: string }[] = [];
		if (inventory.kind === 'ide') {
			if (inventory.settings) { parts.push({ label: t('settings.import.itemCount', t('settings.import.settings'), String(inventory.settings.count)) }); }
			if (inventory.keybindings) { parts.push({ label: t('settings.import.itemCount', t('settings.import.keybindings'), String(inventory.keybindings.count)) }); }
			if (inventory.snippets) { parts.push({ label: t('settings.import.itemCount', t('settings.import.snippets'), String(inventory.snippets.files.length)) }); }
			if (inventory.extensions) { parts.push({ label: t('settings.import.itemCount', t('settings.import.extensions'), String(inventory.extensions.ids.length)) }); }
		} else {
			if (inventory.mcp) { parts.push({ label: t('settings.import.itemCount', t('settings.import.mcp'), String(inventory.mcp.count)) }); }
			if (inventory.rules) { parts.push({ label: t('settings.import.rules') }); }
		}
		return parts;
	}

	private paintActions(body: HTMLElement, inventory: Inventory): void {
		const actions: ISectionAction[] = [];
		const busy = this.busy.has(inventory.source.id);
		if (inventory.kind === 'ide') {
			if (inventory.settings) { actions.push({ label: t('settings.import.importSettings', String(inventory.settings.count)), icon: 'settings-gear', enabled: !busy, run: () => void this.run(inventory, () => this.importSettings(inventory)) }); }
			if (inventory.keybindings) { actions.push({ label: t('settings.import.importKeybindings', String(inventory.keybindings.count)), icon: 'keyboard', enabled: !busy, run: () => void this.run(inventory, () => this.importKeybindings(inventory)) }); }
			if (inventory.snippets) { actions.push({ label: t('settings.import.importSnippets', String(inventory.snippets.files.length)), icon: 'symbol-snippet', enabled: !busy, run: () => void this.run(inventory, () => this.importSnippets(inventory)) }); }
			if (inventory.extensions) { actions.push({ label: t('settings.import.installExtensions', String(inventory.extensions.ids.length)), icon: 'extensions', enabled: !busy, run: () => void this.run(inventory, () => this.installExtensions(inventory)) }); }
		} else {
			if (inventory.mcp) { actions.push({ label: t('settings.import.importMcp', String(inventory.mcp.count)), icon: 'plug', enabled: !busy, run: () => void this.run(inventory, () => this.importMcp(inventory)) }); }
			if (inventory.rules) { actions.push({ label: t('settings.import.importRules'), icon: 'law', enabled: !busy, run: () => void this.run(inventory, () => this.importRules(inventory)) }); }
		}
		const bar = append(body, $('.openide-settings-import-actions'));
		for (const action of actions) {
			this.ui.button(bar, action);
		}
		if (inventory.kind === 'ide' && inventory.extensions) {
			append(body, $('.openide-settings-section-desc', undefined, t('settings.import.extensionsNote')));
		}
	}

	private async run(inventory: Inventory, work: () => Promise<string>): Promise<void> {
		this.busy.add(inventory.source.id);
		this.paint();
		try {
			const summary = await work();
			this.notificationService.notify({ severity: Severity.Info, message: summary });
		} catch (error) {
			this.notificationService.error(t('settings.import.failed', inventory.source.label, error instanceof Error ? error.message : String(error)));
		} finally {
			this.busy.delete(inventory.source.id);
			this.paint();
		}
	}

	// ---- the imports ---------------------------------------------------------------------------

	private async importSettings(inventory: IIdeInventory): Promise<string> {
		const text = await this.readText(inventory.settings!.uri);
		const settings = this.parseObject(text ?? '');
		let count = 0;
		for (const [key, value] of Object.entries(settings)) {
			if (SKIPPED_SETTINGS.has(key)) {
				continue;
			}
			await this.configurationService.updateValue(key, value, ConfigurationTarget.USER);
			count++;
		}
		return t('settings.import.doneSettings', String(count), inventory.source.label);
	}

	private async importKeybindings(inventory: IIdeInventory): Promise<string> {
		const incoming = this.parseArray((await this.readText(inventory.keybindings!.uri)) ?? '');
		const target = this.profileService.currentProfile.keybindingsResource;
		const existing = this.parseArray((await this.readText(target)) ?? '[]');
		const merged = mergeKeybindings(existing, incoming);
		await this.fileService.writeFile(target, VSBuffer.fromString(JSON.stringify(merged.entries, undefined, 4) + '\n'));
		return t('settings.import.doneKeybindings', String(merged.added), inventory.source.label, String(incoming.length - merged.added));
	}

	private async importSnippets(inventory: IIdeInventory): Promise<string> {
		const home = this.profileService.currentProfile.snippetsHome;
		let copied = 0;
		for (const file of inventory.snippets!.files) {
			const target = joinPath(home, basename(file));
			if (await this.fileService.exists(target)) {
				continue; // the user's own snippet of that name stays
			}
			await this.fileService.copy(file, target);
			copied++;
		}
		return t('settings.import.doneSnippets', String(copied), inventory.source.label);
	}

	private async installExtensions(inventory: IIdeInventory): Promise<string> {
		let installed = 0;
		let failed = 0;
		for (const id of inventory.extensions!.ids) {
			try {
				await this.commandService.executeCommand('workbench.extensions.installExtension', id, { donotSync: true });
				installed++;
			} catch {
				failed++;
			}
		}
		return t('settings.import.doneExtensions', String(installed), inventory.source.label, String(failed));
	}

	private async importMcp(inventory: ICliInventory): Promise<string> {
		const servers = parseMcp((await this.readText(inventory.mcp!.uri)) ?? '', inventory.source.mcpFormat);
		const target = joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'mcp.json');
		const merged = mergeMcpJson(await this.readText(target), servers);
		await this.fileService.writeFile(target, VSBuffer.fromString(merged.text));
		await this.agentService.reloadMcpServers().catch(() => undefined);
		return t('settings.import.doneMcp', String(merged.added), inventory.source.label, String(Object.keys(servers).length - merged.added));
	}

	private async importRules(inventory: ICliInventory): Promise<string> {
		const content = (await this.readText(inventory.rules!.uri)) ?? '';
		const name = `${inventory.source.id}-global`;
		await this.agentService.rulesManager().save('global', name, content);
		return t('settings.import.doneRules', inventory.source.label, name);
	}
}
