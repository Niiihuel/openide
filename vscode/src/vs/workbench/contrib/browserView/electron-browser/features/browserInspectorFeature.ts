/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType, getWindow } from '../../../../../base/browser/dom.js';
import { PixelRatio } from '../../../../../base/browser/pixelRatio.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Color, HSLA, RGBA } from '../../../../../base/common/color.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Orientation, Sash, SashState } from '../../../../../base/browser/ui/sash/sash.js';
import { SelectBox } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IElementData } from '../../../../../platform/browserView/common/browserView.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { defaultSelectBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IColorPresentation } from '../../../../../editor/common/languages.js';
import { ColorPickerModel } from '../../../../../editor/contrib/colorPicker/browser/colorPickerModel.js';
import { ColorPickerWidgetType } from '../../../../../editor/contrib/colorPicker/browser/colorPickerParticipantUtils.js';
import { ColorPickerWidget } from '../../../../../editor/contrib/colorPicker/browser/colorPickerWidget.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { openideProductIconCodepoints } from '../../../../common/openideProductIcons.js';
import { BrowserElementSelectionPurpose, IBrowserViewModel } from '../../common/browserView.js';
import { BrowserEditor, BrowserEditorContribution, CONTEXT_BROWSER_HAS_ERROR, CONTEXT_BROWSER_HAS_URL } from '../browserEditor.js';
import { BROWSER_EDITOR_ACTIVE, BrowserActionCategory } from '../browserViewActions.js';
import { BrowserResizableSidePanel } from './browserResizableSidePanel.js';

const CONTEXT_BROWSER_INSPECTOR_VISIBLE = new RawContextKey<boolean>('browserCssInspectorVisible', false, localize('browser.cssInspectorVisible', "Whether the CSS inspector is visible"));
const CONTEXT_BROWSER_INSPECTOR_SELECTING = new RawContextKey<boolean>('browserCssInspectorSelecting', false, localize('browser.cssInspectorSelecting', "Whether the CSS inspector is selecting an element"));
const browserCssInspectorIcon = registerIcon('browser-css-inspector', Codicon.symbolColor, localize('browser.cssInspector.icon', "Icon for the integrated browser CSS inspector"));
const browserCssLayoutPickerIcon = registerIcon(
	'browser-css-layout-picker',
	{ fontCharacter: String.fromCodePoint(openideProductIconCodepoints['browser-css-layout-picker']) },
	localize('browser.cssInspector.layoutPickerIcon', "Icon for selecting an element to edit its layout and CSS")
);

const designGroups: ReadonlyArray<readonly [string, readonly string[]]> = [
	[localize('browser.cssInspector.position', "Position & Size"), ['position', 'left', 'top', 'right', 'bottom', 'z-index', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height']],
	[localize('browser.cssInspector.layout', "Layout"), ['display', 'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'justify-content', 'align-items', 'align-content', 'gap', 'grid-template-columns', 'overflow']],
	[localize('browser.cssInspector.spacing', "Spacing"), ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']],
	[localize('browser.cssInspector.typography', "Typography"), ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'color']],
	[localize('browser.cssInspector.appearance', "Appearance"), ['background', 'background-color', 'border', 'border-color', 'border-radius', 'box-shadow', 'opacity', 'visibility']],
];

const cssGlobalValues = ['inherit', 'initial', 'revert', 'revert-layer', 'unset'];
const propertyOptions: Readonly<Record<string, readonly string[]>> = {
	position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
	display: ['none', 'block', 'inline', 'inline-block', 'flow-root', 'flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'table-row', 'table-cell', 'list-item', 'contents'],
	'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
	'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
	'justify-content': ['normal', 'start', 'end', 'center', 'flex-start', 'flex-end', 'left', 'right', 'space-between', 'space-around', 'space-evenly', 'stretch'],
	'align-items': ['normal', 'stretch', 'start', 'end', 'center', 'flex-start', 'flex-end', 'self-start', 'self-end', 'baseline'],
	'align-content': ['normal', 'start', 'end', 'center', 'flex-start', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'stretch', 'baseline'],
	overflow: ['visible', 'hidden', 'clip', 'scroll', 'auto'],
	'text-align': ['start', 'end', 'left', 'right', 'center', 'justify', 'match-parent'],
	'font-weight': ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold', 'lighter', 'bolder'],
	visibility: ['visible', 'hidden', 'collapse'],
};

/** CSS properties that always expose a color picker control. */
const colorProperties = new Set([
	'color',
	'background-color',
	'border-color',
	'border-top-color',
	'border-right-color',
	'border-bottom-color',
	'border-left-color',
	'outline-color',
	'text-decoration-color',
	'text-emphasis-color',
	'caret-color',
	'column-rule-color',
	'accent-color',
	'fill',
	'stroke',
	'stop-color',
	'flood-color',
	'lighting-color',
]);

const colorValuePattern = /#(?:[0-9a-fA-F]{3,8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/i;
/** Modern CSS Color 4 syntax: rgb(0 0 0 / 50%) */
const modernRgbPattern = /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i;
const modernHslPattern = /^hsla?\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?\s*\)$/i;

function isColorProperty(property: string): boolean {
	return colorProperties.has(property) || property.endsWith('-color');
}

function parseAlphaToken(token: string | undefined): number {
	if (token === undefined) {
		return 1;
	}
	if (token.endsWith('%')) {
		return Math.max(0, Math.min(1, parseFloat(token) / 100));
	}
	return Math.max(0, Math.min(1, parseFloat(token)));
}

function tryParseCssColor(value: string): Color | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const lower = trimmed.toLowerCase();
	if (cssGlobalValues.includes(lower) || lower === 'none' || lower === 'currentcolor') {
		return null;
	}
	try {
		const direct = Color.Format.CSS.parse(lower);
		if (direct) {
			return direct;
		}
	} catch {
		// Fall through for modern / embedded color syntax.
	}

	const rgbModern = lower.match(modernRgbPattern);
	if (rgbModern) {
		return new Color(new RGBA(
			Math.round(parseFloat(rgbModern[1])),
			Math.round(parseFloat(rgbModern[2])),
			Math.round(parseFloat(rgbModern[3])),
			parseAlphaToken(rgbModern[4]),
		));
	}
	const hslModern = lower.match(modernHslPattern);
	if (hslModern) {
		return new Color(new HSLA(
			parseFloat(hslModern[1]),
			parseFloat(hslModern[2]) / 100,
			parseFloat(hslModern[3]) / 100,
			parseAlphaToken(hslModern[4]),
		));
	}

	// background / box-shadow style values: extract the first color token
	const match = trimmed.match(colorValuePattern);
	if (!match) {
		return null;
	}
	try {
		return Color.Format.CSS.parse(match[0].toLowerCase());
	} catch {
		return null;
	}
}

function colorPresentationsFor(color: Color): IColorPresentation[] {
	return [
		{ label: Color.Format.CSS.formatHexA(color, true) },
		{ label: Color.Format.CSS.formatRGB(color) },
		{ label: Color.Format.CSS.formatHSL(color) },
	];
}

function shouldUseColorControl(property: string, value: string): boolean {
	return isColorProperty(property) || tryParseCssColor(value) !== null;
}

function iconButton(icon: ThemeIcon, title: string): HTMLButtonElement {
	const button = $<HTMLButtonElement>('button.browser-inspector-icon-button');
	button.type = 'button';
	button.title = title;
	button.ariaLabel = title;
	const iconElement = $('span');
	iconElement.className = ThemeIcon.asClassName(icon);
	button.appendChild(iconElement);
	return button;
}

function elementLabel(tagName: string, id?: string, classNames?: readonly string[]): string {
	return `${tagName}${id ? `#${id}` : ''}${classNames?.length ? `.${classNames.join('.')}` : ''}`;
}

export class BrowserCssInspectorContribution extends BrowserEditorContribution {
	private readonly panel: BrowserResizableSidePanel;
	private readonly selectingContext: IContextKey<boolean>;
	private readonly visibleContext: IContextKey<boolean>;
	private readonly components = $('.browser-inspector-components');
	private readonly componentsTree = $('.browser-inspector-components-tree');
	private readonly body = $('.browser-inspector-body');
	private readonly componentsScroll: DomScrollableElement;
	private readonly bodyScroll: DomScrollableElement;
	private readonly horizontalSash: Sash;
	private readonly renderStore = this._register(new DisposableStore());
	private componentsHeight: number;
	private sashStartHeight = 0;
	private readonly designContent = $('.browser-inspector-tab-content.browser-inspector-design');
	private readonly cssContent = $('.browser-inspector-tab-content.browser-inspector-css');
	private readonly emptyContent = $('.browser-inspector-empty');
	private readonly status = $('.browser-inspector-status');
	private readonly selectButton: HTMLButtonElement;
	private selectedTab: 'design' | 'css' = 'design';
	private data: IElementData | undefined;
	private model: IBrowserViewModel | undefined;
	private applying = false;
	private colorPickerOpen = false;
	private suppressColorPickerResync = false;
	private liveStyleQueue: Promise<void> = Promise.resolve();
	private pendingLiveStyle: { property: string; value: string } | undefined;
	/** Design tokens de color del proyecto (custom properties --* que resuelven a color),
	 *  cacheados por página. Alimentan los swatches del picker y se invalidan al navegar. */
	private colorTokens: { name: string; value: string }[] | undefined;
	private colorTokensUrl: string | undefined;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IStorageService storageService: IStorageService,
	) {
		super(editor);
		this.panel = this._register(new BrowserResizableSidePanel(editor, 'browser-inspector-panel', 'browser.cssInspector.width', 400, storageService, 300));
		this.visibleContext = CONTEXT_BROWSER_INSPECTOR_VISIBLE.bindTo(contextKeyService);
		this.selectingContext = CONTEXT_BROWSER_INSPECTOR_SELECTING.bindTo(contextKeyService);
		this.componentsHeight = storageService.getNumber('browser.cssInspector.componentsHeight', StorageScope.PROFILE, 220);

		const header = $('.browser-inspector-header');
		const heading = $('strong');
		heading.textContent = localize('browser.cssInspector.title', "CSS Inspector");
		const headerActions = $('.browser-inspector-header-actions');
		this.selectButton = iconButton(browserCssLayoutPickerIcon, localize('browser.cssInspector.select', "Select element to edit CSS"));
		const closeButton = iconButton(Codicon.close, localize('browser.cssInspector.close', "Close CSS inspector"));
		headerActions.append(this.selectButton, closeButton);
		header.append(heading, headerActions);

		const componentsHeading = $('h2');
		componentsHeading.textContent = localize('browser.cssInspector.components', "Components");
		this.componentsScroll = this._register(new DomScrollableElement(this.componentsTree, { useShadows: false }));
		this.componentsScroll.getDomNode().classList.add('browser-inspector-components-scroll');
		this.components.append(componentsHeading, this.componentsScroll.getDomNode());
		this.applyComponentsHeight();

		this.emptyContent.textContent = localize('browser.cssInspector.instructions', "Select an element in the page to inspect and edit its layout and CSS.");
		const tabs = $('.browser-inspector-tabs');
		const designTab = $<HTMLButtonElement>('button.browser-inspector-tab.active');
		designTab.type = 'button';
		designTab.textContent = localize('browser.cssInspector.design', "Design");
		const cssTab = $<HTMLButtonElement>('button.browser-inspector-tab');
		cssTab.type = 'button';
		cssTab.textContent = 'CSS';
		tabs.append(designTab, cssTab);

		this.body.append(this.emptyContent, this.designContent, this.cssContent);
		this.bodyScroll = this._register(new DomScrollableElement(this.body, { useShadows: false }));
		this.bodyScroll.getDomNode().classList.add('browser-inspector-body-scroll');
		this.panel.element.append(header, this.components, tabs, this.bodyScroll.getDomNode(), this.status);

		this.horizontalSash = this._register(new Sash(this.panel.element, {
			getHorizontalSashTop: () => this.components.offsetTop + this.components.offsetHeight,
			getHorizontalSashLeft: () => 0,
			getHorizontalSashWidth: () => this.panel.element.clientWidth,
		}, { orientation: Orientation.HORIZONTAL, size: 4 }));
		this.horizontalSash.state = SashState.Enabled;
		this._register(this.horizontalSash.onDidStart(() => this.sashStartHeight = this.componentsHeight));
		this._register(this.horizontalSash.onDidChange(event => {
			this.componentsHeight = this.clampComponentsHeight(this.sashStartHeight + event.currentY - event.startY);
			this.applyComponentsHeight();
			this.layoutScrollbars();
		}));
		this._register(this.horizontalSash.onDidEnd(() => storageService.store('browser.cssInspector.componentsHeight', this.componentsHeight, StorageScope.PROFILE, StorageTarget.USER)));
		this._register(this.horizontalSash.onDidReset(() => {
			this.componentsHeight = 220;
			this.applyComponentsHeight();
			this.layoutScrollbars();
			storageService.store('browser.cssInspector.componentsHeight', this.componentsHeight, StorageScope.PROFILE, StorageTarget.USER);
		}));

		this._register(addDisposableListener(this.selectButton, EventType.CLICK, () => this.selectElement()));
		this._register(addDisposableListener(closeButton, EventType.CLICK, () => this.closeInspector()));
		this._register(addDisposableListener(designTab, EventType.CLICK, () => {
			this.selectedTab = 'design';
			designTab.classList.add('active');
			cssTab.classList.remove('active');
			this.render();
		}));
		this._register(addDisposableListener(cssTab, EventType.CLICK, () => {
			this.selectedTab = 'css';
			cssTab.classList.add('active');
			designTab.classList.remove('active');
			this.render();
		}));
	}

	override get sidePanelElements(): readonly HTMLElement[] { return [this.panel.element]; }

	override layout(_width: number): void {
		this.componentsHeight = this.clampComponentsHeight(this.componentsHeight);
		this.applyComponentsHeight();
		this.layoutScrollbars();
	}

	protected override subscribeToModel(model: IBrowserViewModel, store: DisposableStore): void {
		this.model = model;
		this.updateSelecting(model);
		store.add(model.onDidChangeElementSelectionActive(() => this.updateSelecting(model)));
		store.add(model.onDidNavigate(() => {
			this.data = undefined;
			this.colorTokens = undefined;
			this.colorTokensUrl = undefined;
			this.render();
		}));
		store.add(model.onDidSelectElement(data => {
			if (model.elementSelectionPurpose !== BrowserElementSelectionPurpose.Inspector) {
				return;
			}
			this.data = data;
			this.setVisible(true);
			this.render();
		}));
	}

	override clear(): void {
		this.model = undefined;
		this.data = undefined;
		this.selectingContext.reset();
		this.render();
	}

	toggleVisible(): void {
		const visible = !this.panel.visible;
		this.setVisible(visible);
		const model = this.editor.model;
		if (!model) {
			return;
		}
		if (visible) {
			this.editor.ensureBrowserFocus();
			void model.toggleElementSelection(true, BrowserElementSelectionPurpose.Inspector);
		} else if (model.isElementSelectionActive && model.elementSelectionPurpose === BrowserElementSelectionPurpose.Inspector) {
			void model.toggleElementSelection(false, BrowserElementSelectionPurpose.Inspector);
		}
	}

	setVisible(visible: boolean): void {
		this.panel.setVisible(visible);
		this.visibleContext.set(visible);
		if (visible) {
			this.editor.window.requestAnimationFrame(() => this.layout(0));
		}
	}

	selectElement(): void {
		const model = this.editor.model;
		if (!model) {
			return;
		}
		this.setVisible(true);
		this.editor.ensureBrowserFocus();
		void model.toggleElementSelection(undefined, BrowserElementSelectionPurpose.Inspector);
	}

	private updateSelecting(model: IBrowserViewModel): void {
		const selecting = model.isElementSelectionActive && model.elementSelectionPurpose === BrowserElementSelectionPurpose.Inspector;
		this.selectButton.classList.toggle('active', selecting);
		this.selectButton.ariaPressed = String(selecting);
		this.selectingContext.set(selecting);
	}

	private render(): void {
		if (this.colorPickerOpen) {
			this.suppressColorPickerResync = true;
			this.contextViewService.hideContextView();
			this.suppressColorPickerResync = false;
			this.colorPickerOpen = false;
		}
		this.renderStore.clear();
		this.componentsTree.textContent = '';
		this.designContent.textContent = '';
		this.cssContent.textContent = '';
		this.emptyContent.classList.toggle('hidden', !!this.data);
		this.designContent.classList.toggle('hidden', !this.data || this.selectedTab !== 'design');
		this.cssContent.classList.toggle('hidden', !this.data || this.selectedTab !== 'css');
		if (!this.data) {
			this.layoutScrollbars();
			return;
		}

		this.renderComponents();
		if (this.selectedTab === 'design') {
			this.renderDesign();
		} else {
			this.renderCss();
		}
		this.editor.window.requestAnimationFrame(() => this.layoutScrollbars());
	}

	private renderComponents(): void {
		const ancestors = this.data?.ancestors ?? [];
		for (const [index, ancestor] of ancestors.entries()) {
			const row = $('.browser-inspector-component-row');
			row.style.paddingLeft = `${10 + index * 16}px`;
			if (index < ancestors.length - 1) {
				const branch = $('span');
				branch.className = ThemeIcon.asClassName(Codicon.chevronRight);
				row.appendChild(branch);
			} else {
				row.classList.add('selected');
				const marker = $('span');
				marker.className = ThemeIcon.asClassName(Codicon.symbolProperty);
				row.appendChild(marker);
			}
			const label = $('span.browser-inspector-component-label');
			label.textContent = elementLabel(ancestor.tagName, ancestor.id, ancestor.classNames);
			row.appendChild(label);
			this.componentsTree.appendChild(row);
		}
	}

	private renderDesign(): void {
		const styles = this.data?.allComputedStyles ?? this.data?.computedStyles ?? {};
		for (const [label, properties] of designGroups) {
			const section = $('.browser-inspector-section');
			const heading = $('h3');
			heading.textContent = label;
			const grid = $('.browser-inspector-control-grid');
			for (const property of properties) {
				grid.appendChild(this.createEditableProperty(property, styles[property] ?? ''));
			}
			section.append(heading, grid);
			this.designContent.appendChild(section);
		}
	}

	private renderCss(): void {
		const toolbar = $('.browser-inspector-css-toolbar');
		const propertyInput = $<HTMLInputElement>('input.browser-inspector-css-name');
		propertyInput.placeholder = localize('browser.cssInspector.propertyName', "property");
		const valueInput = $<HTMLInputElement>('input.browser-inspector-css-value');
		valueInput.placeholder = localize('browser.cssInspector.propertyValue', "value");
		const addButton = $<HTMLButtonElement>('button.browser-inspector-add-property');
		addButton.type = 'button';
		addButton.textContent = localize('browser.cssInspector.apply', "Apply");
		const applyNewProperty = () => {
			const property = propertyInput.value.trim();
			if (property) {
				void this.applyStyle(property, valueInput.value.trim());
			}
		};
		addButton.addEventListener('click', applyNewProperty);
		valueInput.addEventListener('keydown', event => {
			if (event.key === 'Enter') { applyNewProperty(); }
		});
		toolbar.append(propertyInput, valueInput, addButton);

		const filter = $<HTMLInputElement>('input.browser-inspector-css-filter');
		filter.placeholder = localize('browser.cssInspector.filter', "Filter computed properties");
		const properties = $('.browser-inspector-all-properties');
		const renderRows = () => {
			properties.textContent = '';
			const query = filter.value.trim().toLowerCase();
			const styles = this.data?.allComputedStyles ?? this.data?.computedStyles ?? {};
			for (const property of Object.keys(styles).sort()) {
				if (query && !property.includes(query) && !styles[property].toLowerCase().includes(query)) {
					continue;
				}
				properties.appendChild(this.createEditableProperty(property, styles[property], true));
			}
		};
		filter.addEventListener('input', renderRows);
		this.cssContent.append(toolbar, filter, properties);
		renderRows();
	}

	private createEditableProperty(property: string, value: string, compact = false): HTMLElement {
		const row = $('.browser-inspector-editable-property');
		row.classList.toggle('compact', compact);
		const label = $('label');
		label.textContent = property;
		label.title = property;
		const options = !compact ? propertyOptions[property] : undefined;
		if (options) {
			const values = [...new Set([...options, ...cssGlobalValues])];
			if (value && !values.includes(value)) {
				values.unshift(value);
			}
			const selectedIndex = Math.max(0, values.indexOf(value));
			const select = this.renderStore.add(new SelectBox(
				values.map(text => ({ text })),
				selectedIndex,
				this.contextViewService,
				defaultSelectBoxStyles,
				{ useCustomDrawn: true, ariaLabel: property, optionsAsChildren: true }
			));
			const control = $('.browser-inspector-select-control');
			select.render(control);
			this.renderStore.add(select.onDidSelect(event => void this.applyStyle(property, event.selected)));
			row.append(label, control);
		} else if (shouldUseColorControl(property, value)) {
			row.append(label, this.createColorControl(property, value));
		} else {
			const input = $<HTMLInputElement>('input');
			input.value = value;
			input.spellcheck = false;
			input.ariaLabel = property;
			const commit = () => {
				if (input.value !== value) {
					void this.applyStyle(property, input.value.trim());
				}
			};
			input.addEventListener('change', commit);
			input.addEventListener('keydown', event => {
				if (event.key === 'Enter') {
					commit();
					input.blur();
				}
			});
			row.append(label, input);
		}
		return row;
	}

	private createColorControl(property: string, value: string): HTMLElement {
		const control = $('.browser-inspector-color-control');
		const swatch = $<HTMLButtonElement>('button.browser-inspector-color-swatch');
		swatch.type = 'button';
		swatch.title = localize('browser.cssInspector.pickColor', "Pick color");
		swatch.ariaLabel = localize('browser.cssInspector.pickColorFor', "Pick color for {0}", property);

		const input = $<HTMLInputElement>('input.browser-inspector-color-input');
		input.value = value;
		input.spellcheck = false;
		input.ariaLabel = property;

		const updateSwatch = (cssValue: string) => {
			const parsed = tryParseCssColor(cssValue) ?? (isColorProperty(property) ? Color.transparent : null);
			if (parsed) {
				swatch.style.setProperty('--browser-inspector-swatch-color', Color.Format.CSS.format(parsed) || 'transparent');
				swatch.classList.toggle('empty', parsed.rgba.a === 0);
			} else {
				swatch.style.setProperty('--browser-inspector-swatch-color', 'transparent');
				swatch.classList.add('empty');
			}
		};
		updateSwatch(value);

		const commitInput = () => {
			const next = input.value.trim();
			if (next !== value) {
				void this.applyStyle(property, next);
			}
		};
		input.addEventListener('change', commitInput);
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				commitInput();
				input.blur();
			}
		});
		input.addEventListener('input', () => updateSwatch(input.value));

		const open = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openColorPicker(property, input, swatch, updateSwatch);
		};
		swatch.addEventListener('click', open);
		// El campo es el disparador PRIMARIO del picker (no el swatch chico): al click abre el
		// ColorPickerWidget, que ya trae su propio campo de texto con switch hex/rgb/hsl. Así el
		// color deja de vivirse como "un textbox" y el picker es lo primero que aparece.
		input.addEventListener('click', open);

		control.append(swatch, input);
		return control;
	}

	private openColorPicker(
		property: string,
		input: HTMLInputElement,
		swatch: HTMLElement,
		updateSwatch: (cssValue: string) => void,
	): void {
		const initial = tryParseCssColor(input.value) ?? Color.black;
		const model = new ColorPickerModel(initial, colorPresentationsFor(initial), 0);
		model.guessColorPresentation(initial, input.value.trim() || Color.Format.CSS.formatHexA(initial, true));

		const applyColorToUi = (color: Color) => {
			model.colorPresentations = colorPresentationsFor(color);
			const label = model.presentation?.label || Color.Format.CSS.format(color) || '';
			input.value = label;
			updateSwatch(label);
			return label;
		};

		this.colorPickerOpen = true;
		this.contextViewService.showContextView({
			getAnchor: () => swatch,
			render: (container) => {
				const store = new DisposableStore();
				const wrapper = $('.browser-inspector-color-picker');
				container.appendChild(wrapper);

				const pixelRatio = PixelRatio.getInstance(getWindow(wrapper)).value;
				const widget = store.add(new ColorPickerWidget(
					wrapper,
					model,
					pixelRatio,
					this.themeService,
					ColorPickerWidgetType.Hover,
				));
				widget.layout();

				this.appendColorPickerFooter(wrapper, store, model, property, input, applyColorToUi);

				store.add(model.onDidChangeColor(color => {
					const label = applyColorToUi(color);
					this.queueLiveStyle(property, label);
				}));
				store.add(model.onDidChangePresentation(() => {
					const label = model.presentation?.label || input.value;
					input.value = label;
					updateSwatch(label);
					this.queueLiveStyle(property, label);
				}));
				store.add(model.onColorFlushed(color => {
					const label = applyColorToUi(color);
					this.queueLiveStyle(property, label);
				}));
				store.add(toDisposable(() => {
					this.colorPickerOpen = false;
				}));
				return store;
			},
			onHide: () => {
				this.colorPickerOpen = false;
				if (this.suppressColorPickerResync) {
					return;
				}
				// Finish any in-flight live previews, then resync the panel.
				void this.liveStyleQueue.then(() => {
					if (this.data) {
						this.render();
					}
				});
			},
		}, this.panel.element);
	}

	/** Footer del picker: contraste de legibilidad, copiar, eyedropper y swatches de tokens
	 *  del proyecto. Vive en el mismo DisposableStore que el widget, así se limpia al cerrar. */
	private appendColorPickerFooter(
		wrapper: HTMLElement,
		store: DisposableStore,
		model: ColorPickerModel,
		property: string,
		input: HTMLInputElement,
		applyColorToUi: (color: Color) => string,
	): void {
		const footer = $('.browser-inspector-color-picker-footer');

		// Contraste de legibilidad: texto vs fondo del elemento (o fondo vs texto si editás el
		// background). Sin un fondo resuelto (transparente) no se muestra: un número falso sería
		// peor que no decir nada.
		const styles = this.data?.allComputedStyles ?? this.data?.computedStyles;
		const fixedFg = property === 'background-color' ? tryParseCssColor(styles?.['color'] ?? '') : null;
		const fixedBg = property === 'color' ? tryParseCssColor(styles?.['background-color'] ?? '') : null;
		const showContrast = (property === 'color' && fixedBg !== null && fixedBg.rgba.a > 0)
			|| (property === 'background-color' && fixedFg !== null);
		if (showContrast) {
			const badge = $('.browser-inspector-contrast');
			const render = () => {
				const f = property === 'color' ? model.color : fixedFg!;
				const b = property === 'background-color' ? model.color : fixedBg!;
				const ratio = f.getContrastRatio(b);
				badge.textContent = localize('browser.cssInspector.contrast', "Contrast {0}  AA {1}  AAA {2}", ratio.toFixed(2), ratio >= 4.5 ? '✓' : '✗', ratio >= 7 ? '✓' : '✗');
				badge.classList.toggle('ok', ratio >= 4.5);
				badge.classList.toggle('fail', ratio < 4.5);
			};
			render();
			store.add(model.onDidChangeColor(render));
			footer.appendChild(badge);
		}

		// Acciones: copiar el valor actual y, si la API existe, eyedropper desde la pantalla.
		const actions = $('.browser-inspector-color-picker-actions');
		const copyBtn = iconButton(Codicon.copy, localize('browser.cssInspector.copyColor', "Copy color"));
		copyBtn.classList.add('browser-inspector-footer-btn');
		store.add(addDisposableListener(copyBtn, EventType.CLICK, () => {
			const label = model.presentation?.label || Color.Format.CSS.format(model.color) || '';
			void this.clipboardService.writeText(label);
		}));
		actions.appendChild(copyBtn);

		const win = this.editor.window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } };
		if (typeof win.EyeDropper === 'function') {
			const dropBtn = iconButton(Codicon.eye, localize('browser.cssInspector.eyeDropper', "Pick color from screen"));
			dropBtn.classList.add('browser-inspector-footer-btn');
			store.add(addDisposableListener(dropBtn, EventType.CLICK, async () => {
				try {
					const res = await new win.EyeDropper!().open();
					const parsed = Color.Format.CSS.parse(res.sRGBHex);
					if (parsed) {
						// El setter dispara onDidChangeColor: actualiza UI, swatch y preview en vivo.
						model.color = parsed;
					}
				} catch {
					/* el usuario canceló el eyedropper */
				}
			}));
			actions.appendChild(dropBtn);
		}
		footer.appendChild(actions);

		// Tokens de color del proyecto: swatches para saltar a un valor de la paleta.
		const tokensRow = $('.browser-inspector-color-tokens');
		footer.appendChild(tokensRow);
		void this.getColorTokens().then(tokens => {
			if (tokensRow.childElementCount > 0) {
				return;
			}
			for (const token of tokens.slice(0, 24)) {
				const parsed = tryParseCssColor(token.value);
				if (!parsed) {
					continue;
				}
				const sw = $<HTMLButtonElement>('button.browser-inspector-token-swatch');
				sw.type = 'button';
				sw.title = `${token.name} · ${Color.Format.CSS.format(parsed)}`;
				sw.style.setProperty('--browser-inspector-swatch-color', Color.Format.CSS.format(parsed) || token.value);
				store.add(addDisposableListener(sw, EventType.CLICK, () => {
					const label = applyColorToUi(parsed);
					this.queueLiveStyle(property, label);
				}));
				tokensRow.appendChild(sw);
			}
			if (tokensRow.childElementCount === 0) {
				footer.removeChild(tokensRow);
			}
		});

		wrapper.appendChild(footer);
	}

	/** Custom properties --* de :root que resuelven a color. Cacheado por URL de página. */
	private async getColorTokens(): Promise<{ name: string; value: string }[]> {
		const model = this.model;
		const url = this.data?.url;
		if (!model || !url) {
			return [];
		}
		if (this.colorTokensUrl === url && this.colorTokens) {
			return this.colorTokens;
		}
		try {
			const result = await model.evaluateJavaScript(`(() => {
				const cs = getComputedStyle(document.documentElement);
				const probe = document.createElement('span');
				probe.style.cssText = 'display:none';
				(document.body || document.documentElement).appendChild(probe);
				const out = [];
				for (let i = 0; i < cs.length; i++) {
					const p = cs[i];
					if (p.indexOf('--') !== 0) { continue; }
					const raw = cs.getPropertyValue(p).trim();
					if (!raw) { continue; }
					// Un numero pelado o una medida nunca es un color de la paleta, pero el motor
					// acepta algunos por compatibilidad: color:1000 resuelve a #001000.
					if (/^[\\d.]+(px|em|rem|%|s|ms|vh|vw|vmin|vmax|deg|fr)?$/i.test(raw)) { continue; }
					// Dos centinelas: si el motor RECHAZA el valor, el color queda en el centinela y
					// asi se distingue "lo acepto" de "lo ignoro". Con color='' no se podia: un valor
					// invalido dejaba el color HEREDADO, que tambien matchea rgb(...), y cada token
					// que no era color entraba a la paleta como un swatch del color del texto. Son
					// dos por si un token vale exactamente igual que el primero.
					let resolved = '';
					let isColor = true;
					for (const sentinel of ['rgb(1, 2, 3)', 'rgb(4, 5, 6)']) {
						probe.style.color = sentinel;
						probe.style.color = raw;
						const current = getComputedStyle(probe).color;
						if (current === sentinel) { isColor = false; break; }
						resolved = current;
					}
					if (isColor && /^rgba?\\(/.test(resolved)) { out.push({ name: p, value: resolved }); }
				}
				probe.remove();
				return JSON.stringify(out);
			})()`);
			const value = (result as { value?: unknown } | undefined)?.value;
			const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
			this.colorTokens = Array.isArray(parsed)
				? parsed.filter((t): t is { name: string; value: string } => !!t && typeof (t as { name?: unknown }).name === 'string' && typeof (t as { value?: unknown }).value === 'string')
				: [];
			this.colorTokensUrl = url;
			return this.colorTokens;
		} catch {
			return [];
		}
	}

	private queueLiveStyle(property: string, value: string): void {
		this.pendingLiveStyle = { property, value };
		this.liveStyleQueue = this.liveStyleQueue.then(async () => {
			while (this.pendingLiveStyle) {
				const next = this.pendingLiveStyle;
				this.pendingLiveStyle = undefined;
				await this.applyStyle(next.property, next.value, { rerender: false, silent: true });
			}
		}, () => { /* keep queue alive after errors */ });
	}

	private closeInspector(): void {
		this.contextViewService.hideContextView();
		this.setVisible(false);
		const model = this.editor.model;
		if (model?.isElementSelectionActive && model.elementSelectionPurpose === BrowserElementSelectionPurpose.Inspector) {
			void model.toggleElementSelection(false, BrowserElementSelectionPurpose.Inspector);
		}
	}

	private clampComponentsHeight(height: number): number {
		const available = this.panel.element.clientHeight || this.editor.window.innerHeight;
		return Math.round(Math.max(110, Math.min(height, Math.max(110, available - 260))));
	}

	private applyComponentsHeight(): void {
		this.components.style.height = `${this.componentsHeight}px`;
		this.components.style.flex = `0 0 ${this.componentsHeight}px`;
		this.horizontalSash?.layout();
	}

	private layoutScrollbars(): void {
		this.horizontalSash?.layout();
		this.componentsScroll?.scanDomNode();
		this.bodyScroll?.scanDomNode();
	}

	private async applyStyle(property: string, value: string, options: { rerender?: boolean; silent?: boolean } = {}): Promise<void> {
		const elementId = this.data?.elementId;
		const model = this.model;
		if (!elementId || !model) {
			return;
		}
		// Non-silent edits (selects / text) still serialize with the applying flag.
		// Silent live color previews are serialized by `liveStyleQueue` instead.
		if (!options.silent) {
			if (this.applying) {
				return;
			}
			this.applying = true;
			this.status.textContent = localize('browser.cssInspector.applying', "Applying {0}…", property);
			this.status.classList.remove('error');
		}

		const rerender = options.rerender !== false && !this.colorPickerOpen;
		try {
			this.data = await model.setElementStyle(elementId, property, value);
			if (!options.silent) {
				this.status.textContent = localize('browser.cssInspector.applied', "Applied {0}", property);
			}
			if (rerender) {
				this.render();
			}
		} catch (error) {
			this.status.textContent = error instanceof Error ? error.message : String(error);
			this.status.classList.add('error');
		} finally {
			if (!options.silent) {
				this.applying = false;
			}
		}
	}
}

BrowserEditor.registerContribution(BrowserCssInspectorContribution);

class SelectElementForInspectorAction extends Action2 {
	static readonly ID = 'workbench.action.browser.selectElementForInspector';
	constructor() {
			super({
			id: SelectElementForInspectorAction.ID,
			title: localize2('browser.selectElementForInspector', 'Select Element'),
			category: BrowserActionCategory,
			icon: browserCssLayoutPickerIcon,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL, CONTEXT_BROWSER_HAS_ERROR.negate()),
			toggled: CONTEXT_BROWSER_INSPECTOR_SELECTING,
		});
	}
	run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): void {
		if (browserEditor instanceof BrowserEditor) {
			browserEditor.getContribution(BrowserCssInspectorContribution)?.selectElement();
		}
	}
}

class ToggleCssInspectorAction extends Action2 {
	static readonly ID = 'workbench.action.browser.toggleCssInspector';
	constructor() {
		super({
			id: ToggleCssInspectorAction.ID,
			title: localize2('browser.toggleCssInspector', 'Toggle CSS Inspector'),
			category: BrowserActionCategory,
			icon: browserCssInspectorIcon,
			f1: true,
			precondition: BROWSER_EDITOR_ACTIVE,
			toggled: CONTEXT_BROWSER_INSPECTOR_VISIBLE,
			menu: { id: MenuId.BrowserActionsToolbar, group: 'actions', order: 4 }
		});
	}
	run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): void {
		if (browserEditor instanceof BrowserEditor) {
			browserEditor.getContribution(BrowserCssInspectorContribution)?.toggleVisible();
		}
	}
}

registerAction2(SelectElementForInspectorAction);
registerAction2(ToggleCssInspectorAction);
