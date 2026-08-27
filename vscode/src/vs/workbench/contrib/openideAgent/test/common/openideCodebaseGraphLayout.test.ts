/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { ILayoutEdge, ILayoutInputNode, layoutGraph, layoutLayered } from '../../../../../code/common/openideCodebaseGraphLayout.js';

/**
 * The Project Map used a force-directed layout and read like a cloud: it conveyed density, not
 * hierarchy. What makes a React Flow-style diagram legible is that layers order the
 * dependencies in one direction — you can see what is an entrypoint and what is a utility.
 * Estos tests fijan esa propiedad, no las coordenadas exactas.
 */
suite('OpenIDE codebase graph layout — capas', () => {

	const W = 1000;
	const H = 700;

	function node(id: string, community = 'app', degree = 1): ILayoutInputNode {
		return { id, community, degree };
	}
	function layerOf(result: ReturnType<typeof layoutLayered>, id: string): number {
		const found = result.nodes.find(n => n.id === id);
		assert.notStrictEqual(found, undefined, `falta el nodo ${id}`);
		return found!.layer;
	}

	test('una cadena de dependencias produce una capa por eslabón', () => {
		const nodes = [node('a'), node('b'), node('c'), node('d')];
		const edges: ILayoutEdge[] = [
			{ source: 'a', target: 'b' },
			{ source: 'b', target: 'c' },
			{ source: 'c', target: 'd' },
		];
		const result = layoutLayered(nodes, edges, W, H);
		assert.strictEqual(result.layers, 4);
		assert.strictEqual(layerOf(result, 'a'), 0);
		assert.strictEqual(layerOf(result, 'd'), 3);
	});

	test('la dependencia queda SIEMPRE en una capa posterior a quien la usa', () => {
		// This is the property that makes the drawing legible: if an edge goes upward, direction
		// stops meaning anything and the diagram is a cloud with lines again.
		const nodes = [node('app'), node('ui'), node('utils'), node('http'), node('types')];
		const edges: ILayoutEdge[] = [
			{ source: 'app', target: 'ui' },
			{ source: 'app', target: 'http' },
			{ source: 'ui', target: 'utils' },
			{ source: 'http', target: 'utils' },
			{ source: 'utils', target: 'types' },
		];
		const result = layoutLayered(nodes, edges, W, H);
		for (const edge of edges) {
			assert.strictEqual(layerOf(result, edge.source) < layerOf(result, edge.target), true,
				`${edge.source} → ${edge.target} no baja de capa`);
		}
	});

	test('la capa se define por el camino MÁS LARGO, no el más corto', () => {
		// With the shortest path, `utils` would land in layer 1 because of the direct edge and its
		// edge from `ui` would cross backwards.
		const nodes = [node('app'), node('ui'), node('utils')];
		const edges: ILayoutEdge[] = [
			{ source: 'app', target: 'utils' },
			{ source: 'app', target: 'ui' },
			{ source: 'ui', target: 'utils' },
		];
		const result = layoutLayered(nodes, edges, W, H);
		assert.strictEqual(layerOf(result, 'utils'), 2);
	});

	test('un ciclo no cuelga ni deja nodos afuera', () => {
		// Circular imports exist in real projects; a naive topological order would end up with an
		// empty queue and lose the entire cycle.
		const nodes = [node('a'), node('b'), node('c')];
		const edges: ILayoutEdge[] = [
			{ source: 'a', target: 'b' },
			{ source: 'b', target: 'c' },
			{ source: 'c', target: 'a' },
		];
		const result = layoutLayered(nodes, edges, W, H);
		assert.strictEqual(result.nodes.length, 3);
		assert.strictEqual(result.layers >= 2, true);
	});

	test('es determinista: mismo grafo, mismas coordenadas', () => {
		const nodes = [node('a', 'x', 3), node('b', 'y', 1), node('c', 'x', 2), node('d', 'y', 5)];
		const edges: ILayoutEdge[] = [
			{ source: 'a', target: 'b' },
			{ source: 'a', target: 'c' },
			{ source: 'c', target: 'd' },
			{ source: 'b', target: 'd' },
		];
		const first = layoutLayered(nodes, edges, W, H);
		const second = layoutLayered([...nodes].reverse(), [...edges].reverse(), W, H);
		assert.deepStrictEqual(
			first.nodes.map(n => [n.id, Math.round(n.x), Math.round(n.y)]).sort(),
			second.nodes.map(n => [n.id, Math.round(n.x), Math.round(n.y)]).sort());
	});

	test('ningún nodo se sale del viewport', () => {
		const nodes = Array.from({ length: 60 }, (_, i) => node('n' + i, 'm' + (i % 5), i % 7));
		const edges: ILayoutEdge[] = nodes.slice(1).map((n, i) => ({ source: 'n' + i, target: n.id }));
		const result = layoutLayered(nodes, edges, W, H);
		for (const n of result.nodes) {
			assert.strictEqual(n.x >= 0 && n.x <= W, true, `${n.id} fuera en x: ${n.x}`);
			assert.strictEqual(n.y >= 0 && n.y <= H, true, `${n.id} fuera en y: ${n.y}`);
		}
	});

	test('sin aristas no se apila todo en un punto', () => {
		// This is the case seen in production with 0 relationships. Even with no hierarchy to show,
		// the nodes must stay distinguishable instead of overlapping.
		const nodes = Array.from({ length: 12 }, (_, i) => node('n' + i));
		const result = layoutLayered(nodes, [], W, H);
		assert.strictEqual(result.layers, 1);
		const xs = new Set(result.nodes.map(n => Math.round(n.x)));
		assert.strictEqual(xs.size, 12, 'los nodos de una capa se superponen');
	});

	test('un grafo vacío no rompe', () => {
		const result = layoutLayered([], [], W, H);
		assert.deepStrictEqual(result.nodes, []);
		assert.strictEqual(result.layers, 0);
	});
});

/**
 * The native Project Map draws `layoutGraph` (communities + forces): what matters is that it is
 * deterministic, that it stays inside the canvas, and that nodes do not pile up on each other.
 */
suite('OpenIDE codebase graph layout — comunidades', () => {

	const W = 1200;
	const H = 800;

	function clustered(): { nodes: ILayoutInputNode[]; edges: ILayoutEdge[] } {
		const nodes: ILayoutInputNode[] = [];
		const edges: ILayoutEdge[] = [];
		for (const community of ['ui', 'state', 'services']) {
			for (let i = 0; i < 12; i++) {
				nodes.push({ id: `${community}/${i}`, community, degree: i === 0 ? 11 : 2 });
				if (i > 0) { edges.push({ source: `${community}/0`, target: `${community}/${i}` }); }
			}
		}
		edges.push({ source: 'ui/0', target: 'state/0' }, { source: 'state/0', target: 'services/0' });
		return { nodes, edges };
	}

	test('es determinista: mismo grafo, mismas coordenadas', () => {
		const { nodes, edges } = clustered();
		const a = layoutGraph(nodes, W, H, edges);
		const b = layoutGraph(nodes, W, H, edges);
		assert.deepStrictEqual(a, b);
	});

	test('todos los nodos quedan dentro del lienzo, radio incluido', () => {
		const { nodes, edges } = clustered();
		for (const node of layoutGraph(nodes, W, H, edges).nodes) {
			assert.ok(node.x - node.r >= 0 && node.x + node.r <= W, `${node.id} fuera en x: ${node.x}`);
			assert.ok(node.y - node.r >= 0 && node.y + node.r <= H, `${node.id} fuera en y: ${node.y}`);
		}
	});

	test('ningún par de nodos se superpone', () => {
		const { nodes, edges } = clustered();
		const placed = layoutGraph(nodes, W, H, edges).nodes;
		for (let i = 0; i < placed.length; i++) {
			for (let j = i + 1; j < placed.length; j++) {
				const distance = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y);
				assert.ok(distance >= (placed[i].r + placed[j].r) * 0.9, `${placed[i].id} y ${placed[j].id} se pisan (${distance.toFixed(1)})`);
			}
		}
	});

	test('el hub de cada módulo queda más cerca de su módulo que de los otros', () => {
		const { nodes, edges } = clustered();
		const placed = layoutGraph(nodes, W, H, edges).nodes;
		const centroid = (community: string) => {
			const members = placed.filter(node => node.community === community);
			return { x: members.reduce((sum, node) => sum + node.x, 0) / members.length, y: members.reduce((sum, node) => sum + node.y, 0) / members.length };
		};
		for (const community of ['ui', 'state', 'services']) {
			const hub = placed.find(node => node.id === `${community}/0`)!;
			const own = centroid(community);
			for (const other of ['ui', 'state', 'services'].filter(c => c !== community)) {
				const foreign = centroid(other);
				assert.ok(Math.hypot(hub.x - own.x, hub.y - own.y) < Math.hypot(hub.x - foreign.x, hub.y - foreign.y), `${hub.id} cae más cerca de ${other}`);
			}
		}
	});
});
