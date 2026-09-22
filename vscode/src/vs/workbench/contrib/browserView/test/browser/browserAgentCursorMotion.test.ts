/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BrowserAgentCursorMotion } from '../../browser/browserAgentCursorMotion.js';

suite('Browser agent cursor motion', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('retargeting keeps both position and velocity continuous', () => {
		const motion = new BrowserAgentCursorMotion();
		motion.moveTo({ x: 20, y: 30 }, 0);
		motion.moveTo({ x: 800, y: 500 }, 0);
		const before = motion.sample(99.999)!;
		const current = motion.sample(100)!;
		motion.moveTo({ x: 400, y: 600 }, 100);
		assert.deepStrictEqual(motion.sample(100), current);
		const after = motion.sample(100.001)!;
		assert.ok(Math.abs((current.x - before.x) - (after.x - current.x)) < .000001);
		assert.ok(Math.abs((current.y - before.y) - (after.y - current.y)) < .000001);
		assert.deepStrictEqual(motion.sample(800), { x: 400, y: 600 });
		assert.strictEqual(motion.active, false);
	});

	test('motion is frame-rate independent and approaches its target without bouncing', () => {
		const sample = (interval: number) => {
			const motion = new BrowserAgentCursorMotion();
			motion.moveTo({ x: 0, y: 0 }, 0);
			motion.moveTo({ x: 1000, y: 500 }, 0);
			let last = 0;
			for (let time = 0; time < 300; time += interval) {
				const point = motion.sample(time)!;
				assert.ok(point.x >= last && point.x <= 1000);
				last = point.x;
			}
			return motion.sample(300)!;
		};
		assert.ok(Math.abs(sample(1000 / 60).x - sample(1000 / 120).x) < .000001);
	});

	test('reduced motion and coordinate remapping stop an old trajectory immediately', () => {
		const motion = new BrowserAgentCursorMotion();
		motion.moveTo({ x: 10, y: 10 }, 0);
		motion.moveTo({ x: 900, y: 600 }, 0);
		motion.sample(60);
		motion.moveTo({ x: 200, y: 100 }, 60, true);
		assert.deepStrictEqual({ point: motion.sample(100), moving: motion.active }, { point: { x: 200, y: 100 }, moving: false });
		motion.reset();
		assert.strictEqual(motion.sample(200), undefined);
		motion.moveTo({ x: 100, y: 50 }, 200);
		assert.deepStrictEqual({ point: motion.sample(200), moving: motion.active }, { point: { x: 100, y: 50 }, moving: false });
	});
});
