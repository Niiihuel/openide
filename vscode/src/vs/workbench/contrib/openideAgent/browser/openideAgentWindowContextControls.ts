/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { isOpenideChatTextClipped, setupChatTooltip } from './chat/openideChatHover.js';

/** Shared native row geometry and hover behavior for all conversation-context sections. */
export function createContextRow(parent: HTMLElement, label: string, icon: string, action: () => void, store: DisposableStore, hoverService: IHoverService): HTMLButtonElement {
	const button = append(parent, $<HTMLButtonElement>('button.oi-btn.ghost.oi-dock-row.openide-agent-window-context-row', { type: 'button', 'aria-label': label }));
	append(button, $('span.codicon', { 'aria-hidden': 'true' })).classList.add(`codicon-${icon}`);
	const text = append(button, $('span.openide-agent-window-row-label', undefined, label));
	if (icon === 'add' || icon === 'folder') { store.add(setupChatTooltip(hoverService, button, () => button.getAttribute('aria-label') ?? label, { aria: false, position: HoverPosition.ABOVE })); }
	else { setupContextPreview(button, text, () => button.getAttribute('aria-label') ?? label, store, hoverService); }
	store.add(addDisposableListener(button, 'click', action));
	return button;
}

export function createContextSection(parent: HTMLElement, label: string, store: DisposableStore, hoverService: IHoverService, add?: () => void, addLabel = label): HTMLElement {
	const section = append(parent, $('section.openide-agent-window-context-section'));
	const header = append(section, $('.openide-agent-window-section-heading'));
	append(header, $('h2', undefined, label));
	if (add) {
		const button = append(header, $<HTMLButtonElement>('button.openide-chat-head-btn.oi-dock-action.openide-agent-window-section-add', { type: 'button' }));
		append(button, $('span.codicon.codicon-add', { 'aria-hidden': 'true' }));
		store.add(setupChatTooltip(hoverService, button, () => addLabel));
		store.add(addDisposableListener(button, 'click', add));
	}
	return append(section, $('.openide-agent-window-section-body'));
}

/** A single full-text preview target, shared by context rows and workspace tabs. */
export function setupContextPreview(target: HTMLElement, text: HTMLElement, label: () => string, store: DisposableStore, hoverService: IHoverService): void {
	store.add(setupChatTooltip(hoverService, target, () => {
		const full = label();
		const clipped = isOpenideChatTextClipped(text) || Array.from(text.querySelectorAll<HTMLElement>('.label-name')).some(isOpenideChatTextClipped);
		return clipped || (!target.classList.contains('openide-subagents-summary') && full !== text.textContent) ? full : '';
	}, { aria: false, position: HoverPosition.ABOVE }));
}
