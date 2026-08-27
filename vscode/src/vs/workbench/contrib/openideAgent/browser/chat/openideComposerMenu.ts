/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getDomNodePagePosition } from '../../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { AnchorPosition } from '../../../../../base/common/layout.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IContextViewService, IOpenContextView } from '../../../../../platform/contextview/browser/contextView.js';
import './media/openideChatMenus.css';

/**
 * Vertical gap between a composer trigger and its popover.
 *
 * The webview asks for it in CSS (`bottom: calc(100% + 8px)`), which the context view cannot
 * honour: it computes `top` itself from the anchor rect. Shifting the ANCHOR up by the same 8px
 * reproduces the gap without fighting the layout algorithm — a margin on our own container would
 * either collapse into `.context-view` or be counted as part of the measured height.
 */
const MENU_ANCHOR_GAP = 8;

/** `<span class="codicon codicon-x">`, the one shape every row in these menus is built from. */
export function createCodicon(document: Document, id: string, extraClass = ''): HTMLElement {
	const element = document.createElement('span');
	element.className = `codicon codicon-${id}${extraClass ? ` ${extraClass}` : ''}`;
	return element;
}

export function createMenuSection(document: Document, label: string): HTMLElement {
	const section = document.createElement('div');
	section.className = 'openide-menu-section';
	section.textContent = label;
	return section;
}

export function createMenuSeparator(document: Document): HTMLElement {
	const separator = document.createElement('div');
	separator.className = 'openide-menu-sep';
	return separator;
}

export function createMenuEmpty(document: Document, label: string): HTMLElement {
	const empty = document.createElement('div');
	empty.className = 'openide-menu-empty';
	empty.textContent = label;
	return empty;
}

export interface IMenuRowOptions {
	/** Codicon shown in the 21px icon slot. Omitted leaves the slot empty but present, which is
	 *  what keeps the labels of a checked and an unchecked row on the same x. */
	readonly icon?: string;
	readonly label: string;
	/** Right-aligned secondary text (the current value of a submenu row). */
	readonly detail?: string;
	readonly tooltip?: string;
	/** Chevron on the trailing edge: this row opens a submenu instead of choosing something. */
	readonly submenu?: boolean;
	readonly muted?: boolean;
}

/** A `.menu-row` of the webview, rebuilt as a real button so Enter/Space work without extra code. */
export function createMenuRow(document: Document, options: IMenuRowOptions): HTMLButtonElement {
	const row = document.createElement('button');
	row.type = 'button';
	row.className = `openide-menu-row${options.muted ? ' openide-menu-muted' : ''}`;
	const icon = document.createElement('span');
	icon.className = 'openide-menu-row-icon';
	if (options.icon) {
		icon.appendChild(createCodicon(document, options.icon));
	}
	row.appendChild(icon);
	const label = document.createElement('span');
	label.className = 'openide-menu-label';
	label.textContent = options.label;
	row.appendChild(label);
	if (options.detail !== undefined) {
		const detail = document.createElement('span');
		detail.className = 'openide-menu-detail';
		detail.textContent = options.detail;
		row.appendChild(detail);
	}
	if (options.submenu) {
		row.appendChild(createCodicon(document, 'chevron-right', 'openide-menu-submenu-chevron'));
	}
	if (options.tooltip) {
		row.title = options.tooltip;
	}
	return row;
}

export interface IComposerPopoverOptions {
	/** Extra class on the menu container; each picker uses it to pin its own min/max width. */
	readonly className?: string;
	readonly anchorAlignment?: AnchorAlignment;
	/** Defaults to ABOVE (the composer sits at the bottom); a title-bar anchor opens BELOW. */
	readonly anchorPosition?: AnchorPosition;
	/** Pins the menu width when no composer header sets `--openide-menu-anchor-width`. */
	readonly width?: number;
	/** Fills the menu. The returned store is disposed when the popover hides. */
	readonly render: (container: HTMLElement, store: DisposableStore) => void;
	readonly onHide?: () => void;
}

/**
 * Popover host for the composer's pickers.
 *
 * `IContextViewService` rather than an absolutely positioned child: the composer lives in the
 * right dock, whose ancestors clip and scroll, so a menu anchored inside it was cut off exactly
 * when it was tall enough to matter. The context view renders in the workbench overlay and flips
 * the menu when the space above runs out, which is the behaviour the webview only faked.
 */
export class OpenideComposerPopover extends Disposable {

	private _open: IOpenContextView | undefined;
	private _container: HTMLElement | undefined;

	constructor(private readonly contextViewService: IContextViewService) {
		super();
	}

	get isOpen(): boolean {
		return !!this._open;
	}

	/** The live menu container, so a picker can repaint its rows without reopening the popover. */
	get container(): HTMLElement | undefined {
		return this._container;
	}

	/** Toggles: clicking the trigger of an open menu has to close it, not stack a second one. */
	toggle(anchor: HTMLElement, options: IComposerPopoverOptions): void {
		if (this._open) {
			this.close();
			return;
		}
		this.show(anchor, options);
	}

	show(anchor: HTMLElement, options: IComposerPopoverOptions): void {
		this.close();
		this._open = this.contextViewService.showContextView({
			getAnchor: () => {
				const rect = getDomNodePagePosition(anchor);
				return { x: rect.left, y: rect.top - MENU_ANCHOR_GAP, width: rect.width, height: rect.height + MENU_ANCHOR_GAP };
			},
			anchorAlignment: options.anchorAlignment ?? AnchorAlignment.LEFT,
			anchorPosition: options.anchorPosition ?? AnchorPosition.ABOVE,
			// Without this the context view only dismisses on clicks OUTSIDE the whole workbench
			// (contextview.ts:283 tests the container, not the view), so the menu survived a click
			// on the transcript. The anchor is excluded so its own handler can toggle it shut.
			onDOMEvent: event => {
				if (event.type !== 'click') { return; }
				const target = event.target as HTMLElement | null;
				if (target && (this._container?.contains(target) || anchor.contains(target))) { return; }
				this.close();
			},
			render: container => this._render(container, options),
			onHide: () => {
				this._open = undefined;
				this._container = undefined;
				options.onHide?.();
			},
		});
	}

	private _render(container: HTMLElement, options: IComposerPopoverOptions): IDisposable {
		const store = new DisposableStore();
		container.classList.add('openide-menu');
		if (options.className) {
			container.classList.add(options.className);
		}
		if (options.width) {
			container.style.setProperty('--openide-menu-anchor-width', `${options.width}px`);
			store.add(toDisposable(() => container.style.removeProperty('--openide-menu-anchor-width')));
		}
		container.setAttribute('role', 'menu');
		// A click inside the menu bubbles to the context view's own dismiss handler; rows that
		// repaint the menu in place (favourites, submenus) would close it on their first press.
		store.add(addDisposableListener(container, 'mousedown', event => event.stopPropagation()));
		this._container = container;
		options.render(container, store);
		return store;
	}

	/** Re-anchors after the content grew (async model groups): the first layout measured a spinner. */
	layout(): void {
		if (this._open) {
			this.contextViewService.layout();
		}
	}

	close(): void {
		this._open?.close();
		this._open = undefined;
		this._container = undefined;
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}

/** `.menu-content`: the scrolling body every menu puts its rows into. */
export function createMenuContent(document: Document): HTMLElement {
	const content = document.createElement('div');
	content.className = 'openide-menu-content';
	return content;
}
