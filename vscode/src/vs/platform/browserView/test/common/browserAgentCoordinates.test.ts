/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createBrowserAgentViewportTransform } from '../../common/browserAgentCoordinates.js';

suite('BrowserAgentViewportTransform', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps CSS, normalized, and device positions through the same letterboxed viewport', () => {
		const transform = createBrowserAgentViewportTransform({ width: 1000, height: 500, deviceScaleFactor: 2 }, { width: 500, height: 500, offsetX: 10, offsetY: 20 });
		assert.deepStrictEqual({
			content: transform.contentRect,
			css: transform.point({ x: 500, y: 250 }),
			normalized: transform.point({ x: 0.5, y: 0.5, space: 'normalized' }),
			device: transform.point({ x: 1000, y: 500, space: 'device' }),
			target: transform.rect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2, space: 'normalized' }),
		}, {
			content: { x: 10, y: 145, width: 500, height: 250 },
			css: { x: 260, y: 270 }, normalized: { x: 260, y: 270 }, device: { x: 260, y: 270 },
			target: { x: 210, y: 245, width: 100, height: 50 },
		});
	});

	test('keeps a logical point aligned after resize and browser zoom without double scaling high DPI', () => {
		const before = createBrowserAgentViewportTransform({ width: 800, height: 600, deviceScaleFactor: 2 }, { width: 800, height: 600 });
		const resized = createBrowserAgentViewportTransform({ width: 800, height: 600, deviceScaleFactor: 2 }, { width: 400, height: 600 });
		const zoomed = createBrowserAgentViewportTransform({ width: 400, height: 300, deviceScaleFactor: 2, zoomFactor: 2 }, { width: 800, height: 600 });
		assert.deepStrictEqual({ before: before.point({ x: 0.25, y: 0.5, space: 'normalized' }), resized: resized.point({ x: 0.25, y: 0.5, space: 'normalized' }), zoomed: zoomed.point({ x: 100, y: 150 }) }, {
			before: { x: 200, y: 300 }, resized: { x: 100, y: 300 }, zoomed: { x: 200, y: 300 },
		});
	});

	test('applies native browser zoom and explicit centered presentation zoom', () => {
		const native = createBrowserAgentViewportTransform({ width: 400, height: 300, zoomFactor: 2, deviceScaleFactor: 3 }, { width: 800, height: 600, fit: 'native' });
		const fitted = createBrowserAgentViewportTransform({ width: 400, height: 300 }, { width: 800, height: 600, zoomFactor: 2 });
		assert.deepStrictEqual({ native: native.point({ x: 300, y: 450, space: 'device' }), fitted: fitted.point({ x: 0.5, y: 0.5, space: 'normalized' }), content: fitted.contentRect }, {
			native: { x: 200, y: 300 }, fitted: { x: 400, y: 300 }, content: { x: -400, y: -300, width: 1600, height: 1200 },
		});
	});

	test('supports stretched representations and targets partly outside the viewport', () => {
		const transform = createBrowserAgentViewportTransform({ width: 1000, height: 500 }, { width: 500, height: 500, fit: 'fill' });
		assert.deepStrictEqual(transform.rect({ x: -10, y: 400, width: 200, height: 200 }), { x: -5, y: 400, width: 100, height: 200 });
	});

	test('does not produce NaN or infinite transforms during zero-size layout or invalid input', () => {
		const transform = createBrowserAgentViewportTransform({ width: 0, height: NaN, deviceScaleFactor: 0, zoomFactor: Infinity }, { width: 0, height: 0, offsetX: NaN });
		assert.deepStrictEqual({ point: transform.point({ x: NaN, y: Infinity }), target: transform.rect({ x: 0, y: 0, width: -5, height: NaN }) }, {
			point: { x: 0, y: 0 }, target: { x: 0, y: 0, width: 0, height: 0 },
		});
	});
});
