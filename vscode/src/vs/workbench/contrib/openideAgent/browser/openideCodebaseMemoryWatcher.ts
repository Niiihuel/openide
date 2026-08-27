/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — incremental watcher for the memory index. It debounces bursts of changes and sends
 *  only affected files to the shared process. The editor/agent never triggers a full rebuild
 *  because of a normal edit.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, FileChangeType } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { CODEBASE_NOTES_PATH } from '../../../../code/common/openideCodebaseNotes.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';

const DEBOUNCE_MS = 250;
const WATCH_EXCLUDES = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/build/**', '**/target/**', '**/vendor/**', '**/coverage/**', '**/.venv/**', '**/venv/**', '**/bin/**', '**/obj/**', '**/.openide/memory-indexes/**'];

export class OpenideCodebaseMemoryWatcher extends Disposable {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly watchDisposables = this._register(new DisposableStore());
	private readonly pending = new Map<string, { uri: URI; type: FileChangeType }>();
	private started = false;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICodebaseMemoryService private readonly memory: ICodebaseMemoryService,
		@IWorkspaceTrustManagementService private readonly workspaceTrust: IWorkspaceTrustManagementService,
	) {
		super();
		if (this.workspaceTrust.isWorkspaceTrusted()) { this.start(); }
		this._register(this.workspaceTrust.onDidChangeTrust(trusted => { if (trusted) { this.start(); } else { this.started = false; this.pending.clear(); this.watchDisposables.clear(); if (this.timer) { clearTimeout(this.timer); this.timer = undefined; } } }));
	}

	private start(): void {
		if (this.started || this.configurationService.getValue<boolean>('openide.memory.incrementalIndexing') === false) { return; }
		this.started = true;
		this.watchDisposables.clear();
		for (const folder of this.contextService.getWorkspace().folders) {
			this.watchDisposables.add(this.fileService.watch(folder.uri, { recursive: true, excludes: WATCH_EXCLUDES }));
		}
		this.watchDisposables.add(this.fileService.onDidFilesChange(event => {
			for (const uri of event.rawAdded) { this.queue(uri, FileChangeType.ADDED); }
			for (const uri of event.rawUpdated) { this.queue(uri, FileChangeType.UPDATED); }
			for (const uri of event.rawDeleted) { this.queue(uri, FileChangeType.DELETED); }
		}));
		this.watchDisposables.add(this.contextService.onDidChangeWorkspaceFolders(() => {
			this.started = false;
			this.pending.clear();
			this.start();
		}));
	}

	private queue(uri: URI, type: FileChangeType): void {
		if (!this.shouldIndex(uri)) { return; }
		this.pending.set(uri.toString(), { uri, type });
		if (this.timer) { clearTimeout(this.timer); }
		this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, DEBOUNCE_MS);
	}

	private shouldIndex(uri: URI): boolean {
		const path = uri.path;
		const insideWorkspace = this.contextService.getWorkspace().folders.some(folder => uri.scheme === folder.uri.scheme && (path === folder.uri.path || path.startsWith(folder.uri.path.endsWith('/') ? folder.uri.path : folder.uri.path + '/')));
		if (!insideWorkspace) { return false; }
		// The shared memory is a source like any other, and it is the one that changes while the
		// user is watching: an agent writes a fact and the next query has to see it. Without this
		// the note would sit unindexed until the next full rebuild, which is the difference
		// between shared memory and a file nobody reads.
		if (path.endsWith(`/${CODEBASE_NOTES_PATH}`)) { return true; }
		const baseOk = !['/node_modules/', '/.git/', '/dist/', '/out/', '/build/', '/target/', '/vendor/', '/coverage/', '/.venv/', '/venv/', '/bin/', '/obj/', '/.openide/memory-indexes/'].some(excluded => path.includes(excluded)) && (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|c|h|cpp|hpp|cc)$/.test(path) || path.endsWith('/package.json'));
		if (!baseOk) { return false; }
		// Cheap prefilter using the user's settings: the shared process revalidates anyway
		// (indexOne purges what is ineligible), this only saves IPC. Folder patterns → substring.
		const exclude = this.configurationService.getValue<string[]>('openide.memory.exclude');
		if (Array.isArray(exclude) && exclude.some(pattern => typeof pattern === 'string' && !/[*?{}[\]]/.test(pattern) && pattern.trim() && path.includes('/' + pattern.replace(/^\/+|\/+$/g, '') + '/'))) { return false; }
		if (this.configurationService.getValue('openide.memory.indexTests') === false && /(\.|_)(test|spec)\.[jt]sx?$|_test\.(go|py|rs)$|test_[^/]+\.py$|Tests?\.(cs|java|kt)$/.test(path)) { return false; }
		return true;
	}

	private async flush(): Promise<void> {
		const batch = [...this.pending.values()];
		this.pending.clear();
		if (!batch.length) { return; }
		const changes = await Promise.all(batch.map(async change => {
			if (change.type === FileChangeType.DELETED) { return { uri: change.uri.toString(), deleted: true }; }
			try { return { uri: change.uri.toString(), content: (await this.fileService.readFile(change.uri)).value.toString() }; } catch { return { uri: change.uri.toString(), deleted: true }; }
		}));
		await this.memory.indexIncremental(changes);
	}
}
