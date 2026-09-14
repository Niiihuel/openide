/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createOpenideElement } from '../openideDom.js';
import { addDisposableListener, getWindow } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { IListVirtualDelegate } from '../../../../../base/browser/ui/list/list.js';
import { IListStyles, List } from '../../../../../base/browser/ui/list/listWidget.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { AnchorAlignment, AnchorPosition } from '../../../../../base/browser/ui/contextview/contextview.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { defaultListStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IOpenideAgentService } from '../openideAgentService.js';
import { setupChatTooltip } from './openideChatHover.js';
import { IOpenideProviderService } from '../openideProviderService.js';
import { IOpenidePickerPreferencesService } from '../openidePickerPreferencesService.js';
import { IOpenidePickerGroup, IOpenidePickerModel } from '../../common/openidePickerModels.js';
import { createCodicon, createMenuCheck, createMenuContent, createMenuEmpty, createMenuRow, OpenideComposerPopover } from './openideComposerMenu.js';
import { OpenideChatEffortSlider } from './openideChatEffortSlider.js';
import { OpenideChatModelDetail } from './openideChatModelDetail.js';
import { availableReasoningEfforts } from './openideChatReasoning.js';
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
const PICKER_ROW_HEIGHT = 28;

/**
 * Chrome above and below the virtualized rows, which the list height has to leave room for.
 *
 * Search row (28, border inside it) + 4 margin and the content's own 4px padding top/bottom = 40;
 * the footer that carries the add-provider action (4 + 24 + 4 + 1 border) = 33.
 */
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
	readonly hoverService?: IHoverService;
	/** Which entry carries the check mark. Default: the chat's active provider/model. */
	readonly resolveActive?: () => Promise<{ providerId: string; modelId: string }>;
	/** What choosing does. Default: make it the chat's active provider/model. */
	readonly choose?: (group: IOpenidePickerGroup, model: IOpenidePickerModel) => Promise<void>;
}

export class OpenideChatModelPicker extends Disposable {

	private readonly _popover: OpenideComposerPopover;
	private readonly _detail = this._register(new OpenideChatModelDetail());
	private readonly _summaryStore = this._register(new DisposableStore());
	private readonly _effortStore = this._register(new DisposableStore());
	private _view: 'summary' | 'models' | 'effort' = 'summary';
	private _summary: HTMLElement | undefined;
	private _effortPanel: HTMLElement | undefined;
	private _modelsContent: HTMLElement | undefined;
	private _modelsFooter: HTMLElement | undefined;
	private _searchInput: HTMLInputElement | undefined;

	private _groups: readonly IOpenidePickerGroup[] = [];
	/** Until the first load resolves an empty list means "not asked yet", not "nothing connected". */
	private _loaded = false;
	private _search = '';
	private _list: List<ModelPickerRow> | undefined;
	private _listHost: HTMLElement | undefined;
	private _listFocusIsKeyboard = false;
	private _emptyHost: HTMLElement | undefined;
	/** Guards the async group load against a popover that closed (or reopened) meanwhile. */
	private _generation = 0;
	/** Held across close/reopen: provider and model form one asynchronous selection. */
	private _selectionPending = false;
	private _effortGeneration = 0;
	private _effortModel: { groupId: string; model: IOpenidePickerModel } | undefined;

	constructor(
		private readonly agentService: Pick<IOpenideProviderService, 'getConnectedModelGroups' | 'getActiveProviderId' | 'getModel' | 'getReasoningEfforts' | 'getReasoningEffort' | 'setReasoningEffort' | 'setActiveProvider' | 'setModel' | 'findProvider' | 'describeModel'> & Pick<IOpenideAgentService, 'getFastMode' | 'getFastModeCapability' | 'setFastMode'> & Pick<IOpenidePickerPreferencesService, 'getCollapsedSections' | 'getPickerFavorites' | 'getPickerRecents' | 'toggleCollapsedSection' | 'togglePickerFavorite' | 'recordPickerUse'>,
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
				this._effortStore.clear();
				this._effortModel = undefined;
				this._summaryStore.clear();
				this._summary = this._effortPanel = this._modelsContent = this._modelsFooter = undefined;
				this._searchInput = undefined;
			},
		});
	}

	close(): void {
		this._effortStore.clear();
		this._popover.close();
	}

	private _render(container: HTMLElement, store: DisposableStore): void {
		const document = container.ownerDocument;
		container.setAttribute('role', 'dialog');
		container.setAttribute('aria-busy', String(this._selectionPending));
		container.setAttribute('aria-label', t('chatSurface.model.unset'));
		this._view = this.options.choose ? 'models' : 'summary';
		this._summary = createOpenideElement(document, 'div');
		this._summary.className = 'openide-mp-summary openide-menu-content';
		this._effortPanel = createOpenideElement(document, 'div');
		this._effortPanel.className = 'openide-mp-effort-panel openide-menu-content';
		container.append(this._summary, this._effortPanel);
		const content = createMenuContent(document);
		content.classList.add('openide-mp-models-content');
		this._modelsContent = content;
		container.appendChild(content);
		const back = createMenuRow(document, { icon: 'arrow-left', label: t('chatSurface.model.unset') });
		back.classList.add('openide-mp-back');
		back.hidden = !!this.options.choose;
		store.add(addDisposableListener(back, 'click', () => this._showView('summary')));
		content.appendChild(back);
		store.add(addDisposableListener(container, 'keydown', event => {
			const group = this._groups.find(candidate => candidate.id === this.agentService.getActiveProviderId());
			const hasRootModel = group?.models.some(model => model.id === (this.agentService.getModel() || group.defaultModel));
			if (!event.isComposing && event.key === 'Escape' && this._view === 'models' && !this.options.choose && hasRootModel) {
				event.preventDefault(); event.stopPropagation(); this._showView('summary');
			}
		}, true));

		const searchRow = createOpenideElement(document, 'div');
		searchRow.className = 'openide-menu-search-row';
		searchRow.appendChild(createCodicon(document, 'search'));
		const input = createOpenideElement(document, 'input');
		input.type = 'search';
		input.setAttribute('aria-label', t('chatSurface.model.search'));
		this._searchInput = input;
		input.className = 'openide-menu-search';
		input.placeholder = t('chatSurface.model.search');
		input.value = this._search;
		searchRow.appendChild(input);
		content.appendChild(searchRow);
		store.add(addDisposableListener(input, 'input', () => {
			this._search = input.value;
			this._paint();
		}));
		store.add(addDisposableListener(input, 'keydown', event => this._onSearchKey(event)));

		this._listHost = createOpenideElement(document, 'div');
		this._listHost.className = 'openide-mp-list';
		content.appendChild(this._listHost);
		this._emptyHost = createOpenideElement(document, 'div');
		content.appendChild(this._emptyHost);

		this._list = store.add(new List<ModelPickerRow>('OpenideChatModelPicker', this._listHost, new PickerDelegate(), [
			new ModelSectionRenderer(row => this._toggleSection(row)),
			new CheckedModelRowRenderer(row => this._toggleFavorite(row), (row, anchor) => this._editEffort(row, anchor)),
		], { horizontalScrolling: false, mouseSupport: true }));
		this._list.style(PICKER_LIST_STYLES);
		store.add(this._list.onMouseClick(event => {
			if (event.element?.kind === 'model') { this._choose(event.element); }
		}));
		store.add(this._list.onMouseOver(event => {
			// While a level is being picked the card describing another model is noise, and both
			// want the same strip of screen beside the popover.
			if (this._view !== 'models') { return; }
			if (event.element?.kind === 'model' && typeof event.index === 'number') {
				this._listFocusIsKeyboard = false;
				this._listHost?.classList.remove('openide-mp-keyboard-focus');
				this._detail.arm();
				this._list?.setFocus([event.index]);
				this._showDetail(event.index);
			}
		}));
		store.add(addDisposableListener(this._listHost, 'mouseleave', () => {
			this._detail.disarm();
			// Mouse focus only assists the hovered row; moving to the footer/search must not
			// leave it painted as an active keyboard option. Arrow navigation keeps its focus.
			if (!this._listFocusIsKeyboard) { this._list?.setFocus([]); }
		}));

		// Footer, not first row: the picker is a list of models, and an action pinned above the
		// search box put the one thing nobody came for in the first place the eye lands on. Outside
		// `content` so it stays put while the models scroll.
		const footer = createOpenideElement(document, 'div');
		footer.className = 'openide-mp-foot';
		this._modelsFooter = footer;
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
		const observer = new (getWindow(container).ResizeObserver)(() => {
			if (this._view === 'models') { this._layoutList(); }
		});
		observer.observe(content);
		store.add(toDisposable(() => observer.disconnect()));
		store.add(addDisposableListener(getWindow(container), 'resize', () => {
			// A larger viewport raises the cap without resizing an already short list.
			this._popover.layout();
			this._layoutList();
		}));

		this._showView(this._view);
		this._paint();
		void this._load().catch(onUnexpectedError);
	}

	private _showView(view: 'summary' | 'models' | 'effort'): void {
		if (this._view === 'effort' && view !== 'effort') { this._effortStore.clear(); }
		this._view = view;
		if (view === 'models') {
			this._listFocusIsKeyboard = false;
			this._listHost?.classList.remove('openide-mp-keyboard-focus');
			this._list?.setFocus([]);
		}
		this._detail.disarm();
		for (const [element, visible] of [[this._summary, view === 'summary'], [this._modelsContent, view === 'models'], [this._modelsFooter, view === 'models'], [this._effortPanel, view === 'effort']] as const) {
			if (element) { element.hidden = !visible; element.inert = !visible; }
		}
		this._popover.container?.classList.toggle('openide-menu-model-compact', view !== 'models');
		this._paint();
		if (view === 'models') { this._searchInput?.focus(); }
		else if (view === 'summary') { this._summary?.querySelector('button')?.focus(); }
		this._popover.layout();
	}

	private _paintSummary(): void {
		const panel = this._summary;
		if (!panel) { return; }
		const providerId = this._activeOverride?.providerId ?? this.agentService.getActiveProviderId();
		const group = this._groups.find(group => group.id === providerId);
		const modelId = this._activeOverride?.modelId || this.agentService.getModel() || group?.defaultModel;
		const model = group?.models.find(model => model.id === modelId);
		if (group && model) { this._showEffort(group, model); return; }
		// The selected model is already known to the composer. Provider discovery is
		// only needed for the full list; a slow local provider must not delay this panel.
		const provider = !this.options.resolveActive ? this.agentService.findProvider(providerId) : undefined;
		const selectedId = modelId || provider?.defaultModel;
		if (provider && selectedId) {
			const selected = this.agentService.describeModel(providerId, selectedId);
			this._showEffort({ id: providerId, label: provider.label, defaultModel: provider.defaultModel || '', models: [selected] }, selected);
			return;
		}
		if (this._loaded) { this._showView('models'); return; }
		this._summaryStore.clear();
		const loading = createMenuEmpty(panel.ownerDocument, t('chatSurface.model.loading'));
		loading.setAttribute('role', 'status');
		panel.replaceChildren(loading);
	}

	/** The compact panel is the selector's entry point; its centre opens the same searchable list. */
	private _showEffort(group: IOpenidePickerGroup, model: IOpenidePickerModel): void {
		const panel = this._effortPanel;
		if (!panel) { return; }
		this._effortModel = { groupId: group.id, model };
		this._effortStore.clear(); panel.replaceChildren();
		const generation = ++this._effortGeneration;
		const document = panel.ownerDocument;
		const hasEffort = !!(model.efforts.length || model.toggle);
		const levels = availableReasoningEfforts({ efforts: model.efforts, toggle: model.toggle });
		const effort = this.agentService.getReasoningEffort(group.id, model.id);
		const selected = Math.max(0, levels.findIndex(([value]) => value === effort));
		const capability = this.agentService.getFastModeCapability(group.id, model.id);
		const fastMode = capability.supported && this.agentService.getFastMode(group.id, model.id);
		const iconButton = (icon: string, className: string, tooltip: string): HTMLButtonElement => {
			const button = createOpenideElement(document, 'button'); button.type = 'button'; button.className = `openide-mp-control ${className}`;
			button.append(createCodicon(document, icon)); button.setAttribute('aria-label', tooltip);
			if (this.options.hoverService) { this._effortStore.add(setupChatTooltip(this.options.hoverService, button, () => tooltip)); }
			return button;
		};
		const fast = iconButton('zap', 'openide-mp-fast', t(capability.supported ? 'chatSurface.fast.tip' : 'chatSurface.fast.unavailable'));
		fast.setAttribute('aria-pressed', String(fastMode)); fast.setAttribute('aria-disabled', String(!capability.supported));
		const reset = iconButton('discard', 'openide-mp-reset', t('chatSurface.effort.reset'));
		reset.disabled = !hasEffort || !effort;
		const heading = createOpenideElement(document, 'button'); heading.type = 'button';
		heading.className = 'openide-mp-model-toggle'; heading.setAttribute('aria-label', `${t('chatSurface.model.unset')}: ${model.name}`);
		const top = createOpenideElement(document, 'span'); top.className = 'openide-mp-model-top';
		const label = createOpenideElement(document, 'span'); label.className = 'openide-mp-effort-value';
		label.textContent = hasEffort ? t(levels[selected][1]) : t('chatSurface.model.unset');
		top.append(label, createCodicon(document, 'chevron-right'));
		const modelLabel = createOpenideElement(document, 'span'); modelLabel.className = 'openide-mp-effort-model'; modelLabel.textContent = model.name;
		heading.append(top, modelLabel);
		if (this.options.hoverService) { this._effortStore.add(setupChatTooltip(this.options.hoverService, heading, () => `${t('chatSurface.model.unset')}: ${model.name}`)); }
		this._effortStore.add(addDisposableListener(heading, 'click', () => this._showView('models')));
		const header = createOpenideElement(document, 'div'); header.className = 'openide-mp-effort-header'; header.append(fast, heading, reset);
		const track = createOpenideElement(document, 'div'); track.className = 'openide-mp-effort-track';
		panel.append(header); if (hasEffort) { panel.append(track); }
		this._showView('effort');
		let pending = false;
		let slider: OpenideChatEffortSlider | undefined;
		const syncSettings = (): void => {
			const currentFast = capability.supported && this.agentService.getFastMode(group.id, model.id);
			fast.setAttribute('aria-pressed', String(currentFast));
			slider?.setFastMode(currentFast);
			const currentEffort = this.agentService.getReasoningEffort(group.id, model.id);
			slider?.setSelected(Math.max(0, levels.findIndex(([value]) => value === currentEffort)));
			// Reset only the slider. Fast is an independent provider/billing preference.
			if ((!hasEffort || !currentEffort) && document.activeElement === reset) {
				(slider?.input ?? heading).focus({ preventScroll: true });
			}
			reset.disabled = !hasEffort || !currentEffort;
		};
		const update = async (apply: () => Promise<void>): Promise<void> => {
			if (pending) { return; }
			pending = true;
			fast.setAttribute('aria-disabled', 'true'); reset.setAttribute('aria-disabled', 'true');
			if (slider) { slider.input.disabled = true; }
			try {
				await apply(); this.onDidChangeSelection();
			} catch (error) { onUnexpectedError(error); }
			finally {
				pending = false;
				if (generation === this._effortGeneration && this._effortPanel === panel && this._view === 'effort') {
					fast.setAttribute('aria-disabled', String(!capability.supported)); reset.removeAttribute('aria-disabled');
					if (slider) { slider.input.disabled = false; }
					// Keep the clicked nodes alive while the native click bubbles to ContextView.
					// Replacing the panel here made Reset look like an outside click and dismissed it.
					syncSettings();
				}
			}
		};
		this._effortStore.add(addDisposableListener(fast, 'click', () => {
			if (capability.supported) { void update(() => this.agentService.setFastMode(!this.agentService.getFastMode(group.id, model.id), group.id, model.id)); }
		}));
		this._effortStore.add(addDisposableListener(reset, 'click', () => {
			if (hasEffort) { void update(() => this.agentService.setReasoningEffort('', group.id, model.id)); }
		}));
		if (hasEffort) {
			let swap: Animation | undefined;
			this._effortStore.add(toDisposable(() => swap?.cancel()));
			slider = this._effortStore.add(new OpenideChatEffortSlider(track, levels.map(level => t(level[1])), selected, t('chatSurface.effort.section'), !model.toggle && levels.length > 2, index => {
				const next = t(levels[index][1]);
				if (label.textContent !== next) {
					label.textContent = next;
					if (!getWindow(panel).matchMedia('(prefers-reduced-motion: reduce)').matches) {
						swap?.cancel(); swap = label.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 130, easing: 'ease-out' });
					}
				}
				header.classList.toggle('is-maximum', !model.toggle && levels.length > 2 && index === levels.length - 1);
			}, index => {
				void this.agentService.setReasoningEffort(levels[index][0], group.id, model.id).then(() => { this.onDidChangeSelection(); reset.disabled = !levels[index][0]; }, onUnexpectedError);
			}, hovering => header.classList.toggle('is-hovering', hovering)));
			slider.setFastMode(fastMode);
		}
		heading.focus();
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
		const current = this._view === 'effort' ? this._effortModel : undefined;
		const group = current && groups.find(group => group.id === current.groupId);
		const model = group?.models.find(model => model.id === current?.model.id);
		// A cold catalog may learn the model's supported levels after opening. Update
		// only changed metadata; ordinary discovery preserves the slider and focus.
		if (current && group && model && (model.name !== current.model.name || model.toggle !== current.model.toggle
			|| model.efforts.join(',') !== current.model.efforts.join(','))) {
			this._showEffort(group, model);
		}
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
		// One read for the whole list, for the same reason.
		const efforts = this.agentService.getReasoningEfforts();
		const byKey = new Map<string, { group: IOpenidePickerGroup; model: IOpenidePickerModel }>();
		for (const group of this._groups) {
			for (const model of group.models) { byKey.set(pickerKey(group.id, model.id), { group, model }); }
		}
		const entry = (group: IOpenidePickerGroup, model: IOpenidePickerModel): IModelEntryRow => ({
			kind: 'model', key: pickerKey(group.id, model.id), group, model,
			active: group.id === activeProvider && (activeModel ? model.id === activeModel : model.id === group.defaultModel),
			favorite: favorites.includes(pickerKey(group.id, model.id)),
			effort: efforts[pickerKey(group.id, model.id)] ?? '',
			// Read off the group the picker already loaded, not asked of the service per row: this
			// runs once for every model the user has connected — hundreds, on every keystroke in the
			// search box — and `findProvider` rebuilds the provider list on each call.
			editable: model.efforts.length > 0 || model.toggle,
		});
		const rows: ModelPickerRow[] = [];
		const pinned = (key: string, label: string, codicon: string, keys: readonly string[]): void => {
			const hits = keys.map(item => byKey.get(item)).filter((hit): hit is { group: IOpenidePickerGroup; model: IOpenidePickerModel } => !!hit && matches(hit.model, hit.group, query));
			if (!hits.length) { return; }
			rows.push({ kind: 'section', key, label, codicon, collapsed: collapsed.includes(key) });
			if (collapsed.includes(key)) { return; }
			for (const hit of hits) { rows.push(entry(hit.group, hit.model)); }
		};
		pinned('favorites', t('chatSurface.model.favorites'), 'star-full', favorites);
		pinned('recent', t('chatSurface.model.recents'), 'history', this.agentService.getPickerRecents());
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
		if (this._view !== 'models') {
			if (this._view === 'summary') { this._paintSummary(); }
			this._popover.layout();
			return;
		}
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
			const skeleton = createOpenideElement(empty.ownerDocument, 'div');
			skeleton.className = 'openide-mp-skeleton';
			for (let index = 0; index < 5; index++) {
				const row = createOpenideElement(empty.ownerDocument, 'div');
				row.className = 'openide-mp-skeleton-row';
				const icon = createOpenideElement(empty.ownerDocument, 'span');
				icon.className = 'openide-mp-skeleton-icon';
				const bar = createOpenideElement(empty.ownerDocument, 'span');
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
				? t('chatSurface.model.noResults')
				: t('chatSurface.model.noProviders')));
		}
		this._layoutList();
		this._popover.layout();
	}

	private _layoutList(): void {
		const list = this._list;
		const host = this._listHost;
		if (!list || !host || this._view !== 'models' || !this._loaded) { return; }
		const contentHeight = list.contentHeight;
		const height = Math.min(contentHeight, this._listBudget(host));
		host.style.height = `${height}px`;
		host.classList.toggle('openide-mp-scrolls', contentHeight > height);
		list.layout(height);
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
		const content = this._modelsContent;
		if (!content || !menu) { return Math.max(0, ceiling - 117); }
		const style = window.getComputedStyle(content);
		const border = window.getComputedStyle(menu);
		const pixels = (value: string): number => parseFloat(value) || 0;
		const outerHeight = (element: HTMLElement): number => {
			const computed = window.getComputedStyle(element);
			return computed.display === 'none' ? 0 : element.offsetHeight + pixels(computed.marginTop) + pixels(computed.marginBottom);
		};
		// A flex body may already be compressed by the card cap or an in-flight morph.
		// Subtracting the old list height from that body makes chrome negative, so every
		// repaint enlarges the list and hands scrolling to its parent. Measure only the
		// fixed siblings/insets; the previous viewport must never feed its own budget.
		const chrome = Array.from(content.children).reduce((height, child) => height + (child === host ? 0 : outerHeight(child as HTMLElement)), 0)
			+ pixels(style.paddingTop) + pixels(style.paddingBottom)
			+ pixels(style.borderTopWidth) + pixels(style.borderBottomWidth)
			+ pixels(style.marginTop) + pixels(style.marginBottom)
			+ (this._modelsFooter ? outerHeight(this._modelsFooter) : 0)
			+ pixels(border.paddingTop) + pixels(border.paddingBottom)
			+ pixels(border.borderTopWidth) + pixels(border.borderBottomWidth);
		return Math.max(0, ceiling - chrome);
	}

	/** ↑↓ move over MODEL rows only — stopping on a section header would make Enter a no-op. */
	private _onSearchKey(event: KeyboardEvent): void {
		if (event.isComposing) { return; }
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
			this._listFocusIsKeyboard = true;
			this._listHost?.classList.add('openide-mp-keyboard-focus');
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

	private _editEffort(row: IModelEntryRow, _anchor: HTMLElement): void {
		const host = this._popover.container;
		if (!host) { return; }
		this._detail.disarm();
		this._showEffort(row.group, row.model);
	}

	private _choose(row: IModelEntryRow): void {
		if (this._selectionPending) { return; }
		this._selectionPending = true;
		const generation = this._generation;
		this._popover.container?.setAttribute('aria-busy', 'true');
		this._effortStore.clear();
		if (this.options.choose) { this._popover.close(); }
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
			if (generation === this._generation && this._popover.isOpen) { this._showView('summary'); }
		})().catch(onUnexpectedError).finally(() => {
			this._selectionPending = false;
			this._popover.container?.setAttribute('aria-busy', 'false');
		});
	}
}
