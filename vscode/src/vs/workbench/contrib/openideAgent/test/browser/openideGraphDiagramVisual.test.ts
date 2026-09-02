/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { renderGraphDiagramSvg } from '../../browser/diagrams/openideGraphDiagram.js';
import { parseDiagramSource } from '../../common/diagrams/openideDiagramEngine.js';

/**
 * The editorial rendering contract (ported from the diagram-design skill): orthogonal rounded
 * connectors instead of beziers, ONE focal node, card corners, and an in-figure legend that the
 * full-screen viewer inherits because it lives inside the SVG.
 */
suite('OpenIDE graph diagram — editorial rendering', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function render(source: string) {
		const parsed = parseDiagramSource(source);
		assert.ok(parsed && parsed.family === 'graph', 'source parses as a graph');
		return renderGraphDiagramSvg(document, parsed.layout);
	}

	test('edges are orthogonal elbows, never diagonal beziers', () => {
		const svg = render('graph TD\nA[Uno] --> B{Dos}\nB --> C[Tres]\nB --> D[Cuatro]');
		const paths = [...svg.querySelectorAll('.dedge-path')].map(p => p.getAttribute('d') ?? '');
		assert.ok(paths.length >= 3);
		for (const d of paths) {
			assert.ok(!/C/.test(d), `no cubic bezier in ${d}`);
			assert.ok(/^M[-\d.,]+ (L|H|V)/.test(d), `line or elbow: ${d}`);
		}
		// At least one edge in a branching graph is off-axis and must carry rounded turns.
		assert.ok(paths.some(d => d.includes('Q')), 'branching edges turn with rounded corners');
	});

	test('exactly one focal node: the entry node', () => {
		const svg = render('graph TD\nA[Entrada] --> B[Paso]\nB --> C[Paso 2]\nC --> D[Fin]');
		const focal = svg.querySelectorAll('.dnode-shape.focal');
		assert.strictEqual(focal.length, 1);
		const all = svg.querySelectorAll('.dnode-shape');
		assert.strictEqual(all[0], focal[0], 'the first declared node is the focal one');
	});

	test('plain rect nodes are cards (radius-md), not sharp boxes', () => {
		const svg = render('graph TD\nA[Uno] --> B[Dos]');
		const rects = [...svg.querySelectorAll('rect.dnode-shape')];
		assert.ok(rects.length >= 2);
		for (const rect of rects) {
			assert.strictEqual(rect.getAttribute('rx'), '6');
		}
	});

	test('a diagram with enough variety closes with an in-SVG legend', () => {
		const svg = render('graph TD\nA[Uno] --> B[Dos]\nB --> C[Tres]\nC --> D[Cuatro]\nD -.-> A');
		assert.ok(svg.querySelectorAll('.dleg-swatch').length >= 2, 'swatches present');
		assert.strictEqual(svg.querySelectorAll('.dleg-line').length, 1, 'dashed entry because the graph has async edges');
		const labels = [...svg.querySelectorAll('.dleg-label')].map(t => t.textContent);
		assert.deepStrictEqual(labels, ['Focal', 'Paso', 'Asíncrono / retorno']);
		// The legend strip grows the canvas: the viewBox is taller than the layout alone.
		const viewBox = svg.getAttribute('viewBox')!.split(' ');
		assert.ok(Number(viewBox[3]) > 0);
	});

	test('a tiny sketch earns no legend', () => {
		const svg = render('graph TD\nA[Uno] --> B[Dos]');
		assert.strictEqual(svg.querySelectorAll('.dleg-swatch').length, 0);
	});
});
