/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — adapter between the configuration registry/models and product presentation.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget, getConfigValueInTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ISetting, ISettingsGroup, SettingValueType } from '../../../services/preferences/common/preferences.js';
import { Settings2EditorModel } from '../../../services/preferences/common/preferencesModels.js';
import { getCommonlyUsedData, ITOCEntry, tocData } from '../../preferences/browser/settingsLayout.js';
import { OpenideStringKey, t } from '../../openideAgent/common/openideStrings.js';
import { buildOpenideExtensionsNavigation, isOpenideNavigableSetting } from '../common/openideSettingsNavigation.js';
import { IOpenideSettingItem, IOpenideSettingsNavigationEntry, IOpenideSettingsViewState } from '../common/openideSettingsTypes.js';
import { IOpenideSettingsSearchEntry, matchesSettingsSearchEntries, plainSettingsQuery } from './openideSettingsSearch.js';

function settingType(setting: ISetting): SettingValueType {
	if (setting.enum?.length) { return SettingValueType.Enum; }
	const type = Array.isArray(setting.type) ? setting.type.find(candidate => candidate !== 'null') : setting.type;
	if (type === 'boolean') { return SettingValueType.Boolean; }
	if (type === 'integer') { return Array.isArray(setting.type) ? SettingValueType.NullableInteger : SettingValueType.Integer; }
	if (type === 'number') { return Array.isArray(setting.type) ? SettingValueType.NullableNumber : SettingValueType.Number; }
	if (type === 'string') { return setting.editPresentation === 'multilineText' ? SettingValueType.MultilineString : SettingValueType.String; }
	if (type === 'array') { return SettingValueType.Array; }
	if (type === 'object') { return setting.allKeysAreBoolean ? SettingValueType.BooleanObject : SettingValueType.Object; }
	return SettingValueType.Complex;
}

function labelFor(setting: ISetting): string {
	if (setting.title) { return setting.title; }
	const tail = setting.key.split('.').pop() || setting.key;
	return tail.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, value => value.toUpperCase());
}

function categoryFor(group: ISettingsGroup, setting: ISetting): string {
	if (setting.categoryLabel) { return setting.categoryLabel; }
	if (setting.extensionInfo) { return 'Extensions'; }
	const root = setting.key.split('.')[0]?.toLowerCase();
	if (root === 'openide') { return setting.key.startsWith('openide.agent.') ? 'Agente IA' : 'OpenIDE'; }
	return group.title || root || 'Other';
}

/**
 * TOC entries whose label OpenIDE owns, mapped to the dictionary that follows `openide.language`.
 *
 * `settingsLayout.ts` declares them through `localize()`, which resolves against the IDE LOCALE and
 * only switches on restart — and the fork wrote those defaults in Spanish. The result was a Spanish
 * a Spanish "AI Agent" group sitting inside an otherwise English menu, with
 * no way to change it. Anything not listed here keeps the TOC label, which is upstream's and
 * already ships in the language packs.
 */
const OPENIDE_NAV_LABELS = {
	'workbench/language': 'settings.nav.language',
	'openideAgent': 'settings.nav.agent',
	'openideAgent/providers': 'settings.nav.agent.providers',
	'openideAgent/chat': 'settings.nav.agent.chat',
	'openideAgent/voice': 'settings.nav.agent.voice',
	'openideAgent/context': 'settings.nav.agent.context',
	'openideAgent/skills': 'settings.nav.agent.skills',
	'openideAgent/mcp': 'settings.nav.agent.mcp',
	'openideAgent/rules': 'settings.nav.agent.rules',
	'openideAgent/hooks': 'settings.nav.agent.hooks',
	'openideAgent/commands': 'settings.nav.agent.commands',
	'openideAgent/quickCommands': 'settings.nav.agent.quickCommands',
	'openideAgent/subagents': 'settings.nav.agent.subagents',
	'openideAgent/projectMap': 'settings.nav.agent.projectMap',
	'openideAgent/notifications': 'settings.nav.agent.notifications',
	'openideAgent/browser': 'settings.nav.agent.browser',
	'openideAgent/advanced': 'settings.nav.agent.advanced',
	'openideAgent/import': 'settings.nav.agent.import',
} as Readonly<Record<string, OpenideStringKey | undefined>>;

export class OpenideSettingsModel {
	private model: Settings2EditorModel | undefined;
	private cachedItems: IOpenideSettingItem[] | undefined;
	private cachedNavigation: readonly IOpenideSettingsNavigationEntry[] | undefined;
	private cachedMatches: IOpenideSettingItem[] | undefined;
	private readonly patterns = new Map<string, RegExp>();
	private searchText = new WeakMap<IOpenideSettingItem, string>();
	private state: IOpenideSettingsViewState;
	/** Categories whose content is not config keys (skills, hooks, MCP…): without this the filter
	 *  dropped them from the tree, judging each category only by its schema settings. */
	private surfaceSearch: ReadonlyMap<string, readonly IOpenideSettingsSearchEntry[]> = new Map();

	constructor(
		private readonly configurationService: IConfigurationService,
	) {
		this.state = { target: ConfigurationTarget.USER_LOCAL, query: '', category: 'home' };
	}

	setModel(model: Settings2EditorModel | undefined): void { this.model = model; this.invalidate(); }

	/** Configuration, schema, profile and display-language changes invalidate the snapshot. */
	invalidate(): void {
		this.cachedItems = undefined;
		this.cachedNavigation = undefined;
		this.cachedMatches = undefined;
		this.searchText = new WeakMap();
		this.patterns.clear();
	}
	setSurfaceSearch(entries: ReadonlyMap<string, readonly IOpenideSettingsSearchEntry[]>): void { this.surfaceSearch = entries; }
	setState(state: Partial<IOpenideSettingsViewState>): void {
		const next = { ...this.state, ...state };
		if (next.target !== this.state.target || next.folderUri?.toString() !== this.state.folderUri?.toString() || next.language !== this.state.language) {
			this.invalidate();
		} else if (next.query !== this.state.query) {
			this.cachedMatches = undefined;
		}
		this.state = next;
	}
	get viewState(): Readonly<IOpenideSettingsViewState> { return this.state; }

	get navigation(): readonly IOpenideSettingsNavigationEntry[] {
		if (this.cachedNavigation) { return this.cachedNavigation; }
		if (!this.model) { return []; }
		const convert = (entry: ITOCEntry<string>): IOpenideSettingsNavigationEntry | undefined => {
			if (entry.hide) { return undefined; }
			const children = entry.children?.map(convert).filter((child): child is IOpenideSettingsNavigationEntry => !!child);
			// OpenIDE's own pages follow `openide.language`, not the language pack: the TOC label is
			// only the fallback for the native locale.
			const key = OPENIDE_NAV_LABELS[entry.id];
			const label = key ? t(key) : entry.label;
			return { id: entry.id, label, settings: entry.settings, command: entry.command, children };
		};
		const common = getCommonlyUsedData(this.model.settingsGroups).settings?.map(setting => setting.key) ?? [];
		const core = tocData.children?.map(convert).filter((entry): entry is IOpenideSettingsNavigationEntry => !!entry) ?? [];
		const extensions = buildOpenideExtensionsNavigation(this.allItems(), t('settings.nav.extensions'));
		return this.cachedNavigation = [
			{ id: 'home', label: t('settings.nav.all') },
			{ id: 'commonlyUsed', label: t('settings.nav.commonlyUsed'), settings: common },
			...core,
			...(extensions ? [extensions] : []),
		];
	}

	get visibleNavigation(): readonly IOpenideSettingsNavigationEntry[] {
		const query = this.state.query.trim().toLowerCase();
		if (!query) { return this.navigation; }
		const matches = this.filteredItems(true);
		const prune = (entry: IOpenideSettingsNavigationEntry): IOpenideSettingsNavigationEntry | undefined => {
			if (entry.id === 'home') { return entry; }
			const children = entry.children?.map(prune).filter((child): child is IOpenideSettingsNavigationEntry => !!child);
			const labelMatches = entry.label.toLowerCase().includes(query);
			const itemMatches = matches.some(item => this.entryMatchesItem(entry, item, false));
			const surfaceMatches = this.surfaceMatchesQuery(entry.id);
			return labelMatches || itemMatches || surfaceMatches || children?.length ? { ...entry, children } : undefined;
		};
		return this.navigation.map(prune).filter((entry): entry is IOpenideSettingsNavigationEntry => !!entry);
	}

	/** Does the query match this category by what its page offers (rather than by its settings)? */
	surfaceMatchesQuery(category: string): boolean {
		const entries = this.surfaceSearch.get(category);
		// `@modified` and friends ask about a setting's state: a file-backed page cannot answer
		// that, so it does not count as a match.
		return !!entries && !!plainSettingsQuery(this.state.query) && matchesSettingsSearchEntries(this.state.query, entries);
	}

	findNavigationEntry(id: string): IOpenideSettingsNavigationEntry | undefined {
		return this.findNavigationEntryIn(this.navigation, id);
	}

	private findNavigationEntryIn(entries: readonly IOpenideSettingsNavigationEntry[], id: string): IOpenideSettingsNavigationEntry | undefined {
		for (const entry of entries) {
			if (entry.id === id) { return entry; }
			const child = entry.children && this.findNavigationEntryIn(entry.children, id);
			if (child) { return child; }
		}
		return undefined;
	}

	get activeNavigationLabel(): string { return this.findNavigationEntry(this.state.category)?.label ?? t('settings.nav.all'); }

	/** Chain from the top-level category down to `id`, for the breadcrumb. The sidebar is flat by
	 *  design (a collapsible tree hid half the map and cost two clicks per page), so this header
	 *  is the only place the hierarchy is legible: "Agente › Proveedores", not just "Proveedores".
	 *  Empty when the entry is a root or unknown — a one-item breadcrumb says nothing. */
	navigationPath(id: string): readonly IOpenideSettingsNavigationEntry[] {
		const visit = (entries: readonly IOpenideSettingsNavigationEntry[], trail: IOpenideSettingsNavigationEntry[]): IOpenideSettingsNavigationEntry[] | undefined => {
			for (const entry of entries) {
				const next = [...trail, entry];
				if (entry.id === id) { return next; }
				const found = entry.children?.length ? visit(entry.children, next) : undefined;
				if (found) { return found; }
			}
			return undefined;
		};
		const path = visit(this.navigation, []) ?? [];
		return path.length > 1 ? path : [];
	}

	items(): IOpenideSettingItem[] {
		return this.filteredItems(false);
	}

	/**
	 * `items` split into the cards of the current page, in the order the rows arrive.
	 *
	 * The layout has no "group" of its own below a page: a page is a TOC entry, and its rows are
	 * whatever its patterns (and its children's) match. So the grouping reuses the TOC one level
	 * down: on "Text Editor" the rows that belong to "Cursor" share a card captioned "Cursor", the
	 * rows only the page itself claims are captioned with the page's label, and on "All settings"
	 * the top-level entries play the same role. A row no entry claims — an extension's key on the
	 * home page, a search hit outside the TOC — falls back to the first segment of its key
	 * ("files.autoSave" → "Files"), which is how upstream names a section it has no label for.
	 *
	 * The catalog and navigation snapshot are shared with search until configuration or schema
	 * changes invalidate them.
	 */
	groupItems(items: readonly IOpenideSettingItem[]): { readonly label: string; readonly items: IOpenideSettingItem[] }[] {
		const category = this.state.category;
		const navigation = this.navigation;
		const page = category === 'home' ? undefined : this.findNavigationEntryIn(navigation, category);
		const children = page ? page.children ?? [] : navigation.filter(entry => entry.id !== 'home' && entry.id !== 'commonlyUsed');
		const groups = new Map<string, IOpenideSettingItem[]>();
		for (const item of items) {
			const child = children.find(entry => this.entryMatchesItem(entry, item, true));
			let label: string;
			if (child) {
				label = child.label;
			} else if (page && (page.id === 'commonlyUsed' || this.entryMatchesItem(page, item, false))) {
				label = page.label;
			} else {
				const root = item.key.split('.')[0] || item.key;
				label = root.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase());
			}
			const bucket = groups.get(label);
			if (bucket) { bucket.push(item); } else { groups.set(label, [item]); }
		}
		return [...groups].map(([label, rows]) => ({ label, items: rows }));
	}

	/**
	 * Whether `item` can be written in the scope tab currently selected.
	 *
	 * A setting declares how far down it can be configured, and the writer refuses anything
	 * narrower. Until now nothing checked it here, so every setting appeared under every tab and
	 * the folder tab answered a click with a raw
	 * "does not support the folder resource scope" from the configuration service. The setting is
	 * still shown — hiding it would read as "this setting does not exist" — but it is reported as
	 * not editable here, with the scope that does accept it.
	 */
	isEditableInCurrentScope(item: IOpenideSettingItem): boolean {
		const scope = item.scope ?? ConfigurationScope.WINDOW;
		switch (this.state.target) {
			case ConfigurationTarget.WORKSPACE_FOLDER:
				return scope === ConfigurationScope.RESOURCE
					|| scope === ConfigurationScope.LANGUAGE_OVERRIDABLE
					|| scope === ConfigurationScope.MACHINE_OVERRIDABLE;
			case ConfigurationTarget.WORKSPACE:
				return scope !== ConfigurationScope.APPLICATION
					&& scope !== ConfigurationScope.MACHINE
					&& scope !== ConfigurationScope.APPLICATION_MACHINE;
			default:
				return true;		// user settings acepta todo
		}
	}

	/** Narrowest scope that does accept `item`, to tell the user where to go. */
	editableScopeLabel(item: IOpenideSettingItem): string {
		const scope = item.scope ?? ConfigurationScope.WINDOW;
		if (scope === ConfigurationScope.APPLICATION || scope === ConfigurationScope.MACHINE || scope === ConfigurationScope.APPLICATION_MACHINE) {
			return t('settings.scope.userOnly');
		}
		return t('settings.scope.userOrWorkspace');
	}

	private filteredItems(ignoreCategory: boolean): IOpenideSettingItem[] {
		const query = this.state.query.trim().toLowerCase();
		const modifiedOnly = query.includes('@modified');
		const idMatch = query.match(/@id:([^\s]+)/)?.[1];
		const extensionMatch = query.match(/@ext:([^\s]+)/)?.[1];
		const tagMatch = query.match(/@tag:([^\s]+)/)?.[1];
		const plain = query.replace(/@(modified|haspolicy)\b|@(id|ext|feature|lang|tag):[^\s]+/g, '').trim();
		const activeEntry = ignoreCategory || this.state.category === 'home' ? undefined : this.findNavigationEntry(this.state.category);
		const matches = this.cachedMatches ??= this.allItems().filter(item => {
			if (modifiedOnly && !item.value.configured) { return false; }
			if (query.includes('@haspolicy') && item.value.policyValue === undefined) { return false; }
			if (idMatch && !item.key.toLowerCase().includes(idMatch)) { return false; }
			if (extensionMatch && !item.extensionId?.toLowerCase().includes(extensionMatch)) { return false; }
			if (tagMatch && !item.tags.some(tag => tag.toLowerCase().includes(tagMatch))) { return false; }
			if (!plain) { return true; }
			return this.searchText.get(item)!.includes(plain);
		});
		return activeEntry ? matches.filter(item => this.entryMatchesItem(activeEntry, item, true)) : matches;
	}

	private entryMatchesItem(entry: IOpenideSettingsNavigationEntry, item: IOpenideSettingItem, includeDescendants: boolean): boolean {
		if (entry.settings?.some(pattern => pattern.startsWith('@ext:')
			? item.extensionId?.toLowerCase() === pattern.slice(5).toLowerCase()
			: this.settingMatchesPattern(item.key, pattern))) { return true; }
		return !!(includeDescendants && entry.children?.some(child => this.entryMatchesItem(child, item, true)));
	}

	private settingMatchesPattern(key: string, pattern: string): boolean {
		let compiled = this.patterns.get(pattern);
		if (!compiled) {
			const expression = pattern.replace(/[\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
			compiled = new RegExp(`^${expression}$`, 'i');
			this.patterns.set(pattern, compiled);
		}
		return compiled.test(key);
	}

	async update(item: IOpenideSettingItem, value: unknown): Promise<void> {
		const overrides = { resource: this.state.folderUri, overrideIdentifier: this.state.language };
		await this.configurationService.updateValue(item.key, value, overrides, this.state.target);
		this.invalidate();
	}

	reset(item: IOpenideSettingItem): Promise<void> { return this.update(item, undefined); }

	private allItems(): IOpenideSettingItem[] {
		if (this.cachedItems) { return this.cachedItems; }
		if (!this.model) { return []; }
		const out: IOpenideSettingItem[] = [];
		const seen = new Set<string>();
		for (const group of this.model.settingsGroups) {
			for (const section of group.sections) {
				for (const setting of section.settings) {
					if (seen.has(setting.key)) { continue; }
					seen.add(setting.key);
					// Per-language default overrides from extensions are not settings the user edits here.
					if (!isOpenideNavigableSetting({ key: setting.key, groupId: group.id })) { continue; }
					const configurationService = this.configurationService;
					const { folderUri: resource, language: overrideIdentifier, target } = this.state;
					let value: IOpenideSettingItem['value'] | undefined;
					const item: IOpenideSettingItem = {
						key: setting.key,
						label: labelFor(setting),
						category: categoryFor(group, setting),
						groupId: group.id,
						description: setting.description.join('\n'),
						type: settingType(setting),
						schemaType: setting.type,
						setting,
						scope: setting.scope,
						extensionId: setting.extensionInfo?.id,
						extensionLabel: setting.extensionInfo?.displayName,
						tags: setting.tags || [],
						restricted: !!setting.restricted,
						deprecated: !!setting.deprecationMessage,
						// Navigation and text search need metadata, not thousands of inspected values.
						get value() {
							if (value) { return value; }
							const inspected = configurationService.inspect<unknown>(setting.key, { resource, overrideIdentifier });
							const targetValue = getConfigValueInTarget(inspected, target);
							return value = {
								effective: inspected.value,
								defaultValue: inspected.defaultValue,
								targetValue,
								configured: targetValue !== undefined,
								policyValue: inspected.policyValue,
								overrideIdentifiers: inspected.overrideIdentifiers || [],
							};
						},
					};
					this.searchText.set(item, `${item.key} ${item.label} ${item.description} ${item.category}`.toLowerCase());
					out.push(item);
				}
			}
		}
		return this.cachedItems = out;
	}
}
