/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOpenideCodebaseGraph } from './openideCodebaseGraph.js';
import { IOpenideCodebaseQueryService } from './openideCodebaseQueryService.js';
import { IOpenideCodebaseContextService } from './openideCodebaseContextService.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IOpenideCodebasePriorities } from './openideCodebasePriorities.js';
import { IAgentTool } from './openideTools.js';

export class OpenideCodebaseTools {
	constructor(
		private readonly codebaseGraph: IOpenideCodebaseGraph,
		private readonly codebasePriorities: IOpenideCodebasePriorities,
		private readonly codebaseQuery: IOpenideCodebaseQueryService,
		private readonly codebaseContext: IOpenideCodebaseContextService,
		private readonly codebaseMemory: ICodebaseMemoryService,
	) { }

	buildTools(): IAgentTool[] {
		return [this.codebaseSearchTool(), this.codebaseExploreTool(), this.codebaseCallersTool(), this.memoryGraphStatusTool(), this.projectMapQueryTool(), this.memoryGraphImpactTool(), this.memoryGraphPathTool(), this.memoryGraphRelatedTestsTool(), this.codebaseSavePriorityTool()];
	}

	private memoryGraphStatusTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_status', description: 'State of the persisted codebase memory: version, freshness and node/relation counts.', parameters: { type: 'object', properties: {} } }, invoke: async () => {
			const version = await this.codebaseMemory.getVersion();
			return JSON.stringify(version ? { ready: true, ...version } : { ready: false, version: 0, staleCount: 0, nodeCount: 0, edgeCount: 0 });
		} };
	}

	/** Single budgeted query to orient the agent before opening files. */
	private projectMapQueryTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'project_map_query',
				description: 'Query Project Map before searching or reading many files. Returns only relevant nearby entities and relations, with provenance, confidence, freshness and a strict budget. Use it to orient yourself; then open only the specific files you must verify or modify.',
				parameters: {
					type: 'object',
					properties: {
						question: { type: 'string', description: 'Concrete question or task about the project' },
						maxTokens: { type: 'number', description: 'Output budget between 500 and 4000 tokens; 2000 by default' },
					},
					required: ['question'],
				},
			},
			invoke: async (args: any) => {
				const question = String(args.question ?? '').trim();
				if (!question) { return 'Error: empty question.'; }
				const maxTokens = Math.min(4_000, Math.max(500, Number(args.maxTokens) || 2_000));
				const selection = await this.codebaseContext.select(question, { maxTokens, maxNodes: 24 });
				return selection.text || 'Project Map found no relevant entities. Use codebase_search or a narrow text search.';
			},
		};
	}

	private memoryGraphImpactTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_impact', description: 'Analyze direct/transitive impact, dependencies and related tests before modifying symbols.', parameters: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, includeTests: { type: 'boolean' }, includeTransitive: { type: 'boolean' }, maxDepth: { type: 'number' } }, required: ['targets'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.impact(Array.isArray(args.targets) ? args.targets.map(String) : [], args.includeTests !== false, args.includeTransitive !== false, Number(args.maxDepth) || 2)) };
	}

	private memoryGraphPathTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_path', description: 'Find a path of relations between two codebase entities.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, relationTypes: { type: 'array', items: { type: 'string' } }, maxDepth: { type: 'number' } }, required: ['from', 'to'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.path(String(args.from ?? ''), String(args.to ?? ''), args.relationTypes, Number(args.maxDepth) || 5)) };
	}

	private memoryGraphRelatedTestsTool() {
		return { risk: 'safe' as const, def: { name: 'memory_graph_related_tests', description: 'Find tests related to one or more entities.', parameters: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } }, required: ['targets'] } }, invoke: async (args: any) => JSON.stringify(await this.codebaseQuery.relatedTests(Array.isArray(args.targets) ? args.targets.map(String) : [], Number(args.limit) || 100)) };
	}

	/** codebase_search: locates symbols in the codebase by name (language server index). */
	private codebaseSearchTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_search',
				description: 'FAST symbol search in the codebase by name (language server index, precise). Locations + signature only, no code. For code + relations use codebase_explore.',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'Name (or part) of the symbol to search for' },
						kind: { type: 'string', description: 'Optional: filter by kind (class, function, method, interface…)' },
					},
					required: ['query'],
				},
			},
			invoke: async (args: any) => {
				const query = String(args.query ?? '').trim();
				if (!query) { return 'Error: empty query.'; }
				const kind = String(args.kind ?? '').trim().toLowerCase();
				const memoryHits = await this.codebaseQuery.search(query, { kinds: kind ? [kind] : undefined, limit: 15 });
				let hits = await this.codebaseGraph.search(query, 15);
				if (kind) { hits = hits.filter(h => h.kindLabel.toLowerCase().includes(kind)); }
				const memoryLines = memoryHits.data.map(h => `${h.kind} ${h.name}${h.qualifiedName ? ` [${h.qualifiedName}]` : ''} — ${h.uri}:${h.range?.startLine ?? 1} (provider=${h.evidence.provider}, confidence=${Math.round(h.evidence.confidence * 100)}%)`);
				const languageLines = hits.map(h => `${h.kindLabel} ${h.name}${h.container ? ` [${h.container}]` : ''} — ${h.path}:${h.line} (language server)`);
				const out = [...memoryLines, ...languageLines].filter((line, index, all) => all.indexOf(line) === index);
				if (!out.length) { return 'No matches in the index — try grep.'; }
				return out.join('\n');
			},
		};
	}

	/** codebase_explore: verbatim code of a symbol plus callers/callees, in one call. */
	private codebaseExploreTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_explore',
				description: 'PRIMARY navigation tool — call it FIRST for almost any codebase question and BEFORE editing. It finds the symbol and returns its current VERBATIM code + who calls it and what it calls, in a single call. Use it INSTEAD OF grep/read_file chains. Treat the returned code as ALREADY READ.',
				parameters: {
					type: 'object',
					properties: { query: { type: 'string', description: 'Name of the symbol (function/class/method) to explore' } },
					required: ['query'],
				},
			},
			invoke: async (args: any) => {
				const query = String(args.query ?? '').trim();
				if (!query) { return 'Error: empty query.'; }
				const memoryContext = await this.codebaseContext.select(query, { maxTokens: 6000, maxNodes: 30 }).catch(() => undefined);
				const { hits } = await this.codebaseGraph.symbolDetail(query);
				if (!hits.length && !memoryContext?.nodes.length) { return `No results in the index for "${query}" — use grep/read_file.`; }
				if (!hits.length && memoryContext?.text) { return memoryContext.text; }
				const blocks: string[] = [];
				// Matching project priorities (scoped by touched paths / query keywords).
				const priorities = await this.codebasePriorities.match(query, hits.map(h => h.path));
				const prioBlock = this.codebasePriorities.render(priorities);
				if (prioBlock) { blocks.push(prioBlock); }
				for (const h of hits) {
					const parts: string[] = [`== ${h.kindLabel} ${h.name} — ${h.path}:${h.line} ==`, h.source];
					const rel: string[] = [];
					for (const c of h.callees) { rel.push(`${h.name} —calls→ ${c.name} (${c.path}:${c.line})`); }
					for (const c of h.callers) { rel.push(`${c.name} —calls→ ${h.name} (${c.path}:${c.line})`); }
					if (rel.length) { parts.push('== Relations ==', rel.join('\n')); }
					blocks.push(parts.join('\n'));
				}
				blocks.push('Treat the code shown as already read — do NOT reopen these files with read_file.');
				return blocks.join('\n\n');
			},
		};
	}

	/** codebase_callers: who calls (or is called by) a symbol — precise call hierarchy. */
	private codebaseCallersTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_callers',
				description: 'Who CALLS (or is called by) a symbol — precise call hierarchy, to gauge impact before refactoring.',
				parameters: {
					type: 'object',
					properties: {
						symbol: { type: 'string', description: 'Name of the symbol/function/method' },
						direction: { type: 'string', enum: ['callers', 'callees'], description: 'callers (who calls it, default) or callees (what it calls)' },
					},
					required: ['symbol'],
				},
			},
			invoke: async (args: any) => {
				const symbol = String(args.symbol ?? '').trim();
				if (!symbol) { return 'Error: empty symbol.'; }
				const direction = args.direction === 'callees' ? 'callees' as const : 'callers' as const;
				const { hits } = await this.codebaseGraph.callers(symbol, direction, 20);
				if (!hits.length) { return `No results in the index for "${symbol}".`; }
				const lines: string[] = [];
				for (const h of hits) {
					lines.push(`${h.name} (${h.path}:${h.line})`);
					if (h.related.length) {
						for (const r of h.related) { lines.push(`  ${r.name} — ${r.path}:${r.line}`); }
					} else {
						lines.push('  (nobody in the index)');
					}
				}
				return lines.join('\n');
			},
		};
	}

	/** codebase_save_priority: stores a PERMANENT project RULE with a scope. */
	private codebaseSavePriorityTool() {
		return {
			risk: 'safe' as const,
			def: {
				name: 'codebase_save_priority',
				description: "Save a PERMANENT project RULE. Call it PROACTIVELY when the user states a convention or hard requirement ('it is important to always…', 'never use…', 'from now on…'). Scope: paths = path fragments where it applies (e.g. 'src/api'), keywords = topics (e.g. 'auth'). It is injected on its own into future codebase_explore answers when the scope matches. Leave the scope EMPTY only for whole-project rules.",
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string', description: 'The rule, in clear imperative form (e.g. "Always validate input at the API layer")' },
						level: { type: 'string', enum: ['critical', 'high', 'normal'], description: 'Importance (default high)' },
						paths: { type: 'array', items: { type: 'string' }, description: 'Path fragments where it applies (e.g. "src/api"). Empty = the whole project.' },
						keywords: { type: 'array', items: { type: 'string' }, description: 'Topics where it applies (e.g. "auth", "cache").' },
					},
					required: ['text'],
				},
			},
			invoke: async (args: any) => {
				const text = String(args.text ?? '').trim();
				if (!text) { return 'Error: empty text.'; }
				const level = (args.level === 'critical' || args.level === 'normal') ? args.level : 'high';
				const paths = Array.isArray(args.paths) ? args.paths.map((s: any) => String(s)) : [];
				const keywords = Array.isArray(args.keywords) ? args.keywords.map((s: any) => String(s)) : [];
				const saved = await this.codebasePriorities.save({ text, level, paths, keywords });
				if (!saved) { return 'Error: could not save the priority (is a folder open?).'; }
				const scopeParts = [...saved.scope.paths, ...saved.scope.keywords];
				const scope = scopeParts.length ? scopeParts.join(', ') : 'the whole project';
				return `Priority saved [${saved.level}], scope: ${scope}. It will be injected into memory answers when relevant.`;
			},
		};
	}

}
