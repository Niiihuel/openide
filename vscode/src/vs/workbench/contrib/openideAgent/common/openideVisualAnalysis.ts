/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — what the tape says about the MOTION, before anyone looks at it.
 *
 *  A recording proves a flow happened. It does not, on its own, say whether the flow looked
 *  right, and a model handed ninety seconds of video is in the worst possible position to judge:
 *  a stutter is three frames, a flash is one, and a 40 ms hitch is invisible at any playback
 *  speed a reader would use. Asking "do you see anything wrong" over a whole video is asking for
 *  a guess.
 *
 *  So the tape is measured first and the model is POINTED. Everything here is arithmetic over
 *  frame timestamps and a coarse luma signature per frame — no judgement, no thresholds that
 *  encode taste — and it answers questions a picture cannot: when did motion start, did it ever
 *  stop, was it smooth, did the screen change when nobody asked it to, did the click do anything
 *  at all. Each finding carries a timestamp, so the sheet, the video card and the model all get
 *  the same instruction: look HERE.
 *
 *  ── Why a signature and not pixels ────────────────────────────────────────────────────────
 *  Frames are JPEG. Comparing them at full resolution would measure the codec's noise as much as
 *  the page's motion, and would cost more than the encode. A 32x18 luma grid survives compression
 *  (the noise averages out inside a cell), is cheap to produce while the frames are already being
 *  decoded, and is enough for every question above — all of which are about WHERE and WHEN the
 *  screen changed, never about what it now says.
 *
 *  This module is pure so the thresholds can be argued with in a test rather than in a review.
 *--------------------------------------------------------------------------------------------*/

import { IFlowMark } from './openideBrowserRecorder.js';

/** One frame reduced to a coarse luma grid. `cells` is row-major, 0-255, length `gw * gh`. */
export interface IFrameSignature {
	readonly t: number;
	readonly gw: number;
	readonly gh: number;
	readonly cells: Uint8Array;
}

export type VisualFindingKind =
	/** A frame interval far above the segment's own rhythm, while the screen was moving. */
	| 'jank'
	/** Motion that never came to rest inside the recording. */
	| 'never-settles'
	/** One frame unlike both its neighbours, which look like each other. */
	| 'flicker'
	/** A large change over most of the screen with no action to explain it. */
	| 'layout-shift'
	/** An action the agent took that moved nothing at all. */
	| 'no-response';

export interface IVisualFinding {
	readonly kind: VisualFindingKind;
	/** When to look, in ms from the start of the recording. */
	readonly t: number;
	/** How long the problem lasts, when that means anything. */
	readonly durationMs?: number;
	/** One line, already written for a reader. Never a template the caller has to fill. */
	readonly detail: string;
	/**
	 * How sure the arithmetic is, 0..1. Not a probability — a sort key, so the strongest signal
	 * is what a model reads first when a recording produces many findings.
	 */
	readonly severity: number;
}

/** A stretch of frames where the screen was moving. */
export interface IMotionSegment {
	readonly startT: number;
	readonly endT: number;
	/** Largest per-frame change in the segment, 0..1 (fraction of the grid that moved). */
	readonly peak: number;
	/** True when the change was still above the floor at the last frame of the recording. */
	readonly openEnded: boolean;
}

export interface IVisualAnalysis {
	readonly findings: readonly IVisualFinding[];
	readonly segments: readonly IMotionSegment[];
	/** Per-frame change, aligned with the signatures; `changes[0]` is always 0. */
	readonly changes: readonly number[];
	/** Median interval between the analysed frames, ms. The rhythm everything is judged against. */
	readonly medianIntervalMs: number;
}

/**
 * A cell counts as changed when its luma moves by more than this. Below it lives JPEG ringing,
 * sub-pixel text antialiasing and the cursor overlay's own fade — all things that are not the
 * page misbehaving.
 */
const CELL_DELTA = 10;

/** Fraction of the grid that must move for the frame to count as motion at all. */
const MOTION_FLOOR = 0.012;

/** A change touching this much of the screen is structural, not a detail repainting. */
const GLOBAL_FRACTION = 0.45;

/** An interval this many times the segment's median is a stutter, not the rhythm. */
const JANK_FACTOR = 2.6;

/** …and never below this, so a 12 fps capture does not report its own quantisation. */
const JANK_FLOOR_MS = 150;

/** Motion still running after this long has stopped being a transition. */
const NEVER_SETTLES_MS = 4000;

/** How long an action gets to produce a visible effect before it is reported as inert. */
const RESPONSE_WINDOW_MS = 1200;

/** Marks that are supposed to change the screen. `mark` is a note the agent left, not an action. */
const ACTING_KINDS = new Set(['click', 'type', 'navigate', 'press', 'scroll', 'select']);

/** Fraction of the grid whose luma moved by more than `CELL_DELTA` between two signatures. */
export function frameChange(a: IFrameSignature, b: IFrameSignature): number {
	if (a.gw !== b.gw || a.gh !== b.gh || a.cells.length !== b.cells.length || !a.cells.length) {
		// A resize mid-recording is a real event, but not one this can measure; report it as total
		// change so the segment logic sees a boundary rather than silently comparing nothing.
		return 1;
	}
	let moved = 0;
	for (let i = 0; i < a.cells.length; i++) {
		const delta = a.cells[i] - b.cells[i];
		if (delta > CELL_DELTA || delta < -CELL_DELTA) {
			moved++;
		}
	}
	return moved / a.cells.length;
}

function median(values: readonly number[]): number {
	if (!values.length) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Groups consecutive moving frames. A single still frame does not break a segment: a CSS
 *  transition on a slow machine can paint the same thing twice without having finished. */
function findSegments(signatures: readonly IFrameSignature[], changes: readonly number[]): IMotionSegment[] {
	const segments: IMotionSegment[] = [];
	let start = -1;
	let peak = 0;
	let lastMoving = -1;
	for (let i = 1; i < signatures.length; i++) {
		const moving = changes[i] >= MOTION_FLOOR;
		if (moving) {
			if (start < 0) { start = i - 1; peak = 0; }
			peak = Math.max(peak, changes[i]);
			lastMoving = i;
			continue;
		}
		// One quiet frame is tolerated; two close the segment.
		if (start >= 0 && i - lastMoving >= 2) {
			segments.push({ startT: signatures[start].t, endT: signatures[lastMoving].t, peak, openEnded: false });
			start = -1;
		}
	}
	if (start >= 0 && lastMoving >= 0) {
		segments.push({
			startT: signatures[start].t,
			endT: signatures[lastMoving].t,
			peak,
			openEnded: lastMoving >= signatures.length - 2,
		});
	}
	return segments;
}

function formatMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/**
 * Reads the tape. `signatures` must be in time order; `marks` are the recorder's own, used only
 * to tell motion the agent CAUSED from motion that happened on its own.
 */
export function analyseFlow(signatures: readonly IFrameSignature[], marks: readonly IFlowMark[]): IVisualAnalysis {
	if (signatures.length < 3) {
		return { findings: [], segments: [], changes: signatures.map(() => 0), medianIntervalMs: 0 };
	}
	const changes: number[] = [0];
	const intervals: number[] = [];
	for (let i = 1; i < signatures.length; i++) {
		changes.push(frameChange(signatures[i - 1], signatures[i]));
		intervals.push(signatures[i].t - signatures[i - 1].t);
	}
	const segments = findSegments(signatures, changes);
	const medianIntervalMs = median(intervals);
	const findings: IVisualFinding[] = [];

	// ---- Stutter. Only inside motion: a gap on a still page is the screencast being idle, which
	// is the whole reason the video is variable frame rate.
	for (const segment of segments) {
		const inside: number[] = [];
		for (let i = 1; i < signatures.length; i++) {
			if (signatures[i].t > segment.startT && signatures[i].t <= segment.endT) {
				inside.push(i);
			}
		}
		if (inside.length < 4) {
			continue;
		}
		const rhythm = median(inside.map(i => signatures[i].t - signatures[i - 1].t));
		const bar = Math.max(JANK_FLOOR_MS, rhythm * JANK_FACTOR);
		let worst = 0;
		let worstT = 0;
		for (const i of inside) {
			const gap = signatures[i].t - signatures[i - 1].t;
			if (gap > bar && gap > worst) { worst = gap; worstT = signatures[i - 1].t; }
		}
		if (worst) {
			findings.push({
				kind: 'jank',
				t: worstT,
				durationMs: Math.round(worst),
				detail: `The animation stalled for ${formatMs(worst)} while it was running; the rest of it painted every ${formatMs(rhythm)}. A frame took ${(worst / Math.max(1, rhythm)).toFixed(1)}x longer than its neighbours.`,
				severity: Math.min(1, worst / (rhythm * 6)),
			});
		}
	}

	// ---- Motion that never comes to rest.
	for (const segment of segments) {
		const length = segment.endT - segment.startT;
		if (length >= NEVER_SETTLES_MS) {
			findings.push({
				kind: 'never-settles',
				t: segment.startT,
				durationMs: Math.round(length),
				detail: segment.openEnded
					? `The screen was still moving when the recording ended, ${formatMs(length)} after the motion started. Either something is looping, or a loading state never resolved.`
					: `Motion ran for ${formatMs(length)} before the screen came to rest. A transition this long is either intentional or stuck; the video says which.`,
				severity: segment.openEnded ? 0.8 : 0.45,
			});
		}
	}

	// ---- A single frame unlike both its neighbours, which look like each other: a flash.
	for (let i = 1; i < signatures.length - 1; i++) {
		const before = changes[i];
		const after = changes[i + 1];
		if (before < GLOBAL_FRACTION * 0.5 || after < GLOBAL_FRACTION * 0.5) {
			continue;
		}
		const across = frameChange(signatures[i - 1], signatures[i + 1]);
		if (across < MOTION_FLOOR * 2) {
			findings.push({
				kind: 'flicker',
				t: signatures[i].t,
				durationMs: Math.round(signatures[i + 1].t - signatures[i - 1].t),
				detail: `One frame differs from both the frame before and the frame after it, and those two are identical: the screen flashed and went back. Usually an element mounting unstyled, or a re-render painting twice.`,
				severity: 0.7,
			});
		}
	}

	// ---- A large, screen-wide change with no action to explain it.
	const actingTimes = marks.filter(mark => ACTING_KINDS.has(mark.kind)).map(mark => mark.t);
	const causedBy = (t: number) => actingTimes.some(mark => t >= mark - 200 && t <= mark + RESPONSE_WINDOW_MS + 800);
	for (let i = 2; i < signatures.length; i++) {
		if (changes[i] < GLOBAL_FRACTION || changes[i - 1] >= MOTION_FLOOR) {
			continue; // only the FIRST frame of a jump, and only out of stillness
		}
		if (causedBy(signatures[i].t)) {
			continue;
		}
		findings.push({
			kind: 'layout-shift',
			t: signatures[i].t,
			detail: `${Math.round(changes[i] * 100)}% of the screen changed at once, out of a still page, with no click, keystroke or navigation near it. That is the shape of a late reflow — a font, an image or an ad arriving and pushing the layout.`,
			severity: Math.min(1, changes[i]),
		});
	}

	// ---- An action that moved nothing.
	for (const mark of marks) {
		if (!ACTING_KINDS.has(mark.kind)) {
			continue;
		}
		const from = mark.t;
		const to = mark.t + RESPONSE_WINDOW_MS;
		let moved = 0;
		let sawFrame = false;
		for (let i = 1; i < signatures.length; i++) {
			if (signatures[i].t < from) { continue; }
			if (signatures[i].t > to) { break; }
			sawFrame = true;
			moved = Math.max(moved, changes[i]);
		}
		if (sawFrame && moved < MOTION_FLOOR) {
			findings.push({
				kind: 'no-response',
				t: mark.t,
				durationMs: RESPONSE_WINDOW_MS,
				detail: `"${mark.label || mark.kind}" landed and the screen did not change for the next ${formatMs(RESPONSE_WINDOW_MS)}. The control may be dead, or its handler may have thrown.`,
				severity: 0.75,
			});
		}
	}

	findings.sort((a, b) => b.severity - a.severity || a.t - b.t);
	return { findings, segments, changes, medianIntervalMs };
}

/** One line per finding, for the tool result a CLI reads. */
export function describeFindings(findings: readonly IVisualFinding[], formatTime: (ms: number) => string): string {
	if (!findings.length) {
		return 'No motion problems detected: every animation settled, every action moved something, and no frame stalled.';
	}
	return findings.map(finding => `- [${formatTime(finding.t)}] ${finding.kind}: ${finding.detail}`).join('\n');
}
