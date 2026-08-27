/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGraphLayout, IGraphLayoutNode } from '../../common/diagrams/openideDiagramEngine.js';
import { nextDiagramId, SVG_NAMESPACE, svgForeign, svgNode } from './openideDiagramDom.js';

/**
 * The `graph` family (flowchart · state · mindmap): editorial rendering — orthogonal rounded
 * connectors, card nodes, one focal accent, in-figure legend (refs/diagram-design).
 *
 * Parsing and layout are NOT here: they live in common/diagrams/openideDiagramEngine.ts, which
 * both the chat and the diagrams MCP server already call. This file only turns a finished layout
 * into geometry, which is why the plan moves it to a shared module instead of a chat-only part —
 * the plan viewer draws the same picture from the same layout.
 *
 * The `dnode-*` / `dedge-*` / `dchip` class names are load-bearing and must not be renamed: the
 * full-screen viewer receives this exact `<svg>` as `outerHTML` and styles it with
 * OPENIDE_DIAGRAM_SVG_CSS (openideDiagramCss.ts), which selects on them.
 */

/** `<br/>` in a node label is a real line break, not literal text the reader has to decode. */
const BR_SPLIT = /<br\s*\/?>/i;

function appendLabel(doc: Document, host: HTMLElement, label: string): void {
	const lines = String(label).split(BR_SPLIT);
	lines.forEach((line, index) => {
		if (index > 0) {
			host.appendChild(doc.createElement('br'));
		}
		host.appendChild(doc.createTextNode(line.trim()));
	});
}

function shapeNode(doc: Document, n: IGraphLayoutNode, focal: boolean): SVGElement {
	const cls = focal ? 'dnode-shape focal' : 'dnode-shape';
	const cx = n.x + n.w / 2;
	const cy = n.y + n.h / 2;
	if (n.shape === 'circle') {
		return svgNode(doc, 'ellipse', { class: cls, cx, cy, rx: n.w / 2, ry: n.h / 2 });
	}
	if (n.shape === 'diamond') {
		const points = `${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`;
		return svgNode(doc, 'polygon', { class: cls, points });
	}
	// A 'round' node is a stadium: the radius is half the height, so it is not a parameter to tune.
	// Plain rects use radius-md (6) from the editorial scale — cards, not sharp boxes.
	const radius = n.shape === 'round' ? n.h / 2 : 6;
	return svgNode(doc, 'rect', { class: cls, x: n.x, y: n.y, width: n.w, height: n.h, rx: radius, ry: radius });
}

/**
 * Rounded ORTHOGONAL connector, r=8, transcribed from the diagram-design architecture spec
 * ("Rounded right-angle connectors are MANDATORY … diagonal `<line>` between off-axis nodes is a
 * hard fail"). Aligned endpoints stay a straight line; everything else becomes the two-bend elbow
 * with the turn on the layout's flow axis, so a horizontal graph turns sideways and a vertical one
 * turns downwards. The radius yields to short segments rather than overshooting them.
 */
function elbowPath(sx: number, sy: number, tx: number, ty: number, horizontal: boolean): string {
	if (Math.abs(sx - tx) < 0.75 || Math.abs(sy - ty) < 0.75) {
		return `M${sx},${sy} L${tx},${ty}`;
	}
	if (horizontal) {
		const mid = (sx + tx) / 2;
		const dx = Math.sign(tx - sx) || 1;
		const dy = Math.sign(ty - sy) || 1;
		const r = Math.min(8, Math.abs(mid - sx), Math.abs(tx - mid), Math.abs(ty - sy) / 2);
		return `M${sx},${sy} H${mid - dx * r} Q${mid},${sy} ${mid},${sy + dy * r} V${ty - dy * r} Q${mid},${ty} ${mid + dx * r},${ty} H${tx}`;
	}
	const mid = (sy + ty) / 2;
	const dy = Math.sign(ty - sy) || 1;
	const dx = Math.sign(tx - sx) || 1;
	const r = Math.min(8, Math.abs(mid - sy), Math.abs(ty - mid), Math.abs(tx - sx) / 2);
	return `M${sx},${sy} V${mid - dy * r} Q${sx},${mid} ${sx + dx * r},${mid} H${tx - dx * r} Q${tx},${mid} ${tx},${mid + dy * r} V${ty}`;
}

function arrowDefs(doc: Document, svgId: string): SVGDefsElement {
	// The clean editorial head: small, solid, muted — same polygon the design system's examples
	// register (`marker … polygon 0 0, 8 3, 0 6`).
	const path = svgNode(doc, 'path', { d: 'M0,0 L8,4 L0,8 z', fill: 'var(--oid-muted)' });
	const marker = svgNode(doc, 'marker', {
		id: `${svgId}-arrow`,
		viewBox: '0 0 8 8',
		refX: 7,
		refY: 4,
		markerWidth: 7,
		markerHeight: 7,
		// 'auto-start-reverse' and not 'auto': an RL/BT layout emits edges that run backwards and
		// plain 'auto' points their heads at the source.
		orient: 'auto-start-reverse',
	}, path);
	return svgNode(doc, 'defs', undefined, marker);
}

function appendEdges(doc: Document, svg: SVGSVGElement, layout: IGraphLayout, svgId: string): void {
	for (const e of layout.edges) {
		const midx = (e.sx + e.tx) / 2;
		const midy = (e.sy + e.ty) / 2;
		svg.appendChild(svgNode(doc, 'path', {
			class: e.dashed ? 'dedge-path dashed' : 'dedge-path',
			d: elbowPath(e.sx, e.sy, e.tx, e.ty, !!layout.horizontal),
			'marker-end': `url(#${svgId}-arrow)`,
		}));
		if (e.label) {
			const wrap = doc.createElement('div');
			wrap.style.display = 'flex';
			wrap.style.justifyContent = 'center';
			// The chip must not eat the pointer: the card underneath owns click and drag.
			wrap.style.pointerEvents = 'none';
			const chip = doc.createElement('span');
			chip.className = 'dchip';
			chip.textContent = e.label;
			wrap.appendChild(chip);
			svg.appendChild(svgForeign(doc, { x: midx - 60, y: midy - 9, width: 120, height: 18 }, wrap));
		}
	}
}

function appendNodes(doc: Document, svg: SVGSVGElement, layout: IGraphLayout): void {
	// ONE focal node per diagram (the style guide's hard rule): the entry node — the first the
	// source declared — which is the root of a mindmap, the initial state, the start of a flow.
	let focalLeft = 1;
	for (const nid in layout.nodes) {
		const n = layout.nodes[nid];
		const focal = focalLeft-- > 0;
		// A diamond and a circle only offer their inscribed rectangle to the text; using the full
		// box would print the label over the sloped edges.
		const round = n.shape === 'diamond' || n.shape === 'circle';
		const innerW = round ? n.w * 0.62 : n.w;
		const innerH = round ? n.h * 0.72 : n.h;
		svg.appendChild(shapeNode(doc, n, focal));
		const label = doc.createElement('div');
		label.className = focal ? 'dnode-label focal' : 'dnode-label';
		appendLabel(doc, label, n.label);
		svg.appendChild(svgForeign(doc, {
			x: n.x + (n.w - innerW) / 2,
			y: n.y + (n.h - innerH) / 2,
			width: innerW,
			height: innerH,
		}, label));
	}
}

/**
 * The legend row the architecture examples close with: swatch + label pairs, drawn INSIDE the SVG
 * so the full-screen viewer (which only receives `outerHTML`) keeps it. Only diagrams with enough
 * variety earn one — a three-node sketch does not need its treatments explained.
 */
function appendLegend(doc: Document, svg: SVGSVGElement, layout: IGraphLayout, y: number): void {
	const entries: { swatch: 'focal' | 'node' | 'dashed'; label: string }[] = [
		{ swatch: 'focal', label: 'Focal' },
		{ swatch: 'node', label: 'Paso' },
	];
	if (layout.edges.some(e => e.dashed)) {
		entries.push({ swatch: 'dashed', label: 'Asíncrono / retorno' });
	}
	let x = 12;
	for (const entry of entries) {
		if (entry.swatch === 'dashed') {
			svg.appendChild(svgNode(doc, 'line', { class: 'dleg-line', x1: x, y1: y + 5, x2: x + 14, y2: y + 5 }));
		} else {
			svg.appendChild(svgNode(doc, 'rect', { class: entry.swatch === 'focal' ? 'dleg-swatch focal' : 'dleg-swatch', x, y, width: 14, height: 10, rx: 2 }));
		}
		const text = svgNode(doc, 'text', { class: 'dleg-label', x: x + 20, y: y + 9 });
		text.textContent = entry.label;
		svg.appendChild(text);
		x += 20 + entry.label.length * 6 + 20;
	}
}

export function renderGraphDiagramSvg(doc: Document, layout: IGraphLayout): SVGSVGElement {
	const svgId = nextDiagramId('oidiag');
	// The legend adds a 28px strip under the figure; small sketches skip it (see appendLegend).
	const wantLegend = Object.keys(layout.nodes).length >= 4 || layout.edges.some(e => e.dashed);
	const height = wantLegend ? layout.height + 28 : layout.height;
	const svg = svgNode(doc, 'svg', {
		id: svgId,
		viewBox: `0 0 ${layout.width} ${height}`,
		width: layout.width,
		height,
		// Redundant in this document — `createElementNS` already put the element in the SVG
		// namespace — but the full-screen viewer ships `outerHTML` into a webview, and the HTML
		// serializer does not write namespaces back. Without it the copy is a plain unknown tag.
		xmlns: SVG_NAMESPACE,
	});
	svg.appendChild(arrowDefs(doc, svgId));
	// Edges first, nodes second: the node shapes are opaque and have to cover the curve ends.
	appendEdges(doc, svg, layout, svgId);
	appendNodes(doc, svg, layout);
	if (wantLegend) {
		appendLegend(doc, svg, layout, layout.height + 8);
	}
	return svg;
}
