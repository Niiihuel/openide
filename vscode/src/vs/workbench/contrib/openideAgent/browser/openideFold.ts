/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { t } from '../common/openideStrings.js';
import { IOpenideChatTooltip, setupChatTooltip } from './chat/openideChatHover.js';
import './media/openideDiff.css';

/** Webview `.part.edit-card:not(.open) .ediff { max-height: 108px }`. */
export const FOLD_COLLAPSED_HEIGHT = 108;

export interface IOpenideFoldOptions {
	/** Height of the content at rest; above it the fade and the chevron appear. */
	readonly collapsed?: number;
	/**
	 * Which edge fades. `bottom` (the default) for content read from the top — a diff. `top` for
	 * content pinned to its tail — a terminal, whose newest line must stay legible.
	 */
	readonly fadeEdge?: 'bottom' | 'top';
	/** The content's height, when it is not simply the host's scroll height. */
	readonly measure?: () => number;
}

/**
 * The fold Cursor puts on an edit block: a few lines at rest, a fade over the edge where more is
 * hidden, and a chevron — only on hover, only when there IS more — that opens the block. ONE
 * mechanism for every card in the transcript that shows a stream of lines (the diff of an edit,
 * a terminal's output), so they all fold the same way.
 *
 * The host gets `openide-fold` and the states `needs-expand` / `open`; the stylesheet does the
 * rest (openideDiff.css). The host's own content carries the max-heights.
 */
export class OpenideFold extends Disposable {

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly fade: HTMLElement;
	private readonly expand: HTMLButtonElement;
	private readonly tooltip: IOpenideChatTooltip;
	private readonly measurement = this._register(new MutableDisposable<IDisposable>());

	constructor(
		private readonly host: HTMLElement,
		hoverService: IHoverService,
		private readonly options: IOpenideFoldOptions = {},
	) {
		super();
		host.classList.add('openide-fold', options.fadeEdge === 'top' ? 'openide-fold-top' : 'openide-fold-bottom');
		this.fade = $('div.openide-fold-fade');
		this.expand = $('button.openide-fold-expand', { type: 'button' });
		// The `open` class is the state itself, so the factory reads the DOM rather than a second
		// copy of it; `update()` from the two places that toggle it keeps the accessible name honest.
		this.tooltip = this._register(setupChatTooltip(hoverService, this.expand, () => t(this.isOpen ? 'chat.part.collapseDiff' : 'chat.part.expandDiff')));
		append(this.expand, $('span.codicon.codicon-chevron-down'));
		this._register(addDisposableListener(this.expand, 'click', event => {
			event.stopPropagation();
			this.toggle();
		}));
		this.mount();
	}

	get isOpen(): boolean {
		return this.host.classList.contains('open');
	}

	/** Re-appends the fade and the chevron: a host that replaced its children calls this. */
	mount(): void {
		append(this.host, this.fade);
		append(this.host, this.expand);
	}

	/** Forgets the open state and re-measures — the host has new content. */
	reset(): void {
		this.host.classList.remove('open', 'needs-expand');
		this.expand.replaceChildren($('span.codicon.codicon-chevron-down'));
		this.tooltip.update();
		this.measure();
	}

	/**
	 * Measured, not counted: `needs-expand` must be false for a one-line block even though it
	 * has content, or every card grows a chevron that does nothing. Next frame, so the host is
	 * laid out.
	 */
	measure(): void {
		if (this.measurement.value) {
			return;
		}
		this.measurement.value = scheduleAtNextAnimationFrame(getWindow(this.host), () => {
			this.measurement.clear();
			if (!this.host.isConnected) {
				return;
			}
			const height = this.options.measure ? this.options.measure() : this.host.scrollHeight;
			const needs = height > (this.options.collapsed ?? FOLD_COLLAPSED_HEIGHT) + 1;
			if (this.host.classList.contains('needs-expand') !== needs) {
				this.host.classList.toggle('needs-expand', needs);
				this._onDidChangeHeight.fire();
			}
		});
	}

	toggle(): void {
		this.setOpen(!this.isOpen);
	}

	setOpen(open: boolean): void {
		this.host.classList.toggle('open', open);
		this.expand.replaceChildren($(`span.codicon.codicon-chevron-${open ? 'up' : 'down'}`));
		this.tooltip.update();
		this._onDidChangeHeight.fire();
	}
}
