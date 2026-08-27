/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — native diagram viewer (the full-screen modal behind the chat's ⛶ button).
 *
 *  It replaces the overlay-webview viewer 1:1: zoom with the wheel (towards the cursor), the
 *  toolbar and double-click; pan by dragging; fit on open and on resize. The picture is drawn
 *  again from its SOURCE with the same engine the chat uses (`renderOpenideDiagram`), so the
 *  viewer never injects markup, the theme tokens resolve in the workbench, and tooltips are the
 *  workbench hover instead of `<title>` bubbles.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, Dimension, EventType, getWindow } from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { t } from '../../common/openideStrings.js';
import { OpenideDiagramInput, OpenideDiagramPayload } from '../openideDiagramInput.js';
import { renderOpenideDiagram } from './openideDiagramRender.js';
import './media/openideDiagrams.css';

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
const FIT_MAX_SCALE = 2.5;
const FIT_PADDING = 48;
const HOVER_DELAY_MS = 350;

export class OpenideDiagramEditor extends EditorPane {

	static readonly ID = 'workbench.editor.openideDiagram';

	private root!: HTMLElement;
	private stage!: HTMLElement;
	private canvas!: HTMLElement;
	private zoomLabel!: HTMLElement;
	private readonly contentDisposables = this._register(new DisposableStore());

	private scale = 1;
	private tx = 0;
	private ty = 0;
	private panning: { x: number; y: number } | undefined;
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private hoverTarget: Element | undefined;
	private activeHover: IDisposable | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super(OpenideDiagramEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.openide-diagram-viewer'));
		const bar = append(this.root, $('.openide-diagram-viewer-bar'));
		const zoomOut = this.toolButton(bar, Codicon.zoomOut, t('diagram.viewer.zoomOut'));
		this.zoomLabel = append(bar, $('span.openide-diagram-viewer-zoom', undefined, '100%'));
		const zoomIn = this.toolButton(bar, Codicon.zoomIn, t('diagram.viewer.zoomIn'));
		const fit = this.toolButton(bar, Codicon.screenFull, t('diagram.viewer.fit'));
		append(bar, $('span.openide-diagram-viewer-spacer'));
		append(bar, $('span.openide-diagram-viewer-hint', undefined, t('diagram.viewer.hint')));

		this.stage = append(this.root, $('.openide-diagram-viewer-stage'));
		this.canvas = append(this.stage, $('.openide-diagram-viewer-canvas'));

		this._register(addDisposableListener(zoomIn, EventType.CLICK, () => this.zoomAt(this.stage.clientWidth / 2, this.stage.clientHeight / 2, 1.25)));
		this._register(addDisposableListener(zoomOut, EventType.CLICK, () => this.zoomAt(this.stage.clientWidth / 2, this.stage.clientHeight / 2, 1 / 1.25)));
		this._register(addDisposableListener(fit, EventType.CLICK, () => this.fit()));

		// Wheel zooms towards the cursor: the point under the pointer stays put, like the webview.
		this._register(addDisposableListener(this.stage, EventType.WHEEL, (e: WheelEvent) => {
			e.preventDefault();
			const rect = this.stage.getBoundingClientRect();
			this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
		}, { passive: false }));
		this._register(addDisposableListener(this.stage, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (e.button !== 0) {
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
		this._register(addDisposableListener(this.stage, EventType.DBLCLICK, () => this.centerAt100()));

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

	private toolButton(parent: HTMLElement, icon: ThemeIcon, tooltip: string): HTMLButtonElement {
		const button = append(parent, $('button.openide-diagram-viewer-btn', { type: 'button', 'aria-label': tooltip })) as HTMLButtonElement;
		append(button, $(`span.${ThemeIcon.asClassName(icon).replace(/ /g, '.')}`));
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), button, tooltip));
		return button;
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (input instanceof OpenideDiagramInput) {
			this.renderPayload(input.payload);
		}
	}

	override clearInput(): void {
		this.contentDisposables.clear();
		this.hideHover();
		clearNode(this.canvas);
		super.clearInput();
	}

	private renderPayload(payload: OpenideDiagramPayload): void {
		this.contentDisposables.clear();
		this.hideHover();
		clearNode(this.canvas);
		const doc = this.canvas.ownerDocument;
		let node: HTMLElement | undefined;
		switch (payload.kind) {
			case 'source': {
				const render = renderOpenideDiagram(doc, payload.source);
				if (render) {
					liftTitlesToHover(render.domNode);
					node = render.domNode;
				}
				break;
			}
			case 'image': {
				const img = doc.createElement('img');
				img.src = payload.uri;
				img.alt = payload.alt ?? '';
				img.draggable = false;
				node = img;
				break;
			}
			case 'html': {
				// Rendered markup from a legacy caller: shown as a picture, never parsed into the DOM.
				if (/^\s*<svg[\s>]/i.test(payload.html)) {
					const img = doc.createElement('img');
					img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload.html)}`;
					img.draggable = false;
					node = img;
				}
				break;
			}
		}
		if (!node) {
			append(this.canvas, $('.openide-diagram-viewer-empty', undefined, t('diagram.viewer.unsupported')));
		} else {
			append(this.canvas, node);
			if (node instanceof HTMLImageElement && !node.complete) {
				this.contentDisposables.add(addDisposableListener(node, EventType.LOAD, () => this.fit()));
			}
		}
		// Layout first, then measure: the modal may still be sizing the pane.
		getWindow(this.canvas).requestAnimationFrame(() => this.fit());
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

	private fit(): void {
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

	override layout(dimension: Dimension): void {
		this.root.style.width = `${dimension.width}px`;
		this.root.style.height = `${dimension.height}px`;
		if (this.canvas.firstElementChild) {
			this.fit();
		}
	}

	override focus(): void {
		super.focus();
		this.stage.focus();
	}

	override dispose(): void {
		this.hideHover();
		super.dispose();
	}
}

/**
 * The engine annotates nodes with `<title>` because inside the chat the same `<svg>` had to
 * survive a trip through `outerHTML`. Here the picture is DOM, so the text moves to `data-tip`
 * and the workbench hover takes over; the browser bubble is gone with the element.
 */
function liftTitlesToHover(root: Element): void {
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
