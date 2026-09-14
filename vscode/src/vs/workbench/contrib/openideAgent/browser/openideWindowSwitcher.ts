/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import { t } from './../common/openideStrings.js';
import { $, append } from '../../../../base/browser/dom.js';
import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../base/common/actions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { setupChatTooltip } from './chat/openideChatHover.js';

/** Shared branded handoff, with keyboard parity and the workbench motion preference. */
export function renderOpenideWindowSwitcher(container: HTMLElement, label: string): void {
	container.classList.add('openide-window-switcher');
	container.setAttribute('aria-label', label);
	append(container, $('span.openide-window-switcher-icon', { 'aria-hidden': 'true' }));
	append(container, $('span.openide-window-switcher-label', undefined, label));
}

class WindowSwitcherAction extends BaseActionViewItem {
	constructor(action: IAction, options: IBaseActionViewItemOptions | undefined,
		@IHoverService private readonly hovers: IHoverService,
	) { super(undefined, action, options); }
	override render(container: HTMLElement): void {
		super.render(container);
		renderOpenideWindowSwitcher(container, t('openide.switch.agents'));
		container.setAttribute('role', 'button');
		this._register(setupChatTooltip(this.hovers, container, () => this.action.label, { position: HoverPosition.BELOW }));
	}
}

export class OpenideWindowSwitcherContribution extends Disposable {
	static readonly ID = 'openide.windowSwitcher';
	constructor(@IActionViewItemService actions: IActionViewItemService, @IInstantiationService instantiation: IInstantiationService) {
		super();
		this._register(actions.register(MenuId.TitleBar, 'openide.agent.openAgentWindow', (action, options) => instantiation.createInstance(WindowSwitcherAction, action, options), undefined));
	}
}
