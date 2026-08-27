/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { IBrowserPickResult } from '../../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { buildOpenidePickContext, toOpenidePickAttachment } from '../../common/openidePickContext.js';

/**
 * Pick & Polish is a PROMPT, and a prompt that only one of the two chat renderers could reach.
 *
 * The prose used to be inline in the webview host's subscription, so the native chat had no way to
 * produce it: picking an element there attached nothing at all. These asserts pin the two flows
 * apart — an app in the browser is polished with the browser tools, a canvas is polished by editing
 * its `.canvas.tsx` — because that difference is the entire reason there are two texts.
 */
suite('OpenIDE pick context', () => {

	const base: IBrowserPickResult = {
		selector: 'button.primary',
		html: '<button class="primary">Guardar</button>',
		styles: 'color: rgb(255, 255, 255)',
		rect: { x: 0, y: 0, w: 10, h: 10 },
		pageUrl: 'http://localhost:3000/settings',
	};

	test('an app pick asks for the live change first and the source second', () => {
		const context = buildOpenidePickContext(base);
		assert.ok(context.includes('[Pick & Polish'));
		assert.ok(context.includes('browser_set_style'));
		assert.ok(context.includes(base.selector));
		assert.ok(context.includes(base.html));
		// The computed styles are what make "same colour as the other button" answerable.
		assert.ok(context.includes('Estilos computados relevantes'));
	});

	test('a canvas pick never suggests the browser tools', () => {
		const context = buildOpenidePickContext({ ...base, pageUrl: '/home/u/app/Home.canvas.tsx' });
		assert.ok(context.includes('[Design Mode'));
		assert.ok(context.includes('edit_file'));
		// The browser tools do not reach a canvas: suggesting them sends the agent down a dead end.
		assert.strictEqual(context.includes('browser_set_style'), false);
		assert.strictEqual(context.includes('browser_navigate'), false);
	});

	test('a pick with no styles omits the section instead of leaving it empty', () => {
		const context = buildOpenidePickContext({ ...base, styles: '' });
		assert.strictEqual(context.includes('Estilos computados relevantes'), false);
	});

	test('the screenshot travels as an attachment, and only when there is one', () => {
		assert.strictEqual(toOpenidePickAttachment(base).image, undefined);
		const withShot = toOpenidePickAttachment({ ...base, screenshotBase64: 'AAAA' });
		assert.deepStrictEqual(withShot.image, { mimeType: 'image/jpeg', data: 'AAAA' });
		assert.strictEqual(withShot.selector, base.selector);
	});

	test('the context is appended to a turn, so it starts by separating itself', () => {
		// It is concatenated onto whatever @mentions already produced: without the leading break the
		// two run together into one paragraph the model reads as a single instruction.
		assert.ok(buildOpenidePickContext(base).startsWith('\n\n'));
	});
});
