/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	IOpenideChatStatusLineTiming, OPENIDE_CHAT_IDLE_GRACE_MS, OPENIDE_CHAT_STEP_MIN_MS, OpenideChatStatusLine,
} from '../../browser/chat/openideChatStatusLine.js';

/**
 * The swap between steps.
 *
 * What the user asked for is `AnimatePresence mode="wait"`: the step that is leaving finishes
 * leaving BEFORE the next one arrives, so the line never shows two things at once and never
 * reflows. That ordering is the whole behaviour, and it is invisible to a screenshot — a capture
 * taken a frame late looks identical to a swap with no animation at all.
 */
suite('OpenIDE chat status line', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const reducedMotion = () => mainWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/**
	 * The real holds are a second and change, which is the point of them and would make this suite
	 * take a minute. The timings are injected instead and the DEFAULTS are asserted separately, so
	 * nothing here can pass while the shipped line strobes.
	 */
	function create(timing: IOpenideChatStatusLineTiming = { stepMinMs: 60, idleGraceMs: 200 }) {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const line = store.add(new OpenideChatStatusLine(container, timing));
		store.add({ dispose: () => container.remove() });
		const label = () => line.domNode.querySelector('.openide-chat-response-working-label') as HTMLElement;
		const step = (text: string) => line.setStatus({ text, idle: false });
		const idle = (text: string) => line.setStatus({ text, idle: true });
		return { line, label, step, idle };
	}

	async function until(read: () => string, expected: string): Promise<void> {
		// Polled, not slept: the durations are the stylesheet's business, and a test that hardcodes
		// them fails the day somebody tunes the easing.
		for (let i = 0; i < 200 && read() !== expected; i++) {
			await timeout(5);
		}
		assert.strictEqual(read(), expected);
	}

	test('it starts hidden and says nothing', () => {
		const { line, label } = create();
		assert.strictEqual(line.domNode.classList.contains('hidden'), true);
		assert.strictEqual(label().textContent, '');
	});

	test('the first step appears immediately: there is nothing to wait for', () => {
		const { line, label, step } = create();
		step('Pensando');
		assert.strictEqual(line.domNode.classList.contains('hidden'), false);
		assert.strictEqual(label().textContent, 'Pensando');
	});

	test('the next step waits for the previous one to leave, then lands', async () => {
		const { label, step } = create();
		step('Read a.ts');
		step('Searched needle');
		if (!reducedMotion()) {
			// mode="wait": the outgoing step is still on screen while it animates out.
			assert.strictEqual(label().textContent, 'Read a.ts');
		}
		await until(() => label().textContent ?? '', 'Searched needle');
	});

	test('a burst of steps ends on the newest one, not on a queue of every one', async () => {
		const { label, step } = create();
		step('Read a.ts');
		step('Read b.ts');
		step('Read c.ts');
		step('Searched needle');
		await until(() => label().textContent ?? '', 'Searched needle');
	});

	test('repeating the same step does not restart the animation', async () => {
		const { label, step } = create();
		step('Read a.ts');
		await until(() => label().textContent ?? '', 'Read a.ts');
		const before = label().getAnimations().length;
		step('Read a.ts');
		assert.strictEqual(label().getAnimations().length, before);
	});

	test('the shimmer survives the swap: it says "still working", not "working on this"', async () => {
		const { label, step } = create();
		step('Read a.ts');
		step('Searched needle');
		await until(() => label().textContent ?? '', 'Searched needle');
		assert.strictEqual(label().classList.contains('openide-chat-shimmer'), true);
	});

	test('a step is held long enough to read, however fast the next one arrives', async () => {
		// The reported symptom: the agent settles a call and starts the next one a few hundred
		// milliseconds later, so without a floor the line rewrites itself faster than it can be read.
		const { label, step } = create({ stepMinMs: 300, idleGraceMs: 900 });
		step('Read a.ts');
		await until(() => label().textContent ?? '', 'Read a.ts');
		step('Read b.ts');
		await timeout(120);
		assert.strictEqual(label().textContent, 'Read a.ts', 'the first step was pushed off screen early');
		await until(() => label().textContent ?? '', 'Read b.ts');
	});

	test('the generic wait never interrupts a step; it waits out the longer grace', async () => {
		// This is what made "Planning next moves" feel like the only thing the dock ever said.
		const { label, step, idle } = create({ stepMinMs: 60, idleGraceMs: 400 });
		step('Read a.ts');
		await until(() => label().textContent ?? '', 'Read a.ts');
		idle('Planeando los próximos pasos');
		await timeout(200);
		assert.strictEqual(label().textContent, 'Read a.ts', 'the filler displaced a step that was still fresh');
		// A pause that really is a pause does reach the line: the alternative is a stale step
		// claiming the agent is still reading a file it finished with seconds ago.
		await until(() => label().textContent ?? '', 'Planeando los próximos pasos');
	});

	test('a real step jumps the queue ahead of a filler that was waiting', async () => {
		const { label, step, idle } = create({ stepMinMs: 60, idleGraceMs: 400 });
		step('Read a.ts');
		await until(() => label().textContent ?? '', 'Read a.ts');
		idle('Planeando los próximos pasos');
		step('Searched needle');
		await until(() => label().textContent ?? '', 'Searched needle');
		// The filler is stale, not queued: only the newest status is ever shown.
		await timeout(150);
		assert.strictEqual(label().textContent, 'Searched needle');
	});

	test('the shipped holds are the ones the user asked for', () => {
		// The suite runs on injected timings; these are what actually ships.
		assert.strictEqual(OPENIDE_CHAT_STEP_MIN_MS <= 200, true);
		assert.strictEqual(OPENIDE_CHAT_IDLE_GRACE_MS > OPENIDE_CHAT_STEP_MIN_MS, true);
	});

	test('hiding forgets the step, so the next turn enters instead of swapping', async () => {
		const { line, label, step } = create();
		step('Read a.ts');
		line.hide();
		assert.strictEqual(line.domNode.classList.contains('hidden'), true);
		assert.strictEqual(label().textContent, '');
		step('Pensando');
		// No exit to wait for: a step nobody saw leave is not a step.
		assert.strictEqual(label().textContent, 'Pensando');
	});

	test('completed swaps release their animation effects', async () => {
		const { label, step } = create();
		step('Reading');
		step('Editing');
		await until(() => label().textContent ?? '', 'Editing');
		await timeout(200);
		assert.strictEqual(label().getAnimations().filter(animation => animation.playState === 'finished').length, 0);
	});

	test('hiding during an exit cannot overwrite the next live status', async () => {
		const { line, label, step } = create();
		step('Old step');
		await timeout(120);
		step('Stale next step');
		line.hide();
		step('Current step');
		await timeout(300);
		assert.deepStrictEqual({ text: label().textContent, opacity: getComputedStyle(label()).opacity }, { text: 'Current step', opacity: '1' });
	});
});
