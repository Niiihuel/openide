/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — the layout of the Project Map. It groups by module (community) instead of running a
 *  global force-directed pass: that is O(n), deterministic (same graph → same coordinates) and it
 *  says at a glance what Graphify's "one colour, one module" says. A Fruchterman-Reingold over 300
 *  nodes is ~27M operations and draws a different picture on every run.
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

/** Iterations of the force refinement. Fixed: they are part of the definition of the result. */
const FORCE_ITERATIONS = 160;
/** Rest length of an edge's spring, in canvas units. */
const SPRING_LENGTH = 46;
const SPRING_STRENGTH = 0.09;
const REPULSION = 3200;
/** Pull towards the centre: without it the disconnected components drift off to infinity. */
const GRAVITY = 0.015;
/** Pull towards the module's centroid: what keeps each cluster compact (Graphify: one colour, one module). */
const COHESION = 0.03;

const MIN_RADIUS = 3.5;
const MAX_RADIUS = 13;
/** Margin so no circle — nor its outline — is cut off against the viewport. */
const PADDING = 24;
/** Golden angle: spreads a module's nodes in a spiral without lining them up into spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Node radius by degree, root-compressed so a hub does not swallow its neighbours. */
function radiusFor(degree: number, maxDegree: number): number {
	if (maxDegree <= 0) { return MIN_RADIUS; }
	const ratio = Math.sqrt(Math.max(0, degree) / maxDegree);
	return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * ratio;
}

/**
 * Lays the nodes out grouped by module. The modules sit on a circle (the biggest first, in a
 * deterministic order) and inside each one the nodes spiral outwards, most connected first. The
 * coordinates come back already fitted into `width` × `height`.
 */
export function layoutGraph(nodes: readonly ILayoutInputNode[], width: number, height: number, edges: readonly ILayoutEdge[] = []): ILayoutResult {
	if (!nodes.length) { return { nodes: [], width, height }; }

	const byCommunity = new Map<string, ILayoutInputNode[]>();
	for (const node of nodes) {
		const bucket = byCommunity.get(node.community);
		if (bucket) { bucket.push(node); } else { byCommunity.set(node.community, [node]); }
	}
	// A TOTAL order: size descending, and by name at equal size — without the tie-break the picture
	// would change between runs on an identical graph.
	const communities = [...byCommunity.entries()]
		.map(([label, members]) => ({
			label,
			members: [...members].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)),
		}))
		.sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));

	const maxDegree = nodes.reduce((max, node) => Math.max(max, node.degree), 0);

	// Solved in a NORMALIZED [-1, 1] space and stretched to each axis only at the end. With a single
	// radius based on min(width, height) the drawing was locked inside the central square, and in a
	// narrow tall dock it left more than half the panel empty.
	const clusterCenters: { x: number; y: number; spread: number }[] = [];
	if (communities.length === 1) {
		clusterCenters.push({ x: 0, y: 0, spread: 1 });
	} else {
		const ring = 0.62;
		// Ceiling per module: the arc available between neighbours, so a big one does not invade them.
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
			// Vogel's spiral: an even distribution, with no visible rings or spokes.
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
 * Force refinement (repulsion + springs + gravity), the ForceAtlas2 Graphify runs — except SEEDED
 * with the per-community positions and capped at a fixed number of iterations: with no `random()`
 * and no time-based stop, the same graph always draws the same picture. Without this pass the
 * positions ignore the edges and the map reads as a tidy cloud of dots.
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
	// Scale: the spring and the repulsion are calibrated for a canvas around 1000px wide.
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
		// Linear cooling: the first steps rearrange, the last ones only settle.
		const cooling = 1 - iteration / FORCE_ITERATIONS;
		dx.fill(0); dy.fill(0);
		for (let a = 0; a < nodes.length; a++) {
			for (let b = a + 1; b < nodes.length; b++) {
				let deltaX = xs[a] - xs[b];
				let deltaY = ys[a] - ys[b];
				let distanceSquared = deltaX * deltaX + deltaY * deltaY;
				if (distanceSquared < 0.01) {
					// Exactly overlapping: pushed apart by their order, never at random.
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
		// Module cohesion: every node pulls towards its community's centroid. It is what
		// keeps "one colour, one cluster" when the crossing springs try to blend them.
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
			// With no edges nothing holds it: triple gravity so it does not orbit far away.
			const gravity = linkCount[index] === 0 ? GRAVITY * 3 : GRAVITY;
			dx[index] += (centerX - xs[index]) * gravity;
			dy[index] += (centerY - ys[index]) * gravity;
			// Ceiling on the movement per step: without it a close repulsion launches the node.
			const step = Math.min(18, Math.hypot(dx[index], dy[index])) * cooling;
			const magnitude = Math.hypot(dx[index], dy[index]) || 1;
			xs[index] += (dx[index] / magnitude) * step;
			ys[index] += (dy[index] / magnitude) * step;
		}
	}
	return fitToCanvas(nodes.map((node, index) => ({ ...node, x: xs[index], y: ys[index] })), width, height);
}

/** Rescales the result to fill the canvas without distorting the drawing's proportions. */
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

/** Fits the coordinates inside the viewport, each circle's radius included. */
function clampToViewport<T extends ILayoutNode>(nodes: readonly T[], width: number, height: number): T[] {
	return nodes.map(node => ({
		...node,
		x: Math.min(width - node.r - 2, Math.max(node.r + 2, node.x)),
		y: Math.min(height - node.r - 2, Math.max(node.r + 2, node.y)),
	}));
}

//#region Layout en capas (Sugiyama)

/** Distance between layers, and between the nodes of one layer, in canvas units. */
const LAYER_GAP = 150;
const NODE_GAP = 46;
/** Crossing-reduction sweeps. Four reach the plateau on graphs of this size. */
const ORDERING_SWEEPS = 4;

export interface ILayeredNode extends ILayoutNode {
	/** Layer index (0 = no internal dependencies). The renderer groups and labels by it. */
	readonly layer: number;
}

export interface ILayeredResult {
	readonly nodes: ILayeredNode[];
	readonly width: number;
	readonly height: number;
	readonly layers: number;
}

/**
 * Breaks the cycles of the dependency graph so it can be stratified. A DFS with an "on the
 * stack" mark classifies as a back-edge any edge returning to a node of the current path; that
 * edge is left out of the layer computation (it is still DRAWN, it just does not define depth).
 * The visit order is `order`, so which edge gets dropped is deterministic.
 */
function acyclicEdges(order: readonly string[], adjacency: ReadonlyMap<string, string[]>): Set<string> {
	const state = new Map<string, 0 | 1 | 2>(); // 0/undefined = sin ver, 1 = en pila, 2 = cerrado
	const back = new Set<string>();
	for (const root of order) {
		if (state.get(root)) { continue; }
		// Iterative: a recursive DFS overflows the stack on repos with long import chains.
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
 * Layered hierarchical layout: dependency depth defines the layer, and dependencies flow in a
 * single direction. It is what makes a React Flow diagram readable — at a glance you see what is
 * on top (entrypoints), what is at the bottom (utilities) and who depends on whom. A
 * force-directed layout says density, not hierarchy: for "understand the structure" it is the
 * wrong tool, and with no edges it degenerates into a ball.
 *
 * The three classic Sugiyama stages: assign layers by longest path, order within each layer with
 * the median heuristic to reduce crossings, and spread the coordinates. With no `random()` and a
 * total order at every tie-break: same graph → same drawing.
 */
export function layoutLayered(nodes: readonly ILayoutInputNode[], edges: readonly ILayoutEdge[], width: number, height: number): ILayeredResult {
	if (!nodes.length) { return { nodes: [], width, height, layers: 0 }; }

	// A deterministic base order: by module, then by degree, then by id. It seeds the DFS and
	// breaks the ties of everything that comes after.
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

	// Layer = longest path from a node with no incoming dependencies. Solved in topological
	// order (Kahn) over the already acyclic graph, so every node is visited with its
	// predecessors already resolved.
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

	// Median crossing reduction: each node moves to the median position of its neighbours in the
	// adjacent layer. The sweep alternates direction so the order converges from both ends instead
	// of dragging the bias of the first layer alone.
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
			// The id as the last criterion is what makes the order total: a stable `sort` is not enough,
			// because the input array arrives already permuted by the previous sweep.
			layers[index] = [...layers[index]].sort((a, b) => keys.get(a)! - keys.get(b)! || a.localeCompare(b));
			reindex();
		}
	}

	// Coordinates: layers stacked on Y (what depends on nothing goes on top), members spread on X
	// and centred. The canvas is sized by the content and then fitted into the viewport, so a wide
	// graph is not cropped and a small one is not lost in a corner.
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
