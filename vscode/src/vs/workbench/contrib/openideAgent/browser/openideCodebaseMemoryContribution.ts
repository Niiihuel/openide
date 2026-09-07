/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — contribution for the incremental memory watcher. It is instantiated after the
 *  window is restored so startup is not penalized, and it keeps the index up to date while the
 *  workspace is open.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { OpenideCodebaseMemoryWatcher } from './openideCodebaseMemoryWatcher.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { OpenideCodebaseLanguageServerBridge } from './openideCodebaseLanguageServerBridge.js';
import { IOpenideCodebaseGraph } from './openideCodebaseGraph.js';

class OpenideCodebaseMemoryWatcherContribution extends Disposable implements IWorkbenchContribution {
	private readonly watcher: OpenideCodebaseMemoryWatcher;
	private readonly languageServerBridge: OpenideCodebaseLanguageServerBridge;
	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IConfigurationService configurationService: IConfigurationService,
		@ICodebaseMemoryService memory: ICodebaseMemoryService,
		@IWorkspaceTrustManagementService workspaceTrust: IWorkspaceTrustManagementService,
		@IOpenideCodebaseGraph graph: IOpenideCodebaseGraph,
	) {
		super();
		this.watcher = this._register(new OpenideCodebaseMemoryWatcher(fileService, contextService, configurationService, memory, workspaceTrust));
		this.languageServerBridge = this._register(new OpenideCodebaseLanguageServerBridge(memory, graph, workspaceTrust, configurationService));
		void this.watcher;
		void this.languageServerBridge;
		let generation = 0;
		const rebuildIfNeeded = () => {
			const current = ++generation;
			if (!workspaceTrust.isWorkspaceTrusted() || configurationService.getValue<boolean>('openide.memory.indexOnOpen') === false) { return; }
			void memory.getVersion().then(version => {
				if (current !== generation || !workspaceTrust.isWorkspaceTrusted()) { return; }
				if (!version || version.version === 0 || version.staleCount > 0) { return memory.rebuildFull(); }
				return undefined;
			}).catch(() => undefined);
		};
		this._register({ dispose: () => { generation++; } });
		this._register(workspaceTrust.onDidChangeTrust(() => rebuildIfNeeded()));
		this._register(contextService.onDidChangeWorkspaceFolders(() => rebuildIfNeeded()));
		this._register(configurationService.onDidChangeConfiguration(e => { if (e.affectsConfiguration('openide.memory.indexOnOpen')) { rebuildIfNeeded(); } }));
		rebuildIfNeeded();
	}
}

registerWorkbenchContribution2('openideCodebaseMemoryWatcher', OpenideCodebaseMemoryWatcherContribution, WorkbenchPhase.AfterRestored);
