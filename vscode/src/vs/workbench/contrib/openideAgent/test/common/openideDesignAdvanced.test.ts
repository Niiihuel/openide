/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { changeDesign, newDesign, validateDesign } from '../../common/openideDesign.js';
import { createDesignGeometry, parseDesignObj, exportDesignObj, parseDesignSystem } from '../../common/openideDesignAdvanced.js';
import { exportDesignSvg, validateDesignSvg } from '../../common/openideDesignSvg.js';
import { extractCodebaseDesign } from '../../../../../platform/openideCodebase/common/openideCodebaseDesigns.js';
suite('OpenIDE advanced Canvas', () => {
	test('drawing frame edits undo and redo without changing geometry IDs', () => {
		const original = newDesign('whiteboard', 'Ideas');
		const next = changeDesign(original, 1, [{ type: 'setAdvanced', id: 'hero', frame: { x: 200, y: 30, width: 450, height: 200, rotation: 15 } }]);
		assert.equal(next.document.screens[0].nodes[0].frame!.x, 200);
		assert.deepStrictEqual(changeDesign(next, 2, 'undo').document, original.document);
		assert.deepStrictEqual(changeDesign(changeDesign(next, 2, 'undo'), 3, 'redo').document, next.document);
		assert.throws(() => changeDesign(next, 1, [{ type: 'setAdvanced', id: 'hero', points: [[0, 0]] }]), /Design changed/);
	});
	test('animation interpolates values and rejects duplicate times and duration truncation', () => {
		const file = newDesign('animation', 'Motion');
		const frames = file.document.screens[0].nodes[0].keyframes!;
		assert.equal(createDesignGeometry().sample(frames, 1.25).x, 200);
		assert.equal(createDesignGeometry().sample(frames, -1).x, 0);
		assert.throws(() => changeDesign(file, 1, [{ type: 'setAdvanced', id: 'hero', keyframes: [frames[0], frames[0]] }]), /keyframes/);
		assert.throws(() => changeDesign(file, 1, [{ type: 'setDocument', duration: 1 }]), /duration/);
		assert.match(exportDesignSvg(file.document, {}), /animateTransform/);
	});
	test('OBJ export round trips transformed vertices and triangulates negative face indices', () => {
		const file = newDesign('scene3d', 'Geometry');
		const original = createDesignGeometry().mesh(file.document.screens[0].nodes[0].object3d!);
		const parsed = parseDesignObj(exportDesignObj(file.document));
		assert.deepStrictEqual(parsed.vertices, original.vertices);
		assert.deepStrictEqual(parsed.faces, original.faces);
		assert.deepStrictEqual(parseDesignObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1').faces, [[0, 1, 2], [0, 2, 3]]);
		assert.throws(() => parseDesignObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9'), /faces/);
	});
	test('mesh and drawing budgets reject excessive resources before rendering', () => {
		const file = newDesign('scene3d', 'Budget');
		file.document.screens[0].nodes = Array.from({ length: 31 }, (_, i) => ({ ...file.document.screens[0].nodes[0], id: `object-${i}` }));
		assert.throws(() => validateDesign(file), /budget/);
		assert.throws(() => changeDesign(newDesign('whiteboard', 'Budget'), 1, [{ type: 'setAdvanced', id: 'hero', points: Array.from({ length: 2001 }, () => [0, 0]) }]), /points/);
	});
	test('DTCG aliases, sRGB colors and dimensions merge into a reversible design system', () => {
		const system = parseDesignSystem(JSON.stringify({ brand: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0, .5] } }, accent: { $value: '{brand}' }, fontSize: { $type: 'dimension', $value: { value: 20, unit: 'px' } } }), 'Brand');
		assert.equal(system.colors.accent, '#ff0080');
		assert.equal(system.fontSize, 20);
		const original = newDesign('mockup', 'Brand');
		const next = changeDesign(original, 1, [{ type: 'setSystem', designSystem: system }]);
		assert.equal(next.document.tokens.accent, '#ff0080');
		assert.deepStrictEqual(changeDesign(next, 2, 'undo').document, original.document);
		assert.throws(() => parseDesignSystem('{"a":{"$value":"{b}"},"b":{"$value":"{a}"}}', 'Cycle'), /cyclic/);
	});
	test('SVG imports exclude active content, remote references and unbounded dimensions', () => {
		validateDesignSvg('<svg width="120" height="100"><rect width="50" height="50"/></svg>');
		for (const source of ['<svg onload="alert(1)"/>', '<svg><script/></svg>', '<svg><image href="https://a"/></svg>', '<!DOCTYPE svg><svg/>', '<svg width="100000000"><rect/></svg>']) {
			assert.throws(() => validateDesignSvg(source));
		}
	});
	test('Project Map relates screens and implementation files without indexing history', () => {
		const file = newDesign('mobile', 'Checkout');
		file.document.screens[0].nodes[0].sourcePath = 'src/checkout.ts';
		file.past = [{ ...file.document, title: 'Old private draft' }];
		const uri = 'file:///project/.openide/designs/checkout/design.json';
		const graph = extractCodebaseDesign('test', uri, JSON.stringify(file));
		assert(graph.nodes.some(n => n.name === 'Canvas: Checkout'));
		assert(!JSON.stringify(graph).includes('Old private draft'));
		assert(graph.edges.some(e => e.type === 'REFERENCES'));
		assert.deepStrictEqual(extractCodebaseDesign('test', uri, JSON.stringify({ ...file, document: { title: 'Malformed', screens: [null] } })), { nodes: [], edges: [] });
	});
});
