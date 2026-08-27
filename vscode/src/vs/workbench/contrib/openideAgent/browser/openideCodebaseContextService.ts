/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — codebase context selection for the agent/subagents. The result is a fresh copy per
 *  runId: no mutable arrays are shared between runs. The service does not inject whole files
 *  unless the caller asks for them; it prioritizes structure and relations.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { CODEBASE_NOTES_PATH } from '../../../../code/common/openideCodebaseNotes.js';
import { ICodebaseMemoryNode } from '../../../../code/common/openideCodebaseMemoryTypes.js';
import { IOpenideCodebaseQueryService, queryTerms } from './openideCodebaseQueryService.js';
import { IOpenideProjectMapLearningService } from './openideProjectMapLearningService.js';

export const IOpenideCodebaseContextService = createDecorator<IOpenideCodebaseContextService>('openideCodebaseContextService');

export interface ICodebaseContextOptions { readonly runId?: string; readonly maxTokens?: number; readonly maxNodes?: number; readonly targets?: string[]; }
export interface ICodebaseContextSelection { readonly runId?: string; readonly text: string; readonly nodes: ICodebaseMemoryNode[]; readonly estimatedTokens: number; readonly providers: string[]; readonly indexVersion: number; readonly isStale: boolean; }

export interface IOpenideCodebaseContextService {
	readonly _serviceBrand: undefined;
	select(task: string, options?: ICodebaseContextOptions): Promise<ICodebaseContextSelection>;
}

function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }

export class OpenideCodebaseContextService implements IOpenideCodebaseContextService {
	declare readonly _serviceBrand: undefined;
	constructor(
		@IOpenideCodebaseQueryService private readonly query: IOpenideCodebaseQueryService,
		@IOpenideProjectMapLearningService private readonly learning: IOpenideProjectMapLearningService,
	) { }

	async select(task: string, options: ICodebaseContextOptions = {}): Promise<ICodebaseContextSelection> {
		const maxTokens = Math.max(300, options.maxTokens ?? 2_000);
		const maxNodes = Math.max(3, options.maxNodes ?? 24);
		const terms = queryTerms(task);
		const found = await this.query.search(terms.join(' '), { limit: Math.min(maxNodes, 12) });
		const explicitTargets = options.targets?.length ? options.targets : undefined;
		// Gap seeds plus a per-term guarantee instead of a raw top-N: it avoids expanding six
		// nearly identical neighbourhoods and an incidental match eating the relevant terms.
		const seeds = explicitTargets ?? (await this.query.pickSeeds(task, 3)).map(node => node.id);
		if (!seeds.length) {
			return { runId: options.runId, text: '', nodes: [], estimatedTokens: 0, providers: [], indexVersion: found.indexVersion, isStale: found.isStale };
		}
		const nodes = [...found.data];
		const relationLines: string[] = [];
		for (const target of seeds.slice(0, 6)) {
			const rel = await this.query.explore(target, 'both', undefined, 1, Math.max(4, Math.floor(maxNodes / seeds.length)));
			const seed = nodes.find(node => node.id === target);
			for (const row of rel.data) {
				if (!nodes.some(node => node.id === row.node.id)) { nodes.push(row.node); }
				if (seed && relationLines.length < maxNodes) {
					relationLines.push(`- ${seed.qualifiedName ?? seed.name} —${row.edge.type}→ ${row.node.qualifiedName ?? row.node.name} [confidence=${Math.round(row.edge.evidence.confidence * 100)}%]`);
				}
			}
		}
		// Authored notes go FIRST, and not out of politeness: they are the only nodes here nobody
		// inferred, and they are the one thing the agent cannot re-derive by reading the code. If
		// the budget has to cut something, cutting a regex-guessed symbol costs less than cutting
		// the decision that explains why the code looks the way it does.
		nodes.sort((left, right) => Number(right.kind === 'note') - Number(left.kind === 'note'));
		const lines = [`Project map · index v${found.indexVersion}${found.isStale ? ' · STALE: verify touched files before editing' : ' · fresh'}`, `Query vocabulary: ${terms.slice(0, 16).join(', ')}`, '', 'Relevant entities:'];
		const selected: ICodebaseMemoryNode[] = [];
		const providers = new Set<string>();
		const totalCandidates = Math.min(nodes.length, maxNodes);
		for (const node of nodes.slice(0, maxNodes)) {
			const community = await this.query.communityLabel(node.uri);
			// Work memory: how this entity fared in previous turns. It is reported, not
			// filtered — the model decides what to do with the datum (Graphify pattern).
			const learning = this.learning.getState(node.uri, node.qualifiedName ?? node.name);
			// A note's value IS its text. Rendering it like an entity would show a name capped at
			// 80 chars and send the agent off to open the file — which is the round trip this
			// whole thing exists to remove.
			const line = node.kind === 'note'
				? `- NOTE (${CODEBASE_NOTES_PATH}:${node.range?.startLine ?? 0}): ${node.documentation ?? node.name}`
				: `- ${node.qualifiedName ?? node.name} — ${node.uri}${node.range ? ':' + node.range.startLine : ''} [${node.kind}; confidence=${Math.round(node.evidence.confidence * 100)}%; provider=${node.evidence.provider}${community ? `; module=${community}` : ''}${learning ? `; learning=${learning}` : ''}]`;
			if (estimateTokens(lines.concat(line).join('\n')) > maxTokens) { break; }
			lines.push(line); selected.push({ ...node }); providers.add(node.evidence.provider);
		}
		let relationsShown = 0;
		if (relationLines.length) {
			lines.push('', 'Nearby relations:');
			for (const line of relationLines) {
				if (estimateTokens(lines.concat(line).join('\n')) > maxTokens) { break; }
				lines.push(line); relationsShown++;
			}
		}
		// "Silence reads as absence" (Graphify): a trimmed result with no notice makes the
		// agent conclude that what is missing DOES NOT EXIST. The notice goes above and below, outside
		// the budget on purpose.
		const truncated = selected.length < totalCandidates || relationsShown < relationLines.length;
		if (truncated) {
			const notice = `[!] TRUNCATED: showing ${selected.length} of ${totalCandidates} entities and ${relationsShown} of ${relationLines.length} relations (~${maxTokens}-token budget). The answer may be among the cut items — raise openide.memory.maxContextTokens or narrow the question.`;
			lines.unshift(notice);
			lines.push(notice);
		}
		const text = lines.join('\n');
		return { runId: options.runId, text, nodes: selected, estimatedTokens: estimateTokens(text), providers: [...providers], indexVersion: found.indexVersion, isStale: found.isStale };
	}
}
