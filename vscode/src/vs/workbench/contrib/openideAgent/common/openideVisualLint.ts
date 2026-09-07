/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type VisualLintKind =
	/** Text is cut by an overflow with nothing to say it was cut. */
	| 'clipped-text'
	/** The document is wider than the viewport: a horizontal scrollbar nobody wanted. */
	| 'page-overflow'
	/** An `img` that finished loading with no pixels. */
	| 'broken-image'
	/** Text below the WCAG AA ratio against the background actually behind it. */
	| 'low-contrast'
	/** A control too small to hit. */
	| 'tiny-target'
	/** Two controls sitting on top of each other. */
	| 'overlap';

export interface IVisualLintFinding {
	readonly kind: VisualLintKind;
	/** A selector that finds the element again, best effort. */
	readonly selector: string;
	/** One line, already written for a reader, with the measurement in it. */
	readonly detail: string;
	/** Viewport rectangle, so a caller can draw a box on the screenshot. */
	readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly severity: number;
}

export interface IVisualLintReport {
	readonly findings: readonly IVisualLintFinding[];
	readonly checked: number;
	readonly viewport: { readonly width: number; readonly height: number };
}

/** Below this ratio, normal-size text fails WCAG AA. Large text is allowed 3:1. */
export const CONTRAST_AA = 4.5;
export const CONTRAST_AA_LARGE = 3;

/** A control smaller than this in either axis is hard to hit; WCAG 2.2 AA asks for 24. */
export const MIN_TARGET_PX = 24;

/** One line per finding, for the tool result a CLI reads. */
export function describeLint(report: IVisualLintReport): string {
	if (!report.findings.length) {
		return `No measurable visual defects across ${report.checked} visible elements: no clipped text, no broken images, no contrast below WCAG AA, no overlapping or undersized controls, no horizontal overflow.`;
	}
	const lines = report.findings.map(finding => `- ${finding.kind} @ ${finding.selector} (${finding.rect.x},${finding.rect.y} ${finding.rect.width}x${finding.rect.height}): ${finding.detail}`);
	return `${report.findings.length} finding(s) across ${report.checked} visible elements:\n${lines.join('\n')}`;
}
