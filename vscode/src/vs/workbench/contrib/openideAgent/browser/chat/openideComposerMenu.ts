/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getDomNodePagePosition, getWindow } from '../../../../../base/browser/dom.js';
import { AnchorAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { AnchorPosition } from '../../../../../base/common/layout.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IContextViewService, IOpenContextView } from '../../../../../platform/contextview/browser/contextView.js';
import { createOpenideElement } from '../openideDom.js';
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

/** Reserve a real side of the trigger, then give ContextView a preference that actually fits.
 * Its general ABOVE policy can overlap the anchor when more than half a menu fits above, even
 * with enough room below. Composer menus must always preserve the trigger and its gap instead.
 */
export function updateMenuPlacement(container: HTMLElement, anchor: HTMLElement, preferredPosition: AnchorPosition): AnchorPosition {
	const rect = anchor.getBoundingClientRect();
	const above = Math.max(0, rect.top - MENU_ANCHOR_GAP - 12);
	const below = Math.max(0, getWindow(anchor).innerHeight - rect.bottom - MENU_ANCHOR_GAP - 12);
	const available = `${Math.floor(Math.max(above, below))}px`;
	if (container.style.getPropertyValue('--openide-menu-available-height') !== available) {
		container.style.setProperty('--openide-menu-available-height', available);
	}
	// offsetHeight is unaffected by entrance/morph transforms. Read after applying the cap so a
	// long scrolling list chooses the side on which its actual border box will be rendered.
	const height = container.offsetHeight;
	if (preferredPosition === AnchorPosition.ABOVE && height <= above) { return AnchorPosition.ABOVE; }
	if (preferredPosition === AnchorPosition.BELOW && height <= below) { return AnchorPosition.BELOW; }
	return below > above ? AnchorPosition.BELOW : AnchorPosition.ABOVE;
}

/** Class that plays the 90ms entrance (openideChatMenus.css). Shared with `OpenideChatMenuPopover`. */
export const MENU_ENTER_CLASS = 'openide-menu-enter';

/** `<span class="codicon codicon-x">`, the one shape every row in these menus is built from. */
export function createCodicon(document: Document, id: string, extraClass = ''): HTMLElement {
	const element = createOpenideElement(document, 'span');
	element.className = `codicon codicon-${id}${extraClass ? ` ${extraClass}` : ''}`;
	return element;
}

export function createMenuSection(document: Document, label: string): HTMLElement {
	const section = createOpenideElement(document, 'div');
	section.className = 'openide-menu-section';
	section.textContent = label;
	return section;
}

export function createMenuSeparator(document: Document): HTMLElement {
	const separator = createOpenideElement(document, 'div');
	separator.className = 'openide-menu-sep';
	return separator;
}

export function createMenuEmpty(document: Document, label: string): HTMLElement {
	const empty = createOpenideElement(document, 'div');
	empty.className = 'openide-menu-empty';
	empty.textContent = label;
	return empty;
}

/** The trailing check of a row. Always present; CSS shows it only while the row is `.openide-menu-active`. */
export function createMenuCheck(document: Document): HTMLElement {
	const check = createOpenideElement(document, 'span');
	check.className = 'openide-menu-check';
	check.appendChild(createCodicon(document, 'check'));
	return check;
}

export interface IMenuRowOptions {
	/** Codicon shown in the 18px icon slot. Omitted leaves the slot empty but present, which is
	 *  what keeps the labels of a checked and an unchecked row on the same x. */
	readonly icon?: string;
	readonly label: string;
	/** Right-aligned secondary text (the current value of a submenu row). */
	readonly detail?: string;
	/** Right-aligned keybinding hint, rendered after `detail` (e.g. "Ctrl+↵"). */
	readonly keybinding?: string;
	readonly tooltip?: string;
	/** Chevron on the trailing edge: this row opens a submenu instead of choosing something. */
	readonly submenu?: boolean;
	readonly muted?: boolean;
	/** The row holding the CURRENT value. Marked by the trailing check only — never by a tint, so
	 *  the hover fill stays the one fill in the menu and always reads as the strongest signal. */
	readonly active?: boolean;
}

/** A `.menu-row` of the webview, rebuilt as a real button so Enter/Space work without extra code. */
export function createMenuRow(document: Document, options: IMenuRowOptions): HTMLButtonElement {
	const row = createOpenideElement(document, 'button');
	row.type = 'button';
	row.className = `openide-menu-row${options.muted ? ' openide-menu-muted' : ''}${options.active ? ' openide-menu-active' : ''}`;
	const icon = createOpenideElement(document, 'span');
	icon.className = 'openide-menu-row-icon';
	if (options.icon) {
		icon.appendChild(createCodicon(document, options.icon));
	}
	row.appendChild(icon);
	const label = createOpenideElement(document, 'span');
	label.className = 'openide-menu-label';
	label.textContent = options.label;
	row.appendChild(label);
	if (options.detail !== undefined) {
		const detail = createOpenideElement(document, 'span');
		detail.className = 'openide-menu-detail';
		detail.textContent = options.detail;
		row.appendChild(detail);
	}
	if (options.keybinding) {
		const keybinding = createOpenideElement(document, 'span');
		keybinding.className = 'openide-menu-keybinding';
		keybinding.textContent = options.keybinding;
		row.appendChild(keybinding);
	}
	if (options.submenu) {
		row.appendChild(createCodicon(document, 'chevron-right', 'openide-menu-submenu-chevron'));
	}
	// Appended last and on every row, so a caller that toggles `.openide-menu-active` later
	// (repaint in place) gets the mark without rebuilding the row.
	row.appendChild(createMenuCheck(document));
	if (options.tooltip) {
		row.title = options.tooltip;
	}
	return row;
}

export interface IComposerPopoverOptions {
	/** Extra class on the menu container; each picker uses it to pin its own min/max width. */
	readonly className?: string;
	/** Browser views need the overlay inside their native-view host. */
	readonly container?: HTMLElement;
	readonly role?: 'menu' | 'dialog';
	readonly anchorAlignment?: AnchorAlignment;
	/** Defaults to ABOVE (the composer sits at the bottom); a title-bar anchor opens BELOW. */
	readonly anchorPosition?: AnchorPosition;
	/** Pins the menu width when no composer header sets `--openide-menu-anchor-width`. */
	readonly width?: number;
	/** Overrides the default first-row focus. Autocomplete keeps the textarea focused so the
	 *  character that opened it can be followed by more query text without a second click. */
	readonly initialFocus?: () => void;
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
		anchor.setAttribute('aria-expanded', 'true');
		const preferredPosition = options.anchorPosition ?? AnchorPosition.ABOVE;
		let position = preferredPosition;
		this._open = this.contextViewService.showContextView({
			getAnchor: () => {
				const rect = getDomNodePagePosition(anchor);
				if (this._container) { position = updateMenuPlacement(this._container, anchor, preferredPosition); }
				// Grown on BOTH edges: the context view lays the menu flush against the anchor box, and
				// the gap has to be there whether it opens above (composer) or below (Build, Settings).
				return { x: rect.left, y: rect.top - MENU_ANCHOR_GAP, width: rect.width, height: rect.height + MENU_ANCHOR_GAP * 2 };
			},
			anchorAlignment: options.anchorAlignment ?? AnchorAlignment.LEFT,
			get anchorPosition() { return position; },
			// Without this the context view only dismisses on clicks OUTSIDE the whole workbench
			// (contextview.ts:283 tests the container, not the view), so the menu survived a click
			// on the transcript. The anchor is excluded so its own handler can toggle it shut.
			onDOMEvent: event => {
				if (event.type === 'keydown' && (event as KeyboardEvent).isComposing) { return; }
				if (event.type === 'keydown' && !event.defaultPrevented && this._container?.contains(event.target as Node)) {
					const keyboard = event as KeyboardEvent;
					const target = event.target as HTMLElement;
					if (!target.matches('input, textarea, [contenteditable=true]') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(keyboard.key)) {
						const rows = this._focusableRows();
						const index = rows.indexOf(target as HTMLButtonElement);
						const next = keyboard.key === 'Home' ? 0 : keyboard.key === 'End' ? rows.length - 1 : (index + (keyboard.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
						if (rows[next]) { keyboard.preventDefault(); rows[next].focus({ preventScroll: true }); rows[next].scrollIntoView({ block: 'nearest' }); }
					}
				}
				if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') {
					event.preventDefault();
					this.close();
					anchor.focus();
					return;
				}
				if (event.type !== 'click') { return; }
				const target = event.target as HTMLElement | null;
				if (target && (this._container?.contains(target) || anchor.contains(target))) { return; }
				this.close();
			},
			render: container => {
				updateMenuPlacement(container, anchor, preferredPosition);
				const store = new DisposableStore();
				store.add(this._render(container, options));
				store.add(addDisposableListener(container.ownerDocument, 'focusin', event => {
					const target = event.target as Node | null;
					if (target && !container.contains(target) && !anchor.contains(target)) { this.close(); }
				}));
				return store;
			},
			focus: () => {
				if (options.initialFocus) {
					options.initialFocus();
					return;
				}
				if (!this._container?.contains(this._container.ownerDocument.activeElement)) { this._focusableRows()[0]?.focus({ preventScroll: true }); }
			},
			onHide: () => {
				anchor.setAttribute('aria-expanded', 'false');
				this._open = undefined;
				this._container = undefined;
				options.onHide?.();
			},
		}, options.container ?? anchor.closest<HTMLElement>('.monaco-workbench') ?? anchor.ownerDocument.body);
		// The entrance animation goes on AFTER showContextView returned: the context view renders,
		// measures and places the menu synchronously inside that call, and a fixed-position view
		// (aux windows) measures the view's own rect — which the animation's translate would shift.
		// Same task, so nothing has painted yet and the first frame is still the transparent one.
		this._container?.classList.add(MENU_ENTER_CLASS);
	}

	private _focusableRows(): HTMLButtonElement[] {
		return Array.from(this._container?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).filter(button => !button.closest('[hidden], [inert]') && button.getClientRects().length > 0);
	}

	private _render(container: HTMLElement, options: IComposerPopoverOptions): IDisposable {
		const store = new DisposableStore();
		store.add(toDisposable(() => container.style.removeProperty('--openide-menu-available-height')));
		container.classList.add('openide-menu');
		if (options.className) {
			container.classList.add(options.className);
		}
		if (options.width) {
			container.style.setProperty('--openide-menu-anchor-width', `${options.width}px`);
			store.add(toDisposable(() => container.style.removeProperty('--openide-menu-anchor-width')));
		}
		container.setAttribute('role', options.role ?? 'menu');
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
			// A relayout inside the 90ms of the entrance would measure a translated view (see
			// `show`); dropping the class ends the animation before the measurement.
			this._container?.classList.remove(MENU_ENTER_CLASS);
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
	const content = createOpenideElement(document, 'div');
	content.className = 'openide-menu-content';
	return content;
}
