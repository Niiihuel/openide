/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — hybrid query service over the canonical graph. It keeps the scoped queries out of
 *  the webview and offers search, explore, callers/callees, impact, paths and related tests.
 *  Relations carry evidence, so the consumer can tell LS results from heuristics.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { ICodebaseMemoryEdge, ICodebaseMemoryNode, CodebaseMemoryProvider, CodebaseMemoryRelationType, ICodebaseMemoryQueryResult } from '../../../../code/common/openideCodebaseMemoryTypes.js';

export const IOpenideCodebaseQueryService = createDecorator<IOpenideCodebaseQueryService>('openideCodebaseQueryService');

export interface ICodebaseSearchOptions { readonly kinds?: string[]; readonly languages?: string[]; readonly pathPrefix?: string; readonly limit?: number; }
export interface ICodebaseRelationResult { readonly node: ICodebaseMemoryNode; readonly edge: ICodebaseMemoryEdge; readonly depth: number; }
export interface ICodebaseImpactResult { readonly direct: ICodebaseRelationResult[]; readonly transitive: ICodebaseRelationResult[]; readonly tests: ICodebaseRelationResult[]; }

interface IQuerySnapshot {
	readonly nodes: readonly ICodebaseMemoryNode[];
	readonly edges: readonly ICodebaseMemoryEdge[];
	readonly version: number;
	readonly dirty: Set<string>;
	readonly nodesById: ReadonlyMap<string, ICodebaseMemoryNode>;
	readonly edgesBySource: ReadonlyMap<string, readonly ICodebaseMemoryEdge[]>;
	readonly edgesByTarget: ReadonlyMap<string, readonly ICodebaseMemoryEdge[]>;
	/** A node with degree ≥ hubThreshold is visited but NOT expanded as transit (the Graphify
	 *  pattern): without this, 3 hops from anywhere reach the whole graph via utils. */
	readonly hubThreshold: number;
	readonly degreeById: ReadonlyMap<string, number>;
	/** Community (module) label per file URI; empty until the first rebuild. */
	readonly communityLabelByUri: ReadonlyMap<string, string>;
}

export interface IOpenideCodebaseQueryService {
	readonly _serviceBrand: undefined;
	search(query: string, options?: ICodebaseSearchOptions): Promise<ICodebaseMemoryQueryResult<ICodebaseMemoryNode[]>>;
	explore(target: string, direction?: 'incoming' | 'outgoing' | 'both', relationTypes?: CodebaseMemoryRelationType[], depth?: number, limit?: number): Promise<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>;
	callers(target: string, transitive?: boolean, maxDepth?: number, limit?: number): Promise<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>;
	callees(target: string, transitive?: boolean, maxDepth?: number, limit?: number): Promise<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>;
	impact(targets: string[], includeTests?: boolean, includeTransitive?: boolean, maxDepth?: number): Promise<ICodebaseMemoryQueryResult<ICodebaseImpactResult>>;
	path(from: string, to: string, relationTypes?: CodebaseMemoryRelationType[], maxDepth?: number): Promise<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>;
	relatedTests(targets: string[], limit?: number): Promise<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>;
	/** Community (module) label of an entity's file, when the index has already computed it. */
	communityLabel(uri: string): Promise<string | undefined>;
	/** Anchor entities for expanding a neighbourhood (gap cut plus a per-term guarantee). */
	pickSeeds(query: string, max?: number): Promise<ICodebaseMemoryNode[]>;
}

export class OpenideCodebaseQueryService extends Disposable implements IOpenideCodebaseQueryService {
	declare readonly _serviceBrand: undefined;
	private snapshot: IQuerySnapshot | undefined;

	constructor(
		@ICodebaseMemoryService private readonly memory: ICodebaseMemoryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._register(memory.onDidChange(() => { this.snapshot = undefined; }));
		// The snapshot is built with the heuristics filter applied: if it changes, it is rebuilt.
		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('openide.memory.showHeuristicRelations')) { this.snapshot = undefined; }
		}));
	}

	/** Configurable depth ceiling for every graph traversal (default 3, cap 6). */
	private configuredMaxDepth(): number {
		const value = Number(this.configurationService.getValue('openide.memory.maxTraversalDepth'));
		return Number.isFinite(value) && value >= 1 ? Math.min(6, value) : 3;
	}

	private async current() {
		if (!this.snapshot) {
			const snapshot = await this.memory.getSnapshot();
			const nodes = snapshot?.nodes ?? [];
			// Con showHeuristicRelations=false solo sobreviven ARISTAS verificadas (language
			// server). The nodes stay: filtering them would empty the graph (file-nodes are regex/text).
			const includeHeuristic = this.configurationService.getValue('openide.memory.showHeuristicRelations') !== false;
			const edges = (snapshot?.edges ?? []).filter(edge => includeHeuristic || edge.evidence.verified);
			const edgesBySource = new Map<string, ICodebaseMemoryEdge[]>();
			const edgesByTarget = new Map<string, ICodebaseMemoryEdge[]>();
			for (const edge of edges) {
				const outgoing = edgesBySource.get(edge.source) ?? [];
				outgoing.push(edge);
				edgesBySource.set(edge.source, outgoing);
				const incoming = edgesByTarget.get(edge.target) ?? [];
				incoming.push(edge);
				edgesByTarget.set(edge.target, incoming);
			}
			const degreeById = new Map<string, number>();
			for (const edge of edges) {
				degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
				degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
			}
			const degreesSorted = [...degreeById.values()].sort((a, b) => a - b);
			const p99 = degreesSorted.length ? degreesSorted[Math.min(degreesSorted.length - 1, Math.floor(degreesSorted.length * 0.99))] : 0;
			const communityLabelByUri = new Map<string, string>();
			for (const community of snapshot?.communities ?? []) {
				for (const member of community.members) { communityLabelByUri.set(member, community.label); }
			}
			this.snapshot = {
				nodes,
				edges,
				version: snapshot?.version.version ?? 0,
				dirty: new Set(snapshot?.dirtyUris ?? []),
				nodesById: new Map(nodes.map(node => [node.id, node] as const)),
				edgesBySource,
				edgesByTarget,
				hubThreshold: Math.max(50, p99),
				degreeById,
				communityLabelByUri,
			};
		}
		return this.snapshot;
	}

	private result<T>(data: T, snapshot: IQuerySnapshot, providers: CodebaseMemoryProvider[], confidence: number): ICodebaseMemoryQueryResult<T> {
		return { data, indexVersion: snapshot.version, isStale: snapshot.dirty.size > 0, providers: [...new Set(providers)], confidence };
	}

	async search(query: string, options: ICodebaseSearchOptions = {}): Promise<ICodebaseMemoryQueryResult<ICodebaseMemoryNode[]>> {
		const snapshot = await this.current(); const terms = queryTerms(query);
		const kinds = options.kinds?.map(k => k.toLowerCase()); const languages = options.languages?.map(k => k.toLowerCase()); const prefix = options.pathPrefix?.toLowerCase();
		const candidates = !terms.length ? [] : snapshot.nodes.filter(node => {
			if (kinds?.length && !kinds.includes(node.kind.toLowerCase())) { return false; }
			if (languages?.length && !languages.includes((node.language ?? '').toLowerCase())) { return false; }
			if (prefix && !node.uri.toLowerCase().includes(prefix)) { return false; }
			const haystack = searchableNodeText(node);
			return terms.some(term => haystack.includes(term));
		});
		const documentFrequency = new Map<string, number>();
		for (const term of terms) {
			documentFrequency.set(term, candidates.reduce((count, node) => count + (searchableNodeText(node).includes(term) ? 1 : 0), 0));
		}
		const scored = candidates
			.map(node => ({ node, score: this.score(node, terms, documentFrequency, snapshot.nodes.length) }))
			.sort((a, b) => b.score - a.score || a.node.name.length - b.node.name.length || a.node.id.localeCompare(b.node.id));
		const data = scored.slice(0, options.limit ?? 50).map(entry => entry.node);
		return this.result(data, snapshot, data.map(node => node.evidence.provider), data.length ? Math.max(...data.map(node => node.evidence.confidence)) : 0);
	}

	/**
	 * Deterministic Graphify-style lexical scoring: tiers with STRICT precedence per term
	 * (exact > prefix > substring; a term never counts twice) weighted by IDF, and scaled by
	 * coverage SQUARED — with linear coverage, an exact match on 1-of-N terms beats a
	 * prefix+substring covering almost all of them, because the exact tier is worth
	 * 10x el de prefijo.
	 */
	private score(node: ICodebaseMemoryNode, terms: readonly string[], documentFrequency: ReadonlyMap<string, number>, nodeCount: number): number {
		if (!terms.length) { return 0; }
		const name = node.name.toLowerCase(); const qualified = (node.qualifiedName ?? '').toLowerCase(); const uri = node.uri.toLowerCase();
		const base = node.evidence.confidence * 4 + Math.min(node.degree, 20) * 0.15;
		const joined = terms.join('');
		let tiered = 0;
		let matched = 0;
		for (const term of terms) {
			const frequency = documentFrequency.get(term) ?? 0;
			const idf = Math.log((nodeCount + 1) / (frequency + 1)) + 1;
			if (name === term) { tiered += 1000 * idf; matched++; }
			else if (name.startsWith(term)) { tiered += 100 * idf; matched++; }
			else if (name.includes(term) || qualified.includes(term)) { tiered += 1 * idf; matched++; }
			// The path adds signal but does NOT count as coverage: a term appearing only in the
			// path does not mean the entity is about it.
			else if (uri.includes(term)) { tiered += 0.5 * idf; }
		}
		// Full-query tier: the name IS the query (or prefixes it).
		const joinedIdf = Math.max(1, ...terms.map(term => Math.log((nodeCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1));
		if (name === joined || qualified === joined || node.id === joined) { tiered += 1000 * 10 * joinedIdf; }
		else if (name.startsWith(joined)) { tiered += 100 * 10 * joinedIdf; }
		const coverage = matched / terms.length;
		return base + tiered * coverage * coverage;
	}

	/**
	 * Neighbourhood seeds: at most `max`, cut by the gap against the best score, deduplicated by
	 * normalized name (dozens of `GET` handlers contribute ONE seed instead of flooding the BFS)
	 * and with a guarantee of at least one seed per term that has any match — otherwise an
	 * incidental exact match on one term gap-cuts the seeds of the terms that actually mattered.
	 */
	async pickSeeds(query: string, max = 3): Promise<ICodebaseMemoryNode[]> {
		const terms = queryTerms(query);
		if (!terms.length) { return []; }
		const found = await this.search(terms.join(' '), { limit: 50 });
		const ranked = found.data;
		if (!ranked.length) { return []; }
		const snapshot = await this.current();
		const documentFrequency = new Map<string, number>();
		for (const term of terms) {
			documentFrequency.set(term, ranked.reduce((count, node) => count + (searchableNodeText(node).includes(term) ? 1 : 0), 0));
		}
		const topScore = this.score(ranked[0], terms, documentFrequency, snapshot.nodes.length);
		const seeds: ICodebaseMemoryNode[] = [];
		const seenLabels = new Set<string>();
		for (const node of ranked) {
			if (seeds.length >= max) { break; }
			if (this.score(node, terms, documentFrequency, snapshot.nodes.length) < topScore * 0.2) { break; }
			const label = (node.qualifiedName ?? node.name).toLowerCase();
			if (seenLabels.has(label)) { continue; }
			seenLabels.add(label); seeds.push(node);
		}
		// Per-term guarantee: every term with a match contributes its best candidate even if the gap
		// cut it (deduped by id, respecting the `max` ceiling only for the gap ones).
		for (const term of terms) {
			if (seeds.some(seed => searchableNodeText(seed).includes(term))) { continue; }
			const best = ranked.find(node => searchableNodeText(node).includes(term));
			if (best && !seeds.some(seed => seed.id === best.id)) { seeds.push(best); }
		}
		return seeds;
	}

	private edgeOtherForCall(edge: ICodebaseMemoryEdge, current: string, direction: 'incoming' | 'outgoing' | 'both'): string | undefined {
		const reversed = edge.type === 'CALLED_BY';
		const outgoing = reversed ? (edge.target === current ? edge.source : undefined) : (edge.source === current ? edge.target : undefined);
		const incoming = reversed ? (edge.source === current ? edge.target : undefined) : (edge.target === current ? edge.source : undefined);
		return direction === 'outgoing' ? outgoing : direction === 'incoming' ? incoming : outgoing ?? incoming;
	}

	private async adjacency(target: string, direction: 'incoming' | 'outgoing' | 'both', relationTypes: CodebaseMemoryRelationType[] | undefined, maxDepth: number, limit: number): Promise<{ rows: ICodebaseRelationResult[]; snapshot: IQuerySnapshot }> {
		const snapshot = await this.current(); const nodes = snapshot.nodesById;
		const start = nodes.get(target) ?? snapshot.nodes.find(node => node.name.toLowerCase() === target.toLowerCase());
		if (!start) { return { rows: [], snapshot }; }
		const rows: ICodebaseRelationResult[] = []; const seen = new Set<string>([start.id]); let frontier = [start.id];
		const cappedDepth = Math.min(Math.max(1, maxDepth), this.configuredMaxDepth());
		for (let depth = 1; depth <= cappedDepth; depth++) {
			const next: string[] = [];
			for (const id of frontier) {
				const candidateEdges = direction === 'outgoing' ? (snapshot.edgesBySource.get(id) ?? []) : direction === 'incoming' ? (snapshot.edgesByTarget.get(id) ?? []) : [...(snapshot.edgesBySource.get(id) ?? []), ...(snapshot.edgesByTarget.get(id) ?? [])];
				for (const edge of candidateEdges) {
					if (relationTypes?.length && !relationTypes.includes(edge.type)) { continue; }
					const callRelation = edge.type === 'CALLS' || edge.type === 'CALLED_BY';
					const otherId = callRelation ? this.edgeOtherForCall(edge, id, direction) : (direction === 'outgoing' ? (edge.source === id ? edge.target : undefined) : direction === 'incoming' ? (edge.target === id ? edge.source : undefined) : edge.source === id ? edge.target : edge.target === id ? edge.source : undefined);
					if (!otherId) { continue; }
					const node = nodes.get(otherId);
					if (!node || seen.has(otherId)) { continue; }
					seen.add(otherId); rows.push({ node, edge, depth });
					// Hub avoidance: the hub is shown but does not contribute its neighbourhood (the initial
					// seed always expands — if you asked for the hub, you want its neighbours).
					if ((snapshot.degreeById.get(otherId) ?? 0) < snapshot.hubThreshold) { next.push(otherId); }
					if (rows.length >= limit) { return { rows, snapshot }; }
				}
			}
			frontier = next; if (!frontier.length) { break; }
		}
		return { rows, snapshot };
	}

	async explore(target: string, direction: 'incoming' | 'outgoing' | 'both' = 'both', relationTypes?: CodebaseMemoryRelationType[], depth = 1, limit = 100): Promise<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>> {
		const { rows, snapshot } = await this.adjacency(target, direction, relationTypes, depth, limit);
		return this.result(rows, snapshot, rows.map(row => row.edge.evidence.provider), rows.length ? Math.max(...rows.map(row => row.edge.evidence.confidence)) : 0);
	}
	async callers(target: string, transitive = false, maxDepth = 1, limit = 100) { return this.explore(target, 'incoming', ['CALLS', 'CALLED_BY'], transitive ? maxDepth : 1, limit); }
	async callees(target: string, transitive = false, maxDepth = 1, limit = 100) { return this.explore(target, 'outgoing', ['CALLS', 'CALLED_BY'], transitive ? maxDepth : 1, limit); }

	async impact(targets: string[], includeTests = true, includeTransitive = true, maxDepth = 2): Promise<ICodebaseMemoryQueryResult<ICodebaseImpactResult>> {
		const snapshot = await this.current(); const direct: ICodebaseRelationResult[] = []; const transitive: ICodebaseRelationResult[] = []; const tests: ICodebaseRelationResult[] = [];
		for (const target of targets) {
			const result = await this.adjacency(target, 'incoming', undefined, includeTransitive ? maxDepth : 1, 300);
			for (const row of result.rows) { (row.edge.type === 'TESTS' || row.edge.type === 'TESTED_BY' ? tests : row.depth === 1 ? direct : transitive).push(row); }
		}
		const data = { direct, transitive, tests: includeTests ? tests : [] };
		return this.result(data, snapshot, [...direct, ...transitive, ...tests].map(row => row.edge.evidence.provider),  [...direct, ...transitive, ...tests].length ? Math.max(...[...direct, ...transitive, ...tests].map(row => row.edge.evidence.confidence)) : 0);
	}

	async path(from: string, to: string, relationTypes?: CodebaseMemoryRelationType[], maxDepth = 5): Promise<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>> {
		const snapshot = await this.current(); const nodes = snapshot.nodesById; const start = nodes.get(from) ?? snapshot.nodes.find(node => node.name.toLowerCase() === from.toLowerCase()); const end = nodes.get(to) ?? snapshot.nodes.find(node => node.name.toLowerCase() === to.toLowerCase());
		if (!start || !end) { return this.result([], snapshot, [], 0); }
		const queue: { id: string; rows: ICodebaseRelationResult[] }[] = [{ id: start.id, rows: [] }]; const visited = new Set<string>([start.id]);
		// `path` looks for long chains: it is allowed twice the exploration ceiling, capped at 6+2.
		const cappedDepth = Math.min(Math.max(1, maxDepth), this.configuredMaxDepth() + 2);
		while (queue.length) {
			const current = queue.shift()!;
			if (current.id === end.id) { return this.result(current.rows, snapshot, current.rows.map(row => row.edge.evidence.provider), current.rows.length ? Math.min(...current.rows.map(row => row.edge.evidence.confidence)) : 1); }
			if (current.rows.length >= cappedDepth) { continue; }
			const candidateEdges = [...(snapshot.edgesBySource.get(current.id) ?? []), ...(snapshot.edgesByTarget.get(current.id) ?? [])];
			for (const edge of candidateEdges) {
				if (relationTypes?.length && !relationTypes.includes(edge.type)) { continue; }
				const otherId = edge.source === current.id ? edge.target : edge.source;
				if (visited.has(otherId)) { continue; }
				visited.add(otherId);
				const node = nodes.get(otherId);
				if (node) { queue.push({ id: otherId, rows: [...current.rows, { node, edge, depth: current.rows.length + 1 }] }); }
			}
		}
		return this.result([], snapshot, [], 0);
	}

	async relatedTests(targets: string[], limit = 100) { const result = await this.impact(targets, true, true, 2); return { ...result, data: result.data.tests.slice(0, limit) }; }

	async communityLabel(uri: string): Promise<string | undefined> {
		const snapshot = await this.current();
		return snapshot.communityLabelByUri.get(uri);
	}
}

const QUERY_STOP_WORDS = new Set([
	'about', 'after', 'also', 'antes', 'como', 'con', 'contra', 'cual', 'cuando', 'donde', 'este', 'esta', 'esto', 'from', 'hacer', 'hace', 'hacia', 'para', 'pero', 'porque', 'quiero', 'sobre', 'that', 'the', 'this', 'una', 'uno', 'usar', 'uses', 'with', 'what', 'where', 'which', 'your',
]);

/** Splits natural language, paths and camelCase to recover the graph's real vocabulary. */
export function queryTerms(query: string): string[] {
	const expanded = query.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase();
	const terms = expanded.match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
	return [...new Set(terms.flatMap(term => term.split(/[_-]+/)).filter(term => term.length >= 3 && !QUERY_STOP_WORDS.has(term)))].slice(-32);
}

function searchableNodeText(node: ICodebaseMemoryNode): string {
	return `${node.name} ${node.qualifiedName ?? ''} ${node.uri} ${node.signature ?? ''}`.toLowerCase();
}
