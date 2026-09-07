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
import { CODEBASE_MEMORY_MAX_CHANGES, CODEBASE_MEMORY_MAX_CHANGE_BYTES, ICodebaseMemoryChange } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, FileChangeType, FileOperationError, FileOperationResult } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { isCodebaseNotesUri } from '../../../../platform/openideCodebase/common/openideCodebaseNotes.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';

const DEBOUNCE_MS = 250;
const WATCH_EXCLUDES = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/build/**', '**/target/**', '**/vendor/**', '**/coverage/**', '**/.venv/**', '**/venv/**', '**/bin/**', '**/obj/**', '**/.openide/memory-indexes/**'];

export class OpenideCodebaseMemoryWatcher extends Disposable {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly watchDisposables = this._register(new DisposableStore());
	private readonly pending = new Map<string, { uri: URI; type: FileChangeType }>();
	private started = false;
	private generation = 0;
	private draining: Promise<void> | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICodebaseMemoryService private readonly memory: ICodebaseMemoryService,
		@IWorkspaceTrustManagementService private readonly workspaceTrust: IWorkspaceTrustManagementService,
	) {
		super();
		this._register(this.workspaceTrust.onDidChangeTrust(() => this.restart()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('openide.memory.incrementalIndexing')) { this.restart(); }
		}));
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.restart()));
		this.restart();
	}

	private stop(): void {
		this.started = false;
		this.generation++;
		this.pending.clear();
		this.watchDisposables.clear();
		if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
	}

	override dispose(): void { this.stop(); super.dispose(); }

	private restart(): void {
		this.stop();
		if (!this.workspaceTrust.isWorkspaceTrusted() || this.configurationService.getValue<boolean>('openide.memory.incrementalIndexing') === false) { return; }
		this.started = true;
		// IFileService only supports correlated watchers for non-recursive watches.
		for (const folder of this.contextService.getWorkspace().folders) {
			this.watchDisposables.add(this.fileService.watch(folder.uri, { recursive: true, excludes: WATCH_EXCLUDES }));
		}
		this.watchDisposables.add(this.fileService.onDidFilesChange(event => {
			for (const uri of event.rawAdded) { this.queue(uri, FileChangeType.ADDED); }
			for (const uri of event.rawUpdated) { this.queue(uri, FileChangeType.UPDATED); }
			for (const uri of event.rawDeleted) { this.queue(uri, FileChangeType.DELETED); }
		}));
	}

	private schedule(delay = DEBOUNCE_MS): void {
		if (!this.started || this.timer || this.draining) { return; }
		this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
	}

	private queue(uri: URI, type: FileChangeType): void {
		if (!this.started || !this.shouldIndex(uri)) { return; }
		// Object identity is the revision: an event arriving during IO must survive its predecessor.
		this.pending.set(uri.toString(), { uri, type });
		this.schedule();
	}

	private shouldIndex(uri: URI): boolean {
		const path = uri.path;
		const insideWorkspace = this.contextService.getWorkspace().folders.some(folder => uri.scheme === folder.uri.scheme && uri.authority === folder.uri.authority && (path === folder.uri.path || path.startsWith(folder.uri.path.endsWith('/') ? folder.uri.path : folder.uri.path + '/')));
		if (!insideWorkspace) { return false; }
		// The shared memory is a source like any other, and it is the one that changes while the
		// user is watching: an agent writes a fact and the next query has to see it. Without this
		// the note would sit unindexed until the next full rebuild, which is the difference
		// between shared memory and a file nobody reads.
		if (isCodebaseNotesUri(path)) { return true; }
		const baseOk = !['/node_modules/', '/.git/', '/dist/', '/out/', '/build/', '/target/', '/vendor/', '/coverage/', '/.venv/', '/venv/', '/bin/', '/obj/', '/.openide/memory-indexes/'].some(excluded => path.includes(excluded)) && (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|c|h|cpp|hpp|cc)$/.test(path) || path.endsWith('/package.json'));
		if (!baseOk) { return false; }
		// Cheap prefilter using the user's settings: the shared process revalidates anyway
		// (indexOne purges what is ineligible), this only saves IPC. Folder patterns → substring.
		const exclude = this.configurationService.getValue<string[]>('openide.memory.exclude');
		if (Array.isArray(exclude) && exclude.some(pattern => typeof pattern === 'string' && !/[*?{}[\]]/.test(pattern) && pattern.trim() && path.includes('/' + pattern.replace(/^\/+|\/+$/g, '') + '/'))) { return false; }
		if (this.configurationService.getValue('openide.memory.indexTests') === false && /(\.|_)(test|spec)\.[jt]sx?$|_test\.(go|py|rs)$|test_[^/]+\.py$|Tests?\.(cs|java|kt)$/.test(path)) { return false; }
		return true;
	}

	private flush(): Promise<void> {
		if (this.draining) { return this.draining; }
		const generation = this.generation;
		this.draining = this.drain(generation).finally(() => {
			this.draining = undefined;
			if (this.pending.size) { this.schedule(1000); }
		});
		return this.draining;
	}

	private async drain(generation: number): Promise<void> {
		const attempted = new Set<object>();
		while (this.started && generation === this.generation && this.pending.size) {
			const batch = [...this.pending.values()].filter(revision => !attempted.has(revision)).slice(0, CODEBASE_MEMORY_MAX_CHANGES);
			if (!batch.length) { return; }
			for (const revision of batch) { attempted.add(revision); }
			const prepared: { revision: typeof batch[number]; change: ICodebaseMemoryChange; bytes: number }[] = [];
			// At most eight reads and eight MiB of unacknowledged content at a time.
			for (let offset = 0; offset < batch.length; offset += 8) {
				await Promise.all(batch.slice(offset, offset + 8).map(async revision => {
					try {
						let change: ICodebaseMemoryChange = { uri: revision.uri.toString(), deleted: true };
						let bytes = 0;
						if (revision.type !== FileChangeType.DELETED) {
							const stat = await this.fileService.stat(revision.uri);
							if (stat.size <= CODEBASE_MEMORY_MAX_CHANGE_BYTES && !stat.isDirectory) {
								const buffer = (await this.fileService.readFile(revision.uri, { limits: { size: CODEBASE_MEMORY_MAX_CHANGE_BYTES } })).value;
								bytes = buffer.byteLength;
								if (bytes <= CODEBASE_MEMORY_MAX_CHANGE_BYTES) { change = { uri: revision.uri.toString(), content: buffer.toString() }; }
							}
						}
						prepared.push({ revision, change, bytes });
					} catch (error) {
						if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
							prepared.push({ revision, change: { uri: revision.uri.toString(), deleted: true }, bytes: 0 });
						} // Other read failures remain queued while unrelated files can progress.
					}
				}));
				if (!this.started || generation !== this.generation) { return; }
				if (prepared.length && (prepared.reduce((total, item) => total + item.bytes, 0) >= 4 * 1024 * 1024 || offset + 8 >= batch.length)) {
					try {
						const result = await this.memory.indexIncremental(prepared.map(item => item.change));
						if (result.phase === 'cancelled' || result.processed !== prepared.length) { return; }
						for (const item of prepared) {
							if (this.pending.get(item.change.uri) === item.revision) { this.pending.delete(item.change.uri); }
						}
						prepared.length = 0;
					} catch { return; } // Keep revisions for a bounded retry, never lose a rejected batch.
				}
			}
		}
	}
}
