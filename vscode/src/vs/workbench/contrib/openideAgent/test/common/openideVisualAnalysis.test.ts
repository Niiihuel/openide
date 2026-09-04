/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFlowMark } from '../../common/openideBrowserRecorder.js';
import { analyseFlow, describeFindings, frameChange, IFrameSignature } from '../../common/openideVisualAnalysis.js';

/**
 * The thresholds, argued with here instead of in a review.
 *
 * Every case is built as a synthetic tape, because the point of each one is a shape the arithmetic
 * has to tell apart from a shape that looks like it: a gap on a STILL page is the screencast being
 * idle and a gap on a MOVING page is a stutter; a screen-wide change after a click is the click
 * working and the same change out of nowhere is a reflow. A checker that cannot separate those two
 * pairs reports a page that is behaving as if it were broken, which is worse than reporting
 * nothing at all.
 */
suite('OpenIDE visual analysis', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const GW = 8;
	const GH = 4;
	const CELLS = GW * GH;

	/** A signature whose first `moved` cells are bright and the rest dark. */
	function sig(t: number, moved: number): IFrameSignature {
		const cells = new Uint8Array(CELLS);
		for (let i = 0; i < CELLS; i++) {
			cells[i] = i < moved ? 240 : 10;
		}
		return { t, gw: GW, gh: GH, cells };
	}

	/** A still tape: `count` identical frames every `step` ms. */
	function still(count: number, step = 80, from = 0): IFrameSignature[] {
		return Array.from({ length: count }, (_, i) => sig(from + i * step, 0));
	}

	const mark = (t: number, kind: string, label = 'button'): IFlowMark => ({ t, kind, label });
	const kinds = (findings: readonly { kind: string }[]) => findings.map(finding => finding.kind);

	test('a still tape with wide gaps is not jank: an idle screencast simply stops sending', () => {
		// This is the case that makes a naive "big gap = dropped frame" checker useless. A page that
		// sits there produces nothing to send, and the video is variable frame rate for that reason.
		const frames = [sig(0, 0), sig(900, 0), sig(3000, 0), sig(7000, 0)];
		const analysis = analyseFlow(frames, []);
		assert.deepStrictEqual(kinds(analysis.findings), []);
		assert.deepStrictEqual(analysis.segments, []);
	});

	test('a gap inside motion IS jank, and it reports when and how long', () => {
		const frames: IFrameSignature[] = [];
		// Smooth motion at 16 ms: one more cell lights up per frame.
		for (let i = 0; i < 10; i++) { frames.push(sig(i * 16, i)); }
		// …then one frame arrives 400 ms late, still mid-animation.
		frames.push(sig(9 * 16 + 400, 10));
		for (let i = 0; i < 6; i++) { frames.push(sig(9 * 16 + 400 + (i + 1) * 16, 11 + i)); }
		const analysis = analyseFlow(frames, []);
		const jank = analysis.findings.find(finding => finding.kind === 'jank');
		assert.ok(jank, 'the stall should be reported');
		assert.strictEqual(jank.t, 9 * 16);
		assert.strictEqual(jank.durationMs, 400);
		assert.ok(jank.detail.includes('400 ms'), jank.detail);
	});

	test('motion that never comes to rest is reported, and says so when the tape simply ended', () => {
		const frames: IFrameSignature[] = [];
		for (let i = 0; i < 70; i++) {
			// A spinner: two cells alternate forever. Never still, never finished.
			frames.push(sig(i * 80, i % 2 ? 6 : 2));
		}
		const analysis = analyseFlow(frames, []);
		const never = analysis.findings.find(finding => finding.kind === 'never-settles');
		assert.ok(never, 'a five-second animation that never rests should be reported');
		assert.ok(never.detail.includes('still moving when the recording ended'), never.detail);
	});

	test('a settled transition is not reported, however busy it was while it ran', () => {
		const frames: IFrameSignature[] = [
			...still(3),
			sig(240, 8), sig(320, 16), sig(400, 24), sig(480, 32),
			...still(6, 80, 560),
		];
		const analysis = analyseFlow(frames, []);
		assert.deepStrictEqual(kinds(analysis.findings), []);
		assert.strictEqual(analysis.segments.length, 1);
		assert.strictEqual(analysis.segments[0].openEnded, false);
	});

	test('one frame unlike both its neighbours, which match, is a flash', () => {
		const frames = [sig(0, 0), sig(80, 0), sig(160, 32), sig(240, 0), sig(320, 0)];
		const analysis = analyseFlow(frames, []);
		assert.ok(kinds(analysis.findings).includes('flicker'));
	});

	test('a screen-wide change out of stillness is a layout shift — unless an action explains it', () => {
		const tape = [...still(4), sig(320, 32), ...still(4, 80, 400)];

		const unexplained = analyseFlow(tape, []);
		const shift = unexplained.findings.find(finding => finding.kind === 'layout-shift');
		assert.ok(shift, 'nothing caused this repaint, so it should be reported');
		assert.strictEqual(shift.t, 320);

		// The very same tape, with a click just before it: this is what a working button looks like.
		const explained = analyseFlow(tape, [mark(300, 'click')]);
		assert.ok(!kinds(explained.findings).includes('layout-shift'));
	});

	test('an action that moves nothing is reported with the label the agent used', () => {
		const frames = still(20);
		const analysis = analyseFlow(frames, [mark(200, 'click', 'Save')]);
		const dead = analysis.findings.find(finding => finding.kind === 'no-response');
		assert.ok(dead);
		assert.ok(dead.detail.startsWith('"Save"'), dead.detail);

		// A `mark` is a note the agent left, not an action: it promises no repaint.
		assert.deepStrictEqual(kinds(analyseFlow(frames, [mark(200, 'mark', 'here')]).findings), []);
	});

	test('an action near the end of the tape is not reported for lack of evidence', () => {
		// No frames after it means nothing was observed, which is not the same as nothing happened.
		const frames = still(5, 80);
		const analysis = analyseFlow(frames, [mark(5000, 'click', 'Late')]);
		assert.deepStrictEqual(kinds(analysis.findings), []);
	});

	test('findings come back worst first, so a long tape reads top-down', () => {
		const frames = [...still(4), sig(320, 32), ...still(4, 80, 400)];
		const analysis = analyseFlow(frames, [mark(700, 'click', 'Dead')]);
		assert.ok(analysis.findings.length >= 2);
		for (let i = 1; i < analysis.findings.length; i++) {
			assert.ok(analysis.findings[i - 1].severity >= analysis.findings[i].severity);
		}
	});

	test('a grid that changed shape counts as total change, not as a silent no-op', () => {
		const wide: IFrameSignature = { t: 0, gw: 16, gh: 4, cells: new Uint8Array(64) };
		assert.strictEqual(frameChange(sig(0, 0), wide), 1);
	});

	test('a tape too short to have a rhythm answers nothing rather than guessing', () => {
		const analysis = analyseFlow([sig(0, 0), sig(80, 32)], [mark(0, 'click')]);
		assert.deepStrictEqual(analysis.findings, []);
	});

	test('the summary says what was checked when it found nothing', () => {
		const text = describeFindings([], ms => String(ms));
		assert.ok(text.includes('No motion problems detected'), text);
		const one = describeFindings([{ kind: 'jank', t: 1200, detail: 'stalled', severity: 1 }], () => '00:01.2');
		assert.strictEqual(one, '- [00:01.2] jank: stalled');
	});
});
