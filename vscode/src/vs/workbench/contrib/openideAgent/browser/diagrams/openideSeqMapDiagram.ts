/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISeqMapLayout, ISeqMapSpec } from '../../common/diagrams/openideSeqMap.js';
import { t } from '../../common/openideStrings.js';
import { nextDiagramId, SVG_NAMESPACE, svgNode, svgText, svgTooltip } from './openideDiagramDom.js';
import { INodeMapRender, appendArrowDefs, appendEdgeChip, appendShapeBox, nodeMapColorFor, wireFocus } from './openideNodeMapDiagram.js';

/**
 * seqmap: the sequence diagram's own design, in our skin. Actors are the family's CARDS (kind
 * accent, label inside) heading their columns, their lifelines fall as faint dotted rails, and
 * each step is one straight horizontal arrow riding a chip with its message — time reads top to
 * bottom, actors left to right, exactly the shape a sequence diagram is expected to have. The
 * `.amap-*` classes are reused on purpose: hovering an actor dims every message that is not
 * theirs through the exact same CSS the other maps use.
 */

const MARGIN_X = 72;
const MARGIN_BOTTOM = 30;
const LEGEND_HEIGHT = 26;
/** How far a self-message loops out beside its lifeline. */
const SELF_REACH = 46;

export function renderSeqMapSvg(doc: Document, spec: ISeqMapSpec, layout: ISeqMapLayout): INodeMapRender {
	const svgId = nextDiagramId('oiseq');
	const topMargin = spec.title ? 40 : 22;
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
		svg.appendChild(svgText(doc, { class: 'amap-title', x: -MARGIN_X + 6, y: -topMargin + 14 }, spec.title));
	}

	// Lifelines first: rails are context, messages draw on top of them.
	for (const actor of layout.actors) {
		svg.appendChild(svgNode(doc, 'line', {
			class: 'smap-lifeline',
			x1: actor.x,
			y1: actor.y + actor.h / 2 + 4,
			x2: actor.x,
			y2: layout.lifelineBottom,
		}));
	}

	interface IStepRef { readonly el: SVGElement; readonly from: string; readonly to: string }
	const stepRefs: IStepRef[] = [];
	const neighbors = new Map<string, Set<string>>();
	const link = (a: string, b: string): void => {
		(neighbors.get(a) ?? neighbors.set(a, new Set()).get(a)!).add(b);
	};
	for (const step of layout.steps) {
		link(step.from, step.to);
		link(step.to, step.from);
		let d: string;
		let chipX: number;
		if (step.self) {
			// A small loop beside the lifeline: out, down, back, arrow returning home.
			d = `M${step.fromX + 4},${step.y - 10} C${step.fromX + SELF_REACH},${step.y - 12} ${step.fromX + SELF_REACH},${step.y + 12} ${step.fromX + 4},${step.y + 10}`;
			chipX = step.fromX + SELF_REACH + 34;
		} else {
			// Straight, like every sequence diagram a reader has met: the message IS the row.
			const direction = Math.sign(step.toX - step.fromX);
			const fromX = step.fromX + direction * 4;
			const toX = step.toX - direction * 11;
			d = `M${fromX},${step.y} L${toX},${step.y}`;
			chipX = (step.fromX + step.toX) / 2;
		}
		const path = svgNode(doc, 'path', {
			class: step.dashed ? 'amap-edge dashed' : 'amap-edge',
			d,
			'marker-end': `url(#${svgId}-arrow)`,
		});
		svg.appendChild(path);
		stepRefs.push({ el: path, from: step.from, to: step.to });
		appendEdgeChip(doc, svg, step.label, chipX, step.y);
	}

	const colorOf = new Map(spec.actors.map(actor => [actor.id, nodeMapColorFor('archmap', actor.kind)]));
	const actorEls = new Map<string, SVGGElement>();
	for (const actor of layout.actors) {
		const g = svgNode(doc, 'g', { class: 'amap-node', 'data-id': actor.id });
		appendShapeBox(doc, g, { ...actor, shape: 'card' }, colorOf.get(actor.id)!);
		svgTooltip(g, actor.sublabel ? `${actor.label} · ${actor.sublabel}` : actor.label);
		svg.appendChild(g);
		actorEls.set(actor.id, g);
	}

	appendLegend(doc, svg, spec, layout);
	const focus = wireFocus(svg, actorEls, stepRefs, neighbors, id => colorOf.get(id)!);
	return { svg, focus };
}

function appendLegend(doc: Document, svg: SVGSVGElement, spec: ISeqMapSpec, layout: ISeqMapLayout): void {
	const kinds = [...new Set(spec.actors.map(actor => actor.kind))];
	const y = layout.height + MARGIN_BOTTOM + 4;
	let x = -MARGIN_X + 8;
	for (const kind of kinds) {
		const label = t(`archmap.kind.${kind}` as Parameters<typeof t>[0]);
		svg.appendChild(svgNode(doc, 'circle', { class: 'amap-legend-dot', cx: x + 4, cy: y, r: 4, fill: nodeMapColorFor('archmap', kind) }));
		svg.appendChild(svgText(doc, { class: 'dleg-label', x: x + 13, y: y + 3 }, label));
		x += 13 + label.length * 5.6 + 18;
	}
	if (spec.steps.some(step => step.dashed)) {
		const label = t('seqmap.legend.reply');
		svg.appendChild(svgNode(doc, 'line', { class: 'dleg-line', x1: x, y1: y, x2: x + 14, y2: y }));
		svg.appendChild(svgText(doc, { class: 'dleg-label', x: x + 20, y: y + 3 }, label));
	}
}
