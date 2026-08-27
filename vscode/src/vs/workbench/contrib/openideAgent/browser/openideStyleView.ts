/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the visual style editor: what Pick & Polish should have been on the user's side.
 *
 *  Picking an element already worked; what it produced was a STRING of computed styles addressed to
 *  the model. Everything the user wanted to change therefore went: describe it in prose → the agent
 *  writes a CSS string → an approval dialog → `browser_set_style`. That is a long way around for
 *  "make this padding 4px bigger", and it puts a language model between a person and a number.
 *
 *  This view takes the other half back. The picked element's computed styles are parsed into a map
 *  (`common/openideStyleModel.ts`), rendered as real controls (`openideStyleControls.ts`) and
 *  applied to the live preview DIRECTLY, because the user manipulating their own UI is not an
 *  action that needs an agent's permission. The agent keeps the job only it can do: carrying the
 *  result into the source, which is what the "Take to the source" button hands it — with the exact
 *  CSS already decided, instead of a description of an intention.
 *
 *  What is applied live is the DIFF, never the whole computed set: pinning forty properties the
 *  user never touched would stop the element inheriting and make the change unreadable later.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IBrowserPickResult, IOpenideBrowserAutomation, OPENIDE_BROWSER_AUTOMATION_CHANNEL } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import {
	IStylePropertyDef,
	OPENIDE_STYLE_GROUPS,
	parseComputedStyles,
	stylePropertiesOf,
	styleDiffCss,
} from '../common/openideStyleModel.js';
import { createStyleControl, IStyleControl } from './openideStyleControls.js';
import { IOpenideAgentService } from './openideAgentService.js';
import { OpenideStringKey, t } from '../common/openideStrings.js';
import './media/openideStyleView.css';

export const OPENIDE_STYLE_VIEW_ID = 'workbench.view.openideStyles';

/** Live application is debounced: a dragged slider fires per pixel, and each one is an IPC round trip. */
const APPLY_DEBOUNCE_MS = 90;

export class OpenideStyleView extends ViewPane {

	private root: HTMLElement | undefined;
	private panel: HTMLElement | undefined;
	private scrollable: DomScrollableElement | undefined;
	private summary: HTMLElement | undefined;
	private readonly renderStore = this._register(new DisposableStore());
	private readonly applyTimer = this._register(new MutableDisposable());

	private readonly automation: IOpenideBrowserAutomation;
	private pick: IBrowserPickResult | undefined;
	/** What the element looked like when it was picked; the baseline every diff is taken against. */
	private original = new Map<string, string>();
	private edited = new Map<string, string>();
	private readonly controls = new Map<string, IStyleControl>();
	/** The "changed" dot of each property, so the summary can refresh them without a DOM query. */
	private readonly dots = new Map<string, HTMLElement>();
	private collapsed = new Set<string>();

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService storageService: IStorageService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IOpenideAgentService private readonly agentService: IOpenideAgentService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.automation = ProxyChannel.toService<IOpenideBrowserAutomation>(mainProcessService.getChannel(OPENIDE_BROWSER_AUTOMATION_CHANNEL));
		this._register(this.agentService.onDidPickElement(result => this.onPick(result)));
	}

	/** Nothing picked = the workbench's own welcome view, same as every other empty view. */
	override shouldShowWelcome(): boolean {
		return !this.pick;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.root = append(container, $('.openide-style-view'));
		this.panel = $('.openide-style-body');
		this.scrollable = this._register(new DomScrollableElement(this.panel, { vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Hidden, useShadows: false }));
		this.scrollable.getDomNode().classList.add('openide-style-scroll');
		append(this.root, this.scrollable.getDomNode());
		// `renderBody` runs while the pane is still detached from the document, so the first paint
		// has to wait for it to become visible (see openideCliChangesView.ts for the full story).
		this._register(this.onDidChangeBodyVisibility(visible => { if (visible) { this.paint(); } }));
		this.paint();
	}

	private onPick(result: IBrowserPickResult): void {
		this.pick = result;
		this.original = parseComputedStyles(result.styles);
		this.edited = new Map(this.original);
		// The welcome view is standing where the editor goes until this fires.
		this._onDidChangeViewWelcomeState.fire();
		this.paint();
	}

	private paint(): void {
		const body = this.panel;
		if (!body?.isConnected || !this.pick) { return; }
		this.renderStore.clear();
		this.controls.clear();
		this.dots.clear();
		clearNode(body);

		const header = append(body, $('.openide-style-header'));
		append(header, $('span.codicon.codicon-inspect'));
		const selector = append(header, $('span.openide-style-selector'));
		selector.textContent = this.pick.selector;
		selector.title = `${this.pick.selector}\n${this.pick.pageUrl}`;

		const actions = append(body, $('.openide-style-actions'));
		this.summary = append(actions, $('span.openide-style-summary'));
		const reset = append(actions, $('button.openide-style-btn', { type: 'button', title: t('style.reset') }, t('style.reset'))) as HTMLButtonElement;
		this.renderStore.add(addDisposableListener(reset, 'click', () => this.resetAll()));
		const toSource = append(actions, $('button.openide-style-btn.primary', { type: 'button', title: t('style.toSourceTip') }, t('style.toSource'))) as HTMLButtonElement;
		this.renderStore.add(addDisposableListener(toSource, 'click', () => this.takeToSource()));

		append(body, $('.openide-style-note', undefined, t('style.live')));

		for (const group of OPENIDE_STYLE_GROUPS) {
			this.renderGroup(body, group.id, group.labelKey, group.icon);
		}
		this.renderSummary();
		this.scrollable?.scanDomNode();
	}

	private renderGroup(parent: HTMLElement, id: string, labelKey: string, iconId: string): void {
		const section = append(parent, $('.openide-style-group'));
		const isCollapsed = this.collapsed.has(id);
		section.classList.toggle('collapsed', isCollapsed);
		const head = append(section, $('.openide-style-group-head', { role: 'button', tabindex: '0' }));
		head.setAttribute('aria-expanded', String(!isCollapsed));
		append(head, $(`span.codicon.codicon-${iconId}`));
		append(head, $('span.openide-style-group-title', undefined, t(labelKey as OpenideStringKey)));
		append(head, $(`span.openide-style-twistie.codicon.${ThemeIcon.asClassName(isCollapsed ? Codicon.chevronRight : Codicon.chevronDown).replace(/ /g, '.')}`));
		const toggle = () => {
			if (this.collapsed.has(id)) { this.collapsed.delete(id); } else { this.collapsed.add(id); }
			this.paint();
		};
		this.renderStore.add(addDisposableListener(head, 'click', toggle));
		this.renderStore.add(addDisposableListener(head, 'keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
		}));
		if (isCollapsed) { return; }

		const rows = append(section, $('.openide-style-rows'));
		// Properties that belong to one shorthand (the four paddings) render as ONE row of four
		// controls: that is the box model as people picture it, not four unrelated fields.
		const boxes = new Map<string, IStylePropertyDef[]>();
		for (const property of stylePropertiesOf(id as never)) {
			if (property.box) {
				const bucket = boxes.get(property.box) ?? [];
				bucket.push(property);
				boxes.set(property.box, bucket);
				continue;
			}
			this.renderRow(rows, property);
		}
		for (const [box, properties] of boxes) {
			this.renderBoxRow(rows, box, properties);
		}
	}

	private renderRow(parent: HTMLElement, property: IStylePropertyDef): void {
		const row = append(parent, $('.openide-style-row'));
		const label = append(row, $('label.openide-style-label', undefined, t(property.labelKey as OpenideStringKey)));
		label.title = property.id;
		row.appendChild(this.buildControl(property));
		this.renderResetDot(row, property.id);
	}

	private renderBoxRow(parent: HTMLElement, box: string, properties: readonly IStylePropertyDef[]): void {
		const row = append(parent, $('.openide-style-row.openide-style-box'));
		append(row, $('label.openide-style-label', undefined, t(`style.box.${box}` as OpenideStringKey)));
		const grid = append(row, $('.openide-style-box-grid'));
		for (const property of properties) {
			const cell = append(grid, $('.openide-style-box-cell'));
			const side = append(cell, $('span.openide-style-side', undefined, t(property.labelKey as OpenideStringKey)));
			side.title = property.id;
			cell.appendChild(this.buildControl(property));
		}
	}

	private buildControl(property: IStylePropertyDef): HTMLElement {
		const control = this.renderStore.add(createStyleControl(property));
		control.setValue(this.edited.get(property.id) ?? '');
		this.renderStore.add(control.onDidChange(value => this.onEdit(property.id, value)));
		this.controls.set(property.id, control);
		return control.element;
	}

	/** A dot next to a property the user changed, which also puts that one property back. */
	private renderResetDot(row: HTMLElement, id: string): void {
		const changed = (this.edited.get(id) ?? '') !== (this.original.get(id) ?? '');
		const dot = append(row, $('button.openide-style-dot', { type: 'button', title: t('style.resetOne') }));
		dot.classList.toggle('changed', changed);
		this.dots.set(id, dot);
		this.renderStore.add(addDisposableListener(dot, 'click', () => {
			const before = this.original.get(id) ?? '';
			this.edited.set(id, before);
			this.controls.get(id)?.setValue(before);
			dot.classList.remove('changed');
			this.scheduleApply();
			this.renderSummary();
		}));
	}

	private onEdit(id: string, value: string): void {
		this.edited.set(id, value);
		this.scheduleApply();
		this.renderSummary();
	}

	private renderSummary(): void {
		if (!this.summary) { return; }
		const count = styleDiffCss(this.original, this.edited).split(';').filter(part => part.trim()).length;
		this.summary.textContent = count === 0 ? t('style.noEdits') : count === 1 ? t('style.edits.one') : t('style.edits', count);
		this.summary.classList.toggle('dirty', count > 0);
		// Held by id rather than found by selector: a control can change the state of a property it
		// does not own (a unit switch rewrites the value), so every dot is re-checked, and looking
		// them up through the DOM would tie this to the row markup.
		for (const [id, dot] of this.dots) {
			dot.classList.toggle('changed', (this.edited.get(id) ?? '') !== (this.original.get(id) ?? ''));
		}
	}

	private scheduleApply(): void {
		const handle = setTimeout(() => void this.applyLive(), APPLY_DEBOUNCE_MS);
		this.applyTimer.value = toDisposable(() => clearTimeout(handle));
	}

	private async applyLive(): Promise<void> {
		if (!this.pick) { return; }
		const css = styleDiffCss(this.original, this.edited);
		if (!css) { return; }
		try {
			const result = await this.automation.setStyle(this.pick.selector, css);
			if (!result.ok) {
				this.notificationService.warn(t('style.applyFailed', result.error));
			}
		} catch (error) {
			this.notificationService.warn(t('style.applyFailed', error instanceof Error ? error.message : String(error)));
		}
	}

	private resetAll(): void {
		if (!this.pick) { return; }
		this.edited = new Map(this.original);
		for (const [id, control] of this.controls) {
			control.setValue(this.original.get(id) ?? '');
		}
		// Put the element back in the preview too: a reset that only clears the panel would leave the
		// page wearing edits the UI says are gone.
		const revert = [...this.original].map(([property, value]) => `${property}: ${value}`).join('; ');
		void this.automation.setStyle(this.pick.selector, revert).catch(() => undefined);
		this.renderSummary();
	}

	/**
	 * Hands the agent the finished CSS instead of a description of it. This is the one step that
	 * genuinely needs a model: finding which component in the source paints this element.
	 */
	private takeToSource(): void {
		if (!this.pick) { return; }
		const css = styleDiffCss(this.original, this.edited);
		if (!css) {
			this.notificationService.info(t('style.noEdits'));
			return;
		}
		const declarations = css.split(';').map(part => part.trim()).filter(Boolean).join(';\n  ') + ';';
		void this.commandService.executeCommand('openide.agent.injectPrompt', t('style.sourcePrompt', this.pick.selector, this.pick.pageUrl, declarations));
	}

	override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.root) {
			this.root.style.height = `${height}px`;
		}
		this.scrollable?.scanDomNode();
	}
}
