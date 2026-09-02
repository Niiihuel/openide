/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGanttSpec, IJourneySpec, IPieSpec, ITimelineSpec } from '../../common/diagrams/openideDiagramEngine.js';
import {
	CH_DAY, CH_GRID, CH_HATCH_FILL, CH_HATCH_INK, CH_MID, CH_MUTED,
	chartRamp, chartTitleNode, donutSlice, fgA, IOpenideChartRender,
} from './openideChartTheme.js';
import { chartDiv, chartSpan, nextDiagramId, SVG_NAMESPACE, svgNode, svgText, svgTooltip } from './openideDiagramDom.js';

/**
 * pie · gantt · timeline · journey, ported from the webview.
 *
 * These four share nothing but the palette; they are in one file because they are the SMALL half
 * of the chart family and the module has a 280-line ceiling. The rest live next door: the sequence
 * diagram alone in openideChartSequence.ts, quadrant and git in openideChartStructure.ts.
 */

export function renderPieChart(doc: Document, spec: IPieSpec): IOpenideChartRender | undefined {
	// A pie of nothing would divide by zero; the fallback makes every slice 0% instead of NaN.
	const total = spec.slices.reduce((sum, s) => sum + s.value, 0) || 1;
	const R = 88, INNER = 44, C = 96;
	const ramp = chartRamp(spec.slices.length);
	const svg = svgNode(doc, 'svg', {
		id: nextDiagramId('oichart'),
		width: 2 * C, height: 2 * C, viewBox: `0 0 ${2 * C} ${2 * C}`, xmlns: SVG_NAMESPACE,
	});
	const keys = chartDiv(doc, 'openide-chart-keys');
	let angle = 0;
	spec.slices.forEach((s, i) => {
		const frac = s.value / total;
		const a0 = angle;
		const a1 = angle + frac * 2 * Math.PI;
		angle = a1;
		// A single slice covering the whole ring cannot be drawn as one arc — start and end
		// coincide and the renderer collapses it to nothing — so it is split in two halves.
		const d = frac >= 0.999
			? `${donutSlice(C, C, INNER, R, 0, Math.PI)} ${donutSlice(C, C, INNER, R, Math.PI, 2 * Math.PI)}`
			: donutSlice(C, C, INNER, R, a0, a1);
		const percent = Math.round(frac * 100);
		const path = svgNode(doc, 'path', {
			d, fill: ramp[i],
			// The stroke is the background colour: it separates neighbouring slices without
			// spending a second ink on a border.
			stroke: 'var(--vscode-editor-background)', 'stroke-width': 2,
		});
		svgTooltip(path, `${s.label} — ${s.value} · ${percent}%`);
		svg.appendChild(path);
		const key = chartDiv(doc, 'openide-chart-key');
		const swatch = chartSpan(doc, 'openide-chart-swatch');
		swatch.style.background = ramp[i];
		key.appendChild(swatch);
		key.appendChild(chartSpan(doc, '', s.label));
		key.appendChild(chartSpan(doc, 'openide-chart-key-muted', `${s.value} · ${percent}%`));
		keys.appendChild(key);
	});
	const row = chartDiv(doc, 'openide-chart-pie-row');
	row.appendChild(svg);
	row.appendChild(keys);
	const title = chartTitleNode(doc, spec.title);
	return { nodes: title ? [title, row] : [row], svg };
}

/** Hatched = critical, solid ink = active, ghost = done, mid grey = not started. */
function ganttBarFill(status: string | undefined, hatchId: string): string {
	if (status === 'crit') { return `url(#${hatchId})`; }
	if (status === 'active') { return fgA(0.85); }
	if (status === 'done') { return 'rgba(128,128,128,0.18)'; }
	return CH_MID;
}

export function renderGanttChart(doc: Document, spec: IGanttSpec): IOpenideChartRender | undefined {
	const tasks = spec.sections.flatMap(s => s.tasks);
	if (!tasks.length) {
		return undefined;
	}
	const min = Math.min(...tasks.map(t => t.start));
	const max = Math.max(...tasks.map(t => t.end));
	// A chart whose tasks all fall on the same instant would make every bar infinitely wide.
	const span = (max - min) || CH_DAY;
	const LABEL_W = 178, LABEL_MAX = 22, CHART_W = 440, ROW_H = 26, TOP = 28;
	const x = (ms: number): number => LABEL_W + ((ms - min) / span) * CHART_W;
	const fmt = (ms: number): string => new Date(ms).toISOString().slice(5, 10);
	const hatchId = nextDiagramId('oihatch');
	const body: SVGElement[] = [];
	let y = TOP;
	for (const sec of spec.sections) {
		if (sec.name) {
			body.push(svgText(doc, { x: 4, y: y + 17, fill: fgA(0.78), 'font-size': 12, 'font-weight': 600 }, sec.name));
			y += ROW_H;
		}
		for (const t of sec.tasks) {
			const bx = x(t.start);
			// A same-day task would be a zero-width rect: 6px keeps it visible and clickable.
			const bw = Math.max(t.milestone ? 0 : 6, x(t.end) - bx);
			const lbl = t.label.length > LABEL_MAX ? `${t.label.slice(0, LABEL_MAX - 1)}…` : t.label;
			body.push(svgText(doc, { x: LABEL_W - 8, y: y + 17, 'text-anchor': 'end', fill: fgA(0.78), 'font-size': 12 }, lbl));
			if (t.milestone) {
				const marker = svgNode(doc, 'path', {
					d: `M ${bx},${y + 6} l 7,7 l -7,7 l -7,-7 Z`,
					fill: 'var(--vscode-focusBorder)',
				});
				svgTooltip(marker, `${t.label} — ${fmt(t.start)}`);
				body.push(marker);
			} else {
				const rect = svgNode(doc, 'rect', {
					x: bx, y: y + 5, width: bw, height: ROW_H - 10, rx: 3,
					fill: ganttBarFill(t.status, hatchId),
					stroke: t.status === 'crit' ? CH_HATCH_INK : undefined,
				});
				svgTooltip(rect, `${t.label} — ${fmt(t.start)} → ${fmt(t.end)}`);
				body.push(rect);
			}
			y += ROW_H;
		}
	}
	const W = LABEL_W + CHART_W + 24;
	const H = y + 8;
	const svg = svgNode(doc, 'svg', { id: nextDiagramId('oichart'), width: W, height: H, viewBox: `0 0 ${W} ${H}`, xmlns: SVG_NAMESPACE });
	const pattern = svgNode(doc, 'pattern', {
		id: hatchId, patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(-45)',
	},
		svgNode(doc, 'rect', { width: 5, height: 5, fill: CH_HATCH_FILL }),
		svgNode(doc, 'line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: CH_HATCH_INK, 'stroke-width': 2 }),
	);
	svg.appendChild(svgNode(doc, 'defs', undefined, pattern));
	// Five ticks, drawn before the bars so a gridline never crosses over a task.
	for (let i = 0; i < 5; i++) {
		const ms = min + (span * i) / 4;
		svg.appendChild(svgNode(doc, 'line', { x1: x(ms), y1: TOP - 6, x2: x(ms), y2: y + 4, stroke: CH_GRID, 'stroke-width': 1 }));
		svg.appendChild(svgText(doc, { x: x(ms), y: TOP - 10, 'text-anchor': 'middle', fill: CH_MUTED, 'font-size': 10.5 }, fmt(ms)));
	}
	for (const node of body) {
		svg.appendChild(node);
	}
	const title = chartTitleNode(doc, spec.title);
	return { nodes: title ? [title, svg] : [svg], svg };
}

/**
 * The timeline is HTML, not SVG.
 *
 * It is a list of rows with wrapping chips, and wrapping is precisely what SVG cannot do; drawing
 * it would mean measuring every event label by hand. It has no full-screen button for the same
 * reason — there is no single `<svg>` to hand over.
 */
export function renderTimelineChart(doc: Document, spec: ITimelineSpec): IOpenideChartRender | undefined {
	const nodes: HTMLElement[] = [];
	const title = chartTitleNode(doc, spec.title);
	if (title) {
		nodes.push(title);
	}
	for (const sec of spec.sections) {
		if (sec.name) {
			nodes.push(chartDiv(doc, 'openide-chart-section-name', sec.name));
		}
		for (const p of sec.periods) {
			const row = chartDiv(doc, 'openide-chart-tl-row');
			row.appendChild(chartDiv(doc, 'openide-chart-tl-time', p.time));
			const spine = chartDiv(doc, 'openide-chart-tl-spine');
			spine.appendChild(chartSpan(doc, 'openide-chart-tl-dot'));
			spine.appendChild(chartSpan(doc, 'openide-chart-tl-line'));
			row.appendChild(spine);
			const events = chartDiv(doc, 'openide-chart-tl-events');
			for (const e of p.events) {
				events.appendChild(chartSpan(doc, 'openide-chart-tl-event', e));
			}
			row.appendChild(events);
			nodes.push(row);
		}
	}
	return { nodes };
}

/**
 * The journey's 1..5 satisfaction badge.
 *
 * The DIGIT carries the score; the opacity only reinforces it. That ordering matters — a reader
 * who cannot separate two greys still reads the number, which is the whole point of a monochrome
 * chart. The two dark steps flip to the background colour for the text, or the digit disappears
 * into its own badge.
 */
export function renderJourneyChart(doc: Document, spec: IJourneySpec): IOpenideChartRender | undefined {
	const steps = [0.18, 0.18, 0.32, 0.5, 0.7, 0.88];
	const nodes: HTMLElement[] = [];
	const title = chartTitleNode(doc, spec.title);
	if (title) {
		nodes.push(title);
	}
	for (const sec of spec.sections) {
		if (sec.name) {
			nodes.push(chartDiv(doc, 'openide-chart-section-name', sec.name));
		}
		for (const t of sec.tasks) {
			const s = Math.max(1, Math.min(5, Math.round(t.score)));
			const row = chartDiv(doc, 'openide-chart-jr-task');
			const badge = chartSpan(doc, 'openide-chart-jr-score', String(s));
			badge.style.background = fgA(steps[s]);
			badge.style.color = s >= 4 ? 'var(--vscode-editor-background)' : 'var(--vscode-foreground)';
			row.appendChild(badge);
			row.appendChild(chartSpan(doc, '', t.label));
			if (t.actors.length) {
				row.appendChild(chartSpan(doc, 'openide-chart-key-muted', `· ${t.actors.join(', ')}`));
			}
			nodes.push(row);
		}
	}
	return { nodes };
}
