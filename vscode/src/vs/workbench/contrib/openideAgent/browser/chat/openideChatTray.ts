/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import './media/openideChatTray.css';

/** Shared presentation slots. Each owner keeps its own data, actions and lifetime. */
export interface IOpenideChatTray extends IDisposable {
	readonly domNode: HTMLElement;
	readonly head: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly label: HTMLElement;
	readonly chevron: HTMLElement;
	readonly body: HTMLElement;
	/** Includes collapses requested by a sibling, so the data owner can update its height/state. */
	readonly onDidChangeExpanded: Event<boolean>;
	setExpanded(expanded: boolean): void;
}

let trayId = 0;

export interface IOpenideChatTrayExpansion extends IDisposable {
	setExpanded(expanded: boolean): void;
}

/** A composer owns its immediate tray parent. Different chat panes never collapse each other. */
const expandedTrays = new WeakMap<HTMLElement, IOpenideChatTrayExpansion>();

/** Shares expansion with trays that have their own rendering, such as the durable GOAL view. */
export function registerChatTrayExpansion(parent: HTMLElement, changed: (expanded: boolean) => void): IOpenideChatTrayExpansion {
	let currentExpanded = false;
	let disposed = false;
	const registration: IOpenideChatTrayExpansion = {
		setExpanded: expanded => {
			if (disposed || currentExpanded === expanded) { return; }
			if (expanded) {
				const previous = expandedTrays.get(parent);
				if (previous !== registration) { previous?.setExpanded(false); }
				expandedTrays.set(parent, registration);
			} else if (expandedTrays.get(parent) === registration) {
				expandedTrays.delete(parent);
			}
			currentExpanded = expanded;
			changed(expanded);
		},
		dispose: () => {
			disposed = true;
			if (expandedTrays.get(parent) === registration) { expandedTrays.delete(parent); }
		},
	};
	return registration;
}

/** Composes the same accessible shell around queues, pending changes and live terminals. */
export function createChatTray(parent: HTMLElement, variant: 'queue' | 'files' | 'terms', icon: string): IOpenideChatTray {
	const domNode = append(parent, $(`section.openide-chat-tray.openide-chat-${variant}-tray.hidden`));
	const head = append(domNode, $(`div.openide-chat-tray-head.openide-chat-${variant}-head`));
	const toggle = append(head, $<HTMLButtonElement>(`button.oi-dock-action.openide-chat-tray-toggle.openide-chat-${variant}-toggle`, { type: 'button' }));
	append(toggle, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' }));
	const label = append(toggle, $(`span.openide-chat-tray-label.openide-chat-${variant}-count`));
	const chevron = append(toggle, $('span.openide-chat-tray-chevron.codicon.codicon-chevron-down', { 'aria-hidden': 'true' }));
	const reveal = append(domNode, $('div.openide-chat-tray-reveal'));
	const clip = append(reveal, $('div.openide-chat-tray-clip'));
	const body = append(clip, $(`div.openide-chat-tray-body.openide-chat-${variant}-body`, { id: `openide-tray-${++trayId}` }));
	toggle.setAttribute('aria-controls', body.id);
	const onDidChangeExpanded = new Emitter<boolean>();
	let disposed = false;
	const applyExpanded = (expanded: boolean): void => {
		domNode.classList.toggle('expanded', expanded);
		toggle.setAttribute('aria-expanded', String(expanded));
		// Queued work keeps its first request visible when folded. Other trays clip to zero,
		// while inert removes their controls from keyboard navigation immediately.
		body.inert = !expanded && variant !== 'queue';
		body.setAttribute('aria-hidden', String(body.inert));
		onDidChangeExpanded.fire(expanded);
	};
	const expansion = registerChatTrayExpansion(parent, applyExpanded);
	const tray: IOpenideChatTray = {
		domNode, head, toggle, label, chevron, body,
		setExpanded: expanded => expansion.setExpanded(expanded),
		onDidChangeExpanded: onDidChangeExpanded.event,
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			expansion.dispose();
			onDidChangeExpanded.dispose();
			domNode.remove();
		},
	};
	applyExpanded(false);
	return tray;
}
