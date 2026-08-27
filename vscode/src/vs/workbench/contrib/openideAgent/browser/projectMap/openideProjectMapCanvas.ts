/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — Project Map: the graph drawing itself. A DPR-aware 2D <canvas> for nodes and edges
 *  (300+ nodes and thousands of edges in DOM/SVG crawl as soon as you pan) plus a second small
 *  canvas for the minimap. It knows nothing about services: it receives the view and the layout,
 *  and reports hover/selection/viewport through events. The visual grammar is Graphify's: one
 *  colour per community, size by degree, and the god nodes (the three most connected) ringed and
 *  numbered.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, getWindow, scheduleAtNextAnimationFrame } from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILayoutNode } from '../../../../../code/common/openideCodebaseGraphLayout.js';
import { IGraphView, IGraphViewNode } from '../openideCodebaseGraphService.js';

/** Graphify's palette: one colour per community, in size order. */
export const PROJECT_MAP_PALETTE = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#94a3b8', '#d4a373'];

export function projectMapColorFor(moduleIndex: number): string {
	return moduleIndex < 0 ? '#94a3b8' : PROJECT_MAP_PALETTE[moduleIndex % PROJECT_MAP_PALETTE.length];
}

export interface IProjectMapNode extends IGraphViewNode {
	x: number;
	y: number;
	r: number;
	readonly color: string;
	/** 1..3 for the three most connected; 0 for everything else. */
	readonly godRank: number;
}

interface IViewport { x: number; y: number; scale: number }

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
/** Zoom threshold past which EVERY name is drawn, not only the focused ones. */
const LABEL_ALL_SCALE = 2.2;
const LABEL_FONT = 11;

export class OpenideProjectMapCanvas extends Disposable {

	readonly canvas: HTMLCanvasElement;
	readonly minimap: HTMLCanvasElement;

	private readonly _onDidHover = this._register(new Emitter<IProjectMapNode | undefined>());
	readonly onDidHover: Event<IProjectMapNode | undefined> = this._onDidHover.event;
	private readonly _onDidSelect = this._register(new Emitter<IProjectMapNode | undefined>());
	readonly onDidSelect: Event<IProjectMapNode | undefined> = this._onDidSelect.event;

	private _nodes: IProjectMapNode[] = [];
	private _byId = new Map<string, IProjectMapNode>();
	private _edges: { a: IProjectMapNode; b: IProjectMapNode }[] = [];
	private _neighbors = new Map<string, Set<string>>();
	private _world = { width: 1000, height: 700 };
	private _view: IViewport = { x: 0, y: 0, scale: 1 };
	private _size = { width: 0, height: 0 };
	private _hover: IProjectMapNode | undefined;
	private _selected: IProjectMapNode | undefined;
	private _hidden = new Set<string>();
	private _highlight: Set<string> | undefined;
	private _dirty = false;
	private _colors = { bg: '#1e1e1e', fg: '#cccccc', muted: '#8b8b8b', dot: 'rgba(128,128,128,0.18)' };
	private _drag: { startX: number; startY: number; viewX: number; viewY: number; moved: boolean } | undefined;

	constructor(host: HTMLElement, minimapHost: HTMLElement) {
		super();
		this.canvas = host.ownerDocument.createElement('canvas');
		this.canvas.className = 'openide-pmap-canvas';
		host.appendChild(this.canvas);
		this.minimap = minimapHost.ownerDocument.createElement('canvas');
		this.minimap.className = 'openide-pmap-minimap-canvas';
		minimapHost.appendChild(this.minimap);

		this._register(addDisposableListener(this.canvas, 'pointerdown', event => this._onPointerDown(event)));
		this._register(addDisposableListener(this.canvas, 'pointermove', event => this._onPointerMove(event)));
		this._register(addDisposableListener(this.canvas, 'pointerup', event => this._onPointerUp(event)));
		this._register(addDisposableListener(this.canvas, 'pointerleave', () => { if (!this._drag) { this._setHover(undefined); } }));
		this._register(addDisposableListener(this.canvas, 'wheel', event => this._onWheel(event), { passive: false }));
		this._register(addDisposableListener(this.minimap, 'pointerdown', event => this._onMinimapPointer(event)));
		this._register(addDisposableListener(this.minimap, 'pointermove', event => { if (event.buttons & 1) { this._onMinimapPointer(event); } }));
	}

	get nodes(): readonly IProjectMapNode[] { return this._nodes; }
	get selected(): IProjectMapNode | undefined { return this._selected; }
	get scale(): number { return this._view.scale; }

	getNode(id: string): IProjectMapNode | undefined { return this._byId.get(id); }

	neighborsOf(id: string): ReadonlySet<string> { return this._neighbors.get(id) ?? new Set(); }

	/** Theme colours, read by the editor (a canvas cannot use `var(--vscode-*)`). */
	setColors(colors: { bg: string; fg: string; muted: string; dot: string }): void {
		this._colors = colors;
		this.invalidate();
	}

	setGraph(view: IGraphView, layout: readonly ILayoutNode[], world: { width: number; height: number }): void {
		const moduleIndex = new Map<string, number>();
		view.modules.forEach((module, index) => moduleIndex.set(module.label, index));
		const position = new Map(layout.map(node => [node.id, node] as const));
		const ranked = [...view.nodes].sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path)).slice(0, 3).map(node => node.id);
		this._nodes = view.nodes.map(node => {
			const placed = position.get(node.id);
			return {
				...node,
				x: placed?.x ?? world.width / 2,
				y: placed?.y ?? world.height / 2,
				r: placed?.r ?? 4,
				color: projectMapColorFor(moduleIndex.get(node.community) ?? -1),
				godRank: ranked.indexOf(node.id) + 1,
			};
		});
		this._byId = new Map(this._nodes.map(node => [node.id, node]));
		this._neighbors = new Map();
		this._edges = [];
		for (const edge of view.edges) {
			const a = this._byId.get(edge.source);
			const b = this._byId.get(edge.target);
			if (!a || !b || a === b) { continue; }
			this._edges.push({ a, b });
			(this._neighbors.get(a.id) ?? this._neighbors.set(a.id, new Set()).get(a.id)!).add(b.id);
			(this._neighbors.get(b.id) ?? this._neighbors.set(b.id, new Set()).get(b.id)!).add(a.id);
		}
		this._world = world;
		this._hover = undefined;
		this._selected = this._selected ? this._byId.get(this._selected.id) : undefined;
		this.fit();
	}

	setHiddenModules(hidden: ReadonlySet<string>): void {
		this._hidden = new Set(hidden);
		if (this._selected && this._hidden.has(this._selected.community)) { this.select(undefined); }
		this.invalidate();
	}

	/** Search result: the highlighted ids; `undefined` clears the filter. */
	setHighlight(ids: readonly string[] | undefined): void {
		this._highlight = ids ? new Set(ids) : undefined;
		this.invalidate();
	}

	select(node: IProjectMapNode | undefined): void {
		if (this._selected === node) { return; }
		this._selected = node;
		this._onDidSelect.fire(node);
		this.invalidate();
	}

	/** Moves the viewport to the node (for a search hit or a relation). */
	focusNode(id: string): void {
		const node = this._byId.get(id);
		if (!node) { return; }
		const scale = Math.max(this._view.scale, 1.6);
		this._view = { scale, x: this._size.width / 2 - node.x * scale, y: this._size.height / 2 - node.y * scale };
		this.select(node);
	}

	layout(width: number, height: number): void {
		if (width === this._size.width && height === this._size.height) { return; }
		const first = this._size.width === 0;
		this._size = { width, height };
		const dpr = getWindow(this.canvas).devicePixelRatio || 1;
		this.canvas.width = Math.max(1, Math.round(width * dpr));
		this.canvas.height = Math.max(1, Math.round(height * dpr));
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		const mm = this.minimap.parentElement;
		const mmWidth = mm?.clientWidth || 160;
		const mmHeight = mm?.clientHeight || 100;
		this.minimap.width = Math.round(mmWidth * dpr);
		this.minimap.height = Math.round(mmHeight * dpr);
		this.minimap.style.width = `${mmWidth}px`;
		this.minimap.style.height = `${mmHeight}px`;
		if (first) { this.fit(); } else { this.invalidate(); }
	}

	zoomBy(factor: number): void {
		this._zoomAt(this._size.width / 2, this._size.height / 2, factor);
	}

	fit(): void {
		if (!this._size.width || !this._nodes.length) { this.invalidate(); return; }
		// The free area, not the pane: the floating panels cover the right side (modules/inspector)
		// and the top-left corner, so the graph centres on what is actually still visible.
		const pad = { left: 40, right: this._size.width > 900 ? 340 : 40, top: this._size.height > 600 ? 120 : 40, bottom: 40 };
		const freeWidth = Math.max(200, this._size.width - pad.left - pad.right);
		const freeHeight = Math.max(160, this._size.height - pad.top - pad.bottom);
		const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(freeWidth / this._world.width, freeHeight / this._world.height)));
		this._view = { scale, x: pad.left + (freeWidth - this._world.width * scale) / 2, y: pad.top + (freeHeight - this._world.height * scale) / 2 };
		this.invalidate();
	}

	invalidate(): void {
		if (this._dirty) { return; }
		this._dirty = true;
		scheduleAtNextAnimationFrame(getWindow(this.canvas), () => {
			this._dirty = false;
			this._render();
			this._renderMinimap();
		});
	}

	// ---- input

	private _toWorld(clientX: number, clientY: number): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		return { x: (clientX - rect.left - this._view.x) / this._view.scale, y: (clientY - rect.top - this._view.y) / this._view.scale };
	}

	private _hitTest(clientX: number, clientY: number): IProjectMapNode | undefined {
		const point = this._toWorld(clientX, clientY);
		const slack = 4 / this._view.scale;
		let best: IProjectMapNode | undefined;
		let bestDistance = Infinity;
		for (const node of this._nodes) {
			if (this._hidden.has(node.community)) { continue; }
			const distance = Math.hypot(node.x - point.x, node.y - point.y);
			if (distance <= this._radiusOf(node) / this._view.scale + slack && distance < bestDistance) { best = node; bestDistance = distance; }
		}
		return best;
	}

	private _onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) { return; }
		this.canvas.setPointerCapture(event.pointerId);
		this._drag = { startX: event.clientX, startY: event.clientY, viewX: this._view.x, viewY: this._view.y, moved: false };
	}

	private _onPointerMove(event: PointerEvent): void {
		if (this._drag) {
			const dx = event.clientX - this._drag.startX;
			const dy = event.clientY - this._drag.startY;
			if (Math.abs(dx) + Math.abs(dy) > 3) { this._drag.moved = true; }
			if (this._drag.moved) {
				this._view = { ...this._view, x: this._drag.viewX + dx, y: this._drag.viewY + dy };
				this.canvas.classList.add('dragging');
				this.invalidate();
			}
			return;
		}
		this._setHover(this._hitTest(event.clientX, event.clientY));
	}

	private _onPointerUp(event: PointerEvent): void {
		const drag = this._drag;
		this._drag = undefined;
		this.canvas.classList.remove('dragging');
		if (drag && !drag.moved) {
			this.select(this._hitTest(event.clientX, event.clientY));
		}
	}

	private _onWheel(event: WheelEvent): void {
		event.preventDefault();
		const rect = this.canvas.getBoundingClientRect();
		const factor = Math.exp(-event.deltaY * 0.0016);
		this._zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
	}

	private _zoomAt(px: number, py: number, factor: number): void {
		const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this._view.scale * factor));
		const real = scale / this._view.scale;
		this._view = { scale, x: px - (px - this._view.x) * real, y: py - (py - this._view.y) * real };
		this.invalidate();
	}

	private _onMinimapPointer(event: PointerEvent): void {
		event.preventDefault();
		const rect = this.minimap.getBoundingClientRect();
		const scale = this._minimapScale(rect.width, rect.height);
		const worldX = (event.clientX - rect.left - (rect.width - this._world.width * scale) / 2) / scale;
		const worldY = (event.clientY - rect.top - (rect.height - this._world.height * scale) / 2) / scale;
		this._view = { ...this._view, x: this._size.width / 2 - worldX * this._view.scale, y: this._size.height / 2 - worldY * this._view.scale };
		this.invalidate();
	}

	private _setHover(node: IProjectMapNode | undefined): void {
		if (this._hover === node) { return; }
		this._hover = node;
		this.canvas.style.cursor = node ? 'pointer' : '';
		this._onDidHover.fire(node);
		this.invalidate();
	}

	// ---- drawing

	private _radiusOf(node: IProjectMapNode): number {
		// In screen pixels: it grows with zoom but never drops below a visible dot.
		return Math.max(2.5, node.r * Math.sqrt(this._view.scale) * 0.9);
	}

	private _focusSet(): Set<string> | undefined {
		const focus = this._hover ?? this._selected;
		if (!focus) { return undefined; }
		const set = new Set(this._neighbors.get(focus.id));
		set.add(focus.id);
		return set;
	}

	private _render(): void {
		const ctx = this.canvas.getContext('2d');
		if (!ctx || !this._size.width) { return; }
		const dpr = getWindow(this.canvas).devicePixelRatio || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = this._colors.bg;
		ctx.fillRect(0, 0, this._size.width, this._size.height);
		this._renderDots(ctx);

		const focus = this._focusSet();
		const focusId = (this._hover ?? this._selected)?.id;
		const { x, y, scale } = this._view;
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(scale, scale);
		ctx.lineWidth = 1 / scale;

		// Edges first, dimmed; the focused ones after, in the source node's colour.
		const focused: { a: IProjectMapNode; b: IProjectMapNode }[] = [];
		ctx.globalAlpha = focus || this._highlight ? 0.05 : 0.14;
		ctx.strokeStyle = this._colors.fg;
		ctx.beginPath();
		for (const edge of this._edges) {
			if (this._hidden.has(edge.a.community) || this._hidden.has(edge.b.community)) { continue; }
			if (focus && (edge.a.id === focusId || edge.b.id === focusId)) { focused.push(edge); continue; }
			this._edgePath(ctx, edge.a, edge.b);
		}
		ctx.stroke();
		for (const edge of focused) {
			ctx.globalAlpha = 0.75;
			ctx.strokeStyle = (edge.a.id === focusId ? edge.a : edge.b).color;
			ctx.lineWidth = 1.4 / scale;
			ctx.beginPath();
			this._edgePath(ctx, edge.a, edge.b);
			ctx.stroke();
		}

		// Nodes: least to most connected, so the hubs end up on top.
		const ordered = [...this._nodes].sort((a, b) => a.degree - b.degree);
		for (const node of ordered) {
			if (this._hidden.has(node.community)) { continue; }
			const dimmed = (focus && !focus.has(node.id)) || (this._highlight && !this._highlight.has(node.id));
			const radius = this._radiusOf(node) / scale;
			ctx.globalAlpha = dimmed ? 0.18 : 1;
			ctx.fillStyle = node.color;
			ctx.beginPath();
			ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
			ctx.fill();
			if (node.godRank || node.id === this._selected?.id) {
				ctx.strokeStyle = node.id === this._selected?.id ? this._colors.fg : node.color;
				ctx.lineWidth = 1.5 / scale;
				ctx.globalAlpha = dimmed ? 0.3 : 0.9;
				ctx.beginPath();
				ctx.arc(node.x, node.y, radius + 4 / scale, 0, Math.PI * 2);
				ctx.stroke();
			}
		}

		// Labels: focus and neighbours always; god nodes from a moderate zoom; all of them close in.
		ctx.font = `${LABEL_FONT / scale}px ${this._labelFont()}`;
		ctx.textBaseline = 'middle';
		for (const node of ordered) {
			if (this._hidden.has(node.community)) { continue; }
			const inFocus = focus?.has(node.id);
			const isFocusNode = node.id === focusId;
			// The focus's neighbours only with some zoom: at map scale their names overlap.
			const show = isFocusNode || (inFocus && scale >= 1.1) || (this._highlight?.has(node.id)) || scale >= LABEL_ALL_SCALE || (node.godRank && scale >= 0.55);
			if (!show) { continue; }
			const radius = this._radiusOf(node) / scale;
			const label = node.godRank ? `${node.godRank} · ${node.name}` : node.name;
			const isFocus = isFocusNode;
			ctx.globalAlpha = isFocus ? 1 : inFocus ? 0.9 : 0.7;
			ctx.fillStyle = isFocus ? this._colors.fg : this._colors.muted;
			if (isFocus) {
				// Backdrop behind the hovered node's name: legible over any tangle.
				const width = ctx.measureText(label).width;
				ctx.save();
				ctx.fillStyle = this._colors.bg;
				ctx.globalAlpha = 0.85;
				ctx.fillRect(node.x + radius + 4 / scale, node.y - 8 / scale, width + 8 / scale, 16 / scale);
				ctx.restore();
				ctx.fillStyle = this._colors.fg;
			}
			ctx.fillText(label, node.x + radius + 8 / scale, node.y);
		}
		ctx.restore();
	}

	private _edgePath(ctx: CanvasRenderingContext2D, a: IProjectMapNode, b: IProjectMapNode): void {
		// A slight curve, always to the same side: edges stay distinguishable instead of crossing as straight lines.
		const mx = (a.x + b.x) / 2;
		const my = (a.y + b.y) / 2;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const bend = 0.12;
		ctx.moveTo(a.x, a.y);
		ctx.quadraticCurveTo(mx - dy * bend, my + dx * bend, b.x, b.y);
	}

	private _renderDots(ctx: CanvasRenderingContext2D): void {
		// Dot grid pinned to the screen (not to the world): it gives texture without implying coordinates.
		const step = 22;
		ctx.fillStyle = this._colors.dot;
		const offsetX = ((this._view.x % step) + step) % step;
		const offsetY = ((this._view.y % step) + step) % step;
		for (let px = offsetX; px < this._size.width; px += step) {
			for (let py = offsetY; py < this._size.height; py += step) {
				ctx.fillRect(px, py, 1, 1);
			}
		}
	}

	private _labelFont(): string {
		return getWindow(this.canvas).getComputedStyle(this.canvas).fontFamily || 'sans-serif';
	}

	private _minimapScale(width: number, height: number): number {
		return Math.min((width - 8) / this._world.width, (height - 8) / this._world.height);
	}

	private _renderMinimap(): void {
		const ctx = this.minimap.getContext('2d');
		if (!ctx) { return; }
		const dpr = getWindow(this.canvas).devicePixelRatio || 1;
		const width = this.minimap.width / dpr;
		const height = this.minimap.height / dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		if (!this._nodes.length) { return; }
		const scale = this._minimapScale(width, height);
		const ox = (width - this._world.width * scale) / 2;
		const oy = (height - this._world.height * scale) / 2;
		for (const node of this._nodes) {
			if (this._hidden.has(node.community)) { continue; }
			ctx.fillStyle = node.color;
			ctx.globalAlpha = 0.9;
			ctx.fillRect(ox + node.x * scale - 1, oy + node.y * scale - 1, 2, 2);
		}
		// The current viewport, in world coordinates.
		const vx = -this._view.x / this._view.scale;
		const vy = -this._view.y / this._view.scale;
		const vw = this._size.width / this._view.scale;
		const vh = this._size.height / this._view.scale;
		ctx.globalAlpha = 0.9;
		ctx.strokeStyle = this._colors.fg;
		ctx.lineWidth = 1;
		ctx.strokeRect(ox + vx * scale + 0.5, oy + vy * scale + 0.5, vw * scale, vh * scale);
		ctx.globalAlpha = 0.08;
		ctx.fillStyle = this._colors.fg;
		ctx.fillRect(ox + vx * scale, oy + vy * scale, vw * scale, vh * scale);
	}
}
