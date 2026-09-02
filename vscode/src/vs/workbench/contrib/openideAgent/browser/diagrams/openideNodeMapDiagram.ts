/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INodeMapLayout, INodeMapPlacedNode, INodeMapSpec, NodeMapType } from '../../common/diagrams/openideNodeMaps.js';
import { OpenideStringKey, t } from '../../common/openideStrings.js';
import { nextDiagramId, SVG_NAMESPACE, svgForeign, svgNode, svgText, svgTooltip } from './openideDiagramDom.js';

/**
 * The typed-map family (archmap · flowmap · lifemap): the Project Map's visual grammar, in SVG.
 * Circle nodes sized by degree and coloured by SEMANTIC KIND (the Project Map colours by
 * community; here the community is the authored group and the colour carries meaning instead),
 * slightly-bent quadratic edges always curving to the same side, halo rings on the emphasised
 * nodes, soft dashed hulls around the authored groups (boundaries, lanes), and hover focus that
 * dims everything not adjacent — the map, not the tangle. One renderer, one skin; only the
 * palette and the legend words change per type.
 *
 * SVG and not the Project Map's <canvas> on purpose: that canvas exists for 300+ nodes, an
 * authored map is capped by validation at map scale, and SVG is what the chat rows, the
 * full-screen viewer and the plan webview already carry (`.amap-*` classes styled from
 * openideDiagrams.css and OPENIDE_DIAGRAM_SVG_CSS — both must stay in sync).
 */

/** The Project Map palette hues, assigned by meaning, one vocabulary per map type. */
export const NODE_MAP_COLORS: Record<NodeMapType, Record<string, string>> = {
	archmap: {
		frontend: '#38bdf8',
		backend: '#4ade80',
		database: '#c084fc',
		cloud: '#fbbf24',
		security: '#f87171',
		messagebus: '#fb923c',
		external: '#94a3b8',
	},
	flowmap: {
		start: '#4ade80',
		step: '#38bdf8',
		decision: '#fbbf24',
		tool: '#c084fc',
		end: '#2dd4bf',
		failure: '#f87171',
	},
	lifemap: {
		initial: '#38bdf8',
		active: '#4ade80',
		waiting: '#fbbf24',
		terminal: '#94a3b8',
		failure: '#f87171',
	},
};

const FALLBACK_COLOR = '#94a3b8';

export function nodeMapColorFor(type: NodeMapType, kind: string): string {
	return NODE_MAP_COLORS[type][kind] ?? FALLBACK_COLOR;
}

function kindLabelKey(type: NodeMapType, kind: string): OpenideStringKey {
	return `${type}.kind.${kind}` as OpenideStringKey;
}

/** The legend's word for a kind, so a panel beside the picture names it the same way. */
export function nodeMapKindLabel(type: NodeMapType, kind: string): string {
	return t(kindLabelKey(type, kind));
}

/** Same slight bend, always to the same side, as the Project Map's `_edgePath`. */
const EDGE_BEND = 0.1;
const MARGIN_X = 72;
const MARGIN_BOTTOM = 36;
const LEGEND_HEIGHT = 26;

interface IEdgeRef {
	readonly el: SVGElement;
	readonly from: string;
	readonly to: string;
}

/** Where a line towards (tx, ty) leaves the node's BOX, pushed `margin` further out. */
function boxExit(node: INodeMapPlacedNode, tx: number, ty: number, margin: number): { x: number; y: number } {
	const dx = tx - node.x;
	const dy = ty - node.y;
	const sx = dx === 0 ? Infinity : (node.w / 2) / Math.abs(dx);
	const sy = dy === 0 ? Infinity : (node.h / 2) / Math.abs(dy);
	const s = Math.min(sx, sy);
	const len = Math.hypot(dx, dy) || 1;
	return { x: node.x + dx * s + (dx / len) * margin, y: node.y + dy * s + (dy / len) * margin };
}

function edgePath(a: INodeMapPlacedNode, b: INodeMapPlacedNode): { d: string; labelX: number; labelY: number } {
	const mx = (a.x + b.x) / 2;
	const my = (a.y + b.y) / 2;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const cx = mx - dy * EDGE_BEND;
	const cy = my + dx * EDGE_BEND;
	// Trimmed to the box borders along the curve's end tangents; the target keeps extra room so
	// the arrowhead sits against the border instead of under the shape.
	const start = boxExit(a, cx, cy, 2);
	const end = boxExit(b, cx, cy, 7);
	return {
		d: `M${start.x},${start.y} Q${cx},${cy} ${end.x},${end.y}`,
		// The quadratic's own midpoint (t = 0.5), not the chord's: the chip rides the curve.
		labelX: 0.25 * start.x + 0.5 * cx + 0.25 * end.x,
		labelY: 0.25 * start.y + 0.5 * cy + 0.25 * end.y,
	};
}

export function appendArrowDefs(doc: Document, svg: SVGSVGElement, svgId: string): void {
	svg.appendChild(svgNode(doc, 'defs', undefined, svgNode(doc, 'marker', {
		id: `${svgId}-arrow`,
		viewBox: '0 0 8 8',
		refX: 7,
		refY: 4,
		markerWidth: 6.5,
		markerHeight: 6.5,
		orient: 'auto-start-reverse',
	}, svgNode(doc, 'path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--oid-muted)' }))));
}

/** The chip an edge label rides on; shared with the seqmap renderer. */
export function appendEdgeChip(doc: Document, svg: SVGSVGElement, label: string, x: number, y: number): void {
	const wrap = doc.createElement('div');
	wrap.style.display = 'flex';
	wrap.style.justifyContent = 'center';
	wrap.style.pointerEvents = 'none';
	const chip = doc.createElement('span');
	chip.className = 'dchip';
	chip.textContent = label;
	wrap.appendChild(chip);
	svg.appendChild(svgForeign(doc, { x: x - 60, y: y - 9, width: 120, height: 18 }, wrap));
}

export function renderNodeMapSvg(doc: Document, spec: INodeMapSpec, layout: INodeMapLayout): INodeMapRender {
	const svgId = nextDiagramId('oimap');
	const topMargin = spec.title ? 46 : 28;
	const viewWidth = layout.width + MARGIN_X * 2;
	const viewHeight = layout.height + topMargin + MARGIN_BOTTOM + LEGEND_HEIGHT;
	const svg = svgNode(doc, 'svg', {
		id: svgId,
		class: 'amap-svg',
		viewBox: `${-MARGIN_X} ${-topMargin} ${viewWidth} ${viewHeight}`,
		width: viewWidth,
		height: viewHeight,
		xmlns: SVG_NAMESPACE,
	});
	appendArrowDefs(doc, svg, svgId);

	if (spec.title) {
		svg.appendChild(svgText(doc, { class: 'amap-title', x: -MARGIN_X + 6, y: -topMargin + 16 }, spec.title));
	}

	// Hulls first: the boundary is context and everything else draws on top of it.
	for (const hull of layout.hulls) {
		svg.appendChild(svgNode(doc, 'rect', { class: 'amap-hull', x: hull.x, y: hull.y, width: hull.w, height: hull.h, rx: 14, ry: 14 }));
		svg.appendChild(svgText(doc, { class: 'amap-hull-label', x: hull.x + 12, y: hull.y + 15 }, hull.label));
	}

	const byId = new Map(layout.nodes.map(node => [node.id, node]));
	const neighbors = new Map<string, Set<string>>();
	const link = (a: string, b: string): void => {
		(neighbors.get(a) ?? neighbors.set(a, new Set()).get(a)!).add(b);
	};
	const edgeRefs: IEdgeRef[] = [];
	for (const edge of spec.edges) {
		const a = byId.get(edge.from);
		const b = byId.get(edge.to);
		if (!a || !b) { continue; }
		link(a.id, b.id);
		link(b.id, a.id);
		const { d, labelX, labelY } = edgePath(a, b);
		const path = svgNode(doc, 'path', {
			class: edge.dashed ? 'amap-edge dashed' : 'amap-edge',
			d,
			'marker-end': `url(#${svgId}-arrow)`,
		});
		svg.appendChild(path);
		edgeRefs.push({ el: path, from: a.id, to: b.id });
		if (edge.label) {
			appendEdgeChip(doc, svg, edge.label, labelX, labelY);
		}
	}

	// Least connected first, hubs on top — the Project Map's stacking order.
	const nodeEls = new Map<string, SVGGElement>();
	for (const node of [...layout.nodes].sort((a, b) => a.degree - b.degree)) {
		const color = nodeMapColorFor(spec.type, node.kind);
		const g = svgNode(doc, 'g', { class: 'amap-node', 'data-id': node.id });
		appendShapeBox(doc, g, node, color);
		svgTooltip(g, node.sublabel ? `${node.label} · ${node.sublabel}` : node.label);
		svg.appendChild(g);
		nodeEls.set(node.id, g);
	}

	appendLegend(doc, svg, spec, layout);
	const focus = wireFocus(svg, nodeEls, edgeRefs, neighbors, node => nodeMapColorFor(spec.type, byId.get(node)!.kind));
	return { svg, focus };
}

/**
 * One shape with its text INSIDE — the anatomy Archify gives a component (label, sublabel, kind
 * accent), drawn with our tokens. Cards for components, stadiums for start/end and states,
 * diamonds for decisions; the kind colours the border, the dot, and — on emphasis — a tint.
 * Shared with the seqmap renderer, whose actors are the same card.
 */
export function appendShapeBox(
	doc: Document,
	g: SVGGElement,
	node: { x: number; y: number; w: number; h: number; shape: 'card' | 'stadium' | 'diamond'; label: string; sublabel?: string; emphasis?: boolean },
	color: string,
): void {
	const left = node.x - node.w / 2;
	const top = node.y - node.h / 2;
	const cls = node.emphasis ? 'amap-shape emphasis' : 'amap-shape';
	let shapeEl: SVGElement;
	if (node.shape === 'diamond') {
		const points = `${node.x},${top} ${left + node.w},${node.y} ${node.x},${top + node.h} ${left},${node.y}`;
		shapeEl = svgNode(doc, 'polygon', { class: cls, points, stroke: color });
	} else {
		const radius = node.shape === 'stadium' ? node.h / 2 : 8;
		shapeEl = svgNode(doc, 'rect', { class: cls, x: left, y: top, width: node.w, height: node.h, rx: radius, ry: radius, stroke: color });
	}
	if (node.emphasis) {
		// The tint archify gives its focal component, from OUR kind colour over OUR paper.
		(shapeEl as SVGElement & ElementCSSInlineStyle).style.fill = `color-mix(in srgb, ${color} 10%, var(--oid-paper))`;
	}
	g.appendChild(shapeEl);

	// A diamond only offers its inscribed rectangle to the text.
	const innerW = node.shape === 'diamond' ? node.w * 0.6 : node.w;
	const innerH = node.shape === 'diamond' ? node.h * 0.64 : node.h;
	const card = doc.createElement('div');
	card.className = 'amap-card';
	const row = doc.createElement('div');
	row.className = 'amap-card-row';
	const dot = doc.createElement('span');
	dot.className = 'amap-card-dot';
	dot.style.backgroundColor = color;
	row.appendChild(dot);
	const title = doc.createElement('span');
	title.className = 'amap-card-title';
	title.textContent = node.label;
	row.appendChild(title);
	card.appendChild(row);
	if (node.sublabel) {
		const sub = doc.createElement('div');
		sub.className = 'amap-card-sub';
		sub.textContent = node.sublabel;
		card.appendChild(sub);
	}
	g.appendChild(svgForeign(doc, {
		x: node.x - innerW / 2,
		y: node.y - innerH / 2,
		width: innerW,
		height: innerH,
	}, card));
}

function appendLegend(doc: Document, svg: SVGSVGElement, spec: INodeMapSpec, layout: INodeMapLayout): void {
	const vocabulary = Object.keys(NODE_MAP_COLORS[spec.type]);
	const kinds = [...new Set(spec.nodes.map(node => node.kind))]
		.sort((a, b) => vocabulary.indexOf(a) - vocabulary.indexOf(b));
	const y = layout.height + MARGIN_BOTTOM + 6;
	let x = -MARGIN_X + 8;
	for (const kind of kinds) {
		const label = t(kindLabelKey(spec.type, kind));
		svg.appendChild(svgNode(doc, 'circle', { class: 'amap-legend-dot', cx: x + 4, cy: y, r: 4, fill: nodeMapColorFor(spec.type, kind) }));
		svg.appendChild(svgText(doc, { class: 'dleg-label', x: x + 13, y: y + 3 }, label));
		x += 13 + label.length * 5.6 + 18;
	}
	if (spec.edges.some(edge => edge.dashed)) {
		const label = t('archmap.legend.dashed');
		svg.appendChild(svgNode(doc, 'line', { class: 'dleg-line', x1: x, y1: y, x2: x + 14, y2: y }));
		svg.appendChild(svgText(doc, { class: 'dleg-label', x: x + 20, y: y + 3 }, label));
	}
}

/**
 * The Project Map's hover focus, on DOM instead of canvas: entering a node dims everything that
 * is not it, a neighbour or an incident edge, and the incident edges take the focused node's
 * colour. Plain listeners, no disposables: they live and die with the SVG they are attached to,
 * and BOTH consumers (the chat row and the full-screen viewer) render fresh from source. Shared
 * with the seqmap renderer, whose "nodes" are actors and whose "edges" are messages.
 */
/**
 * The picture's selection, handed to whoever frames it. The chat row ignores it — hovering is all
 * a transcript needs — while the saved-map editor pins a node on click and opens its inspector,
 * which is Archify's "click a component and read what it touches".
 */
export interface INodeMapFocus {
	/** The pinned node, if any. */
	readonly selected: string | undefined;
	/** Pins the focus from OUTSIDE (a row in the inspector), or clears it with undefined. */
	select(id: string | undefined): void;
	/** Fires when the PICTURE changes the selection: a click on a node, or on the paper. */
	onDidSelect(listener: (id: string | undefined) => void): void;
}

export interface INodeMapRender {
	readonly svg: SVGSVGElement;
	readonly focus: INodeMapFocus;
}

export function wireFocus(
	svg: SVGSVGElement,
	nodeEls: ReadonlyMap<string, SVGGElement>,
	edgeRefs: readonly IEdgeRef[],
	neighbors: ReadonlyMap<string, ReadonlySet<string>>,
	colorOf: (id: string) => string,
): INodeMapFocus {
	const listeners: ((id: string | undefined) => void)[] = [];
	let pinned: string | undefined;

	const clear = (): void => {
		svg.classList.remove('amap-focus');
		for (const el of nodeEls.values()) { el.classList.remove('on', 'pinned'); }
		for (const edge of edgeRefs) { edge.el.classList.remove('on'); }
	};
	const apply = (id: string | undefined): void => {
		clear();
		const g = id ? nodeEls.get(id) : undefined;
		if (!id || !g) {
			return;
		}
		svg.classList.add('amap-focus');
		const adjacent = neighbors.get(id);
		g.classList.add('on');
		if (id === pinned) {
			g.classList.add('pinned');
		}
		for (const [otherId, other] of nodeEls) {
			if (adjacent?.has(otherId)) { other.classList.add('on'); }
		}
		const color = colorOf(id);
		for (const edge of edgeRefs) {
			if (edge.from === id || edge.to === id) {
				edge.el.classList.add('on');
				(edge.el as SVGElement & ElementCSSInlineStyle).style.setProperty('--amap-c', color);
			}
		}
	};

	for (const [id, g] of nodeEls) {
		g.addEventListener('pointerenter', () => apply(id));
		// Leaving falls back to the PIN, not to nothing: a selection made by clicking has to survive
		// the pointer wandering off, or reading the panel it opened would undo it.
		g.addEventListener('pointerleave', () => apply(pinned));
		g.addEventListener('click', event => {
			event.stopPropagation();
			pinned = pinned === id ? undefined : id;
			apply(pinned);
			for (const listener of listeners) { listener(pinned); }
		});
	}
	// Clicking the paper is how you let go of a selection, the way it works on a canvas.
	svg.addEventListener('click', () => {
		if (pinned === undefined) {
			return;
		}
		pinned = undefined;
		apply(undefined);
		for (const listener of listeners) { listener(undefined); }
	});

	return {
		get selected(): string | undefined { return pinned; },
		select(id: string | undefined): void {
			pinned = id && nodeEls.has(id) ? id : undefined;
			apply(pinned);
		},
		onDidSelect(listener: (id: string | undefined) => void): void {
			listeners.push(listener);
		},
	};
}
