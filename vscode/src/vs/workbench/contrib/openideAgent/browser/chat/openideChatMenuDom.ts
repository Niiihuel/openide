/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getDomNodePagePosition, isHTMLElement } from '../../../../../base/browser/dom.js';
import { AnchorAlignment, IAnchor } from '../../../../../base/browser/ui/contextview/contextview.js';
import { AnchorPosition } from '../../../../../base/common/layout.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IContextViewService, IOpenContextView } from '../../../../../platform/contextview/browser/contextView.js';
import './media/openideChatMenus.css';

/**
 * Building blocks shared by the header's two popovers. They emit the SAME `.openide-menu-*` class
 * family the composer's pickers use: both transcribe one `.menu` block of the webview, so a second
 * copy of that surface would be a second place to keep in sync with it. The webview draws them as absolutely
 * positioned children of `#header`; on native DOM they are context views, so the geometry the
 * webview expresses in CSS (`top: calc(100% + 4px); left: 6px; right: 6px`) has to be handed to
 * the layout algorithm as an anchor rect instead.
 */

/** Gap between the header's bottom edge and the popover — the webview's `calc(100% + 4px)`. */
const MENU_GAP = 4;

export function menuIcon(name: string): HTMLElement {
	return $(`span.codicon.codicon-${name}`);
}

export function menuSection(label: string): HTMLElement {
	const element = $('div.openide-menu-section');
	element.textContent = label;
	return element;
}

export function menuSeparator(): HTMLElement {
	return $('div.openide-menu-sep');
}

export function menuEmpty(label: string): HTMLElement {
	const element = $('div.openide-menu-empty');
	element.textContent = label;
	return element;
}

/**
 * A row is a `<button>` so it is reachable by keyboard without re-implementing focus handling.
 * `icon` is a codicon name, or a ready-made node when the row carries a brand mark instead of a
 * glyph (the session-kind picker hands it a provider icon).
 */
export function menuRow(icon: string | HTMLElement, label: string): { readonly row: HTMLButtonElement; readonly labelElement: HTMLElement } {
	const row = $<HTMLButtonElement>('button.openide-menu-row', { type: 'button' });
	append(append(row, $('span.openide-menu-row-icon')), typeof icon === 'string' ? menuIcon(icon) : icon);
	const labelElement = append(row, $('span.openide-menu-label'));
	labelElement.textContent = label;
	return { row, labelElement };
}

export function menuRowAction(icon: string, tooltip: string): HTMLButtonElement {
	const button = $<HTMLButtonElement>('button.openide-menu-row-action', { type: 'button', title: tooltip });
	button.setAttribute('aria-label', tooltip);
	append(button, menuIcon(icon));
	return button;
}

/**
 * The rect the webview's CSS describes: the header, inset horizontally, grown by the 4px gap so
 * `AnchorPosition.BELOW` lands the popover exactly where `calc(100% + 4px)` would.
 */
function headerAnchor(header: HTMLElement, insetLeft: number, insetRight: number): IAnchor {
	const rect = getDomNodePagePosition(header);
	return {
		x: rect.left + insetLeft,
		y: rect.top,
		width: Math.max(0, rect.width - insetLeft - insetRight),
		height: rect.height + MENU_GAP,
	};
}

/**
 * A toolbar dropdown hangs off its OWN button — upstream's `dropdown.ts` anchors on `this.element`,
 * never on the bar around it. Anchoring on the header instead pushed these popovers past the whole
 * two-row block (35px of view tabs + 30px of session title), so they opened a row and a half below
 * the `+` that spawned them.
 */
function triggerAnchor(trigger: HTMLElement): IAnchor {
	const rect = getDomNodePagePosition(trigger);
	return { x: rect.left, y: rect.top, width: rect.width, height: rect.height + MENU_GAP };
}

export interface IOpenideChatMenuLayout {
	/** Extra class on the context-view container; carries the per-popover width rules. */
	readonly menuClass: string;
	readonly insetLeft: number;
	readonly insetRight: number;
	readonly alignment: AnchorAlignment;
	/** History spans the header's full width; the kebab keeps its intrinsic one. */
	readonly stretchToAnchor: boolean;
	/**
	 * What the popover hangs off: its trigger button (a toolbar dropdown, upstream's behaviour) or
	 * the whole header (the history list, which is header-wide by design).
	 */
	readonly anchorTo: 'trigger' | 'header';
	/** Defaults to BELOW the anchor; a popover opening from the bottom of the dock goes ABOVE. */
	readonly position?: AnchorPosition;
}

export abstract class OpenideChatMenuPopover extends Disposable {

	private _contextView: IOpenContextView | undefined;

	constructor(
		protected readonly contextViewService: IContextViewService,
		private readonly menuLayout: IOpenideChatMenuLayout,
	) {
		super();
	}

	get isOpen(): boolean {
		return !!this._contextView;
	}

	/** Fills the scrolling body. Runs once per open; a popover that repaints while it is on screen
	 *  owns that repaint itself (the history keeps its search field focused across one). */
	protected abstract renderContent(content: HTMLElement, store: DisposableStore): void;

	/** Element that focus should land on once the popover is on screen, if any. */
	protected initialFocus(): HTMLElement | undefined {
		return undefined;
	}

	toggle(header: HTMLElement, trigger: HTMLElement): void {
		if (this._contextView) {
			this._contextView.close();
			return;
		}
		this._contextView = this.contextViewService.showContextView({
			// Recomputed rather than captured: the view pane resizes while the popover is open.
			getAnchor: () => this.menuLayout.anchorTo === 'trigger'
				? triggerAnchor(trigger)
				: headerAnchor(header, this.menuLayout.insetLeft, this.menuLayout.insetRight),
			anchorAlignment: this.menuLayout.alignment,
			anchorPosition: this.menuLayout.position ?? AnchorPosition.BELOW,
			render: container => this.renderContainer(container, header),
			// Focused from here and not from `render`: the context view positions the popover after
			// rendering it, and focusing a node still parked at 0,0 makes the container jump.
			focus: () => this.initialFocus()?.focus(),
			onDOMEvent: (event: Event) => this.onDOMEvent(event, trigger),
			onHide: () => { this._contextView = undefined; },
		});
	}

	close(): void {
		this._contextView?.close();
	}

	/**
	 * Re-anchors the popover after its own content changed height. The context view measured it at
	 * render time, so a list that grew or shrank afterwards would hang off the window.
	 */
	protected relayout(): void {
		if (this._contextView) {
			this.contextViewService.layout();
		}
	}

	private renderContainer(container: HTMLElement, header: HTMLElement): DisposableStore {
		const store = new DisposableStore();
		container.classList.add('openide-menu', this.menuLayout.menuClass);
		if (this.menuLayout.stretchToAnchor) {
			// The layout algorithm only positions the left edge; the webview pins BOTH edges to the
			// header, so the width has to be applied by hand.
			//
			// It goes through min/max-width and NOT through `width`: contextview.ts:258 ends every
			// doLayout() with `view.style.width = 'initial'`, unconditionally, which silently wiped
			// an inline width set here — the popover then sized to its content and hung past the
			// panel. min-width and max-width survive that reset and win over `width` anyway.
			const width = headerAnchor(header, this.menuLayout.insetLeft, this.menuLayout.insetRight).width;
			container.style.setProperty('--openide-menu-anchor-width', `${width}px`);
		}
		const content = append(container, $('div.openide-menu-content'));
		this.renderContent(content, store);
		// `show()` resets the view's className but not its inline style, so the width would leak
		// into whatever popover opens next.
		store.add(toDisposable(() => { container.style.width = ''; }));
		return store;
	}

	/**
	 * The context view has no click-outside behaviour of its own once `onDOMEvent` is supplied, and
	 * its default one never fires (it listens on the workbench container, of which every click is a
	 * descendant). The trigger is excluded so its own handler can toggle instead of racing a close
	 * that already ran in the capture phase.
	 */
	private onDOMEvent(event: Event, trigger: HTMLElement): void {
		if (event.type === 'keydown') {
			if ((event as KeyboardEvent).key === 'Escape') {
				this.close();
			}
			return;
		}
		if (event.type !== 'click') {
			return;
		}
		const target = event.target;
		if (isHTMLElement(target) && (this.contextViewService.getContextViewElement().contains(target) || trigger.contains(target))) {
			return;
		}
		this.close();
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}
