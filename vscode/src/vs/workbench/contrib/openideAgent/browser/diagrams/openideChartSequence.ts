/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISequenceSpec } from '../../common/diagrams/openideDiagramEngine.js';
import { CH_AXIS, CH_GRID, CH_MID, CH_MUTED, CH_SOFT, fgA, IOpenideChartRender, textWpx } from './openideChartTheme.js';
import { nextDiagramId, SVG_NAMESPACE, svgNode, svgText } from './openideDiagramDom.js';

/**
 * The sequence diagram, ported from the webview (openideChatHtml.ts:1929-2031).
 *
 * It gets a file to itself because it is the only chart with STATE while drawing: an activation
 * stack per participant and a block stack for alt/loop/opt. Those two make it as long as the other
 * six charts together.
 *
 * The painting order is load-bearing and is why the webview kept three separate buffers, copied
 * here: block frames must sit UNDER the messages they enclose (hence `unshift`), lifelines under
 * everything, and the participant heads on top so a message arriving at a box does not draw over
 * its label.
 */

interface ISeqBlock {
	readonly kind: string;
	readonly label: string;
	readonly y: number;
	readonly elses: number[];
}

const MARGIN = 20, HEAD_H = 34, ROW_H = 38;

export function renderSequenceChart(doc: Document, spec: ISequenceSpec): IOpenideChartRender | undefined {
	const parts = spec.participants;
	const ink2 = fgA(0.78);

	// Columns are as wide as the widest participant needs; 120 is the floor so two short names do
	// not end up shoulder to shoulder.
	let colW = 120;
	for (const p of parts) {
		colW = Math.max(colW, textWpx(p.label, 8) + 28);
	}
	const colX = (id: string): number => {
		let index = 0;
		for (let i = 0; i < parts.length; i++) {
			if (parts[i].id === id) { index = i; break; }
		}
		return MARGIN + index * colW + colW / 2;
	};

	// Notes and self-messages stick out past the columns, so the viewBox is widened by what was
	// actually drawn instead of being computed from the participants alone.
	let minX = 0;
	let maxX = MARGIN * 2 + parts.length * colW;
	const touch = (x0: number, x1: number): void => {
		minX = Math.min(minX, x0);
		maxX = Math.max(maxX, x1);
	};

	const layers: SVGElement[] = [];
	const blockStack: ISeqBlock[] = [];
	const actStack = new Map<string, number[]>();

	const pushAct = (id: string, y: number): void => {
		const stack = actStack.get(id) ?? [];
		stack.push(y);
		actStack.set(id, stack);
	};
	/** Closes one activation bar. Nested ones are nudged 4px right so both stay visible. */
	const popAct = (id: string, y: number): void => {
		const stack = actStack.get(id);
		const start = stack?.pop();
		if (start === undefined) {
			return;
		}
		const cx = colX(id) + (stack ? stack.length : 0) * 4;
		layers.push(svgNode(doc, 'rect', {
			x: cx - 4, y: start, width: 8, height: Math.max(8, y - start), rx: 2,
			fill: CH_MID, stroke: CH_AXIS, 'stroke-width': 1,
		}));
	};

	let y = HEAD_H + 18;
	let num = 1;

	for (const e of spec.events) {
		if (e.type === 'block-start') {
			blockStack.push({ kind: e.kind, label: e.label, y: y - 10, elses: [] });
			y += 26;
			continue;
		}
		if (e.type === 'block-else') {
			blockStack[blockStack.length - 1]?.elses.push(y - 8);
			layers.push(svgText(doc, {
				x: MARGIN + 8, y: y + 2, fill: CH_MUTED, 'font-size': 10.5, 'font-style': 'italic',
			}, `[${e.label || 'else'}]`));
			y += 18;
			continue;
		}
		if (e.type === 'block-end') {
			const block = blockStack.pop();
			if (block) {
				const bx0 = MARGIN - 6;
				const bx1 = MARGIN + parts.length * colW + 6;
				touch(bx0, bx1);
				const group = svgNode(doc, 'g', undefined,
					svgNode(doc, 'rect', {
						x: bx0, y: block.y, width: bx1 - bx0, height: y - block.y + 4, rx: 4,
						fill: 'none', stroke: CH_AXIS, 'stroke-width': 1,
					}),
					svgNode(doc, 'rect', {
						x: bx0, y: block.y, width: textWpx(block.kind, 6) + 18, height: 16, fill: CH_SOFT,
					}),
					svgText(doc, {
						x: bx0 + 6, y: block.y + 12, fill: ink2, 'font-size': 10.5, 'font-weight': 600,
					}, block.kind),
				);
				if (block.label) {
					group.appendChild(svgText(doc, {
						x: bx0 + textWpx(block.kind, 6) + 22, y: block.y + 12, fill: CH_MUTED, 'font-size': 10.5,
					}, `[${block.label}]`));
				}
				for (const ey of block.elses) {
					group.appendChild(svgNode(doc, 'line', {
						x1: bx0, y1: ey, x2: bx1, y2: ey, stroke: CH_GRID, 'stroke-dasharray': '4 3', 'stroke-width': 1,
					}));
				}
				// The frame goes to the BOTTOM of the stack so it never covers its own contents.
				layers.unshift(group);
			}
			y += 8;
			continue;
		}
		if (e.type === 'note') {
			const xs = e.actors.map(colX);
			const cx0 = Math.min(...xs);
			const cx1 = Math.max(...xs);
			const w = Math.max(textWpx(e.text, 6.8) + 20, cx1 - cx0 + 60);
			const nx = e.placement === 'left' ? cx0 - w - 10 : e.placement === 'right' ? cx1 + 10 : (cx0 + cx1) / 2 - w / 2;
			touch(nx - 4, nx + w + 4);
			layers.push(svgNode(doc, 'g', undefined,
				svgNode(doc, 'rect', {
					x: nx, y: y - 4, width: w, height: 24, rx: 3,
					fill: CH_SOFT, stroke: CH_GRID, 'stroke-width': 1,
				}),
				svgText(doc, {
					x: nx + w / 2, y: y + 11, 'text-anchor': 'middle', fill: ink2, 'font-size': 11.5,
				}, e.text),
			));
			y += 34;
			continue;
		}

		// A bare `activate A` / `deactivate A` arrives as a self-message with no text: it only moves
		// the activation stack and must not draw an arrow or advance the cursor.
		if (e.activate && e.from === e.to && !e.text) { pushAct(e.to, y - 6); continue; }
		if (e.deactivate && e.from === e.to && !e.text) { popAct(e.from, y - 6); continue; }

		const x1 = colX(e.from);
		const x2 = colX(e.to);
		const label = spec.autonumber ? `${num++}. ${e.text}` : e.text;
		const dash = e.dashed ? '5 4' : undefined;

		if (e.from === e.to) {
			touch(x1, x1 + 46 + textWpx(label, 7.5));
			layers.push(svgNode(doc, 'g', undefined,
				svgNode(doc, 'path', {
					d: `M ${x1},${y} h 34 v 18 h -30`, fill: 'none',
					stroke: CH_MUTED, 'stroke-width': 1.5, 'stroke-dasharray': dash,
				}),
				svgNode(doc, 'polygon', {
					points: `${x1 + 4},${y + 18} ${x1 + 12},${y + 14} ${x1 + 12},${y + 22}`, fill: CH_MUTED,
				}),
				svgText(doc, { x: x1 + 40, y: y - 2, fill: ink2, 'font-size': 12 }, label),
			));
			y += ROW_H + 6;
			continue;
		}

		const dir = x2 > x1 ? 1 : -1;
		const half = textWpx(label, 7.5) / 2;
		touch((x1 + x2) / 2 - half - 4, (x1 + x2) / 2 + half + 4);
		// An open arrow (`->>`) is a stroked chevron; a closed one is a filled triangle. Mermaid
		// gives them different meanings, so the two must stay distinguishable.
		const head = e.open
			? svgNode(doc, 'path', {
				d: `M ${x2 - dir * 9},${y - 4} L ${x2},${y} L ${x2 - dir * 9},${y + 4}`,
				fill: 'none', stroke: CH_MUTED, 'stroke-width': 1.5,
			})
			: svgNode(doc, 'polygon', {
				points: `${x2},${y} ${x2 - dir * 9},${y - 4} ${x2 - dir * 9},${y + 4}`, fill: CH_MUTED,
			});
		layers.push(svgNode(doc, 'g', undefined,
			svgText(doc, { x: (x1 + x2) / 2, y: y - 6, 'text-anchor': 'middle', fill: ink2, 'font-size': 12 }, label),
			svgNode(doc, 'line', {
				x1, y1: y, x2: x2 - dir * 2, y2: y,
				stroke: CH_MUTED, 'stroke-width': 1.5, 'stroke-dasharray': dash,
			}),
			head,
		));
		if (e.activate) { pushAct(e.to, y); }
		if (e.deactivate) { popAct(e.from, y); }
		y += ROW_H;
	}

	// A source that opened more activations than it closed would otherwise leave zero-height bars.
	for (const id of actStack.keys()) {
		while ((actStack.get(id)?.length ?? 0) > 0) {
			popAct(id, y);
		}
	}

	const bottom = y + 8;
	const left = minX - 4;
	const W = maxX + 4 - left;
	const H = bottom + HEAD_H;
	const svg = svgNode(doc, 'svg', {
		id: nextDiagramId('oichart'), width: W, height: H, viewBox: `${left} 0 ${W} ${H}`, xmlns: SVG_NAMESPACE,
	});

	for (const p of parts) {
		svg.appendChild(svgNode(doc, 'line', {
			x1: colX(p.id), y1: HEAD_H, x2: colX(p.id), y2: bottom,
			stroke: CH_GRID, 'stroke-width': 1, 'stroke-dasharray': '3 4',
		}));
	}
	for (const layer of layers) {
		svg.appendChild(layer);
	}
	// Heads are repeated at the foot of the diagram: a long sequence is read scrolled, and the top
	// row is off screen by then.
	for (const p of parts) {
		const cx = colX(p.id);
		for (const cy of [HEAD_H / 2, bottom + HEAD_H / 2]) {
			svg.appendChild(svgNode(doc, 'g', undefined,
				svgNode(doc, 'rect', {
					x: cx - colW / 2 + 8, y: cy - 12, width: colW - 16, height: 24,
					// An `actor` is pill-shaped, a plain participant is a box: same convention as mermaid.
					rx: p.actor ? 12 : 2,
					fill: CH_SOFT, stroke: CH_GRID, 'stroke-width': 1,
				}),
				svgText(doc, {
					x: cx, y: cy + 4, 'text-anchor': 'middle',
					fill: 'var(--vscode-foreground)', 'font-size': 12, 'font-weight': 500,
				}, p.label),
			));
		}
	}

	return { nodes: [svg], svg };
}
