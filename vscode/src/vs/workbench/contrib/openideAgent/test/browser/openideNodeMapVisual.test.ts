/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildProjectArchMapSource } from '../../browser/diagrams/openideArchMapFromProject.js';
import { NODE_MAP_COLORS, renderNodeMapSvg } from '../../browser/diagrams/openideNodeMapDiagram.js';
import { renderSeqMapSvg } from '../../browser/diagrams/openideSeqMapDiagram.js';
import { IGraphView } from '../../browser/openideCodebaseGraphService.js';
import { parseNodeMap } from '../../common/diagrams/openideNodeMaps.js';
import { parseDiagramSource } from '../../common/diagrams/openideDiagramEngine.js';

/**
 * The typed-map rendering contract: each diagram type draws ITS canonical shapes — component
 * cards, decision diamonds, state stadiums, sequence lifelines — dressed in our skin: paper
 * fill, kind-coloured accents, dotted canvas, quadratic edges, hover focus that dims what is
 * not adjacent. The full-screen viewer inherits all of it because everything, legend included,
 * lives inside the SVG.
 */
suite('OpenIDE typed maps — diagram shapes in our skin', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const SOURCE = JSON.stringify({
		type: 'archmap',
		title: 'Checkout',
		nodes: [
			{ id: 'web', label: 'Web App', kind: 'frontend', sublabel: 'Next.js', emphasis: true },
			{ id: 'api', label: 'API', kind: 'backend', group: 'AWS' },
			{ id: 'db', label: 'PostgreSQL', kind: 'database', group: 'AWS' },
			{ id: 'auth', label: 'Auth0', kind: 'external' },
		],
		edges: [
			{ from: 'web', to: 'api', label: 'HTTPS' },
			{ from: 'api', to: 'db' },
			{ from: 'web', to: 'auth', dashed: true },
		],
	});

	function render(source: string = SOURCE) {
		const parsed = parseDiagramSource(source);
		assert.ok(parsed && parsed.family === 'nodemap', 'source parses as a node map');
		return renderNodeMapSvg(document, parsed.spec, parsed.layout).svg;
	}

	test('components are CARDS — kind-accented boxes with the text inside, not circles', () => {
		const svg = render();
		const shapes = [...svg.querySelectorAll('rect.amap-shape')];
		assert.strictEqual(shapes.length, 4);
		assert.strictEqual(svg.querySelectorAll('circle.amap-dot').length, 0, 'the circle era is over');
		const strokes = new Set(shapes.map(shape => shape.getAttribute('stroke')));
		assert.ok(strokes.has(NODE_MAP_COLORS.archmap.frontend) && strokes.has(NODE_MAP_COLORS.archmap.database), 'the kind colours the border');
		const titles = [...svg.querySelectorAll('.amap-card-title')].map(title => title.textContent);
		assert.strictEqual(titles.length, 4);
		assert.ok(titles.includes('Web App') && titles.includes('PostgreSQL'));
		assert.strictEqual(svg.querySelectorAll('.amap-card-sub').length, 1, 'only web has a sublabel');
	});

	test('edges are quadratic curves trimmed to the box borders, with the chip on the curve', () => {
		const svg = render();
		const paths = [...svg.querySelectorAll('.amap-edge')].map(path => path.getAttribute('d') ?? '');
		assert.strictEqual(paths.length, 3);
		for (const d of paths) {
			assert.ok(/^M[-\d.,]+ Q/.test(d), `quadratic, Obsidian-style: ${d}`);
		}
		const chips = [...svg.querySelectorAll('.dchip')].map(chip => chip.textContent);
		assert.deepStrictEqual(chips, ['HTTPS']);
		assert.strictEqual(svg.querySelectorAll('.amap-edge.dashed').length, 1);
	});

	test('emphasis tints its card with the kind colour, groups draw one labelled hull', () => {
		const svg = render();
		const emphasised = [...svg.querySelectorAll('.amap-shape.emphasis')];
		assert.strictEqual(emphasised.length, 1);
		assert.strictEqual(emphasised[0].getAttribute('stroke'), NODE_MAP_COLORS.archmap.frontend);
		assert.ok((emphasised[0] as SVGElement).style.fill.includes('color-mix'), 'the focal card carries a tint');
		assert.strictEqual(svg.querySelectorAll('rect.amap-hull').length, 1);
		const hullLabels = [...svg.querySelectorAll('text.amap-hull-label')].map(label => label.textContent);
		assert.deepStrictEqual(hullLabels, ['AWS']);
	});

	test('the legend carries only the kinds present, plus the dashed entry', () => {
		const svg = render();
		assert.strictEqual(svg.querySelectorAll('.amap-legend-dot').length, 4);
		assert.strictEqual(svg.querySelectorAll('.dleg-line').length, 1, 'dashed entry because one edge is async');
		assert.ok(svg.querySelector('text.amap-title')?.textContent === 'Checkout');
	});

	test('a flowmap speaks flowchart: diamonds decide, stadiums open and close', () => {
		const svg = render(JSON.stringify({
			type: 'flowmap',
			nodes: [
				{ id: 'a', label: 'Recibir', kind: 'start', group: 'Backoffice' },
				{ id: 'b', label: '¿Stock?', kind: 'decision', group: 'Backoffice' },
				{ id: 'c', label: 'Facturar', kind: 'step' },
				{ id: 'd', label: 'Listo', kind: 'end' },
			],
			edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'sí' }, { from: 'c', to: 'd' }],
		}));
		const diamonds = [...svg.querySelectorAll('polygon.amap-shape')];
		assert.strictEqual(diamonds.length, 1, 'the decision is a diamond');
		assert.strictEqual(diamonds[0].getAttribute('stroke'), NODE_MAP_COLORS.flowmap.decision, 'and it wears amber');
		const stadiums = [...svg.querySelectorAll('rect.amap-shape')]
			.filter(rect => Number(rect.getAttribute('rx')) === Number(rect.getAttribute('height')) / 2);
		assert.strictEqual(stadiums.length, 2, 'start and end are stadiums');
		assert.deepStrictEqual([...svg.querySelectorAll('text.amap-hull-label')].map(l => l.textContent), ['Backoffice'], 'the lane is a hull');
	});

	test('hovering a node focuses it: neighbours stay lit, incident edges take its colour', () => {
		const svg = render();
		const nodes = [...svg.querySelectorAll('g.amap-node')];
		// Stacking order sorts by degree; find web (degree 2, emphasised) through its tinted card.
		const web = nodes.find(node => node.querySelector('.amap-shape.emphasis'))!;
		web.dispatchEvent(new Event('pointerenter'));
		assert.ok(svg.classList.contains('amap-focus'));
		assert.ok(web.classList.contains('on'));
		assert.strictEqual(svg.querySelectorAll('g.amap-node.on').length, 3, 'web + its two neighbours');
		const litEdges = [...svg.querySelectorAll('.amap-edge.on')];
		assert.strictEqual(litEdges.length, 2);
		for (const edge of litEdges) {
			assert.strictEqual((edge as SVGElement).style.getPropertyValue('--amap-c'), NODE_MAP_COLORS.archmap.frontend);
		}
		web.dispatchEvent(new Event('pointerleave'));
		assert.ok(!svg.classList.contains('amap-focus'));
		assert.strictEqual(svg.querySelectorAll('.on').length, 0);
	});

	test('a seqmap draws lifelines, time flows down, and replies dash', () => {
		const parsed = parseDiagramSource(JSON.stringify({
			type: 'seqmap',
			title: 'Login',
			actors: [
				{ id: 'web', label: 'Web', kind: 'frontend' },
				{ id: 'api', label: 'API', kind: 'backend' },
			],
			steps: [
				{ from: 'web', to: 'api', label: 'POST /login' },
				{ from: 'api', to: 'api', label: 'crear sesión' },
				{ from: 'api', to: 'web', label: '200', reply: true },
			],
		}));
		assert.ok(parsed && parsed.family === 'seqmap');
		const svg = renderSeqMapSvg(document, parsed.spec, parsed.layout).svg;
		assert.strictEqual(svg.querySelectorAll('line.smap-lifeline').length, 2, 'one lifeline per actor');
		assert.strictEqual(svg.querySelectorAll('rect.amap-shape').length, 2, 'actors head their columns as cards');
		const steps = [...svg.querySelectorAll('.amap-edge')];
		assert.strictEqual(steps.length, 3);
		const straight = steps.map(step => step.getAttribute('d') ?? '').filter(d => /^M[-\d.,]+ L/.test(d));
		assert.strictEqual(straight.length, 2, 'messages between actors are straight rows; only the self-call loops');
		assert.strictEqual(svg.querySelectorAll('.amap-edge.dashed').length, 1, 'the reply dashes');
		const chips = [...svg.querySelectorAll('.dchip')].map(chip => chip.textContent);
		assert.deepStrictEqual(chips, ['POST /login', 'crear sesión', '200'], 'authored order is time');

		// Hovering an actor lights only its traffic — same focus CSS as every other map.
		const api = [...svg.querySelectorAll('g.amap-node')][1];
		api.dispatchEvent(new Event('pointerenter'));
		assert.ok(svg.classList.contains('amap-focus'));
		assert.strictEqual(svg.querySelectorAll('.amap-edge.on').length, 3, 'every step touches api here');
		api.dispatchEvent(new Event('pointerleave'));
		assert.strictEqual(svg.querySelectorAll('.on').length, 0);
	});

	test('the project view projects the index into valid archmap source', () => {
		const view: IGraphView = {
			nodes: [
				{ id: 'a.ts', name: 'a.ts', path: 'src/ui/a.ts', uri: 'u1', community: 'ui', degree: 3 },
				{ id: 'b.ts', name: 'b.ts', path: 'src/core/b.ts', uri: 'u2', community: 'core', degree: 4 },
				{ id: 'c.ts', name: 'c.ts', path: 'src/data/c.ts', uri: 'u3', community: 'data', degree: 2 },
			],
			edges: [
				{ source: 'a.ts', target: 'b.ts' },
				{ source: 'b.ts', target: 'c.ts' },
				{ source: 'a.ts', target: 'c.ts' },
			],
			// The orphan is Louvain's trail: one file, zero cross-module edges. It earns no node.
			modules: [{ label: 'core', count: 12 }, { label: 'ui', count: 8 }, { label: 'data', count: 5 }, { label: 'huerfano', count: 1 }],
			truncated: 0,
		};
		const source = buildProjectArchMapSource(view, 'Arquitectura del proyecto');
		assert.ok(source, 'the index has enough modules to tell');
		const parsed = parseNodeMap(source!);
		assert.ok(parsed.spec, 'the projection obeys the authored contract');
		assert.strictEqual(parsed.spec!.nodes.length, 3, 'the disconnected singleton is filtered out');
		assert.strictEqual(parsed.spec!.nodes.some(node => node.label === 'huerfano'), false);
		assert.strictEqual(parsed.spec!.edges.length, 3, 'file edges aggregate to module pairs');
		const kinds = new Map(parsed.spec!.nodes.map(node => [node.label, node.kind]));
		assert.strictEqual(kinds.get('ui'), 'frontend', 'module names hint the semantic kind');
		assert.strictEqual(kinds.get('data'), 'database');
		assert.strictEqual(parsed.spec!.nodes.find(node => node.label === 'core')?.emphasis, true, 'the biggest module carries the ring');
	});

	test('an index with a single module has no architecture to tell', () => {
		const view: IGraphView = {
			nodes: [{ id: 'a.ts', name: 'a.ts', path: 'a.ts', uri: 'u1', community: 'app', degree: 0 }],
			edges: [],
			modules: [{ label: 'app', count: 1 }],
			truncated: 0,
		};
		assert.strictEqual(buildProjectArchMapSource(view, 'x'), undefined);
	});
});
