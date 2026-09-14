/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { openidePlaywrightVisuals } from '../../common/openidePlaywrightVisuals.js';

suite('OpenIDE Playwright feedback', () => {
	function fixture(script = 'install') {
		const steps: string[] = [];
		const painted: unknown[] = [];
		const locator = {
			count: async () => 1,
			scrollIntoViewIfNeeded: async () => {},
			boundingBox: async () => ({ x: 20, y: 30, width: 100, height: 40 }),
			fill: async (text: string) => { steps.push('fill:' + text); return 'result'; },
			click: async (_options?: unknown) => { steps.push('click'); },
			filter: () => locator,
		};
		const page = {
			evaluate: async (_fn: unknown, arg?: { method: string; args: unknown[] }) => {
				if (arg) { steps.push(arg.method); painted.push(arg); }
			},
			getByRole: (_role: string) => locator,
			locator: (_selector: string) => locator,
			mouse: { move: async (_x: number, _y: number) => { steps.push('move'); } },
		};
		return { steps, painted, locator, page, visual: openidePlaywrightVisuals(page, script) };
	}

	test('chained locator feedback precedes input and never includes typed values', async () => {
		const f = fixture();
		assert.strictEqual(await f.visual.page.getByRole('textbox').filter({}).fill('private text'), 'result');
		assert.ok(f.steps.indexOf('moveTo') < f.steps.indexOf('fill:private text'));
		assert.strictEqual(JSON.stringify(f.painted).includes('private text'), false);
		assert.strictEqual(f.steps.at(-1), 'clearHighlight');
	});

	test('trial actions and disabled feedback pass through without decoration', async () => {
		const f = fixture();
		await f.visual.page.getByRole('button').click({ trial: true });
		assert.deepStrictEqual(f.steps, ['click']);
		const disabled = fixture('');
		await disabled.visual.page.getByRole('button').click();
		assert.deepStrictEqual(disabled.steps, ['click']);
	});

	test('decoration failure cannot change the result of the real action', async () => {
		const f = fixture();
		f.locator.boundingBox = async () => { throw new Error('detached'); };
		await f.visual.page.getByRole('button').click();
		assert.ok(f.steps.includes('click'));
	});

	test('original action errors survive feedback and cleanup', async () => {
		const f = fixture();
		const error = new Error('action failed');
		f.locator.click = async () => { throw error; };
		await assert.rejects(f.visual.page.getByRole('button').click(), e => e === error);
		assert.ok(f.steps.includes('fail'));
		await f.visual.dispose();
		assert.strictEqual(f.steps.at(-1), 'finish');
	});

	test('namespace identity and mouse coordinates are preserved', async () => {
		const f = fixture();
		assert.strictEqual(f.visual.page.mouse, f.visual.page.mouse);
		await f.visual.page.mouse.move(51, 84);
		assert.ok(f.steps.indexOf('moveTo') < f.steps.indexOf('move'));
		assert.ok(JSON.stringify(f.painted).includes('[51,84,"Move pointer"]'));
	});
});
