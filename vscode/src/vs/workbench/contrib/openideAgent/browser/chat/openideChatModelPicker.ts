/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { IListStyles, List } from '../../../../../base/browser/ui/list/listWidget.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { AnchorAlignment, AnchorPosition } from '../../../../../base/browser/ui/contextview/contextview.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { defaultListStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IOpenideAgentService, IOpenidePickerGroup, IOpenidePickerModel } from '../openideAgentService.js';
import { createCodicon, createMenuCheck, createMenuContent, createMenuEmpty, createMenuRow, OpenideComposerPopover } from './openideComposerMenu.js';
import { OpenideChatModelDetail } from './openideChatModelDetail.js';
import { t } from '../../common/openideStrings.js';
import {
	IModelEntryRow, IModelSectionRow, MODEL_ROW_TEMPLATE, MODEL_SECTION_HEIGHT, MODEL_SECTION_TEMPLATE,
	ModelPickerRow, ModelRowRenderer, ModelSectionRenderer,
} from './openideChatModelPickerRows.js';

/**
 * Height of one model row: the menu family's 28px (`.openide-menu-row` / `.openide-mp-row` in
 * openideChatMenus.css), which the virtual list has to be told up front. Pinned here rather than
 * taken from the rows module so the picker and its stylesheet agree on the one number.
 */
const PICKER_ROW_HEIGHT = 24;

/**
 * Chrome above and below the virtualized rows, which the list height has to leave room for.
 *
 * Search row (28, border inside it) + 4 margin and the content's own 4px padding top/bottom = 40;
 * the footer that carries the add-provider action (4 + 24 + 4 + 1 border) = 33.
 */
const PICKER_CHROME_HEIGHT = 73;
const PICKER_MAX_HEIGHT = 420;

/**
 * The list's own row paint is switched off: it never holds DOM focus (the search field drives it),
 * and its hover/focus fills would land on the outer `.monaco-list-row`, a square box that ignores
 * the 4px inset and the row radius. The fill is painted by CSS on the inner `.openide-mp-row`
 * instead, the same way every other menu row paints it.
 */
const PICKER_LIST_STYLES: IListStyles = {
	...defaultListStyles,
	listFocusBackground: undefined,
	listFocusForeground: undefined,
	listActiveSelectionBackground: undefined,
	listActiveSelectionForeground: undefined,
	listActiveSelectionIconForeground: undefined,
	listFocusAndSelectionOutline: undefined,
	listFocusAndSelectionBackground: undefined,
	listFocusAndSelectionForeground: undefined,
	listInactiveSelectionBackground: undefined,
	listInactiveSelectionIconForeground: undefined,
	listInactiveSelectionForeground: undefined,
	listInactiveFocusForeground: undefined,
	listInactiveFocusBackground: undefined,
	listHoverBackground: undefined,
	listHoverForeground: undefined,
	listFocusOutline: undefined,
	listInactiveFocusOutline: undefined,
	listSelectionOutline: undefined,
	listHoverOutline: undefined,
};

class PickerDelegate implements IListVirtualDelegate<ModelPickerRow> {
	getHeight(element: ModelPickerRow): number {
		return element.kind === 'section' ? MODEL_SECTION_HEIGHT : PICKER_ROW_HEIGHT;
	}
	getTemplateId(element: ModelPickerRow): string {
		return element.kind === 'section' ? MODEL_SECTION_TEMPLATE : MODEL_ROW_TEMPLATE;
	}
}

/**
 * The shared row plus the family's trailing check. The base renderer already toggles
 * `.openide-menu-active` on the row for the current model; the check node is what CSS reveals
 * under that class, and the column stays reserved on every row so the stars keep their line.
 */
class CheckedModelRowRenderer extends ModelRowRenderer {
	override renderTemplate(container: HTMLElement): ReturnType<ModelRowRenderer['renderTemplate']> {
		const template = super.renderTemplate(container);
		template.container.appendChild(createMenuCheck(container.ownerDocument));
		return template;
	}
}

function pickerKey(providerId: string, modelId: string): string {
	return `${providerId}/${modelId}`;
}

function matches(model: IOpenidePickerModel, group: IOpenidePickerGroup, query: string): boolean {
	if (!query) { return true; }
	return model.name.toLowerCase().includes(query)
		|| model.id.toLowerCase().includes(query)
		|| group.label.toLowerCase().includes(query);
}

/**
 * Model popover: favourites, recents and one collapsible section per connected provider.
 *
 * The rows go through `List` instead of raw DOM because a well-connected user has hundreds of
 * models and the webview paid for every one of them on every repaint. The virtualization is the
 * only difference: the row itself is the same picture (provider mark, name, context, star).
 */
/**
 * Lets a host other than the composer reuse the picker: the plan editor's title bar picks the
 * EXECUTION model of one plan, which is neither the chat's active model nor stored in the same
 * place. Everything visual stays identical; only "which one is ticked" and "what a click does"
 * are the host's.
 */
export interface IOpenideChatModelPickerOptions {
	readonly anchorPosition?: AnchorPosition;
	readonly anchorAlignment?: AnchorAlignment;
	readonly width?: number;
	/** Which entry carries the check mark. Default: the chat's active provider/model. */
	readonly resolveActive?: () => Promise<{ providerId: string; modelId: string }>;
	/** What choosing does. Default: make it the chat's active provider/model. */
	readonly choose?: (group: IOpenidePickerGroup, model: IOpenidePickerModel) => Promise<void>;
}

export class OpenideChatModelPicker extends Disposable {

	private readonly _popover: OpenideComposerPopover;
	private readonly _detail = this._register(new OpenideChatModelDetail());

	private _groups: readonly IOpenidePickerGroup[] = [];
	/** Until the first load resolves an empty list means "not asked yet", not "nothing connected". */
	private _loaded = false;
	private _search = '';
	private _list: List<ModelPickerRow> | undefined;
	private _listHost: HTMLElement | undefined;
	private _emptyHost: HTMLElement | undefined;
	/** Guards the async group load against a popover that closed (or reopened) meanwhile. */
	private _generation = 0;

	constructor(
		private readonly agentService: IOpenideAgentService,
		contextViewService: IContextViewService,
		private readonly commandService: ICommandService,
		private readonly onDidChangeSelection: () => void,
		private readonly options: IOpenideChatModelPickerOptions = {},
	) {
		super();
		this._popover = this._register(new OpenideComposerPopover(contextViewService));
	}

	private _activeOverride: { providerId: string; modelId: string } | undefined;

	toggle(anchor: HTMLElement): void {
		this._popover.toggle(anchor, {
			className: 'openide-menu-model',
			anchorPosition: this.options.anchorPosition,
			anchorAlignment: this.options.anchorAlignment,
			width: this.options.width,
			render: (container, store) => this._render(container, store),
			onHide: () => {
				this._generation++;
				this._list = undefined;
				this._listHost = undefined;
				this._emptyHost = undefined;
				this._detail.disarm();
			},
		});
	}

	close(): void {
		this._popover.close();
	}

	private _render(container: HTMLElement, store: DisposableStore): void {
		const document = container.ownerDocument;
		const content = createMenuContent(document);
		container.appendChild(content);

		const searchRow = document.createElement('div');
		searchRow.className = 'openide-menu-search-row';
		searchRow.appendChild(createCodicon(document, 'search'));
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'openide-menu-search';
		input.placeholder = localize('openide.chat.model.search', "Buscar modelos…");
		input.value = this._search;
		searchRow.appendChild(input);
		content.appendChild(searchRow);
		store.add(addDisposableListener(input, 'input', () => {
			this._search = input.value;
			this._paint();
		}));
		store.add(addDisposableListener(input, 'keydown', event => this._onSearchKey(event)));

		this._listHost = document.createElement('div');
		this._listHost.className = 'openide-mp-list';
		content.appendChild(this._listHost);
		this._emptyHost = document.createElement('div');
		content.appendChild(this._emptyHost);

		this._list = store.add(new List<ModelPickerRow>('OpenideChatModelPicker', this._listHost, new PickerDelegate(), [
			new ModelSectionRenderer(row => this._toggleSection(row)),
			new CheckedModelRowRenderer(row => this._toggleFavorite(row)),
		], { horizontalScrolling: false, mouseSupport: true }));
		this._list.style(PICKER_LIST_STYLES);
		store.add(this._list.onMouseClick(event => {
			if (event.element?.kind === 'model') { this._choose(event.element); }
		}));
		store.add(this._list.onMouseOver(event => {
			if (event.element?.kind === 'model' && typeof event.index === 'number') {
				this._detail.arm();
				this._list?.setFocus([event.index]);
				this._showDetail(event.index);
			}
		}));
		store.add(addDisposableListener(this._listHost, 'mouseleave', () => this._detail.disarm()));

		// Footer, not first row: the picker is a list of models, and an action pinned above the
		// search box put the one thing nobody came for in the first place the eye lands on. Outside
		// `content` so it stays put while the models scroll.
		const footer = document.createElement('div');
		footer.className = 'openide-mp-foot';
		const add = createMenuRow(document, { icon: 'add', label: t('chat.model.addProvider'), muted: true });
		store.add(addDisposableListener(add, 'click', () => {
			this._popover.close();
			void this.commandService.executeCommand('openide.agent.openProviders');
		}));
		footer.appendChild(add);
		container.appendChild(footer);

		// No shortcut bar: the arrows and Enter work from the search field as before, the bar only
		// said so and cost a hairline and 26px (Cursor's list ends at its footer).

		// The search box owns the keyboard: the list is driven from it, so the caret never leaves
		// the field the user is typing in.
		getWindow(container).setTimeout(() => input.focus(), 0);
		this._paint();
		void this._load();
	}

	private async _load(): Promise<void> {
		const generation = ++this._generation;
		const [groups, active] = await Promise.all([
			this.agentService.getConnectedModelGroups(),
			this.options.resolveActive ? this.options.resolveActive().catch(() => undefined) : Promise.resolve(undefined),
		]);
		if (generation !== this._generation) { return; }
		this._groups = groups;
		this._activeOverride = active;
		this._loaded = true;
		this._paint();
	}

	/** Flattens the sections into the list's rows. Favourites and recents repeat models that also
	 *  appear under their provider: they are shortcuts, not a different set. */
	private _buildRows(): ModelPickerRow[] {
		const query = this._search.trim().toLowerCase();
		const collapsed = this.agentService.getCollapsedSections();
		const favorites = this.agentService.getPickerFavorites();
		const activeProvider = this._activeOverride?.providerId ?? this.agentService.getActiveProviderId();
		const activeModel = this._activeOverride ? this._activeOverride.modelId : this.agentService.getModel();
		const byKey = new Map<string, { group: IOpenidePickerGroup; model: IOpenidePickerModel }>();
		for (const group of this._groups) {
			for (const model of group.models) { byKey.set(pickerKey(group.id, model.id), { group, model }); }
		}
		const entry = (group: IOpenidePickerGroup, model: IOpenidePickerModel): IModelEntryRow => ({
			kind: 'model', key: pickerKey(group.id, model.id), group, model,
			active: group.id === activeProvider && (activeModel ? model.id === activeModel : model.id === group.defaultModel),
			favorite: favorites.includes(pickerKey(group.id, model.id)),
		});
		const rows: ModelPickerRow[] = [];
		const pinned = (key: string, label: string, codicon: string, keys: readonly string[]): void => {
			const hits = keys.map(item => byKey.get(item)).filter((hit): hit is { group: IOpenidePickerGroup; model: IOpenidePickerModel } => !!hit && matches(hit.model, hit.group, query));
			if (!hits.length) { return; }
			rows.push({ kind: 'section', key, label, codicon, collapsed: collapsed.includes(key) });
			if (collapsed.includes(key)) { return; }
			for (const hit of hits) { rows.push(entry(hit.group, hit.model)); }
		};
		pinned('favorites', localize('openide.chat.model.favorites', "Favoritos"), 'star-full', favorites);
		pinned('recent', localize('openide.chat.model.recents', "Recientes"), 'history', this.agentService.getPickerRecents());
		for (const group of this._groups) {
			const models = group.models.filter(model => matches(model, group, query));
			if (!models.length) { continue; }
			const key = `provider:${group.id}`;
			rows.push({ kind: 'section', key, label: group.label, providerId: group.id, collapsed: collapsed.includes(key) });
			if (collapsed.includes(key)) { continue; }
			for (const model of models) { rows.push(entry(group, model)); }
		}
		return rows;
	}

	private _paint(): void {
		const list = this._list;
		const host = this._listHost;
		const empty = this._emptyHost;
		if (!list || !host || !empty) { return; }
		const rows = this._buildRows();
		list.splice(0, list.length, rows);
		empty.textContent = '';
		// While the providers answer, the menu holds a skeleton at roughly its final height: the
		// collapsed three-line popover read as "no models" every time it opened.
		if (!this._loaded) {
			const skeleton = empty.ownerDocument.createElement('div');
			skeleton.className = 'openide-mp-skeleton';
			for (let index = 0; index < 5; index++) {
				const row = empty.ownerDocument.createElement('div');
				row.className = 'openide-mp-skeleton-row';
				const icon = empty.ownerDocument.createElement('span');
				icon.className = 'openide-mp-skeleton-icon';
				const bar = empty.ownerDocument.createElement('span');
				bar.className = 'openide-mp-skeleton-bar';
				bar.style.width = `${[62, 44, 71, 52, 38][index]}%`;
				row.append(icon, bar);
				skeleton.appendChild(row);
			}
			empty.appendChild(skeleton);
			host.style.height = '0px';
			return;
		}
		if (!rows.length && this._loaded) {
			empty.appendChild(createMenuEmpty(host.ownerDocument, this._groups.length
				? localize('openide.chat.model.noResults', "Sin resultados")
				: localize('openide.chat.model.noProviders', "Sin proveedores conectados")));
		}
		const contentHeight = rows.reduce((total, row) => total + (row.kind === 'section' ? MODEL_SECTION_HEIGHT : PICKER_ROW_HEIGHT), 0);
		const height = Math.min(contentHeight, this._listBudget(host));
		host.style.height = `${height}px`;
		list.layout(height);
		this._popover.layout();
	}

	/**
	 * How tall the virtual list may be, taken from the CARD and not from a number of its own.
	 *
	 * `.openide-menu` caps every popover in the product (openideChatMenus.css) and clips what
	 * overflows. This method used to repeat that cap as its own constants, and the moment the two
	 * drifted apart the picker laid its list out TALLER than the card could show: the rows past the
	 * card's edge were clipped, and the list — believing it had the room it was given — would not
	 * scroll to them. Filtering is where it showed, because that is when the row count lands
	 * between the two numbers. Reading the computed cap keeps one source of truth; the constants
	 * stay as the fallback for a surface mounted outside a menu.
	 */
	private _listBudget(host: HTMLElement): number {
		const window = getWindow(host);
		const menu = host.closest('.openide-menu');
		const cap = menu ? parseFloat(window.getComputedStyle(menu).maxHeight) : Number.NaN;
		const ceiling = Number.isFinite(cap) && cap > 0 ? cap : Math.min(PICKER_MAX_HEIGHT, window.innerHeight * 0.6);
		return Math.max(PICKER_ROW_HEIGHT, ceiling - PICKER_CHROME_HEIGHT);
	}

	/** ↑↓ move over MODEL rows only — stopping on a section header would make Enter a no-op. */
	private _onSearchKey(event: KeyboardEvent): void {
		const list = this._list;
		if (!list) { return; }
		const standard = new StandardKeyboardEvent(event);
		if (standard.keyCode === KeyCode.Escape) {
			// The search box swallows the key otherwise: the context view only listens on the
			// workbench container, and the caret is inside the popover.
			standard.preventDefault();
			this._popover.close();
			return;
		}
		if (standard.keyCode === KeyCode.DownArrow || standard.keyCode === KeyCode.UpArrow) {
			standard.preventDefault();
			standard.stopPropagation();
			this._detail.arm();
			const isModel = (row: ModelPickerRow): boolean => row.kind === 'model';
			if (standard.keyCode === KeyCode.DownArrow) {
				list.focusNext(1, true, undefined, isModel);
			} else {
				list.focusPrevious(1, true, undefined, isModel);
			}
			const index = list.getFocus()[0];
			if (typeof index === 'number') {
				list.reveal(index);
				this._showDetail(index);
			}
			return;
		}
		if (standard.keyCode === KeyCode.Enter) {
			const index = list.getFocus()[0];
			const element = typeof index === 'number' ? list.element(index) : undefined;
			if (element?.kind === 'model') {
				standard.preventDefault();
				this._choose(element);
			}
		}
	}

	private _showDetail(index: number): void {
		const list = this._list;
		const host = this._popover.container;
		if (!list || !host || !this._listHost) { return; }
		const element = list.element(index);
		if (element.kind !== 'model') { return; }
		// Derived from the list geometry instead of the row node: a virtualized row can be recycled
		// between the hover and the moment the panel is actually painted.
		const top = this._listHost.getBoundingClientRect().top + list.getElementTop(index) - list.scrollTop;
		this._detail.schedule(host, { top, height: PICKER_ROW_HEIGHT }, element.group, element.model);
	}

	private _toggleSection(row: IModelSectionRow): void {
		void this.agentService.toggleCollapsedSection(row.key);
		// Optimistic: the service persists asynchronously, but the section has to fold on the same
		// frame it was clicked.
		this._paint();
	}

	private _toggleFavorite(row: IModelEntryRow): void {
		void this.agentService.togglePickerFavorite(row.key);
		this._paint();
	}

	private _choose(row: IModelEntryRow): void {
		this._popover.close();
		void (async () => {
			if (this.options.choose) {
				await this.options.choose(row.group, row.model);
				await this.agentService.recordPickerUse(pickerKey(row.group.id, row.model.id));
				this.onDidChangeSelection();
				return;
			}
			await this.agentService.setActiveProvider(row.group.id);
			// Choosing the provider's default means "no model override", same as the webview.
			const model = row.model.id === row.group.defaultModel ? '' : row.model.id;
			await this.agentService.setModel(model);
			const picked = model || this.agentService.findProvider(row.group.id)?.defaultModel || '';
			if (picked) { await this.agentService.recordPickerUse(pickerKey(row.group.id, picked)); }
			this.onDidChangeSelection();
		})();
	}
}
