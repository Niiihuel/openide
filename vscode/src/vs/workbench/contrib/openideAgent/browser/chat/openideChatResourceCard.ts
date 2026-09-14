/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener } from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { BaseMenuActionViewItem } from '../../../../../base/browser/ui/menu/menu.js';
import { IAction } from '../../../../../base/common/actions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { defaultButtonStyles, defaultMenuStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { t } from '../../common/openideStrings.js';
import { setupChatTooltip } from './openideChatHover.js';
import './media/openideChatResourceCard.css';

export interface IOpenideChatResourceCardOptions {
	readonly compact?: boolean;
	readonly title: string;
	readonly description: string;
	readonly icon: ThemeIcon;
	readonly open: () => void;
	readonly expand: () => void;
	readonly actions: readonly IAction[];
}

/** A reference to a resource. The owning native editor renders the resource itself. */
export class OpenideChatResourceCard extends Disposable {
	readonly domNode = $('div.openide-chat-resource-card');
	constructor(options: IOpenideChatResourceCardOptions, hover: IHoverService, menus: IContextMenuService) {
		super();
		if (options.compact) {
			this.domNode.classList.add('openide-chat-resource-compact');
			const split = append(this.domNode, $('span.oi-split.oi-split-secondary'));
			const open = append(split, $('button.oi-split-main', { type: 'button', 'aria-label': `${t('chatSurface.resource.open')}: ${options.title}` }));
			open.textContent = t('chatSurface.resource.open');
			this._register(addDisposableListener(open, 'click', options.open));
			this._register(setupChatTooltip(hover, open, () => `${options.title}\n${options.description}`));
			const more = append(split, $('button.oi-split-more', { type: 'button', 'aria-label': t('chatSurface.resource.openIn'), 'aria-haspopup': 'menu', 'aria-expanded': 'false' }));
			append(more, $('span.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
			this._register(addDisposableListener(more, 'click', () => {
				more.setAttribute('aria-expanded', 'true');
				menus.showContextMenu({
					getAnchor: () => more,
					getActions: () => [...options.actions],
					getActionViewItem: action => new BaseMenuActionViewItem(undefined, action, { icon: true, label: true }, defaultMenuStyles),
					domForShadowRoot: this.domNode,
					useWindowContainerForShadowRoot: true,
					onHide: cancelled => { more.setAttribute('aria-expanded', 'false'); if (cancelled && !this._store.isDisposed) { more.focus(); } },
				});
			}));
			return;
		}
		const primary = this._register(new Button(this.domNode, { ...defaultButtonStyles, secondary: true, buttonSecondaryBorder: 'transparent', buttonSecondaryBackground: 'transparent', buttonSecondaryHoverBackground: 'var(--vscode-toolbar-hoverBackground)' }));
		primary.element.classList.add('openide-chat-resource-open');
		primary.setAriaLabel(`${options.title}: ${options.description}`);
		const icon = append(primary.element, $('span.openide-chat-resource-icon'));
		icon.classList.add(...ThemeIcon.asClassNameArray(options.icon));
		icon.setAttribute('aria-hidden', 'true');
		const text = append(primary.element, $('span.openide-chat-resource-text'));
		append(text, $('span.openide-chat-resource-title')).textContent = options.title;
		append(text, $('span.openide-chat-resource-description')).textContent = options.description;
		this._register(primary.onDidClick(options.open));
		this._register(setupChatTooltip(hover, primary.element, () => options.description));

		const full = this._register(new Button(this.domNode, { ...defaultButtonStyles, secondary: true, supportIcons: true }));
		full.element.classList.add('openide-chat-resource-full');
		full.icon = Codicon.screenFull;
		this._register(setupChatTooltip(hover, full.element, () => t('chatSurface.resource.full')));
		this._register(full.onDidClick(options.expand));

		const menu = this._register(new Button(this.domNode, { ...defaultButtonStyles, secondary: true, supportIcons: true }));
		menu.element.classList.add('openide-chat-resource-menu');
		menu.label = `${t('chatSurface.resource.openIn')} $(chevron-down)`;
		menu.element.setAttribute('aria-haspopup', 'menu');
		menu.element.setAttribute('aria-expanded', 'false');
		this._register(menu.onDidClick(() => {
			menu.element.setAttribute('aria-expanded', 'true');
			menus.showContextMenu({
				getAnchor: () => menu.element,
				getActions: () => [...options.actions],
				getActionViewItem: action => new BaseMenuActionViewItem(undefined, action, { icon: true, label: true }, defaultMenuStyles),
				domForShadowRoot: this.domNode,
				useWindowContainerForShadowRoot: true,
				onHide: cancelled => { menu.element.setAttribute('aria-expanded', 'false'); if (cancelled && !this._store.isDisposed) { menu.focus(); } },
			});
		}));
	}
}
