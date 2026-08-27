/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — layout del mapa visual del Project Map. Agrupa por módulo (comunidad) en vez de
 *  correr un force-directed global: es O(n), determinista (mismo grafo → mismas coordenadas) y
 *  comunica de un vistazo lo mismo que el "un color, un módulo" de Graphify. Un Fruchterman-
 *  Reingold sobre 300 nodos son ~27M de operaciones y da un dibujo distinto en cada corrida.
 *--------------------------------------------------------------------------------------------*/

export interface ILayoutInputNode {
	readonly id: string;
	readonly community: string;
	readonly degree: number;
}

export interface ILayoutNode {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly r: number;
	readonly community: string;
}

export interface ILayoutResult {
	readonly nodes: ILayoutNode[];
	readonly width: number;
	readonly height: number;
}

export interface ILayoutEdge {
	readonly source: string;
	readonly target: string;
}

/** Iteraciones del refinamiento por fuerzas. Fijas: son parte de la definición del resultado. */
const FORCE_ITERATIONS = 160;
/** Longitud de reposo del resorte de una arista, en unidades del lienzo. */
const SPRING_LENGTH = 46;
const SPRING_STRENGTH = 0.09;
const REPULSION = 3200;
/** Atracción al centro: evita que los componentes desconectados se vayan al infinito. */
const GRAVITY = 0.015;
/** Atracción al centroide del módulo: mantiene compacto cada cluster (Graphify: un color, un módulo). */
const COHESION = 0.03;

const MIN_RADIUS = 3.5;
const MAX_RADIUS = 13;
/** Margen para que ningún círculo (ni su borde) quede cortado contra el viewport. */
const PADDING = 24;
/** Ángulo áureo: reparte los nodos de un módulo en espiral sin alinearlos en rayos. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Radio del nodo por grado, con compresión raíz para que un hub no tape a sus vecinos. */
function radiusFor(degree: number, maxDegree: number): number {
	if (maxDegree <= 0) { return MIN_RADIUS; }
	const ratio = Math.sqrt(Math.max(0, degree) / maxDegree);
	return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * ratio;
}

/**
 * Dispone los nodos agrupados por módulo. Los módulos se ubican en un círculo (los más grandes
 * primero, en orden determinista) y dentro de cada uno los nodos van en espiral, del más
 * conectado al menos. Devuelve coordenadas ya encajadas en `width` × `height`.
 */
export function layoutGraph(nodes: readonly ILayoutInputNode[], width: number, height: number, edges: readonly ILayoutEdge[] = []): ILayoutResult {
	if (!nodes.length) { return { nodes: [], width, height }; }

	const byCommunity = new Map<string, ILayoutInputNode[]>();
	for (const node of nodes) {
		const bucket = byCommunity.get(node.community);
		if (bucket) { bucket.push(node); } else { byCommunity.set(node.community, [node]); }
	}
	// Orden total: tamaño desc, y a igual tamaño por nombre — sin esto el dibujo cambiaría
	// entre corridas aunque el grafo fuera idéntico.
	const communities = [...byCommunity.entries()]
		.map(([label, members]) => ({
			label,
			members: [...members].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)),
		}))
		.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));

	const maxDegree = nodes.reduce((max, node) => Math.max(max, node.degree), 0);

	// Se resuelve en un espacio NORMALIZADO [-1, 1] y recién al final se estira a cada eje. Con
	// un radio único basado en min(ancho, alto) el dibujo se encerraba en el cuadrado central y
	// en un dock angosto y alto dejaba más de la mitad del panel vacío.
	const clusterCenters: { x: number; y: number; spread: number }[] = [];
	if (communities.length === 1) {
		clusterCenters.push({ x: 0, y: 0, spread: 1 });
	} else {
		const ring = 0.62;
		// Techo por módulo: el arco disponible entre vecinos, para que uno grande no los invada.
		const maxSpread = (Math.PI * ring) / Math.max(2, communities.length) * 0.92;
		const totalMembers = nodes.length;
		for (let index = 0; index < communities.length; index++) {
			const angle = (index / communities.length) * Math.PI * 2 - Math.PI / 2;
			const share = communities[index].members.length / totalMembers;
			const spread = Math.max(0.05, Math.min(maxSpread, 0.5 * Math.sqrt(share) + 0.05));
			clusterCenters.push({ x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, spread });
		}
	}

	const centerX = width / 2;
	const centerY = height / 2;
	const usableX = Math.max(20, width / 2 - PADDING);
	const usableY = Math.max(20, height / 2 - PADDING);

	const placed: ILayoutNode[] = [];
	communities.forEach((community, index) => {
		const center = clusterCenters[index];
		const members = community.members;
		members.forEach((node, position) => {
			// Espiral de Vogel: distribución pareja, sin anillos ni rayos visibles.
			const t = members.length === 1 ? 0 : Math.sqrt(position / members.length);
			const angle = position * GOLDEN_ANGLE;
			placed.push({
				id: node.id,
				x: centerX + (center.x + Math.cos(angle) * center.spread * t) * usableX,
				y: centerY + (center.y + Math.sin(angle) * center.spread * t) * usableY,
				r: radiusFor(node.degree, maxDegree),
				community: community.label,
			});
		});
	});

	return { nodes: clampToViewport(relax(placed, edges, width, height), width, height), width, height };
}

/**
 * Refinamiento por fuerzas (repulsión + resortes + gravedad), como el ForceAtlas2 que usa
 * Graphify, pero SEMBRADO con las posiciones por comunidad y con un número fijo de iteraciones:
 * sin `random()` ni condición de corte por tiempo, el mismo grafo da siempre el mismo dibujo.
 * Sin esto las posiciones ignoran las aristas y el mapa se ve como una nube ordenada de puntos.
 */
function relax(nodes: readonly ILayoutNode[], edges: readonly ILayoutEdge[], width: number, height: number): ILayoutNode[] {
	if (nodes.length < 2 || !edges.length) { return [...nodes]; }
	const indexById = new Map<string, number>();
	nodes.forEach((node, index) => indexById.set(node.id, index));
	const xs = nodes.map(node => node.x);
	const ys = nodes.map(node => node.y);
	const links = edges
		.map(edge => [indexById.get(edge.source), indexById.get(edge.target)] as const)
		.filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined && pair[0] !== pair[1]);
	const centerX = width / 2;
	const centerY = height / 2;
	// Escala: el resorte y la repulsión están calibrados para ~1000px de ancho.
	const scale = Math.max(0.35, Math.min(2, Math.min(width, height) / 700));
	const springLength = SPRING_LENGTH * scale;
	const repulsion = REPULSION * scale * scale;

	const dx = new Array<number>(nodes.length).fill(0);
	const dy = new Array<number>(nodes.length).fill(0);
	const communityIds = [...new Set(nodes.map(node => node.community))].sort();
	const communityIndex = nodes.map(node => communityIds.indexOf(node.community));
	const centroidSumX = new Array<number>(communityIds.length).fill(0);
	const centroidSumY = new Array<number>(communityIds.length).fill(0);
	const centroidCount = new Array<number>(communityIds.length).fill(0);
	const linkCount = new Array<number>(nodes.length).fill(0);
	for (const [a, b] of links) { linkCount[a]++; linkCount[b]++; }
	for (let iteration = 0; iteration < FORCE_ITERATIONS; iteration++) {
		// Enfriamiento lineal: los primeros pasos reordenan, los últimos sólo acomodan.
		const cooling = 1 - iteration / FORCE_ITERATIONS;
		dx.fill(0); dy.fill(0);
		for (let a = 0; a < nodes.length; a++) {
			for (let b = a + 1; b < nodes.length; b++) {
				let deltaX = xs[a] - xs[b];
				let deltaY = ys[a] - ys[b];
				let distanceSquared = deltaX * deltaX + deltaY * deltaY;
				if (distanceSquared < 0.01) {
					// Superpuestos exactos: se separan por su orden, nunca al azar.
					deltaX = (a - b) * 0.01; deltaY = 0.01; distanceSquared = deltaX * deltaX + deltaY * deltaY;
				}
				const force = repulsion / distanceSquared;
				const distance = Math.sqrt(distanceSquared);
				const pushX = (deltaX / distance) * force;
				const pushY = (deltaY / distance) * force;
				dx[a] += pushX; dy[a] += pushY;
				dx[b] -= pushX; dy[b] -= pushY;
			}
		}
		for (const [a, b] of links) {
			const deltaX = xs[b] - xs[a];
			const deltaY = ys[b] - ys[a];
			const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 0.01;
			const force = (distance - springLength) * SPRING_STRENGTH;
			const pullX = (deltaX / distance) * force;
			const pullY = (deltaY / distance) * force;
			dx[a] += pullX; dy[a] += pullY;
			dx[b] -= pullX; dy[b] -= pullY;
		}
		// Cohesión de módulo: cada nodo tira hacia el centroide de su comunidad. Es lo que
		// mantiene "un color, un cluster" cuando los resortes cruzados quieren mezclarlos.
		centroidSumX.fill(0); centroidSumY.fill(0); centroidCount.fill(0);
		for (let index = 0; index < nodes.length; index++) {
			const community = communityIndex[index];
			centroidSumX[community] += xs[index]; centroidSumY[community] += ys[index]; centroidCount[community]++;
		}
		for (let index = 0; index < nodes.length; index++) {
			const community = communityIndex[index];
			if (centroidCount[community] > 1) {
				dx[index] += (centroidSumX[community] / centroidCount[community] - xs[index]) * COHESION;
				dy[index] += (centroidSumY[community] / centroidCount[community] - ys[index]) * COHESION;
			}
			// Sin aristas nada lo sostiene: gravedad triple para que no quede orbitando lejos.
			const gravity = linkCount[index] === 0 ? GRAVITY * 3 : GRAVITY;
			dx[index] += (centerX - xs[index]) * gravity;
			dy[index] += (centerY - ys[index]) * gravity;
			// Techo de desplazamiento por paso: sin él una repulsión cercana dispara el nodo.
			const step = Math.min(18, Math.hypot(dx[index], dy[index])) * cooling;
			const magnitude = Math.hypot(dx[index], dy[index]) || 1;
			xs[index] += (dx[index] / magnitude) * step;
			ys[index] += (dy[index] / magnitude) * step;
		}
	}
	return fitToCanvas(nodes.map((node, index) => ({ ...node, x: xs[index], y: ys[index] })), width, height);
}

/** Reescala el resultado para que ocupe el lienzo sin deformar las proporciones del dibujo. */
function fitToCanvas<T extends ILayoutNode>(nodes: readonly T[], width: number, height: number): T[] {
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const node of nodes) {
		minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
		minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
	}
	const spanX = maxX - minX || 1;
	const spanY = maxY - minY || 1;
	const usableWidth = Math.max(20, width - PADDING * 2);
	const usableHeight = Math.max(20, height - PADDING * 2);
	const factor = Math.min(usableWidth / spanX, usableHeight / spanY);
	const offsetX = (width - spanX * factor) / 2;
	const offsetY = (height - spanY * factor) / 2;
	return nodes.map(node => ({ ...node, x: offsetX + (node.x - minX) * factor, y: offsetY + (node.y - minY) * factor }));
}

/** Encaja las coordenadas dentro del viewport contemplando el radio de cada círculo. */
function clampToViewport<T extends ILayoutNode>(nodes: readonly T[], width: number, height: number): T[] {
	return nodes.map(node => ({
		...node,
		x: Math.min(width - node.r - 2, Math.max(node.r + 2, node.x)),
		y: Math.min(height - node.r - 2, Math.max(node.r + 2, node.y)),
	}));
}

//#region Layout en capas (Sugiyama)

/** Separación entre capas y entre nodos de una misma capa, en unidades del lienzo. */
const LAYER_GAP = 150;
const NODE_GAP = 46;
/** Barridos de reducción de cruces. Cuatro alcanzan la meseta en grafos de este tamaño. */
const ORDERING_SWEEPS = 4;

export interface ILayeredNode extends ILayoutNode {
	/** Índice de capa (0 = sin dependencias internas). Lo usa el render para agrupar y etiquetar. */
	readonly layer: number;
}

export interface ILayeredResult {
	readonly nodes: ILayeredNode[];
	readonly width: number;
	readonly height: number;
	readonly layers: number;
}

/**
 * Rompe los ciclos del grafo de dependencias para poder estratificarlo. Un DFS con marca de
 * "en pila" clasifica como back-edge la arista que vuelve a un nodo del camino actual; se la
 * excluye del cálculo de capas (la arista SIGUE dibujándose, sólo no define profundidad).
 * El orden de visita es el de `order`, así que la elección de qué arista cae es determinista.
 */
function acyclicEdges(order: readonly string[], adjacency: ReadonlyMap<string, string[]>): Set<string> {
	const state = new Map<string, 0 | 1 | 2>(); // 0/undefined = sin ver, 1 = en pila, 2 = cerrado
	const back = new Set<string>();
	for (const root of order) {
		if (state.get(root)) { continue; }
		// Iterativo: un DFS recursivo desborda la pila en repos con cadenas largas de imports.
		const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
		state.set(root, 1);
		while (stack.length) {
			const frame = stack[stack.length - 1];
			const neighbours = adjacency.get(frame.id) ?? [];
			if (frame.next >= neighbours.length) { state.set(frame.id, 2); stack.pop(); continue; }
			const target = neighbours[frame.next++];
			const seen = state.get(target);
			if (seen === 1) { back.add(frame.id + '\0' + target); continue; }
			if (seen === 2) { continue; }
			state.set(target, 1);
			stack.push({ id: target, next: 0 });
		}
	}
	return back;
}

/**
 * Layout jerárquico en capas: la profundidad de dependencia define la capa, y las dependencias
 * fluyen en una sola dirección. Es lo que hace legible a un diagrama de React Flow — de un
 * vistazo se ve qué está arriba (entrypoints), qué está abajo (utilidades) y quién depende de
 * quién. Un force-directed comunica densidad, no jerarquía: para "entender la estructura" es la
 * herramienta equivocada, y sin aristas degenera directamente en una bola.
 *
 * Tres etapas clásicas de Sugiyama: asignar capas por camino más largo, ordenar dentro de cada
 * capa con la heurística de la mediana para reducir cruces, y repartir las coordenadas. Sin
 * `random()` y con órdenes totales en cada desempate: mismo grafo → mismo dibujo.
 */
export function layoutLayered(nodes: readonly ILayoutInputNode[], edges: readonly ILayoutEdge[], width: number, height: number): ILayeredResult {
	if (!nodes.length) { return { nodes: [], width, height, layers: 0 }; }

	// Orden base determinista: por módulo, luego por grado, luego por id. Siembra el DFS y
	// desempata todo lo que venga después.
	const ordered = [...nodes].sort((a, b) => a.community.localeCompare(b.community) || b.degree - a.degree || a.id.localeCompare(b.id));
	const known = new Set(ordered.map(node => node.id));
	const order = ordered.map(node => node.id);

	const outgoing = new Map<string, string[]>();
	const incoming = new Map<string, string[]>();
	for (const id of order) { outgoing.set(id, []); incoming.set(id, []); }
	const seenPairs = new Set<string>();
	for (const edge of edges) {
		if (!known.has(edge.source) || !known.has(edge.target) || edge.source === edge.target) { continue; }
		const key = edge.source + '\0' + edge.target;
		if (seenPairs.has(key)) { continue; }
		seenPairs.add(key);
		outgoing.get(edge.source)!.push(edge.target);
		incoming.get(edge.target)!.push(edge.source);
	}
	for (const list of outgoing.values()) { list.sort(); }
	for (const list of incoming.values()) { list.sort(); }

	const back = acyclicEdges(order, outgoing);
	const isBack = (source: string, target: string): boolean => back.has(source + '\0' + target);

	// Capa = camino más largo desde un nodo sin dependencias entrantes. Se resuelve en orden
	// topológico (Kahn) sobre el grafo ya sin ciclos, así cada nodo se visita con sus
	// predecesores resueltos.
	const layerOf = new Map<string, number>();
	const pendingCount = new Map<string, number>();
	for (const id of order) {
		pendingCount.set(id, (incoming.get(id) ?? []).filter(source => !isBack(source, id)).length);
		layerOf.set(id, 0);
	}
	const queue = order.filter(id => pendingCount.get(id) === 0);
	for (let head = 0; head < queue.length; head++) {
		const id = queue[head];
		for (const target of outgoing.get(id) ?? []) {
			if (isBack(id, target)) { continue; }
			layerOf.set(target, Math.max(layerOf.get(target)!, layerOf.get(id)! + 1));
			const left = pendingCount.get(target)! - 1;
			pendingCount.set(target, left);
			if (left === 0) { queue.push(target); }
		}
	}

	const layerCount = order.reduce((max, id) => Math.max(max, layerOf.get(id)!), 0) + 1;
	const layers: string[][] = Array.from({ length: layerCount }, () => []);
	for (const id of order) { layers[layerOf.get(id)!].push(id); }

	// Reducción de cruces por mediana: cada nodo se mueve a la posición mediana de sus vecinos en
	// la capa adyacente. Se alterna la dirección del barrido para que el orden converja por los
	// dos lados en vez de arrastrar sólo el sesgo de la primera capa.
	const positionOf = new Map<string, number>();
	const reindex = (): void => { for (const layer of layers) { layer.forEach((id, index) => positionOf.set(id, index)); } };
	reindex();
	const median = (id: string, neighbours: ReadonlyMap<string, string[]>): number => {
		const values = (neighbours.get(id) ?? []).map(other => positionOf.get(other)).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
		if (!values.length) { return positionOf.get(id)!; }
		const middle = values.length >> 1;
		return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
	};
	for (let sweep = 0; sweep < ORDERING_SWEEPS; sweep++) {
		const downward = sweep % 2 === 0;
		const indices = downward ? layers.map((_, index) => index) : layers.map((_, index) => layers.length - 1 - index);
		for (const index of indices) {
			const neighbours = downward ? incoming : outgoing;
			const keys = new Map(layers[index].map(id => [id, median(id, neighbours)] as const));
			// El id como último criterio deja el orden total: `sort` estable no alcanza porque el
			// arreglo de entrada ya viene permutado por el barrido anterior.
			layers[index] = [...layers[index]].sort((a, b) => keys.get(a)! - keys.get(b)! || a.localeCompare(b));
			reindex();
		}
	}

	// Coordenadas: capas apiladas en Y (arriba lo que no depende de nada), miembros repartidos en
	// X y centrados. El lienzo se dimensiona por el contenido y después se encaja en el viewport,
	// así un grafo ancho no se recorta ni uno chico queda perdido en una esquina.
	const maxDegree = nodes.reduce((max, node) => Math.max(max, node.degree), 0);
	const inputById = new Map(nodes.map(node => [node.id, node] as const));
	const widest = layers.reduce((max, layer) => Math.max(max, layer.length), 1);
	const contentWidth = Math.max(1, widest - 1) * NODE_GAP;

	const placed: ILayeredNode[] = [];
	layers.forEach((layer, layerIndex) => {
		const span = Math.max(0, layer.length - 1) * NODE_GAP;
		const startX = (contentWidth - span) / 2;
		layer.forEach((id, index) => {
			const input = inputById.get(id)!;
			placed.push({
				id,
				x: startX + index * NODE_GAP,
				y: layerIndex * LAYER_GAP,
				r: radiusFor(input.degree, maxDegree),
				community: input.community,
				layer: layerIndex,
			});
		});
	});

	return { nodes: clampToViewport(fitToCanvas(placed, width, height), width, height), width, height, layers: layerCount };
}

//#endregion
