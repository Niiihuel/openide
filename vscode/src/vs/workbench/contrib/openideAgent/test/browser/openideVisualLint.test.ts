/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { describeLint, IVisualLintReport, openideVisualLintRuntime } from '../../common/openideVisualLint.js';

/**
 * The lint, run against a real document in a real browser — the only place its answers mean
 * anything, because every one of them is a computed style or a laid-out rectangle.
 *
 * The cases come in pairs on purpose. A checker that finds clipped text is worthless if it also
 * flags every element with `overflow: hidden`; one that finds low contrast is worse than nothing
 * if it flags white-on-blue. So each defect is asserted next to the innocent shape it most
 * resembles, and the assert is that only one of the two is reported.
 */
suite('OpenIDE visual lint', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/** A fresh same-origin document, laid out for real, torn down after the case. */
	function withDocument(build: (doc: Document) => void): IVisualLintReport {
		const frame = document.createElement('iframe');
		// Big enough that nothing is reported merely for being off screen.
		frame.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:600px;border:0;visibility:hidden';
		document.body.appendChild(frame);
		try {
			const doc = frame.contentDocument!;
			doc.open();
			doc.write('<!doctype html><html><body style="margin:0;background:#fff"></body></html>');
			doc.close();
			build(doc);
			// Force layout before measuring.
			void doc.body.offsetHeight;
			return openideVisualLintRuntime(doc) as IVisualLintReport;
		} finally {
			frame.remove();
		}
	}

	const kinds = (report: IVisualLintReport) => report.findings.map(finding => finding.kind);
	const html = (doc: Document, markup: string) => {
		const holder = doc.createElement('div');
		// eslint-disable-next-line no-unsanitized/property
		holder.innerHTML = markup;
		doc.body.appendChild(holder);
	};

	test('a clean page reports nothing, and says how much it looked at', () => {
		const report = withDocument(doc => html(doc,
			`<p style="color:#111;background:#fff;font-size:16px">Readable text on white</p>
			 <button style="width:80px;height:32px;color:#fff;background:#1b4fd8">Save</button>`));
		assert.deepStrictEqual(kinds(report), []);
		assert.ok(report.checked >= 2);
		assert.ok(describeLint(report).includes('No measurable visual defects'), describeLint(report));
	});

	test('text cut by overflow:hidden is reported; the same text with an ellipsis is not', () => {
		const report = withDocument(doc => html(doc,
			`<div id="cut" style="width:60px;overflow:hidden;white-space:nowrap;color:#111;background:#fff">A label far too long for sixty pixels</div>
			 <div id="ok" style="width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#111;background:#fff">A label far too long for sixty pixels</div>`));
		const clipped = report.findings.filter(finding => finding.kind === 'clipped-text');
		assert.strictEqual(clipped.length, 1, JSON.stringify(clipped));
		assert.strictEqual(clipped[0].selector, '#cut');
		assert.ok(clipped[0].detail.includes('cut horizontally'), clipped[0].detail);
	});

	test('a scrollable box is not "clipped": its content is reachable', () => {
		const report = withDocument(doc => html(doc,
			`<div style="width:60px;overflow:auto;white-space:nowrap;color:#111;background:#fff">A label far too long for sixty pixels</div>`));
		assert.ok(!kinds(report).includes('clipped-text'));
	});

	test('contrast is measured against what is actually behind the text, not against the body', () => {
		const report = withDocument(doc => html(doc,
			`<div style="background:#767676">
			   <span id="bad" style="color:#8a8a8a">grey on grey</span>
			 </div>
			 <div style="background:#1b4fd8"><span id="good" style="color:#ffffff">white on blue</span></div>`));
		const low = report.findings.filter(finding => finding.kind === 'low-contrast');
		assert.strictEqual(low.length, 1, JSON.stringify(low.map(f => f.detail)));
		assert.strictEqual(low[0].selector, '#bad');
		assert.ok(/:1/.test(low[0].detail), low[0].detail);
	});

	test('large text is judged at 3:1, not at 4.5:1', () => {
		// 4:1 — a failure for body copy, and correct for a heading.
		const report = withDocument(doc => html(doc,
			`<h1 style="font-size:32px;color:#767676;background:#fff;margin:0">Heading</h1>`));
		assert.ok(!kinds(report).includes('low-contrast'), JSON.stringify(report.findings));
	});

	test('text over a background image is not judged at all rather than judged wrongly', () => {
		const report = withDocument(doc => html(doc,
			`<div style="background-image:linear-gradient(#000,#fff)"><span style="color:#888">over an image</span></div>`));
		assert.ok(!kinds(report).includes('low-contrast'));
	});

	test('a control under 24px is reported with its size', () => {
		const report = withDocument(doc => html(doc,
			`<button style="width:16px;height:16px;padding:0;color:#fff;background:#1b4fd8"></button>`));
		const tiny = report.findings.find(finding => finding.kind === 'tiny-target');
		assert.ok(tiny);
		assert.ok(tiny.detail.includes('16x16'), tiny.detail);
	});

	test('two controls on top of each other are reported; a button inside its card is not', () => {
		const report = withDocument(doc => html(doc,
			`<div style="position:relative;height:120px">
			   <button style="position:absolute;left:0;top:0;width:80px;height:32px">One</button>
			   <button style="position:absolute;left:10px;top:4px;width:80px;height:32px">Two</button>
			 </div>
			 <a href="#" style="display:block;width:200px;height:60px"><button style="width:60px;height:30px">Nested</button></a>`));
		const overlaps = report.findings.filter(finding => finding.kind === 'overlap');
		assert.strictEqual(overlaps.length, 1, JSON.stringify(overlaps.map(o => o.detail)));
		assert.ok(overlaps[0].detail.includes('%'), overlaps[0].detail);
	});

	test('a document wider than its viewport is reported once, with both numbers', () => {
		const report = withDocument(doc => html(doc, `<div style="width:2000px;height:10px"></div>`));
		const overflow = report.findings.filter(finding => finding.kind === 'page-overflow');
		assert.strictEqual(overflow.length, 1);
		assert.ok(/\d+px wide in a \d+px viewport/.test(overflow[0].detail), overflow[0].detail);
	});

	test('a hidden subtree is never measured: it has no layout to be wrong about', () => {
		const report = withDocument(doc => html(doc,
			`<div style="display:none"><span style="color:#888;background:#999">invisible and awful</span></div>`));
		assert.deepStrictEqual(kinds(report), []);
	});

	test('every finding carries a rectangle a caller can draw on the screenshot', () => {
		const report = withDocument(doc => html(doc,
			`<button style="width:16px;height:16px;padding:0"></button>`));
		assert.ok(report.findings.length);
		for (const finding of report.findings) {
			assert.strictEqual(typeof finding.rect.x, 'number');
			assert.strictEqual(typeof finding.rect.width, 'number');
			assert.ok(finding.selector.length);
			assert.ok(finding.severity > 0 && finding.severity <= 1);
		}
	});
});
