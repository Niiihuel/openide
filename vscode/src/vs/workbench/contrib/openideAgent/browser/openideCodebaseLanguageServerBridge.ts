/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — puente renderer → shared process para evidencia del language server. Consulta
 *  document symbols in the renderer, where the native providers live, and sends a bounded
 *  extraction to the same canonical index. The regex backend remains the fallback.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IOpenideCodebaseGraph } from './openideCodebaseGraph.js';
import { ICodebaseMemoryNode, makeEvidence, makeNodeId } from '../../../../code/common/openideCodebaseMemoryTypes.js';
import { IProviderExtraction } from '../../../../code/common/openideCodebaseMemoryProviders.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';

/** Files per batch before yielding the event loop. Without this, the sequential sweep saturated
 *  the shared process channel and left any UI getVersion()/getSnapshot() hanging. */
const BATCH_SIZE = 25;
/** Pause between batches: it gives the shared process room to answer interactive queries. */
const BATCH_PAUSE_MS = 50;
/** Cap on files the bridge enriches with language server evidence. The indexer's regex
 *  covers the rest; raising it only adds startup latency. */
const MAX_FILES = 1500;

export class OpenideCodebaseLanguageServerBridge extends Disposable {
	private generation = 0;

	constructor(
		@ICodebaseMemoryService private readonly memory: ICodebaseMemoryService,
		@IOpenideCodebaseGraph private readonly graph: IOpenideCodebaseGraph,
		@IWorkspaceTrustManagementService private readonly trust: IWorkspaceTrustManagementService,
	) {
		super();
		this._register(this.trust.onDidChangeTrust(trusted => { if (trusted) { void this.refresh(); } else { this.generation++; } }));
		if (this.trust.isWorkspaceTrusted()) { void this.refresh(); }
		// On close (window or reload), stop the sweep in progress: otherwise it keeps pushing
		// extractions to the shared process and drowns the new window's initialize.
		this._register({ dispose: () => { this.generation++; } });
	}

	private async refresh(): Promise<void> {
		if (!this.trust.isWorkspaceTrusted()) { return; }
		const generation = ++this.generation;
		const snapshot = await this.memory.getSnapshot().catch(() => undefined);
		if (!snapshot || generation !== this.generation) { return; }
		const files = snapshot.nodes.filter(node => node.kind === 'file').slice(0, MAX_FILES);
		for (let index = 0; index < files.length; index++) {
			if (generation !== this.generation) { return; }
			const file = files[index];
			const outline = await this.graph.outline(file.uri).catch(() => undefined);
			if (outline) {
				const evidence = makeEvidence('documentSymbols');
				const nodes: ICodebaseMemoryNode[] = outline.symbols.slice(0, 1000).map(symbol => {
					const kind = symbol.kind;
					const id = makeNodeId(snapshot.version.workspaceKey, file.uri, kind, symbol.name, symbol.startLine);
					return { id, kind, name: symbol.name, qualifiedName: symbol.name, uri: file.uri, range: { startLine: symbol.startLine, startColumn: 0, endLine: symbol.endLine, endColumn: 0 }, evidence, degree: 0 };
				});
				const extraction: IProviderExtraction = {
					nodes,
					edges: nodes.map(node => ({ source: file.id, target: node.id, type: 'CONTAINS', evidence })),
				};
				await this.memory.addLanguageServerExtraction(file.uri, extraction).catch(() => undefined);
			}
			// Yield the event loop every batch: this sweep is background work and must never
			// leave an interactive query from the editor or the agent unanswered.
			if ((index + 1) % BATCH_SIZE === 0) { await timeout(BATCH_PAUSE_MS); }
		}
	}
}
