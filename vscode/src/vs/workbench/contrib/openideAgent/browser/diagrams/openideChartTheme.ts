/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The palette and the two bits of geometry every chart shares.
 *
 * Since 2026-08 the palette is the EDITORIAL token system ported from the diagram-design skill
 * (refs/diagram-design, `references/style-guide.md`): semantic roles — paper / ink / muted / soft /
 * rule / accent / link — expressed as `--oid-*` CSS custom properties so the same SVG sits in a
 * light theme, a dark theme and a high-contrast theme without a per-theme palette. The properties
 * are DEFINED in two synchronized places (media/openideDiagrams.css for the workbench, and
 * OPENIDE_DIAGRAM_SVG_CSS for the webview surfaces); this module only references them.
 *
 * The one-accent rule is the load-bearing design decision: `accent` marks the focal element —
 * the first series, the critical hatch, the entry node — and everything else is ink at an opacity.
 * Rainbow ramps are exactly what the style guide forbids.
 */

/** Semantic tokens, referenced by role — never inline a colour in a renderer. */
export const OID_PAPER = 'var(--oid-paper)';
export const OID_INK = 'var(--oid-ink)';
export const OID_MUTED = 'var(--oid-muted)';
export const OID_SOFT = 'var(--oid-soft)';
export const OID_RULE = 'var(--oid-rule)';
export const OID_RULE_SOLID = 'var(--oid-rule-solid)';
export const OID_ACCENT = 'var(--oid-accent)';
export const OID_ACCENT_TINT = 'var(--oid-accent-tint)';
export const OID_LINK = 'var(--oid-link)';

export function fgA(alpha: number): string {
	return `color-mix(in srgb, var(--vscode-foreground) ${Math.round(alpha * 100)}%, transparent)`;
}

/**
 * `n` distinguishable series inks: the FIRST series is the focal one and gets the accent
 * (style-guide.md: "accent is reserved for the focal series"); the rest are ink at stepped
 * opacities. Up to three non-focal series get hand-picked steps, because an even ramp over so few
 * values puts two of them within a few percent of each other and they stop being separable. Beyond
 * that the spread is linear down to 0.14 — under it a slice is invisible on any background.
 */
export function chartRamp(n: number): string[] {
	if (n <= 0) { return []; }
	const rest = [0.62, 0.38, 0.18];
	const out: string[] = [OID_ACCENT];
	if (n - 1 <= rest.length) {
		return out.concat(rest.slice(0, n - 1).map(fgA));
	}
	for (let i = 0; i < n - 1; i++) {
		out.push(fgA(Math.max(0.14, 0.72 - (0.58 * i) / (n - 2))));
	}
	return out;
}

/** Structural greys, now expressed through the editorial tokens. */
export const CH_GRID = OID_RULE;
export const CH_AXIS = OID_RULE_SOLID;
export const CH_MUTED = OID_MUTED;
export const CH_SOFT = 'color-mix(in srgb, var(--oid-ink) 6%, transparent)';
export const CH_MID = 'color-mix(in srgb, var(--oid-ink) 22%, transparent)';
/** Critical-path hatch: the ONE place a chart may use the accent besides the focal series. */
export const CH_HATCH_FILL = OID_ACCENT_TINT;
export const CH_HATCH_INK = OID_ACCENT;

export const CH_DAY = 86400000;

/**
 * Width of a string, guessed from its length.
 *
 * Measuring for real would mean laying the text out in the DOM first, and these renderers run
 * before anything is attached — an unattached `<text>` has no `getComputedTextLength`. The
 * estimate only has to be good enough to reserve space, and the callers pass a per-context factor
 * because the figures are drawn at several font sizes.
 */
export function textWpx(s: string, px?: number): number {
	return String(s).length * (px || 7);
}

/**
 * One ring segment of the donut, as a path.
 *
 * Angles start at twelve o'clock and grow clockwise, which is why the point helper uses sin for x
 * and negative cos for y instead of the usual pair.
 */
export function donutSlice(cx: number, cy: number, innerR: number, outerR: number, a0: number, a1: number): string {
	const pt = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
	// SVG arcs cannot express more than half a circle in one command; the flag tells the renderer
	// which of the two possible arcs between the endpoints was meant.
	const large = a1 - a0 > Math.PI ? 1 : 0;
	const p0 = pt(outerR, a0);
	const p1 = pt(outerR, a1);
	const p2 = pt(innerR, a1);
	const p3 = pt(innerR, a0);
	return `M ${p0[0]} ${p0[1]} A ${outerR} ${outerR} 0 ${large} 1 ${p1[0]} ${p1[1]}`
		+ ` L ${p2[0]} ${p2[1]} A ${innerR} ${innerR} 0 ${large} 0 ${p3[0]} ${p3[1]} Z`;
}

/**
 * What one chart renderer hands back.
 *
 * `nodes` and not a single container because the webview drops the title `<div>` next to the
 * `<svg>` inside `.diagram-scroll`; wrapping them would change the layout. `svg` is set only when
 * the chart HAS one and it is the whole picture — that is exactly the condition under which the
 * full-screen button appears.
 */
export interface IOpenideChartRender {
	readonly nodes: readonly Element[];
	readonly svg?: SVGSVGElement;
}

/** The chart's heading, when the source declared one. */
export function chartTitleNode(doc: Document, title: string | undefined): HTMLElement | undefined {
	if (!title) {
		return undefined;
	}
	const node = doc.createElement('div');
	node.className = 'openide-chart-title';
	node.textContent = title;
	return node;
}
