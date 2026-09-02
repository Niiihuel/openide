/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }` — see openideCodebaseGraphLayout.test.ts.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { layoutNodeMap, looksLikeNodeMap, parseNodeMap } from '../../common/diagrams/openideNodeMaps.js';
import { layoutSeqMap, parseSeqMap } from '../../common/diagrams/openideSeqMap.js';
import { parseDiagramSource } from '../../common/diagrams/openideDiagramEngine.js';

/**
 * The contract is Archify's model: the agent authors semantics, validation answers with
 * diagnostics it can act on, and the layout is deterministic. These tests pin the contract —
 * which errors block, which warnings drop what, that the three node-map types share one shape,
 * and that the same spec always draws the same picture — not exact coordinates.
 */
suite('OpenIDE typed maps — IR y layout', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('evidencia: un nodo lleva los archivos que representa', () => {
		const parsed = parseNodeMap(JSON.stringify({
			type: 'archmap',
			nodes: [
				{ id: 'api', label: 'API', kind: 'backend', sources: ['src/api/server.ts', './src/api/client.ts'] },
				{ id: 'db', label: 'DB', kind: 'database' },
			],
			edges: [{ from: 'api', to: 'db' }],
		}));
		assert.deepStrictEqual(parsed.spec!.nodes[0].sources, ['src/api/server.ts', 'src/api/client.ts']);
		// Having no evidence is the normal case, not an empty array to check for.
		assert.strictEqual(parsed.spec!.nodes[1].sources, undefined);
		assert.deepStrictEqual(parsed.diagnostics, []);
	});

	test('evidencia que apunta afuera del repo se descarta, y nunca bloquea el dibujo', () => {
		const parsed = parseNodeMap(JSON.stringify({
			type: 'archmap',
			nodes: [
				{ id: 'api', label: 'API', kind: 'backend', sources: ['/etc/passwd', '../../secrets.txt', 'C:/Windows/x.ts', '', 'src/ok.ts'] },
				{ id: 'db', label: 'DB', kind: 'database', sources: 'no soy un array' },
			],
			edges: [{ from: 'api', to: 'db' }],
		}));
		// The map still draws: evidence is a doorway, not a requirement.
		assert.ok(parsed.spec);
		assert.deepStrictEqual(parsed.spec!.nodes[0].sources, ['src/ok.ts']);
		assert.strictEqual(parsed.spec!.nodes[1].sources, undefined);
		assert.ok(parsed.diagnostics.every(d => d.severity === 'warning'));
	});

	test('la evidencia corta en tres archivos', () => {
		const parsed = parseNodeMap(JSON.stringify({
			type: 'archmap',
			nodes: [
				{ id: 'api', label: 'API', kind: 'backend', sources: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] },
				{ id: 'db', label: 'DB', kind: 'database' },
			],
			edges: [{ from: 'api', to: 'db' }],
		}));
		assert.deepStrictEqual(parsed.spec!.nodes[0].sources, ['a.ts', 'b.ts', 'c.ts']);
		assert.ok(parsed.diagnostics.some(d => d.code === 'map/sources-max'));
	});

	const VALID = JSON.stringify({
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

	test('un spec válido parsea completo y sin diagnósticos', () => {
		const parsed = parseNodeMap(VALID);
		assert.notStrictEqual(parsed.spec, undefined);
		assert.strictEqual(parsed.diagnostics.length, 0);
		assert.strictEqual(parsed.spec!.nodes.length, 4);
		assert.strictEqual(parsed.spec!.edges.length, 3);
		assert.strictEqual(parsed.spec!.nodes[0].emphasis, true);
		assert.strictEqual(parsed.spec!.edges[2].dashed, true);
	});

	test('cada tipo valida contra SU vocabulario de kinds', () => {
		// One shape, three vocabularies — the whole reason flowmap/lifemap cost one contract.
		const flow = parseNodeMap(JSON.stringify({
			type: 'flowmap',
			nodes: [
				{ id: 'a', label: 'Recibir pedido', kind: 'start' },
				{ id: 'b', label: '¿Stock?', kind: 'decision' },
				{ id: 'c', label: 'Facturar', kind: 'step' },
			],
			edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'sí' }],
		}));
		assert.notStrictEqual(flow.spec, undefined);
		assert.strictEqual(flow.spec!.type, 'flowmap');

		// An archmap kind inside a flowmap blocks, and the fix names the RIGHT vocabulary.
		const wrong = parseNodeMap(JSON.stringify({
			type: 'flowmap',
			nodes: [{ id: 'a', label: 'A', kind: 'backend' }],
		}));
		assert.strictEqual(wrong.spec, undefined);
		const diagnostic = wrong.diagnostics.find(d => d.code === 'map/node-kind');
		assert.strictEqual(diagnostic!.severity, 'error');
		assert.strictEqual(diagnostic!.fix!.includes('decision'), true);
		assert.strictEqual(diagnostic!.fix!.includes('backend'), false);
	});

	test('un lifemap con ciclo de reintento es válido y el layout lo tolera', () => {
		const life = parseNodeMap(JSON.stringify({
			type: 'lifemap',
			nodes: [
				{ id: 'nuevo', label: 'Nuevo', kind: 'initial' },
				{ id: 'corriendo', label: 'Corriendo', kind: 'active' },
				{ id: 'fallo', label: 'Falló', kind: 'failure' },
				{ id: 'ok', label: 'Completado', kind: 'terminal' },
			],
			edges: [
				{ from: 'nuevo', to: 'corriendo' },
				{ from: 'corriendo', to: 'fallo' },
				{ from: 'fallo', to: 'corriendo', label: 'retry', dashed: true },
				{ from: 'corriendo', to: 'ok' },
			],
		}));
		assert.notStrictEqual(life.spec, undefined);
		const layout = layoutNodeMap(life.spec!);
		assert.strictEqual(layout.nodes.length, 4);
		assert.deepStrictEqual(layoutNodeMap(life.spec!), layout, 'determinista con ciclos incluidos');
	});

	test('una conexión a un id no declarado bloquea y nombra el par', () => {
		const parsed = parseNodeMap(JSON.stringify({
			type: 'archmap',
			nodes: [{ id: 'a', label: 'A', kind: 'backend' }],
			edges: [{ from: 'a', to: 'ghost' }],
		}));
		assert.strictEqual(parsed.spec, undefined);
		const diagnostic = parsed.diagnostics.find(d => d.code === 'map/edge-endpoint');
		assert.strictEqual(diagnostic!.subject, 'a→ghost');
	});

	test('self-loops y duplicados avisan pero no bloquean, y se omiten del spec', () => {
		const parsed = parseNodeMap(JSON.stringify({
			type: 'archmap',
			nodes: [{ id: 'a', label: 'A', kind: 'backend' }, { id: 'b', label: 'B', kind: 'database' }],
			edges: [{ from: 'a', to: 'a' }, { from: 'a', to: 'b' }, { from: 'a', to: 'b' }],
		}));
		assert.notStrictEqual(parsed.spec, undefined);
		assert.strictEqual(parsed.spec!.edges.length, 1);
		assert.strictEqual(parsed.diagnostics.filter(d => d.severity === 'warning').length, 2);
	});

	test('looksLikeNodeMap acepta los tres tipos y descarta mermaid y prosa', () => {
		assert.strictEqual(looksLikeNodeMap(VALID), true);
		assert.strictEqual(looksLikeNodeMap('{"type": "lifemap"}'), true);
		assert.strictEqual(looksLikeNodeMap('flowchart TD\nA --> B'), false);
		assert.strictEqual(looksLikeNodeMap('{"type": "otra cosa"}'), false);
	});

	test('el layout es determinista: mismo spec, mismas coordenadas', () => {
		const spec = parseNodeMap(VALID).spec!;
		assert.deepStrictEqual(layoutNodeMap(spec), layoutNodeMap(spec));
	});

	test('la composición es la de archify: cada conexión avanza de izquierda a derecha', () => {
		// The layered pass is what tells this apart from a force-directed cloud: on an acyclic map,
		// direction always reads the same way and no edge doubles back.
		const spec = parseNodeMap(VALID).spec!;
		const layout = layoutNodeMap(spec);
		const at = new Map(layout.nodes.map(n => [n.id, n]));
		for (const edge of spec.edges) {
			assert.strictEqual(at.get(edge.from)!.x < at.get(edge.to)!.x, true, `${edge.from}→${edge.to} no avanza en x`);
		}
	});

	test('ningún nodo ajeno queda dentro del hull de un group', () => {
		// The band strips are the guarantee a bounding box over free positions could never give.
		const spec = parseNodeMap(VALID).spec!;
		const layout = layoutNodeMap(spec);
		const hull = layout.hulls[0];
		for (const node of layout.nodes.filter(n => n.group !== 'AWS')) {
			const inside = node.x + node.w / 2 > hull.x && node.x - node.w / 2 < hull.x + hull.w
				&& node.y + node.h / 2 > hull.y && node.y - node.h / 2 < hull.y + hull.h;
			assert.strictEqual(inside, false, `${node.id} cayó dentro del hull de AWS`);
		}
	});

	test('los nodos sin group comparten banda en vez de estirar el lienzo', () => {
		// web (capa 0) and auth (capa 1) pack into the shared free band: one rail, same y.
		const spec = parseNodeMap(VALID).spec!;
		const layout = layoutNodeMap(spec);
		const at = new Map(layout.nodes.map(n => [n.id, n]));
		assert.strictEqual(at.get('web')!.y, at.get('auth')!.y);
	});

	test('el hull de un group envuelve las cajas de todos sus miembros', () => {
		const spec = parseNodeMap(VALID).spec!;
		const layout = layoutNodeMap(spec);
		assert.strictEqual(layout.hulls.length, 1);
		const hull = layout.hulls[0];
		assert.strictEqual(hull.label, 'AWS');
		for (const node of layout.nodes.filter(n => n.group === 'AWS')) {
			assert.strictEqual(node.x - node.w / 2 >= hull.x, true);
			assert.strictEqual(node.x + node.w / 2 <= hull.x + hull.w, true);
			assert.strictEqual(node.y - node.h / 2 >= hull.y, true);
			assert.strictEqual(node.y + node.h / 2 <= hull.y + hull.h, true);
		}
	});

	const SEQ = JSON.stringify({
		type: 'seqmap',
		title: 'Login',
		actors: [
			{ id: 'web', label: 'Web', kind: 'frontend' },
			{ id: 'api', label: 'API', kind: 'backend' },
			{ id: 'idp', label: 'Auth0', kind: 'security' },
		],
		steps: [
			{ from: 'web', to: 'api', label: 'POST /login' },
			{ from: 'api', to: 'idp', label: 'validar token' },
			{ from: 'idp', to: 'api', label: 'claims', reply: true },
			{ from: 'api', to: 'api', label: 'crear sesión' },
			{ from: 'api', to: 'web', label: '200 + cookie', reply: true },
		],
	});

	test('seqmap: el orden de steps ES el tiempo y las columnas son los actores', () => {
		const parsed = parseSeqMap(SEQ);
		assert.notStrictEqual(parsed.spec, undefined);
		assert.strictEqual(parsed.diagnostics.length, 0);
		const layout = layoutSeqMap(parsed.spec!);
		assert.strictEqual(layout.actors.length, 3);
		for (let i = 1; i < layout.actors.length; i++) {
			const previous = layout.actors[i - 1];
			assert.strictEqual(previous.x + previous.w / 2 < layout.actors[i].x - layout.actors[i].w / 2, true, 'las tarjetas no se pisan');
		}
		for (let i = 1; i < layout.steps.length; i++) {
			assert.strictEqual(layout.steps[i].y > layout.steps[i - 1].y, true, 'el tiempo baja');
		}
		assert.strictEqual(layout.steps[3].self, true, 'api→api es un self-loop');
		assert.strictEqual(layout.steps[2].dashed, true, 'una reply se puntea sola');
		assert.deepStrictEqual(layoutSeqMap(parsed.spec!), layout, 'determinista');
	});

	test('seqmap: un mensaje sin texto bloquea — la secuencia vive de sus labels', () => {
		const parsed = parseSeqMap(JSON.stringify({
			type: 'seqmap',
			actors: [{ id: 'a', label: 'A', kind: 'backend' }, { id: 'b', label: 'B', kind: 'database' }],
			steps: [{ from: 'a', to: 'b' }],
		}));
		assert.strictEqual(parsed.spec, undefined);
		assert.strictEqual(parsed.diagnostics.find(d => d.code === 'map/step-label')!.subject, 'a→b');
	});

	test('parseDiagramSource enruta cada tipo a su familia y no al parser mermaid', () => {
		assert.strictEqual(parseDiagramSource(VALID)?.family, 'nodemap');
		assert.strictEqual(parseDiagramSource(SEQ)?.family, 'seqmap');
		const flow = parseDiagramSource(JSON.stringify({
			type: 'flowmap',
			nodes: [{ id: 'a', label: 'A', kind: 'start' }, { id: 'b', label: 'B', kind: 'end' }],
			edges: [{ from: 'a', to: 'b' }],
		}));
		assert.strictEqual(flow?.family, 'nodemap');
		assert.strictEqual(flow?.kind, 'flowmap');
	});

	test('un mapa inválido cae a código, nunca al fallback de flowchart', () => {
		// Without the guard, the flowchart parser scrapes "nodes" out of the JSON braces and draws garbage.
		const broken = JSON.stringify({ type: 'archmap', nodes: [{ id: 'a', label: 'A', kind: 'nope' }] });
		assert.strictEqual(parseDiagramSource(broken), undefined);
	});

	test('mermaid sigue enrutando a la familia graph', () => {
		const result = parseDiagramSource('flowchart TD\nA --> B');
		assert.strictEqual(result?.family, 'graph');
	});
});
