/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — detección de comunidades (módulos) del grafo del codebase. Louvain determinista
 *  en TS puro, con los post-pasos de Graphify: hubs excluidos y reinsertados por voto, split de
 *  comunidades gigantes o de baja cohesión, reindexado con orden total e IDs estables entre
 *  corridas vía remapeo greedy contra la partición anterior. Sin aleatoriedad: mismo grafo →
 *  misma salida, byte a byte.
 *--------------------------------------------------------------------------------------------*/

export interface ICommunityGraphEdge { readonly source: string; readonly target: string }

export interface ICodebaseCommunity {
	readonly id: number;
	readonly label: string;
	readonly members: readonly string[];
}

interface IWorkGraph {
	readonly nodes: readonly string[];
	readonly neighbors: ReadonlyMap<string, ReadonlyMap<string, number>>;
	readonly degree: ReadonlyMap<string, number>;
	readonly totalWeight: number;
}

const IMPROVEMENT_THRESHOLD = 1e-4;
const MAX_PASSES = 10;

/** Grafo de trabajo no dirigido con pesos agregados; nodos y aristas en orden determinista. */
function buildWorkGraph(nodeIds: readonly string[], edges: readonly ICommunityGraphEdge[]): IWorkGraph {
	const nodes = [...new Set(nodeIds)].sort();
	const nodeSet = new Set(nodes);
	const neighbors = new Map<string, Map<string, number>>();
	for (const id of nodes) { neighbors.set(id, new Map()); }
	const sortedEdges = [...edges]
		.filter(edge => edge.source !== edge.target && nodeSet.has(edge.source) && nodeSet.has(edge.target))
		.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
	let totalWeight = 0;
	for (const edge of sortedEdges) {
		const forward = neighbors.get(edge.source)!;
		const backward = neighbors.get(edge.target)!;
		forward.set(edge.target, (forward.get(edge.target) ?? 0) + 1);
		backward.set(edge.source, (backward.get(edge.source) ?? 0) + 1);
		totalWeight += 1;
	}
	const degree = new Map<string, number>();
	for (const id of nodes) {
		let sum = 0;
		for (const weight of neighbors.get(id)!.values()) { sum += weight; }
		degree.set(id, sum);
	}
	return { nodes, neighbors, degree, totalWeight };
}

/** Una pasada de Louvain (fase local + agregación), determinista por recorrido en orden fijo. */
function louvain(graph: IWorkGraph): Map<string, number> {
	// Sin aristas: cada nodo es su propia comunidad.
	if (!graph.totalWeight) {
		return new Map(graph.nodes.map((id, index) => [id, index] as const));
	}
	// Nivel actual: cada supernodo agrupa nodos originales.
	let memberOf = new Map<string, number>(graph.nodes.map((id, index) => [id, index] as const));
	let level: { nodes: string[]; neighbors: Map<string, Map<string, number>>; degree: Map<string, number>; selfLoops: Map<string, number>; members: Map<string, string[]> } = {
		nodes: [...graph.nodes],
		neighbors: new Map([...graph.neighbors].map(([id, m]) => [id, new Map(m)] as const)),
		degree: new Map(graph.degree),
		selfLoops: new Map(graph.nodes.map(id => [id, 0] as const)),
		members: new Map(graph.nodes.map(id => [id, [id]] as const)),
	};
	const m2 = 2 * graph.totalWeight;

	for (let pass = 0; pass < MAX_PASSES; pass++) {
		// --- fase 1: movimiento local ---
		const community = new Map<string, string>(level.nodes.map(id => [id, id] as const));
		const communityDegree = new Map<string, number>(level.nodes.map(id => [id, level.degree.get(id) ?? 0] as const));
		let improvedTotal = false;
		let improved = true;
		while (improved) {
			improved = false;
			for (const node of level.nodes) {
				const nodeDegree = level.degree.get(node) ?? 0;
				const currentCommunity = community.get(node)!;
				// Peso hacia cada comunidad vecina (orden determinista por clave).
				const weights = new Map<string, number>();
				for (const [neighbor, weight] of level.neighbors.get(node)!) {
					const neighborCommunity = community.get(neighbor)!;
					weights.set(neighborCommunity, (weights.get(neighborCommunity) ?? 0) + weight);
				}
				communityDegree.set(currentCommunity, (communityDegree.get(currentCommunity) ?? 0) - nodeDegree);
				let bestCommunity = currentCommunity;
				let bestGain = weights.get(currentCommunity) !== undefined ? (weights.get(currentCommunity)! - ((communityDegree.get(currentCommunity) ?? 0) * nodeDegree) / m2) : 0;
				for (const candidate of [...weights.keys()].sort()) {
					const gain = weights.get(candidate)! - ((communityDegree.get(candidate) ?? 0) * nodeDegree) / m2;
					if (gain > bestGain + IMPROVEMENT_THRESHOLD) { bestGain = gain; bestCommunity = candidate; }
				}
				communityDegree.set(bestCommunity, (communityDegree.get(bestCommunity) ?? 0) + nodeDegree);
				if (bestCommunity !== currentCommunity) { community.set(node, bestCommunity); improved = true; improvedTotal = true; }
			}
		}
		if (!improvedTotal) { break; }
		// --- fase 2: agregación en supernodos ---
		const groups = new Map<string, string[]>();
		for (const node of level.nodes) {
			const c = community.get(node)!;
			const group = groups.get(c) ?? [];
			group.push(node);
			groups.set(c, group);
		}
		const newNodes = [...groups.keys()].sort();
		const newNeighbors = new Map<string, Map<string, number>>(newNodes.map(id => [id, new Map<string, number>()] as const));
		const newSelfLoops = new Map<string, number>(newNodes.map(id => [id, 0] as const));
		const newMembers = new Map<string, string[]>();
		for (const superId of newNodes) {
			const original: string[] = [];
			for (const member of groups.get(superId)!) { original.push(...(level.members.get(member) ?? [])); }
			newMembers.set(superId, original.sort());
			let loops = 0;
			for (const member of groups.get(superId)!) { loops += level.selfLoops.get(member) ?? 0; }
			newSelfLoops.set(superId, loops);
		}
		for (const node of level.nodes) {
			const from = community.get(node)!;
			for (const [neighbor, weight] of level.neighbors.get(node)!) {
				const to = community.get(neighbor)!;
				if (from === to) { newSelfLoops.set(from, (newSelfLoops.get(from) ?? 0) + weight / 2); continue; }
				const bucket = newNeighbors.get(from)!;
				bucket.set(to, (bucket.get(to) ?? 0) + weight);
			}
		}
		const newDegree = new Map<string, number>();
		for (const id of newNodes) {
			let sum = (newSelfLoops.get(id) ?? 0) * 2;
			for (const weight of newNeighbors.get(id)!.values()) { sum += weight; }
			newDegree.set(id, sum);
		}
		// Actualizar la membresía de nodos originales al supernodo nuevo.
		const superIndex = new Map(newNodes.map((id, index) => [id, index] as const));
		memberOf = new Map();
		for (const superId of newNodes) {
			for (const original of newMembers.get(superId)!) { memberOf.set(original, superIndex.get(superId)!); }
		}
		if (newNodes.length === level.nodes.length) { break; } // sin compresión: convergió
		level = { nodes: newNodes, neighbors: newNeighbors, degree: newDegree, selfLoops: newSelfLoops, members: newMembers };
	}
	return memberOf;
}

function groupByCommunity(memberOf: ReadonlyMap<string, number>): string[][] {
	const groups = new Map<number, string[]>();
	for (const [node, community] of memberOf) {
		const group = groups.get(community) ?? [];
		group.push(node);
		groups.set(community, group);
	}
	return [...groups.values()].map(group => group.sort());
}

function cohesion(members: readonly string[], neighbors: ReadonlyMap<string, ReadonlyMap<string, number>>): number {
	if (members.length < 2) { return 1; }
	const memberSet = new Set(members);
	let internal = 0;
	for (const id of members) {
		for (const neighbor of neighbors.get(id)?.keys() ?? []) {
			if (memberSet.has(neighbor) && id < neighbor) { internal++; }
		}
	}
	return internal / ((members.length * (members.length - 1)) / 2);
}

function percentile(sortedAscending: readonly number[], fraction: number): number {
	if (!sortedAscending.length) { return 0; }
	return sortedAscending[Math.min(sortedAscending.length - 1, Math.floor(sortedAscending.length * fraction))];
}

/**
 * Particiona el grafo en comunidades. `degreeById` es el grado REAL en el grafo completo (para
 * etiquetas y exclusión de hubs). `previous` permite mantener IDs estables entre corridas.
 */
export function detectCommunities(
	nodeIds: readonly string[],
	edges: readonly ICommunityGraphEdge[],
	degreeById: ReadonlyMap<string, number>,
	nameById: (id: string) => string,
	previous?: readonly ICodebaseCommunity[],
): ICodebaseCommunity[] {
	const allNodes = [...new Set(nodeIds)].sort();
	if (!allNodes.length) { return []; }

	// --- exclusión de hubs p99 (reinsertados después por voto mayoritario de vecinos) ---
	const degreesSorted = allNodes.map(id => degreeById.get(id) ?? 0).sort((a, b) => a - b);
	const hubThreshold = Math.max(50, percentile(degreesSorted, 0.99));
	const hubs = allNodes.filter(id => (degreeById.get(id) ?? 0) >= hubThreshold);
	const hubSet = new Set(hubs);
	const coreNodes = allNodes.filter(id => !hubSet.has(id));
	const coreEdges = edges.filter(edge => !hubSet.has(edge.source) && !hubSet.has(edge.target));

	const graph = buildWorkGraph(coreNodes, coreEdges);
	const memberOf = louvain(graph);
	let groups = groupByCommunity(memberOf);

	// --- splits: comunidades gigantes o de baja cohesión se re-particionan ---
	const maxSize = Math.max(10, Math.floor(coreNodes.length * 0.25));
	const splitOnce = (members: string[]): string[][] => {
		const memberSet = new Set(members);
		const subEdges = coreEdges.filter(edge => memberSet.has(edge.source) && memberSet.has(edge.target));
		if (!subEdges.length) { return members.map(id => [id]); }
		const sub = louvain(buildWorkGraph(members, subEdges));
		const parts = groupByCommunity(sub);
		return parts.length > 1 ? parts : [members];
	};
	groups = groups.flatMap(group => group.length > maxSize ? splitOnce(group) : [group]);
	groups = groups.flatMap(group => (group.length >= 50 && cohesion(group, graph.neighbors) < 0.05) ? splitOnce(group) : [group]);

	// --- reinserción de hubs por voto mayoritario de sus vecinos (desempate por id menor) ---
	const communityOf = new Map<string, number>();
	groups.forEach((group, index) => { for (const id of group) { communityOf.set(id, index); } });
	const neighborsAll = new Map<string, string[]>();
	const addNeighbor = (from: string, to: string): void => {
		const list = neighborsAll.get(from);
		if (list) { list.push(to); } else { neighborsAll.set(from, [to]); }
	};
	for (const edge of edges) {
		addNeighbor(edge.source, edge.target);
		addNeighbor(edge.target, edge.source);
	}
	for (const hub of hubs.sort()) {
		const votes = new Map<number, number>();
		for (const neighbor of neighborsAll.get(hub) ?? []) {
			const community = communityOf.get(neighbor);
			if (community !== undefined) { votes.set(community, (votes.get(community) ?? 0) + 1); }
		}
		if (votes.size) {
			const winner = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
			groups[winner].push(hub);
			groups[winner].sort();
			communityOf.set(hub, winner);
		} else {
			communityOf.set(hub, groups.length);
			groups.push([hub]);
		}
	}

	// --- reindexado con ORDEN TOTAL: (-tamaño, tupla de miembros ordenados) ---
	groups = groups.filter(group => group.length > 0);
	groups.sort((a, b) => b.length - a.length || a.join(' ').localeCompare(b.join(' ')));

	// --- etiquetado por hub: el miembro de mayor grado nombra la comunidad ---
	const label = (members: readonly string[]): string => {
		const top = [...members].sort((a, b) => (degreeById.get(b) ?? 0) - (degreeById.get(a) ?? 0) || a.localeCompare(b))[0];
		return nameById(top).replace(/\(\)$/, '') || 'módulo';
	};

	let communities: ICodebaseCommunity[] = groups.map((members, index) => ({ id: index, label: label(members), members }));

	// --- remapeo greedy contra la corrida anterior para IDs estables ---
	if (previous?.length) {
		const overlaps: { overlap: number; oldId: number; newIndex: number }[] = [];
		for (const old of previous) {
			const oldSet = new Set(old.members);
			communities.forEach((next, newIndex) => {
				let overlap = 0;
				for (const member of next.members) { if (oldSet.has(member)) { overlap++; } }
				if (overlap > 0) { overlaps.push({ overlap, oldId: old.id, newIndex }); }
			});
		}
		overlaps.sort((a, b) => b.overlap - a.overlap || a.oldId - b.oldId || a.newIndex - b.newIndex);
		const usedOld = new Set<number>();
		const assigned = new Map<number, number>();
		for (const { oldId, newIndex } of overlaps) {
			if (usedOld.has(oldId) || assigned.has(newIndex)) { continue; }
			usedOld.add(oldId);
			assigned.set(newIndex, oldId);
		}
		let nextFresh = Math.max(0, ...previous.map(community => community.id + 1));
		communities = communities.map((community, index) => ({
			...community,
			id: assigned.get(index) ?? nextFresh++,
		}));
	}
	return communities;
}
