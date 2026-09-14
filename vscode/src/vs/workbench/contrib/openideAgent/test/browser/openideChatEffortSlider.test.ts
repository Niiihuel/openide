/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IOpenideEffortSliderRuntime, OpenideChatEffortSlider } from '../../browser/chat/openideChatEffortSlider.js';

suite('OpenIDE ChatEffortSlider', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create() {
		const host = document.createElement('div');
		host.style.cssText = 'width:240px;height:36px;position:relative';
		document.body.appendChild(host);
		store.add({ dispose: () => host.remove() });
		let hidden = false;
		let reduced = false;
		const visibility = store.add(new Emitter<void>());
		const motion = store.add(new Emitter<void>());
		const frames = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		const runtime: IOpenideEffortSliderRuntime = {
			get reducedMotion() { return reduced; },
			get hidden() { return hidden; },
			requestFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
			cancelFrame: frame => { frames.delete(frame); },
			onDidChangeMotion: listener => motion.event(listener),
			onDidChangeVisibility: listener => visibility.event(listener),
		};
		const committed: number[] = [];
		const previews: number[] = [];
		const slider = store.add(new OpenideChatEffortSlider(host, ['Default', 'Low', 'High', 'Max'], 1, 'Effort', true, index => previews.push(index), index => committed.push(index), () => { }, runtime));
		const pointer = (type: string, fraction: number) => {
			const rect = host.getBoundingClientRect();
			slider.input.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, clientX: rect.left + rect.width * fraction, bubbles: true }));
		};
		return { host, slider, pointer, committed, previews, frames,
			motion: (value: boolean) => { reduced = value; motion.fire(); },
			visibility: (value: boolean) => { hidden = !value; visibility.fire(); },
		};
	}

	test('a continuous pointer gesture previews levels and persists only once on release', () => {
		const { slider, pointer, committed, previews } = create();
		pointer('pointerdown', 0.2);
		pointer('pointermove', 0.95);
		assert.strictEqual(slider.input.value, '3');
		assert.strictEqual(slider.input.getAttribute('aria-valuetext'), 'Max');
		assert.ok(previews.includes(3));
		assert.deepStrictEqual(committed, []);
		pointer('pointerup', 0.95);
		pointer('pointerup', 0.95);
		assert.deepStrictEqual(committed, [3]);
	});

	test('pointer cancellation restores the committed level without persisting a preview', () => {
		const { slider, pointer, committed } = create();
		pointer('pointerdown', 0.95);
		pointer('pointercancel', 0.95);
		assert.strictEqual(slider.input.value, '1');
		assert.deepStrictEqual(committed, []);
	});

	test('maximum effort has sparkles without Fast and returns to idle at lower effort', () => {
		const { host, slider, committed, frames, motion } = create();
		assert.strictEqual(frames.size, 0);
		slider.input.value = '3'; slider.input.dispatchEvent(new Event('input')); slider.input.dispatchEvent(new Event('change'));
		assert.deepStrictEqual(committed, [3]);
		assert.strictEqual(host.classList.contains('is-fast'), false);
		assert.strictEqual(host.classList.contains('is-maximum'), true);
		assert.strictEqual(frames.size, 1);
		const [burstFrame, paintBurst] = [...frames.entries()][0]; frames.delete(burstFrame); paintBurst(performance.now() + 16);
		const burst = host.querySelector<HTMLCanvasElement>('.openide-mp-slider-burst')!;
		const pixels = burst.getContext('2d')!.getImageData(0, 0, burst.width, burst.height).data;
		assert.ok(pixels.some((value, index) => index % 4 === 3 && value > 0), 'Reaching Max paints a burst even when Fast is off');
		motion(true); assert.strictEqual(frames.size, 0);
		motion(false); assert.strictEqual(frames.size, 1);
		slider.input.value = '2'; slider.input.dispatchEvent(new Event('input')); slider.input.dispatchEvent(new Event('change'));
		// A burst may finish after leaving Max; it must never keep an idle slider ticking.
		const start = performance.now();
		for (let index = 1; frames.size && index <= 20; index++) {
			const [id, callback] = [...frames.entries()][0]; frames.delete(id); callback(start + index * 32);
		}
		assert.strictEqual(frames.size, 0);
		assert.strictEqual(host.classList.contains('is-fast'), false);
		assert.deepStrictEqual(committed, [3, 2]);
	});

	test('one animation loop pauses for motion and visibility preferences and is released on disposal', () => {
		const { host, slider, committed, frames, motion, visibility } = create();
		slider.input.focus();
		assert.strictEqual(host.classList.contains('is-keyboard-focus'), false);
		slider.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
		assert.strictEqual(host.classList.contains('is-keyboard-focus'), true);
		assert.strictEqual(frames.size, 0);
		slider.setFastMode(true);
		assert.strictEqual(frames.size, 1);
		const [id, callback] = [...frames.entries()][0];
		frames.delete(id); callback(performance.now());
		assert.strictEqual(frames.size, 1);
		motion(true);
		assert.strictEqual(frames.size, 0);
		// The native range's keyboard input/change contract works even with every effect off.
		slider.input.value = '2';
		slider.input.dispatchEvent(new Event('input'));
		slider.input.dispatchEvent(new Event('change'));
		assert.deepStrictEqual(committed, [2]);
		assert.strictEqual(slider.input.getAttribute('aria-valuetext'), 'High');
		assert.strictEqual(frames.size, 0);
		motion(false);
		assert.strictEqual(frames.size, 1);
		slider.setFastMode(false);
		assert.strictEqual(frames.size, 0);
		slider.setFastMode(true);
		visibility(false);
		assert.strictEqual(frames.size, 0);
		visibility(true);
		assert.strictEqual(frames.size, 1);
		slider.dispose();
		motion(true); motion(false);
		assert.strictEqual(frames.size, 0);
		assert.strictEqual(host.querySelector('.openide-mp-slider-effects'), null);
		assert.ok([...host.querySelectorAll('canvas')].every(canvas => canvas.width === 0 && canvas.height === 0));
	});
});
