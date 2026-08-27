/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGitCommit, IGitSpec, IQuadrantSpec } from '../../common/diagrams/openideDiagramEngine.js';
import { CH_GRID, CH_MUTED, CH_SOFT, chartRamp, chartTitleNode, fgA, IOpenideChartRender, textWpx } from './openideChartTheme.js';
import { nextDiagramId, SVG_NAMESPACE, svgNode, svgText, svgTooltip } from './openideDiagramDom.js';

/**
 * quadrant · git, ported from the webview (openideChatHtml.ts:2063-2174).
 *
 * Both draw a FIXED frame and scatter labelled points on it, which is why they share a file: the
 * work in each is reserving room for labels that stick out of that frame, not the frame itself.
 */

/** Rough width of one character at the quadrant's 12px label size (openideChatHtml.ts:2064). */
const QCHAR = 7.2;

export function renderQuadrantChart(doc: Document, spec: IQuadrantSpec): IOpenideChartRender | undefined {
	let longest = 0;
	for (const q of spec.quadrants) {
		longest = Math.max(longest, q.length);
	}
	// The square grows with the longest quadrant name so the four titles fit, but is clamped: past
	// 440px it stops being readable at a glance, under 300px the points pile up.
	const S = Math.min(440, Math.max(300, Math.round(longest * QCHAR * 2) + 40));
	const mid = S / 2;
	const maxChars = Math.max(4, Math.floor((mid - 12) / QCHAR));
	// A quadrant title that still overflows is cut with an ellipsis rather than allowed to run into
	// the neighbouring quadrant, where it would read as belonging to it.
	const clip = (s: string): string => s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;

	const ox = 58, oy = 12;
	const px = (x: number): number => ox + x * S;
	// y grows UP in the chart and DOWN in SVG, hence the inversion.
	const py = (y: number): number => oy + (1 - y) * S;

	const quads = [
		{ x: ox + mid, y: oy, label: spec.quadrants[0], tinted: true },
		{ x: ox, y: oy, label: spec.quadrants[1], tinted: false },
		{ x: ox, y: oy + mid, label: spec.quadrants[2], tinted: true },
		{ x: ox + mid, y: oy + mid, label: spec.quadrants[3], tinted: false },
	];
	const W = ox + S + 16;
	const H = oy + S + 34;
	const ink2 = fgA(0.78);

	const svg = svgNode(doc, 'svg', {
		id: nextDiagramId('oichart'), width: W, height: H, viewBox: `0 0 ${W} ${H}`, xmlns: SVG_NAMESPACE,
	});

	// Two opposite quadrants are tinted, like a chessboard: it separates the four cells without a
	// second border, and it survives a theme flip because the tint is the foreground at 5%.
	for (const q of quads) {
		if (q.tinted) {
			svg.appendChild(svgNode(doc, 'rect', { x: q.x, y: q.y, width: mid, height: mid, fill: fgA(0.05) }));
		}
	}
	svg.appendChild(svgNode(doc, 'rect', { x: ox, y: oy, width: S, height: S, fill: 'none', stroke: CH_GRID, 'stroke-width': 1 }));
	svg.appendChild(svgNode(doc, 'line', {
		x1: ox + mid, y1: oy, x2: ox + mid, y2: oy + S, stroke: CH_GRID, 'stroke-width': 1, 'stroke-dasharray': '4 4',
	}));
	svg.appendChild(svgNode(doc, 'line', {
		x1: ox, y1: oy + mid, x2: ox + S, y2: oy + mid, stroke: CH_GRID, 'stroke-width': 1, 'stroke-dasharray': '4 4',
	}));
	for (const q of quads) {
		if (q.label) {
			svg.appendChild(svgText(doc, {
				x: q.x + mid / 2, y: q.y + 19, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 500, fill: CH_MUTED,
			}, clip(q.label)));
		}
	}
	if (spec.xAxis) {
		svg.appendChild(svgText(doc, { x: ox + 2, y: oy + S + 22, 'font-size': 11.5, fill: ink2 }, spec.xAxis[0]));
		svg.appendChild(svgText(doc, {
			x: ox + S - 2, y: oy + S + 22, 'text-anchor': 'end', 'font-size': 11.5, fill: ink2,
		}, spec.xAxis[1]));
	}
	if (spec.yAxis) {
		// Rotated about its own anchor so the label runs bottom-to-top along the y axis.
		svg.appendChild(svgText(doc, {
			x: ox - 16, y: oy + S, 'font-size': 11.5, fill: ink2, transform: `rotate(-90 ${ox - 16} ${oy + S})`,
		}, spec.yAxis[0]));
		svg.appendChild(svgText(doc, {
			x: ox - 16, y: oy, 'text-anchor': 'end', 'font-size': 11.5, fill: ink2, transform: `rotate(-90 ${ox - 16} ${oy})`,
		}, spec.yAxis[1]));
	}
	for (const p of spec.points) {
		// Past the middle the label is written to the LEFT of its dot, or it would run off the frame.
		const flip = p.x > 0.5;
		const dot = svgNode(doc, 'circle', { cx: px(p.x), cy: py(p.y), r: 5, fill: 'var(--vscode-focusBorder)' });
		svgTooltip(dot, `${p.label} — x ${p.x} · y ${p.y}`);
		svg.appendChild(svgNode(doc, 'g', undefined,
			dot,
			svgText(doc, {
				x: px(p.x) + (flip ? -9 : 9), y: py(p.y) + 4, 'text-anchor': flip ? 'end' : 'start',
				'font-size': 12, fill: 'var(--vscode-foreground)',
			}, p.label),
		));
	}

	const title = chartTitleNode(doc, spec.title);
	return { nodes: title ? [title, svg] : [svg], svg };
}

const COL = 56, ROW = 52, TAG_H = 17, TAG_GAP = 4, TAG_CLEAR = 10;

interface IGitTag {
	readonly commit: IGitCommit;
	readonly cx: number;
	readonly w: number;
	readonly level: number;
}

export function renderGitChart(doc: Document, spec: IGitSpec): IOpenideChartRender | undefined {
	const { branches, commits } = spec;
	const ramp = chartRamp(Math.max(branches.length, 1));
	// A commit on a branch the header never declared still has to land somewhere: lane 0.
	const laneOf = (b: string): number => Math.max(0, branches.indexOf(b));
	const color = (b: string): string => ramp[laneOf(b) % ramp.length];

	// The gutter holds the branch names, so it is as wide as the longest one.
	let startX = 64;
	for (const b of branches) {
		startX = Math.max(startX, Math.round(b.length * 7) + 26);
	}
	const byId = new Map(commits.map(c => [c.id, c]));
	const colOf = (c: IGitCommit): number => startX + c.x * COL;

	// Tags are stacked greedily: each one takes the lowest level on its lane where it does not
	// overlap the previous tag, so two tags on adjacent commits sit one above the other instead of
	// printing on top of each other.
	const tags: IGitTag[] = [];
	const levelRight = new Map<string, number[]>();
	for (const c of commits) {
		if (!c.tag) {
			continue;
		}
		const w = textWpx(c.tag, 6.6) + 12;
		const x0 = colOf(c) - w / 2;
		const levels = levelRight.get(c.branch) ?? [];
		levelRight.set(c.branch, levels);
		let level = 0;
		while (level < levels.length && x0 < levels[level] + 8) {
			level++;
		}
		levels[level] = x0 + w;
		tags.push({ commit: c, cx: colOf(c), w, level });
	}

	// Only lane 0's tags can push the whole picture down — every other lane's stack grows into the
	// empty space above its own row.
	let lane0Stack = 0;
	for (const t of tags) {
		if (laneOf(t.commit.branch) === 0) {
			lane0Stack = Math.max(lane0Stack, t.level + 1);
		}
	}
	const TOP = Math.max(24, TAG_CLEAR + lane0Stack * (TAG_H + TAG_GAP) + 8);
	const cy = (c: IGitCommit): number => TOP + laneOf(c.branch) * ROW;
	const tagY = (t: IGitTag): number => cy(t.commit) - TAG_CLEAR - (t.level + 1) * (TAG_H + TAG_GAP) + TAG_GAP;

	let maxX = 0;
	for (const c of commits) {
		maxX = Math.max(maxX, c.x);
	}
	let left = 0;
	let right = startX + maxX * COL + 26;
	for (const t of tags) {
		left = Math.min(left, t.cx - t.w / 2 - 6);
		right = Math.max(right, t.cx + t.w / 2 + 6);
	}
	const W = right - left;
	const H = TOP + (branches.length - 1) * ROW + 26;

	const svg = svgNode(doc, 'svg', {
		id: nextDiagramId('oichart'), width: W, height: H, viewBox: `${left} 0 ${W} ${H}`, xmlns: SVG_NAMESPACE,
	});

	branches.forEach((b, i) => {
		const xs = commits.filter(c => c.branch === b).map(c => c.x);
		const y = TOP + i * ROW;
		if (xs.length) {
			svg.appendChild(svgNode(doc, 'line', {
				x1: startX + Math.min(...xs) * COL, y1: y, x2: startX + Math.max(...xs) * COL, y2: y,
				stroke: color(b), 'stroke-width': 2.5, opacity: 0.28, 'stroke-linecap': 'round',
			}));
		}
		svg.appendChild(svgText(doc, {
			x: startX - 14, y: y + 4, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 500, fill: color(b),
		}, b));
	});

	for (const c of commits) {
		for (const pid of c.parents) {
			const p = byId.get(pid);
			if (!p) {
				continue;
			}
			const x1 = colOf(p), y1 = cy(p), x2 = colOf(c), y2 = cy(c);
			// Same lane: a straight segment. Across lanes: an S-curve, which is what makes a branch
			// or a merge readable as one gesture instead of a corner.
			const d = y1 === y2
				? `M ${x1},${y1} L ${x2},${y2}`
				: `M ${x1},${y1} C ${x1 + COL * 0.55},${y1} ${x2 - COL * 0.55},${y2} ${x2},${y2}`;
			svg.appendChild(svgNode(doc, 'path', {
				d, fill: 'none', stroke: color(c.branch), 'stroke-width': 2, opacity: 0.65,
			}));
		}
	}

	for (const c of commits) {
		const dot = svgNode(doc, 'circle', {
			cx: colOf(c), cy: cy(c), r: c.highlight ? 9 : 6.5, fill: color(c.branch),
			// The stroke is the editor background: it punches a hole so an edge passing behind the
			// commit does not appear to go through it.
			stroke: 'var(--vscode-editor-background)', 'stroke-width': 3,
		});
		svgTooltip(dot, c.id + (c.tag ? ` — ${c.tag}` : ''));
		const group = svgNode(doc, 'g', undefined, dot);
		// A merge is marked by a hollow centre — two parents, one ring.
		if (c.parents.length >= 2) {
			group.appendChild(svgNode(doc, 'circle', {
				cx: colOf(c), cy: cy(c), r: 2.5, fill: 'var(--vscode-editor-background)',
			}));
		}
		svg.appendChild(group);
	}

	// Leader lines first, then the labels, so a line never crosses over a tag box.
	for (const t of tags) {
		svg.appendChild(svgNode(doc, 'line', {
			x1: t.cx, y1: tagY(t) + TAG_H, x2: t.cx, y2: cy(t.commit) - (t.commit.highlight ? 9 : 6.5) - 2,
			stroke: CH_GRID, 'stroke-width': 1,
		}));
	}
	for (const t of tags) {
		svg.appendChild(svgNode(doc, 'g', undefined,
			svgNode(doc, 'rect', {
				x: t.cx - t.w / 2, y: tagY(t), width: t.w, height: TAG_H, rx: 2,
				fill: CH_SOFT, stroke: CH_GRID, 'stroke-width': 1,
			}),
			svgText(doc, {
				x: t.cx, y: tagY(t) + 12, 'text-anchor': 'middle', 'font-size': 11, fill: fgA(0.78),
			}, t.commit.tag ?? ''),
		));
	}

	return { nodes: [svg], svg };
}
