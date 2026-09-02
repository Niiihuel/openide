/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the diagram STAGE: toolbar, dotted canvas, zoom, pan and hover.
 *
 *  Extracted from the full-screen viewer when the saved maps got their own editor. Both panes
 *  show a picture the same way — wheel zooms towards the cursor, drag pans, double click centres
 *  at 100%, fit on open and on resize — and the second pane copying those two hundred lines is
 *  exactly how the two would drift. The panes keep what makes them different: one takes a payload
 *  handed over by a command, the other a file on disk.
 *
 *  It owns no content of its own: `setContent` takes whatever element the caller built.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension, EventType, getWindow } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { t } from '../../common/openideStrings.js';
import './media/openideDiagrams.css';

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
const FIT_MAX_SCALE = 2.5;
const FIT_PADDING = 48;
const HOVER_DELAY_MS = 350;

export interface IDiagramStageOptions {
	/** False builds no toolbar row: the framing pane floats its own controls over the canvas. */
	readonly toolbar?: boolean;
}

export class OpenideDiagramStage extends Disposable {

	readonly domNode: HTMLElement;

	private readonly bar: HTMLElement;
	private readonly actions: HTMLElement;
	private readonly stage: HTMLElement;
	private readonly canvas: HTMLElement;
	private readonly overlay: HTMLElement;
	private readonly zoomLabel: HTMLElement;
	private readonly contentDisposables = this._register(new DisposableStore());

	private scale = 1;
	private tx = 0;
	private ty = 0;
	private panning: { x: number; y: number } | undefined;
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private hoverTarget: Element | undefined;
	private activeHover: IDisposable | undefined;

	constructor(
		parent: HTMLElement,
		private readonly hoverService: IHoverService,
		options: IDiagramStageOptions = {},
	) {
		super();

		this.domNode = append(parent, $('.openide-diagram-viewer'));
		// A modal keeps its toolbar row; a pane that IS the picture does not. There the controls
		// float over the canvas as cards, the way the Project Map arranges its own.
		this.domNode.classList.toggle('chromeless', options.toolbar === false);
		this.bar = append(this.domNode, $('.openide-diagram-viewer-bar'));
		if (options.toolbar === false) {
			this.bar.classList.add('hidden');
		}
		const zoomOut = this.toolButton(this.bar, Codicon.zoomOut, t('diagram.viewer.zoomOut'));
		this.zoomLabel = append(this.bar, $('span.openide-diagram-viewer-zoom', undefined, '100%'));
		const zoomIn = this.toolButton(this.bar, Codicon.zoomIn, t('diagram.viewer.zoomIn'));
		const fit = this.toolButton(this.bar, Codicon.screenFull, t('diagram.viewer.fit'));
		// Anything the pane adds lands here, after the zoom controls and before the hint.
		this.actions = append(this.bar, $('span.openide-diagram-viewer-actions'));
		append(this.bar, $('span.openide-diagram-viewer-spacer'));
		append(this.bar, $('span.openide-diagram-viewer-hint', undefined, t('diagram.viewer.hint')));

		this.stage = append(this.domNode, $('.openide-diagram-viewer-stage'));
		this.canvas = append(this.stage, $('.openide-diagram-viewer-canvas'));
		this.overlay = append(this.stage, $('.openide-diagram-viewer-overlay.hidden'));

		this._register(addDisposableListener(zoomIn, EventType.CLICK, () => this.zoomAt(this.stage.clientWidth / 2, this.stage.clientHeight / 2, 1.25)));
		this._register(addDisposableListener(zoomOut, EventType.CLICK, () => this.zoomAt(this.stage.clientWidth / 2, this.stage.clientHeight / 2, 1 / 1.25)));
		this._register(addDisposableListener(fit, EventType.CLICK, () => this.fit()));

		// Wheel zooms towards the cursor: the point under the pointer stays put, like the webview.
		this._register(addDisposableListener(this.stage, EventType.WHEEL, (e: WheelEvent) => {
			if (this.overlayVisible || this.fromPanel(e)) {
				// The overlay scrolls its own text; zooming a message it is not showing is nonsense.
				return;
			}
			e.preventDefault();
			const rect = this.stage.getBoundingClientRect();
			this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
		}, { passive: false }));
		this._register(addDisposableListener(this.stage, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (e.button !== 0 || this.overlayVisible || this.fromPanel(e)) {
				return;
			}
			this.panning = { x: e.clientX - this.tx, y: e.clientY - this.ty };
			this.stage.classList.add('panning');
			this.hideHover();
		}));
		const win = getWindow(parent);
		this._register(addDisposableListener(win, EventType.MOUSE_MOVE, (e: MouseEvent) => {
			if (this.panning) {
				this.tx = e.clientX - this.panning.x;
				this.ty = e.clientY - this.panning.y;
				this.apply();
			}
		}));
		this._register(addDisposableListener(win, EventType.MOUSE_UP, () => {
			this.panning = undefined;
			this.stage.classList.remove('panning');
		}));
		this._register(addDisposableListener(this.stage, EventType.DBLCLICK, e => { if (!this.fromPanel(e)) { this.centerAt100(); } }));

		// Workbench hover for whatever the renderer annotated (`data-tip`, converted from `<title>`).
		this._register(addDisposableListener(this.canvas, EventType.MOUSE_OVER, (e: MouseEvent) => {
			const target = (e.target as Element | null)?.closest?.('[data-tip]') ?? undefined;
			if (target === this.hoverTarget) {
				return;
			}
			this.hideHover();
			if (!target) {
				return;
			}
			this.hoverTarget = target;
			this.hoverTimer = setTimeout(() => {
				if (this.hoverTarget !== target) {
					return;
				}
				this.activeHover = this.hoverService.showInstantHover({
					content: target.getAttribute('data-tip') ?? '',
					target: target as HTMLElement,
					appearance: { compact: true, showPointer: true },
				}, false);
			}, HOVER_DELAY_MS);
		}));
		this._register(addDisposableListener(this.canvas, EventType.MOUSE_LEAVE, () => this.hideHover()));
	}

	/** Where a pane hangs its floating cards: over the canvas, above the picture. */
	get panelHost(): HTMLElement {
		return this.stage;
	}

	/** Zoom from a floating control, about the centre of the stage. */
	zoomBy(factor: number): void {
		this.zoomAt(this.stage.clientWidth / 2, this.stage.clientHeight / 2, factor);
	}

	/**
	 * True when the gesture started inside a floating panel rather than on the paper.
	 *
	 * The panels sit ON the stage, so every wheel, drag and double click over a card bubbles down to
	 * these handlers. A scroller only swallows the wheel WHILE it still has somewhere to go: reach
	 * the end of a list and the event keeps travelling, and the canvas would zoom as a reward for
	 * scrolling to the bottom. Dragging a card would pan the map underneath it, and a double click
	 * on a row would recentre it.
	 */
	private fromPanel(event: Event): boolean {
		return !!(event.target as Element | null)?.closest?.('.openide-pmap-panel');
	}

	/** A pane-specific button, placed after the zoom controls. */
	addAction(icon: ThemeIcon, tooltip: string, run: () => void): HTMLButtonElement {
		const button = this.toolButton(this.actions, icon, tooltip);
		this._register(addDisposableListener(button, EventType.CLICK, () => run()));
		return button;
	}

	private toolButton(parent: HTMLElement, icon: ThemeIcon, tooltip: string): HTMLButtonElement {
		const button = append(parent, $('button.openide-diagram-viewer-btn', { type: 'button', 'aria-label': tooltip })) as HTMLButtonElement;
		append(button, $(`span.${ThemeIcon.asClassName(icon).replace(/ /g, '.')}`));
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), button, tooltip));
		return button;
	}

	/**
	 * Shows `node`, or the empty message when there is nothing to draw. The picture is fitted on the
	 * next frame: the pane may still be sizing when the content arrives.
	 */
	setContent(node: HTMLElement | undefined, emptyMessage: string = t('diagram.viewer.unsupported')): void {
		this.setOverlay(undefined);
		this.contentDisposables.clear();
		this.hideHover();
		clearNode(this.canvas);
		if (!node) {
			append(this.canvas, $('.openide-diagram-viewer-empty', undefined, emptyMessage));
		} else {
			append(this.canvas, node);
			if (node instanceof HTMLImageElement && !node.complete) {
				this.contentDisposables.add(addDisposableListener(node, EventType.LOAD, () => this.fit()));
			}
		}
		getWindow(this.canvas).requestAnimationFrame(() => this.fit());
	}

	/**
	 * A panel shown over the canvas area and under the toolbar — the map that does not draw yet
	 * explaining why. It is NOT zoomed or panned: it is text to read and act on, and the toolbar
	 * stays reachable above it because "edit the JSON" is what you came for.
	 */
	setOverlay(node: HTMLElement | undefined): void {
		clearNode(this.overlay);
		this.overlay.classList.toggle('hidden', !node);
		// The zoom controls and the "wheel: zoom" hint go with the picture they act on: offering to
		// zoom a message that is not a picture is an affordance that does nothing.
		this.domNode.classList.toggle('has-overlay', !!node);
		if (node) {
			append(this.overlay, node);
		}
	}

	private get overlayVisible(): boolean {
		return !this.overlay.classList.contains('hidden');
	}

	clear(): void {
		this.setOverlay(undefined);
		this.contentDisposables.clear();
		this.hideHover();
		clearNode(this.canvas);
	}

	get hasContent(): boolean {
		return !!this.canvas.firstElementChild;
	}

	// ---- zoom & pan (transcribed from the webview script)

	private apply(): void {
		this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
		this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
	}

	private contentSize(): { w: number; h: number } {
		const el = this.canvas.firstElementChild;
		if (!el) {
			return { w: 1, h: 1 };
		}
		const rect = el.getBoundingClientRect();
		return { w: Math.max(1, rect.width / this.scale), h: Math.max(1, rect.height / this.scale) };
	}

	fit(): void {
		const c = this.contentSize();
		const sw = this.stage.clientWidth;
		const sh = this.stage.clientHeight;
		if (!sw || !sh) {
			return;
		}
		this.scale = Math.min(FIT_MAX_SCALE, Math.max(MIN_SCALE, Math.min((sw - FIT_PADDING) / c.w, (sh - FIT_PADDING) / c.h)));
		this.tx = (sw - c.w * this.scale) / 2;
		this.ty = (sh - c.h * this.scale) / 2;
		this.apply();
	}

	private centerAt100(): void {
		this.scale = 1;
		const c = this.contentSize();
		this.tx = (this.stage.clientWidth - c.w) / 2;
		this.ty = (this.stage.clientHeight - c.h) / 2;
		this.apply();
	}

	private zoomAt(cx: number, cy: number, factor: number): void {
		const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
		this.tx = cx - (cx - this.tx) * (next / this.scale);
		this.ty = cy - (cy - this.ty) * (next / this.scale);
		this.scale = next;
		this.apply();
	}

	private hideHover(): void {
		if (this.hoverTimer) {
			clearTimeout(this.hoverTimer);
			this.hoverTimer = undefined;
		}
		this.hoverTarget = undefined;
		this.activeHover?.dispose();
		this.activeHover = undefined;
	}

	layout(dimension: Dimension): void {
		this.domNode.style.width = `${dimension.width}px`;
		this.domNode.style.height = `${dimension.height}px`;
		if (this.hasContent) {
			this.fit();
		}
	}

	focus(): void {
		this.stage.focus();
	}

	override dispose(): void {
		this.hideHover();
		super.dispose();
	}
}

/**
 * The engine annotates nodes with `<title>` because inside the chat the same `<svg>` had to
 * survive a trip through `outerHTML`. On a stage the picture is DOM, so the text moves to
 * `data-tip` and the workbench hover takes over; the browser bubble is gone with the element.
 */
export function liftTitlesToHover(root: Element): void {
	// eslint-disable-next-line no-restricted-syntax
	for (const title of Array.from(root.querySelectorAll('title'))) {
		const parent = title.parentElement;
		const text = title.textContent?.trim();
		title.remove();
		if (parent && text) {
			parent.setAttribute('data-tip', text);
		}
	}
}
