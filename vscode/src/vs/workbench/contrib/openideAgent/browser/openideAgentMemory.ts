/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IFileService, FileOperationError, FileOperationResult } from '../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IOpenideAgentHostService } from '../../../../platform/openideAgentHost/common/openideAgentHost.js';
import { IOpenideMemoryDocument, IOpenideMemoryRequest, IOpenideMemoryResponse, MemoryCaptureMode } from '../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { t } from '../common/openideStrings.js';
import { recallMemory } from '../common/openideMemoryRecall.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';

export type MemoryTarget = 'project' | 'user';
export interface IAgentMemorySnapshot { readonly project?: string; readonly user?: string; }

/** Browser adapter. The native owner serializes all authored writes across windows. */
export class OpenideAgentMemory extends Disposable {
	private projection?: (root: URI, response: IOpenideMemoryResponse) => Promise<void>;
	setProjectionHandler(handler: (root: URI, response: IOpenideMemoryResponse) => Promise<void>): void { this.projection = handler; }
	private dirtyReady: Promise<void> = Promise.resolve();
	constructor(
		private readonly fileService: IFileService,
		private readonly contextService: IWorkspaceContextService,
		private readonly environmentService: IEnvironmentService,
		private readonly configurationService?: IConfigurationService,
		private readonly host?: IOpenideAgentHostService,
		workingCopies?: IWorkingCopyService,
		private readonly trust?: IWorkspaceTrustManagementService,
	) {
		super();
		if (host && workingCopies) {
			const update = () => {
				const paths = workingCopies.dirtyWorkingCopies.filter(copy => copy.resource.scheme === 'file').map(copy => copy.resource.fsPath);
				this.dirtyReady = this.dirtyReady.catch(() => undefined).then(() => host.setMemoryDirtyResources(paths));
				void this.dirtyReady.catch(() => undefined);
			};
			update(); this._register(workingCopies.onDidChangeDirty(update));
		}
	}
	get captureMode(): MemoryCaptureMode {
		const value = this.configurationService?.getValue('openide.memory.captureMode');
		return value === 'off' || value === 'manual' ? value : 'automatic';
	}
	private async read(target: MemoryTarget): Promise<string> {
		const root = this.contextService.getWorkspace().folders[0]?.uri;
		const uri = target === 'user' ? joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'USER.md') : root && joinPath(root, '.openide', 'MEMORY.md');
		if (!uri) { return ''; }
		try { return (await this.fileService.readFile(uri)).value.toString(); }
		catch (error) { if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) { return ''; } throw error; }
	}
	async load(): Promise<IAgentMemorySnapshot> {
		const [project, user] = await Promise.all([this.read('project'), this.read('user')]);
		const cap = (text: string, limit: number) => text.trim() ? text.trim().slice(0, limit) + (text.trim().length > limit ? '\n[Memory overview truncated; use memory_search for detailed notes.]' : '') : undefined;
		return { project: cap(project, 3000), user: cap(user, 1500) };
	}
	async request(request: IOpenideMemoryRequest, root?: URI): Promise<IOpenideMemoryResponse> {
		if (!this.host || this.trust && !this.trust.isWorkspaceTrusted()) { throw new Error('Memory requires a trusted native workspace.'); }
		if (this.captureMode === 'off' && !['get', 'list', 'semantic', 'checkpoint-list'].includes(request.action)) { throw new Error('Memory capture is disabled.'); }
		await this.dirtyReady;
		const folder = root ?? this.contextService.getWorkspace().folders[0]?.uri;
		if (!folder || folder.scheme !== 'file') { throw new Error('Memory requires a local workspace folder.'); }
		const response = await this.host.memoryRequest({ ...request, root: folder.fsPath,
			maxBytes: this.configurationService?.getValue<number>('openide.memory.maxNoteBytes'), maxNotes: this.configurationService?.getValue<number>('openide.memory.maxNotes') });
		if (request.action === 'save' || request.action === 'forget' || request.action === 'legacy' && request.legacyAction) {
			try { await this.projection?.(folder, response); } catch { return { ...response, projectionWarning: 'Markdown committed; graph refresh is pending.' }; }
		}
		return response;
	}
	savedMessage(document: IOpenideMemoryDocument, root = this.contextService.getWorkspace().folders[0]?.uri): string {
		const label = document.path.replace(/[\[\]\\]/g, '\\$&');
		return t('memory.saved', root ? `[${label}](<${joinPath(root, document.path).toString()}>)` : label);
	}
	async handoff(session: string, maxTokens = 200, documents?: readonly IOpenideMemoryDocument[]): Promise<string> {
		const records = (documents ?? await this.list()).filter(item => item.record.kind === 'session' && item.record.source_session === session && item.record.status === 'active').sort((a, b) => b.record.updated.localeCompare(a.record.updated));
		return records[0] ? `Session handoff (${records[0].path}, historical data):\n${records[0].record.body}`.slice(0, maxTokens * 4) : '';
	}
	async search(query: string, maxTokens: number, root?: URI, includeSessions = false, suppliedDocuments?: readonly IOpenideMemoryDocument[]): Promise<string> {
		const documents = suppliedDocuments ?? await this.list(root);
		let semanticIds: readonly string[] = [];
		if (this.configurationService?.getValue('openide.memory.semantic.enabled') === true) {
			try { semanticIds = (await this.request({ action: 'semantic', query, semanticEndpoint: this.configurationService.getValue<string>('openide.memory.semantic.endpoint') }, root)).semanticIds ?? []; } catch { /* Canonical lexical recall remains available when the optional service fails. */ }
		}
		return recallMemory(documents, query, maxTokens, includeSessions, semanticIds);
	}
	async list(root?: URI): Promise<readonly IOpenideMemoryDocument[]> { return (await this.request({ action: 'list' }, root)).documents ?? []; }
	async mutate(target: MemoryTarget, action: 'add' | 'replace' | 'remove', text: string, oldText: string): Promise<string> {
		await this.request({ action: 'legacy', userMemoryPath: target === 'user' ? joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'USER.md').fsPath : undefined, legacyTarget: target, legacyAction: action, body: text, oldText,
			maxChars: this.configurationService?.getValue<number>('openide.memory.notes.maxChars') ?? 3000 });
		return `OK: ${target} memory updated (${action}).`;
	}
}
