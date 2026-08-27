/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — product-owned Settings pane. Uses configuration services/models as backend and
 *  intentionally does not depend on SettingsEditor2 DOM, trees, widgets or CSS.
 *--------------------------------------------------------------------------------------------*/

import { append, clearNode, Dimension, $ } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IPreferencesService, ISettingsEditorOptions, SettingValueType } from '../../../services/preferences/common/preferences.js';
import { Settings2EditorModel } from '../../../services/preferences/common/preferencesModels.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_SEARCH_FOCUS } from '../../preferences/common/preferences.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { SettingsEditorInput } from './openideSettingsInput.js';
import { OpenideSettingsModel } from './openideSettingsModel.js';
import { appendSettingsInfoHint, createSettingControl } from './openideSettingsControls.js';
import { appendOpenideSettingsIcon } from './openideSettingsIcons.js';
import { normalizeSettingsQuery, plainSettingsQuery } from './openideSettingsSearch.js';
import { openideSettingsSurfaceSearch } from './openideSettingsSurfaceSearch.js';
import { OpenideSectionRenderer } from './openideSettingsSectionBuilder.js';
import './media/openideSettings.css';
import { applyOpenideSurfaceCss } from '../../openideAgent/browser/openideSurfaceStyle.js';
import { IOpenideSettingsNavigationEntry } from '../common/openideSettingsTypes.js';
import { OpenideCommandsSettingsSection } from '../../openideAgent/browser/openideCommandsSettingsSection.js';
import { OpenideHooksSettingsSection } from '../../openideAgent/browser/openideHooksSettingsSection.js';
import { OpenideQuickCommandsSettingsSection } from '../../openideAgent/browser/openideQuickCommandsSettingsSection.js';
import { OpenideMcpSettingsSection } from '../../openideAgent/browser/openideMcpSettingsSection.js';
import { OpenideProvidersSettingsSection } from '../../openideAgent/browser/openideProvidersSettingsSection.js';
import { OpenideProjectMapSettingsSection } from '../../openideAgent/browser/openideProjectMapSettingsSection.js';
import { OpenideRulesSettingsSection } from '../../openideAgent/browser/openideRulesSettingsSection.js';
import { OpenideSkillsSettingsSection } from '../../openideAgent/browser/openideSkillsSettingsSection.js';
import { OpenideSubagentSettingsSection } from '../../openideAgent/browser/openideSubagentSettingsSection.js';
import { IOpenideSettingsSection } from './openideSettingsSection.js';
import { OpenideLanguageSettingsSection } from './openideLanguageSettingsSection.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { openideInputBoxStyles } from '../../openideAgent/browser/openideControlStyles.js';
import { onDidChangeOpenideLanguage, t } from '../../openideAgent/common/openideStrings.js';

const INITIAL_RENDER_LIMIT = 180;

/** Categories with native rows plus a DOM section below (what the schema cannot express).
 *  Migration target: workbench DOM, services called directly, shared CSS. */
const SECTION_FACTORIES: ReadonlyMap<string, new (...args: any[]) => IOpenideSettingsSection> = new Map<string, new (...args: any[]) => IOpenideSettingsSection>([
	['openideAgent/subagents', OpenideSubagentSettingsSection],
	['openideAgent/projectMap', OpenideProjectMapSettingsSection],
	['openideAgent/skills', OpenideSkillsSettingsSection],
	['openideAgent/rules', OpenideRulesSettingsSection],
	['openideAgent/commands', OpenideCommandsSettingsSection],
	['openideAgent/hooks', OpenideHooksSettingsSection],
	['openideAgent/quickCommands', OpenideQuickCommandsSettingsSection],
	['openideAgent/mcp', OpenideMcpSettingsSection],
	['openideAgent/providers', OpenideProvidersSettingsSection],
	['workbench/language', OpenideLanguageSettingsSection],
]);

export class OpenideSettingsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.openideSettings';

	private root!: HTMLElement;
	private search!: HTMLInputElement;
	private navigation!: HTMLElement;
	private content!: HTMLElement;
	private title!: HTMLElement;
	private pageIcon!: HTMLElement;
	private breadcrumb!: HTMLElement;
	private count!: HTMLElement;
	private _searchClear!: HTMLButtonElement;
	private readonly modelListeners = this._register(new DisposableStore());
	/** Hovers of the current page's rows; cleared on every repaint so hints never outlive a row. */
	private readonly rowHovers = this._register(new DisposableStore());
	/** Native widgets built per row (InputBox, Checkbox, SelectBox): they own DOM and listeners, so
	 *  they are disposed with the rows they belong to, not leaked across renders. */
	private readonly rowWidgets = this._register(new DisposableStore());
	private readonly settingsModel: OpenideSettingsModel;
	private renderLimit = INITIAL_RENDER_LIMIT;
	/** Shape of the rows currently in the sidebar, so a re-render that changes nothing skips the
	 *  rebuild (and with it the scroll reset). `undefined` until the first paint. */
	private navigationSignature: string | undefined;
	private _searchBox!: InputBox;
	private renderHandle: number | undefined;
	private readonly sections = new Map<string, IOpenideSettingsSection>();

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ICommandService private readonly commandService: ICommandService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IHoverService private readonly hoverService: IHoverService,
		@IContextViewService private readonly contextViewService: IContextViewService,
	) {
		super(OpenideSettingsEditor.ID, group, telemetryService, themeService, storageService);
		this.settingsModel = new OpenideSettingsModel(configurationService);
		CONTEXT_SETTINGS_EDITOR.bindTo(contextKeyService).set(true);
		this._register(configurationService.onDidChangeConfiguration(() => this.scheduleRender(false)));
		this._register(userDataProfileService.onDidChangeCurrentProfile(() => this.scheduleRender(true)));
		// `openide.language` repaints the whole shell: nav labels, search, hints, buttons.
		this._register(onDidChangeOpenideLanguage(() => this.scheduleRender(true)));
	}

	override get minimumWidth(): number { return 620; }
	override get minimumHeight(): number { return 420; }

	protected createEditor(parent: HTMLElement): void {
		applyOpenideSurfaceCss();
		this.root = append(parent, $('.openide-settings'));
		// Explicit DOM construction: Settings is a privileged surface and must not depend on
		// innerHTML/TrustedHTML, nor on a sanitizer preserving empty placeholders.
		// Sidebar: search, scope and navigation live together, on the side where you pick WHAT to
		// look at. The content stays a single reading column, with nothing above it competing.
		const body = append(this.root, $('.openide-settings-body'));
		const sidebar = append(body, $('nav.openide-settings-sidebar', { 'aria-label': t('settings.nav.aria') }));

		const searchBlock = append(sidebar, $('.openide-settings-sidebar-block'));
		// The native widget, not a hand-rolled div: `InputBox` brings the theme's input background,
		// border, focus ring and high-contrast handling, which a bordered `<div>` around a bare
		// `<input>` has to re-implement (and drifts from) forever. The magnifier is decoration laid
		// over it in CSS, the same way upstream's own settings search does it.
		const searchWrap = append(searchBlock, $('.openide-settings-search-wrap'));
		this._searchBox = this._register(new InputBox(searchWrap, undefined, {
			placeholder: t('settings.search.placeholder'),
			ariaLabel: t('settings.search.placeholder'),
			inputBoxStyles: openideInputBoxStyles,
		}));
		append(searchWrap, $('span.codicon.codicon-search.openide-settings-search-icon'));
		this.search = this._searchBox.inputElement;
		// Inline clear, like every macOS search field: appears only while there is a query.
		const clear = append(searchWrap, $('button.openide-settings-search-clear.hidden', { type: 'button', title: t('settings.search.clear') })) as HTMLButtonElement;
		append(clear, $('span.codicon.codicon-close'));
		clear.addEventListener('click', () => {
			this._searchBox.value = '';
			this.applySearch();
			this._searchBox.focus();
		});
		this._searchClear = clear;
		this.count = append(searchBlock, $('span.openide-settings-count'));

		this.navigation = append(sidebar, $('.openide-settings-nav'));
		// ↑/↓ move between categories without tabbing through every one; Home/End jump. Standard
		// sidebar keyboard behavior — the buttons stay real buttons, so Enter/Space still work.
		this.navigation.addEventListener('keydown', event => {
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') { return; }
			const items = Array.from(this.navigation.querySelectorAll<HTMLButtonElement>('button.openide-settings-nav-item'));
			if (!items.length) { return; }
			const current = items.indexOf(this.navigation.ownerDocument.activeElement as HTMLButtonElement);
			const next = event.key === 'Home' ? 0
				: event.key === 'End' ? items.length - 1
					: event.key === 'ArrowDown' ? Math.min(items.length - 1, current + 1)
						: Math.max(0, current - 1);
			items[next]?.focus();
			event.preventDefault();
		});

		const content = append(body, $('main.openide-settings-content', { tabindex: '-1' }));
		// A dropdown is anchored to its trigger, not attached to it: scrolling the page left the open
		// list floating over unrelated rows, still pointing at a control that had moved. Every native
		// select closes on scroll, so this one does too — the same call the upstream settings tree
		// makes when its own scroller moves (settingsTree.ts, `cancelSuggesters`).
		const closeOverlays = () => this.contextViewService.hideContextView();
		content.addEventListener('scroll', closeOverlays, { passive: true });
		this.navigation.addEventListener('scroll', closeOverlays, { passive: true });
		const column = append(content, $('.openide-settings-column'));
		const pageHead = append(column, $('.openide-settings-page-head'));
		const pageTitles = append(pageHead, $('.openide-settings-page-titles'));
		this.breadcrumb = append(pageTitles, $('nav.openide-settings-breadcrumb', { 'aria-label': t('settings.breadcrumb.aria') }));
		const titleRow = append(pageTitles, $('.openide-settings-page-title-row'));
		this.pageIcon = append(titleRow, $('span.openide-settings-page-icon'));
		this.title = append(titleRow, $('h1.openide-settings-page-title'));
		this.content = append(column, $('.openide-settings-list'));
		this.search.addEventListener('input', () => this.applySearch());
		this.search.addEventListener('focus', () => CONTEXT_SETTINGS_SEARCH_FOCUS.bindTo(this.rootContextKeyService()).set(true));
	}

	private rootContextKeyService(): IContextKeyService { return this.contextKeyService; }

	override async setInput(input: SettingsEditorInput, options: ISettingsEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		const model = await input.resolve();
		if (token.isCancellationRequested || !(model instanceof Settings2EditorModel)) { return; }
		this.settingsModel.setModel(model);
		this.settingsModel.setState({ target: options?.target ?? ConfigurationTarget.USER_LOCAL, folderUri: options?.folderUri, query: options?.query || '', category: 'home' });
		this.search.value = options?.query || '';
		this.modelListeners.clear(); this.modelListeners.add(model.onDidChangeGroups(() => this.scheduleRender(true)));
		this.renderAll();
		if (options?.focusSearch !== false) { this.search.focus(); }
	}

	focusSearch(query?: string): void { if (query !== undefined) { this.search.value = query; this.applySearch(); } this.search.focus(); }
	clearSearchResults(): void { this.search.value = ''; this.applySearch(); }
	showSettingsCategory(category: string): void {
		const found = this.settingsModel.findNavigationEntry(category);
		this.settingsModel.setState({ category: found?.id || 'home' });
		this.renderAll();
	}
	focusSettings(): void { (this.content.querySelector('button, input, select, textarea') as HTMLElement | null)?.focus(); }
	focusTOC(): void { (this.navigation.querySelector('button') as HTMLElement | null)?.focus(); }
	switchToSettingsFile(): Promise<void> { return this.openJson(); }

	private applySearch(): void {
		this.renderLimit = INITIAL_RENDER_LIMIT;
		// Search always starts from "All settings": the text filters both the options and the tree,
		// without being accidentally constrained by the previously selected category.
		// EXCEPTION: categories with their own section filter in place (the section receives the
		// query), because jumping to "home" would pull the user off the page they are looking at.
		const category = this.settingsModel.viewState.category;
		const filtersInPlace = SECTION_FACTORIES.has(category);
		this.settingsModel.setState({ query: normalizeSettingsQuery(this.search.value), category: filtersInPlace ? category : 'home' });
		this._searchClear?.classList.toggle('hidden', !this.search.value);
		this.renderAll();
	}
	private scheduleRender(reset: boolean): void {
		if (reset) { this.renderLimit = INITIAL_RENDER_LIMIT; }
		if (this.renderHandle !== undefined) { cancelAnimationFrame(this.renderHandle); }
		this.renderHandle = requestAnimationFrame(() => { this.renderHandle = undefined; this.renderAll(); });
	}


	/** Sub-page contributed by a section, if `category` is one. The model does not know about
	 *  these: they come from a runtime list (the connected providers), not from the static TOC. */
	private sectionNavigationEntry(category: string): IOpenideSettingsNavigationEntry | undefined {
		const base = this.baseCategory(category);
		if (base === category) { return undefined; }
		return this.sectionForCategory(base)?.navigationChildren?.find(entry => entry.id === category);
	}

	private renderAll(): void {
		// Rebuilt per render, not once in the constructor: its titles go through `t()` and a map
		// built at construction would keep whatever language was active back then.
		this.settingsModel.setSurfaceSearch(openideSettingsSurfaceSearch());
		const visibleNavigation = this.settingsModel.visibleNavigation;
		const category = this.settingsModel.viewState.category;
		if (!this.settingsModel.findNavigationEntry(category) && !this.sectionNavigationEntry(category)) {
			this.settingsModel.setState({ category: 'home' });
		}
		this.renderNavigation(visibleNavigation);
		this.renderItems();
	}
	/** Grouped navigation: top-level categories are HEADINGS and their children the items.
	 *  The previous collapsible tree required two clicks to reach anything and hid half the map;
	 *  with groups, everything that exists is visible at once. */
	private renderNavigation(entries: readonly IOpenideSettingsNavigationEntry[]): void {
		type NavRow =
			| { readonly kind: 'group'; readonly label: string }
			| { readonly kind: 'item'; readonly entry: IOpenideSettingsNavigationEntry; readonly nested: boolean };

		const rows: NavRow[] = [];
		for (const entry of entries) {
			if (!entry.children?.length) { rows.push({ kind: 'item', entry, nested: false }); continue; }
			rows.push({ kind: 'group', label: entry.label });
			for (const child of entry.children) {
				rows.push({ kind: 'item', entry: child, nested: false });
				// Sub-pages a section contributes (one per provider) are drawn indented under it,
				// so the sidebar keeps showing everything that exists without a collapsible tree.
				for (const grandchild of this.sectionForCategory(child.id)?.navigationChildren ?? []) {
					// Hidden children stay resolvable (breadcrumb, deep links) without a nav row:
					// the parent's index page is their directory.
					if (!grandchild.hidden) { rows.push({ kind: 'item', entry: grandchild, nested: true }); }
				}
			}
		}

		const category = this.settingsModel.viewState.category;
		// Picking a category re-renders the whole editor, but the sidebar itself almost never
		// changes — only which row is active. Rebuilding it regardless threw away `scrollTop`, so
		// every click on a page below the fold snapped the list back to the top. When the rows are
		// the same list as last time, move the highlight and touch nothing else.
		const signature = rows.map(row => row.kind === 'group' ? `#${row.label}` : `${row.entry.id}\u0000${row.entry.label}\u0000${row.nested}`).join('\u0001');
		if (signature === this.navigationSignature) {
			for (const button of this.navigation.querySelectorAll<HTMLElement>('.openide-settings-nav-item')) {
				button.classList.toggle('active', button.dataset.navId === category);
			}
			return;
		}
		this.navigationSignature = signature;

		// The list really did change — a search, a language switch, a provider connected. Rebuild
		// it, but put the scroll back: the rows the user was looking at are mostly still there.
		const scrollTop = this.navigation.scrollTop;
		clearNode(this.navigation);
		for (const row of rows) {
			if (row.kind === 'group') {
				append(this.navigation, $('.openide-settings-nav-group', undefined, row.label));
				continue;
			}
			const { entry, nested } = row;
			const button = append(this.navigation, $(`button.openide-settings-nav-item${nested ? '.nested' : ''}`)) as HTMLButtonElement;
			button.type = 'button';
			button.title = entry.label;
			button.dataset.navId = entry.id;
			// Sub-pages (one per provider) skip the chip: they inherit their parent's identity and
			// the indentation already says whose children they are.
			if (!nested) {
				appendOpenideSettingsIcon(button, entry.id);
			}
			append(button, $('span.openide-settings-nav-label', undefined, entry.label));
			button.classList.toggle('active', entry.id === category);
			button.addEventListener('click', async () => {
				if (entry.command) { await this.commandService.executeCommand(entry.command); return; }
				this.settingsModel.setState({ category: entry.id });
				this.renderAll();
			});
		}
		this.navigation.scrollTop = scrollTop;
	}

	/** Ancestors of the current page, each one navigable. The last segment is the page itself and
	 *  is not repeated — the <h1> right below already says it. */
	private renderBreadcrumb(): void {
		clearNode(this.breadcrumb);
		const category = this.settingsModel.viewState.category;
		const subPage = this.sectionNavigationEntry(category);
		// A section sub-page is not in the model's tree. Its trail is the parent's full path plus
		// itself, so the shared `slice(0, -1)` below still drops only the current page and the
		// crumb reads "Agente IA › Proveedores".
		const path = subPage
			? [...this.settingsModel.navigationPath(this.baseCategory(category)), subPage]
			: this.settingsModel.navigationPath(category);
		if (!path.length) {
			this.breadcrumb.classList.add('empty');
			return;
		}
		this.breadcrumb.classList.remove('empty');
		path.slice(0, -1).forEach((entry, index) => {
			if (index > 0) { append(this.breadcrumb, $('span.openide-settings-breadcrumb-sep', undefined, '›')); }
			const crumb = append(this.breadcrumb, $('button.openide-settings-breadcrumb-item', { type: 'button' })) as HTMLButtonElement;
			crumb.textContent = entry.label;
			crumb.addEventListener('click', () => {
				this.settingsModel.setState({ category: entry.id });
				this.renderAll();
			});
		});
	}

	private renderItems(): void {
		this.rowHovers.clear();
		this.rowWidgets.clear();
		clearNode(this.content);
		const section = this.sectionForCategory(this.settingsModel.viewState.category);
		const owned = new Set(section?.ownedSettings ?? []);
		const subPageEntry = this.sectionNavigationEntry(this.settingsModel.viewState.category);
		// A section SUB-page (one provider) is 100% section-owned. The model cannot know that: the
		// sub-pages live outside its TOC, so its category filter finds no entry and falls back to
		// EVERY setting — which is how a provider page once rendered the whole editor config above
		// the provider card.
		const items = subPageEntry ? [] : this.settingsModel.items().filter(item => !owned.has(item.key));
		// With no native rows (pages that are 100% section, like Skills) the counter does not apply.
		// The count is search feedback, not page furniture: "4 ajustes" under an idle search box
		// read as noise (and as a mystery). It only exists while a query is filtering.
		const activeQuery = plainSettingsQuery(this.settingsModel.viewState.query).trim() || this.settingsModel.viewState.query.trim();
		this.count.textContent = activeQuery ? (items.length === 1 ? t('settings.search.oneResult') : t('settings.search.results', items.length)) : '';
		this.title.textContent = subPageEntry ? subPageEntry.label : this.settingsModel.activeNavigationLabel;
		clearNode(this.pageIcon);
		appendOpenideSettingsIcon(this.pageIcon, this.settingsModel.viewState.category, true);
		this.renderBreadcrumb();
		// Flat (OpenChamber): no card — the rows sit straight on the page background and the spacing
		// does the separating. The wrapper only groups them for the gap against the sections.
		const card = items.length ? append(this.content, $('.openide-settings-group')) : this.content;
		for (const item of items.slice(0, this.renderLimit)) {
			const row = append(card, $('.openide-settings-row'));
			row.classList.toggle('modified', item.value.configured); row.classList.toggle('deprecated', item.deprecated); row.classList.toggle('restricted', item.restricted);
			const copy = append(row, $('.openide-settings-copy'));
			const heading = append(copy, $('.openide-settings-setting-title'));
			append(heading, $('span.openide-settings-setting-name', undefined, item.label));
			// Apple's rows are quiet: a short line may stay visible as a subtitle; anything longer
			// goes behind the ⓘ hint so the page reads as a list of decisions, not documentation.
			const shortDescription = item.description && item.description.length <= 90 && !item.description.includes('\n');
			const hintParts: string[] = [];
			if (!shortDescription && item.description) { hintParts.push(item.description); }
			if (item.value.configured) { hintParts.push(t('settings.item.modified')); }
			if (item.deprecated) { hintParts.push(t('settings.item.deprecated')); }
			if (hintParts.length) {
				appendSettingsInfoHint(this.hoverService, this.rowHovers, heading, hintParts.join('\n\n'));
			}
			// The key rides LAST on the title line, invisible until the row is hovered: it occupies
			// its space permanently (inline, small) so revealing it never shifts the layout.
			append(heading, $('span.openide-settings-key', undefined, item.key));
			if (shortDescription) {
				append(copy, $('.openide-settings-description', undefined, item.description));
			}
			if (item.extensionId) { const owner = append(copy, $('.openide-settings-owner')); owner.textContent = item.extensionId; }
			// A setting narrower than the selected tab cannot be written there. Saying so up front
			// beats letting the click through and surfacing the writer's raw refusal
			// ("does not support the folder resource scope") after the fact.
			const editableHere = this.settingsModel.isEditableInCurrentScope(item);
			row.classList.toggle('out-of-scope', !editableHere);
			if (!editableHere) {
				const note = append(copy, $('.openide-settings-scope-note'));
				note.textContent = t('settings.item.onlyIn', this.settingsModel.editableScopeLabel(item));
			}
			const actions = append(row, $('.openide-settings-value'));
			const control = createSettingControl(item, () => this.openJson(item.key), this.rowWidgets, this.contextViewService); actions.appendChild(control.element);
			control.element.setAttribute('aria-label', item.label);
			if (!editableHere) {
				control.element.setAttribute('aria-disabled', 'true');
				control.setEnabled?.(false);
			}
			// Booleans: the whole row toggles (like a macOS row), but the switch stays the only
			// focusable control — the row's click is delegated to it without stealing focus.
			if (item.type === SettingValueType.Boolean && editableHere) {
				row.classList.add('togglable');
				row.addEventListener('click', event => {
					if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) { return; }
					(control.element as HTMLButtonElement).click();
				});
			}
			control.onChange?.(async value => {
				const validation = item.setting.validator?.(value); if (validation) { control.element.setAttribute('aria-invalid', 'true'); control.element.title = validation; return; }
				await this.settingsModel.update(item, value); control.element.setAttribute('aria-invalid', 'false');
			});
			if (item.value.configured) { const reset = append(actions, $('button.openide-settings-reset')) as HTMLButtonElement; reset.type = 'button'; reset.title = t('settings.item.reset'); append(reset, $('span.codicon.codicon-discard')); reset.addEventListener('click', () => this.settingsModel.reset(item)); }
			if (item.value.policyValue !== undefined) { row.title = t('settings.item.policy'); }
			if (item.type === SettingValueType.Complex) { row.classList.add('complex'); }
		}
		if (items.length > this.renderLimit) {
			const more = append(this.content, $('button.openide-settings-more')) as HTMLButtonElement; more.type = 'button'; more.textContent = t('settings.item.showMore', Math.min(INITIAL_RENDER_LIMIT, items.length - this.renderLimit));
			more.addEventListener('click', () => { this.renderLimit += INITIAL_RENDER_LIMIT; this.renderItems(); });
		}
		if (!items.length && !section) { const empty = append(this.content, $('.openide-settings-empty')); empty.textContent = t('settings.search.noMatches'); }
		if (!section) { return; }
		// Searching "skills" must SHOW the skills, not filter them by the word "skills": if the
		// query matches the category by what it offers, the page is drawn in full.
		// Without the `@…` filters: the section searches by text, and `@modified` is not text that
		// exists in a skill list — letting it through emptied the whole page.
		const query = this.settingsModel.surfaceMatchesQuery(this.settingsModel.viewState.category) ? '' : plainSettingsQuery(this.settingsModel.viewState.query);
		section.render(this.content, {
			scope: this.settingsModel.viewState.target === ConfigurationTarget.WORKSPACE || this.settingsModel.viewState.target === ConfigurationTarget.WORKSPACE_FOLDER ? 'workspace' : 'user',
			query,
			category: this.settingsModel.viewState.category,
			navigate: category => { this.settingsModel.setState({ category }); this.renderAll(); },
		});
		// And whatever the section did not filter itself (whole blocks, rows from another list) is
		// filtered by the renderer, in one place and using the declared keywords.
		OpenideSectionRenderer.prune(this.content, query);
		if (query && !this.content.hasChildNodes()) {
			append(this.content, $('.openide-settings-empty')).textContent = t('settings.search.noMatches');
		}
	}

	/** Lazy, cached instance: the section survives repaints and keeps its draft. */
	/** A section owns its category AND every sub-page under it, so `openideAgent/providers/openai`
	 *  resolves to the providers section rather than to nothing. */
	private baseCategory(category: string): string {
		if (SECTION_FACTORIES.has(category)) { return category; }
		for (const id of SECTION_FACTORIES.keys()) {
			if (category.startsWith(id + '/')) { return id; }
		}
		return category;
	}

	private sectionForCategory(category: string | undefined): IOpenideSettingsSection | undefined {
		if (!category) { return undefined; }
		const base = this.baseCategory(category);
		const existing = this.sections.get(base);
		if (existing) { return existing; }
		const ctor = SECTION_FACTORIES.get(base);
		if (!ctor) { return undefined; }
		const section = this._register(this.instantiationService.createInstance(ctor));
		this.sections.set(base, section);
		// The sub-pages a section contributes are discovered asynchronously (a provider list has
		// to be read first), so the nav has to repaint when they arrive.
		if (section.onDidChangeNavigation) {
			this._register(section.onDidChangeNavigation(() => this.renderAll()));
		}
		return section;
	}

	private async openJson(key?: string): Promise<void> {
		await this.preferencesService.openSettings({ jsonEditor: true, target: this.settingsModel.viewState.target, folderUri: this.settingsModel.viewState.folderUri, revealSetting: key ? { key, edit: true } : undefined });
	}

	override layout(dimension: Dimension): void { this.root.style.width = `${dimension.width}px`; this.root.style.height = `${dimension.height}px`; }

}
