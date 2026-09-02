/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChartSpec, parseDiagramSource } from '../../common/diagrams/openideDiagramEngine.js';
import { renderGanttChart, renderJourneyChart, renderPieChart, renderTimelineChart } from './openideChartFlow.js';
import { renderSequenceChart } from './openideChartSequence.js';
import { renderGitChart, renderQuadrantChart } from './openideChartStructure.js';
import { IOpenideChartRender } from './openideChartTheme.js';
import { renderGraphDiagramSvg } from './openideGraphDiagram.js';
import { INodeMapFocus, renderNodeMapSvg } from './openideNodeMapDiagram.js';
import { renderSeqMapSvg } from './openideSeqMapDiagram.js';
import './media/openideDiagrams.css';

/**
 * The one entry point every consumer of a diagram uses: source in, DOM out.
 *
 * It exists so the chat part and the plan viewer cannot drift apart — the webview had TWO
 * dispatchers (`renderDiagramResult` for the graph family, `renderChartHtml` for the charts,
 * the removed chat webview and :2282-2292) and the plan viewer a third copy of both.
 *
 * The container markup is transcribed from the webview: the OUTER box clips and the INNER box
 * scrolls. That split is not cosmetic — it is what keeps the full-screen button pinned while a wide
 * diagram scrolls under it, and in the native list it is also what keeps a 2000px-wide sequence
 * diagram inside its own row instead of widening every row of a `horizontalScrolling: false` list.
 */

export interface IOpenideDiagramRender {
	/** The `.openide-diagram` box, ready to append. */
	readonly domNode: HTMLElement;
	/**
	 * The whole picture as ONE element, when the diagram has one.
	 *
	 * Only then can the full-screen viewer be offered: it is handed `outerHTML`, and the timeline
	 * and journey charts are lists of HTML rows with no single node that means anything on its own.
	 */
	readonly svg?: SVGSVGElement;
	/**
	 * The picture's selection, for the frames that offer one. Only the typed maps have it: a chart
	 * has no nodes to pin, and a mermaid graph's focus is hover-only.
	 */
	readonly focus?: INodeMapFocus;
}

function renderChartSpec(doc: Document, spec: ChartSpec): IOpenideChartRender | undefined {
	switch (spec.kind) {
		case 'pie': return renderPieChart(doc, spec);
		case 'gantt': return renderGanttChart(doc, spec);
		case 'sequence': return renderSequenceChart(doc, spec);
		case 'timeline': return renderTimelineChart(doc, spec);
		case 'journey': return renderJourneyChart(doc, spec);
		case 'quadrant': return renderQuadrantChart(doc, spec);
		case 'git': return renderGitChart(doc, spec);
	}
}

/**
 * Renders `source` as a diagram, or returns undefined when it is not one.
 *
 * Undefined is a normal answer, not a failure: the caller falls back to a code block, exactly like
 * `buildDiagramOrCodeHtml` does. A THROW is also normal — the parsers are hand-written and a
 * half-streamed fence reaches them mid-token — so it is caught here rather than in every caller.
 */
export function renderOpenideDiagram(doc: Document, source: string): IOpenideDiagramRender | undefined {
	let result;
	try {
		result = parseDiagramSource(source);
	} catch {
		return undefined;
	}
	if (!result) {
		return undefined;
	}

	const domNode = doc.createElement('div');
	domNode.className = 'openide-diagram';
	const scroll = doc.createElement('div');
	scroll.className = 'openide-diagram-scroll';
	domNode.appendChild(scroll);

	try {
		if (result.family === 'graph') {
			const svg = renderGraphDiagramSvg(doc, result.layout);
			scroll.appendChild(svg);
			return { domNode, svg };
		}
		if (result.family === 'nodemap' || result.family === 'seqmap') {
			// The typed maps keep the dotted grid: it is the graph family's canvas texture, and the
			// Project Map (whose visual grammar this is) draws the same dots behind its nodes.
			const map = result.family === 'seqmap'
				? renderSeqMapSvg(doc, result.spec, result.layout)
				: renderNodeMapSvg(doc, result.spec, result.layout);
			scroll.appendChild(map.svg);
			return { domNode, svg: map.svg, focus: map.focus };
		}
		const chart = renderChartSpec(doc, result.spec);
		if (!chart || !chart.nodes.length) {
			return undefined;
		}
		// The dotted grid says "canvas" and belongs to the graph family only; a chart draws its own
		// axes and would fight it (the removed chat webview).
		domNode.classList.add('openide-diagram-chart');
		for (const node of chart.nodes) {
			scroll.appendChild(node);
		}
		return { domNode, svg: chart.svg };
	} catch {
		// A spec the parser accepted but a renderer choked on: the fence still has to show as code.
		return undefined;
	}
}
