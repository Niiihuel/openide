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
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { ICodebaseMemoryNode, CodebaseMemoryRelationType, ICodebaseMemoryQueryResult } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryTypes.js';
import { CodebaseQueryEngine, ICodebaseQueries, ICodebaseSearchOptions, ICodebaseRelationResult, ICodebaseImpactResult, executeCodebaseQuery } from '../../../../platform/openideCodebase/common/openideCodebaseQueryEngine.js';
import { CodebaseQueryMethod } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';

export { type ICodebaseSearchOptions, type ICodebaseRelationResult, type ICodebaseImpactResult, queryTerms } from '../../../../platform/openideCodebase/common/openideCodebaseQueryEngine.js';
export interface IOpenideCodebaseQueryService extends ICodebaseQueries {}
export const IOpenideCodebaseQueryService = createDecorator<IOpenideCodebaseQueryService>('openideCodebaseQueryService');

/** Renderer facade: successful queries transfer only their results, never a graph snapshot. */
export class OpenideCodebaseQueryService extends Disposable implements IOpenideCodebaseQueryService {
	declare readonly _serviceBrand: undefined;
	private readonly lifetime = new CancellationTokenSource();
	private fallback: CodebaseQueryEngine | undefined;
	private configurationGeneration = 0;
	constructor(
		@ICodebaseMemoryService private readonly memory: ICodebaseMemoryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('openide.memory.showHeuristicRelations') || event.affectsConfiguration('openide.memory.maxTraversalDepth')) { this.configurationGeneration++; }
		}));
	}

	private async run<T>(method: CodebaseQueryMethod, args: unknown[]): Promise<T> {
		while (true) {
			if (this.lifetime.token.isCancellationRequested) { throw new CancellationError(); }
			const generation = this.configurationGeneration;
			const depth = Number(this.configurationService.getValue('openide.memory.maxTraversalDepth'));
			const request = { method, arguments: args, includeHeuristic: this.configurationService.getValue('openide.memory.showHeuristicRelations') !== false, maxTraversalDepth: Number.isFinite(depth) && depth >= 1 ? Math.min(6, depth) : 3 };
			// Older embedders/test sources still implement the snapshot-only contract. Native
			// backend failures are handled in the shared process, not by loading data here.
			let result: unknown;
			if (typeof this.memory.query === 'function') { result = await this.memory.query(request, this.lifetime.token); }
			else { this.fallback ??= this._register(new CodebaseQueryEngine(this.memory, this.configurationService)); result = await executeCodebaseQuery(this.fallback, request); }
			if (this.lifetime.token.isCancellationRequested) { throw new CancellationError(); }
			if (generation === this.configurationGeneration) { return (method === 'communityLabel' && result === null ? undefined : result) as T; }
		}
	}
	search(query: string, options?: ICodebaseSearchOptions) { return this.run<ICodebaseMemoryQueryResult<ICodebaseMemoryNode[]>>('search', [query, options]); }
	explore(target: string, direction?: 'incoming' | 'outgoing' | 'both', relationTypes?: CodebaseMemoryRelationType[], depth?: number, limit?: number) { return this.run<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>('explore', [target, direction, relationTypes, depth, limit]); }
	callers(target: string, transitive?: boolean, maxDepth?: number, limit?: number) { return this.run<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>('callers', [target, transitive, maxDepth, limit]); }
	callees(target: string, transitive?: boolean, maxDepth?: number, limit?: number) { return this.run<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>('callees', [target, transitive, maxDepth, limit]); }
	impact(targets: string[], includeTests?: boolean, includeTransitive?: boolean, maxDepth?: number) { return this.run<ICodebaseMemoryQueryResult<ICodebaseImpactResult>>('impact', [targets, includeTests, includeTransitive, maxDepth]); }
	path(from: string, to: string, relationTypes?: CodebaseMemoryRelationType[], maxDepth?: number) { return this.run<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>('path', [from, to, relationTypes, maxDepth]); }
	relatedTests(targets: string[], limit?: number) { return this.run<ICodebaseMemoryQueryResult<ICodebaseRelationResult[]>>('relatedTests', [targets, limit]); }
	communityLabel(uri: string) { return this.run<string | undefined>('communityLabel', [uri]); }
	pickSeeds(query: string, max?: number) { return this.run<ICodebaseMemoryNode[]>('pickSeeds', [query, max]); }
	override dispose(): void { this.lifetime.dispose(true); super.dispose(); }
}
