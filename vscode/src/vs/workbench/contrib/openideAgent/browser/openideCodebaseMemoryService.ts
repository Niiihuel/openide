/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — renderer facade for the codebase memory service. It consumes the shared process
 *  channel and keeps only bounded caches/snapshots for the UI and the agent.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../base/common/resources.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenideNativeServices } from '../common/openideNativeServices.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ICodebaseMemoryChannel, ICodebaseMemoryIndexOptions, ICodebaseMemorySnapshotDto, ICodebaseIndexProgress, ICodebaseMemoryChange } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryProtocol.js';
import { ICodebaseIndexVersion, ICodebaseMemoryNode } from '../../../../platform/openideCodebase/common/openideCodebaseMemoryTypes.js';
import { CODEBASE_NOTES_ENABLED_SETTING, CODEBASE_NOTES_LINKING_SETTING, noteLinkingFromSetting } from '../../../../platform/openideCodebase/common/openideCodebaseNotes.js';
import { t } from '../common/openideStrings.js';

export const ICodebaseMemoryService = createDecorator<ICodebaseMemoryService>('openideCodebaseMemoryService');

/** Ceiling for the shared process handshake before reporting the index as down. */
const INITIALIZE_TIMEOUT_MS = 20_000;

export interface ICodebaseMemoryService {
	readonly _serviceBrand: undefined;
	readonly onProgress: Event<{ phase: ICodebaseIndexProgress['phase']; processed: number; total: number; current?: string }>;
	readonly onDidChange: Event<ICodebaseIndexVersion>;
	rebuildFull(): Promise<IIndexProgressResult>;
	indexIncremental(changes: ICodebaseMemoryChange[]): Promise<IIndexProgressResult>;
	getVersion(): Promise<ICodebaseIndexVersion | undefined>;
	getSnapshot(): Promise<ICodebaseMemorySnapshotDto | undefined>;
	getFileNodes(uri: string): Promise<ICodebaseMemoryNode[]>;
	addLanguageServerExtraction(uri: string, extraction: import('../../../../platform/openideCodebase/common/openideCodebaseMemoryProviders.js').IProviderExtraction): Promise<void>;
	clear(): Promise<void>;
	/** Counters from the last full rebuild (what was left out of the scan, and why). */
	getLastScanCounters(): { excludedByUser: number; excludedTests: number; skippedTooLarge: number } | undefined;
}

export interface IIndexProgressResult {
	readonly phase: ICodebaseIndexProgress['phase'];
	readonly processed: number;
	readonly total: number;
	readonly current?: string;
	readonly excludedByUser?: number;
	readonly excludedTests?: number;
	readonly skippedTooLarge?: number;
	readonly warning?: string;
}

export class CodebaseMemoryService extends Disposable implements ICodebaseMemoryService {
	declare readonly _serviceBrand: undefined;

	private readonly _onProgress = this._register(new Emitter<IIndexProgressResult>());
	readonly onProgress = this._onProgress.event;
	private readonly _onDidChange = this._register(new Emitter<ICodebaseIndexVersion>());
	readonly onDidChange = this._onDidChange.event;
	// Assigned in the constructor via setWorkspaceKeyPromise (which also avoids unhandled rejections).
	private workspaceKeyPromise!: Promise<string>;
	private readonly remote: ICodebaseMemoryChannel;
	private workspaceFolders: string[];
	private snapshotGeneration = 0;
	private snapshotLoad: { generation: number; promise: Promise<ICodebaseMemorySnapshotDto | undefined> } | undefined;
	private snapshotCache: { workspaceKey: string; version: number; snapshot: ICodebaseMemorySnapshotDto } | undefined;
	private lastScanCounters: { excludedByUser: number; excludedTests: number; skippedTooLarge: number } | undefined;


	constructor(
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IOpenideNativeServices nativeServices: IOpenideNativeServices,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly workspaceTrust: IWorkspaceTrustManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.remote = nativeServices.codebase;
		const folders = contextService.getWorkspace().folders.map(folder => folder.uri.toString());
		this.workspaceFolders = folders;
		this.setWorkspaceKeyPromise(this.initialize(folders));
		this._register(contextService.onDidChangeWorkspaceFolders(() => {
			this.workspaceFolders = contextService.getWorkspace().folders.map(folder => folder.uri.toString());
			this.setWorkspaceKeyPromise(this.initialize(this.workspaceFolders));
			this.invalidateSnapshot();

			this._onDidChange.fire({ version: 0, workspaceKey: this.workspaceFolders.join('|'), builtAt: Date.now(), staleCount: 0, nodeCount: 0, edgeCount: 0 });
		}));
		this._register(this.workspaceTrust.onDidChangeTrust(trusted => {
			this.invalidateSnapshot();
			if (trusted) { this.setWorkspaceKeyPromise(this.initialize(this.workspaceFolders)); }
			void this.workspaceKeyPromise.then(key => this.remote.setTrusted(key, trusted)).catch(() => undefined);
			this._onDidChange.fire({ version: 0, workspaceKey: this.workspaceFolders.join('|'), builtAt: Date.now(), staleCount: 0, nodeCount: 0, edgeCount: 0 });
		}));
		this._register(this.remote.onProgress((event: { workspaceKey: string; progress: ICodebaseIndexProgress }) => {
			void this.workspaceKeyPromise.then(key => { if (key === event.workspaceKey) { this._onProgress.fire(event.progress); } }, () => undefined);
		}));
		this._register(this.remote.onDidChange((event: { workspaceKey: string; version: ICodebaseIndexVersion }) => {
			void this.workspaceKeyPromise.then(key => {
				if (key === event.workspaceKey) { this.invalidateSnapshot(); this._onDidChange.fire(event.version); }
			}, () => undefined);
		}));
		// Indexing options live in the renderer's config (the shared process does not know the
		// schema defaults). Changes that alter the file set force a rebuild.
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			const affectsFileSet = ['openide.memory.exclude', 'openide.memory.include', 'openide.memory.indexTests', 'openide.memory.enableRegexFallback', 'openide.memory.persistIndex', CODEBASE_NOTES_ENABLED_SETTING, CODEBASE_NOTES_LINKING_SETTING].some(key => e.affectsConfiguration(key));
			if (!affectsFileSet) { return; }
			this.invalidateSnapshot();
			this._onDidChange.fire({ version: 0, workspaceKey: this.workspaceFolders.join('|'), builtAt: Date.now(), staleCount: 0, nodeCount: 0, edgeCount: 0 });
			void this.workspaceKeyPromise
				.then(key => this.remote.setOptions(key, this.indexOptions()))
				.then(() => this.rebuildFull())
				.catch(() => undefined);
		}));
	}

	/** Stores the promise while preventing a rejection from becoming unhandled (the real consumer
	 *  awaits it again in `key()`, which also retries). */
	private setWorkspaceKeyPromise(promise: Promise<string>): void {
		this.workspaceKeyPromise = promise;
		promise.catch(() => undefined);
	}

	private indexOptions(): ICodebaseMemoryIndexOptions {
		const list = (key: string): string[] => {
			const raw = this.configurationService.getValue(key);
			return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string' && !!value.trim()) : [];
		};
		return {
			exclude: list('openide.memory.exclude'),
			include: list('openide.memory.include'),
			indexTests: this.configurationService.getValue('openide.memory.indexTests') !== false,
			enableRegexFallback: this.configurationService.getValue('openide.memory.enableRegexFallback') !== false,
			persistIndex: this.configurationService.getValue('openide.memory.persistIndex') !== false,
			// The IDE's own storage, so the index never sits in the user's repo.
			storageRoot: joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'memory-indexes').toString(),
			indexNotes: this.configurationService.getValue(CODEBASE_NOTES_ENABLED_SETTING) !== false,
			noteLinking: noteLinkingFromSetting(this.configurationService.getValue(CODEBASE_NOTES_LINKING_SETTING)),
		};
	}

	/** The shared process channel uses `getDelayedChannel`, which queues without limit: if the
	 *  process is saturated or down, the promise stays PENDING forever and the whole UI hangs
	 *  silently. The timeout turns that case into a visible, retryable error. */
	private async initialize(folders: string[]): Promise<string> {
		const key = await raceTimeout(
			this.remote.initialize(folders, this.workspaceTrust.isWorkspaceTrusted(), this.indexOptions()),
			INITIALIZE_TIMEOUT_MS,
		);
		if (key === undefined) {
			throw new Error(t('service.projectMap.initTimeout', t('settings.projectMap.rebuild')));
		}
		return key;
	}

	private async key(): Promise<string> {
		try {
			return await this.workspaceKeyPromise;
		} catch (error) {
			// A cached rejection would leave the Project Map dead until the window restarted:
			// it is discarded and the next access tries again.
			this.workspaceKeyPromise = this.initialize(this.workspaceFolders);
			this.workspaceKeyPromise.catch(() => undefined);
			throw error;
		}
	}
	async rebuildFull(): Promise<IIndexProgressResult> {
		const result = await this.remote.rebuildFull(await this.key());
		if (result.phase === 'idle') {
			this.lastScanCounters = { excludedByUser: result.excludedByUser ?? 0, excludedTests: result.excludedTests ?? 0, skippedTooLarge: result.skippedTooLarge ?? 0 };
		}
		return result;
	}
	getLastScanCounters() { return this.lastScanCounters ? { ...this.lastScanCounters } : undefined; }
	async indexIncremental(changes: ICodebaseMemoryChange[]): Promise<IIndexProgressResult> { return this.remote.indexIncremental(await this.key(), changes); }
	async getVersion(): Promise<ICodebaseIndexVersion | undefined> { return this.remote.getVersion(await this.key()); }
	async getFileNodes(uri: string): Promise<ICodebaseMemoryNode[]> { return this.remote.getFileNodes(await this.key(), uri); }
	async addLanguageServerExtraction(uri: string, extraction: import('../../../../platform/openideCodebase/common/openideCodebaseMemoryProviders.js').IProviderExtraction): Promise<void> { await this.remote.addLanguageServerExtraction(await this.key(), uri, extraction); }
	async clear(): Promise<void> { this.invalidateSnapshot();  await this.remote.clear(await this.key()); this._onDidChange.fire({ version: 0, workspaceKey: await this.key(), builtAt: Date.now(), staleCount: 0, nodeCount: 0, edgeCount: 0 }); }

	private invalidateSnapshot(): void {
		this.snapshotGeneration++;
		this.snapshotCache = undefined;
		this.snapshotLoad = undefined;
	}

	getSnapshot(): Promise<ICodebaseMemorySnapshotDto | undefined> {
		if (!this.workspaceTrust.isWorkspaceTrusted()) { return Promise.resolve(undefined); }
		if (this.snapshotCache) { return Promise.resolve(this.snapshotCache.snapshot); }
		if (this.snapshotLoad?.generation === this.snapshotGeneration) { return this.snapshotLoad.promise; }
		const generation = this.snapshotGeneration;
		const promise = this.loadSnapshot(generation).finally(() => {
			if (this.snapshotLoad?.promise === promise) { this.snapshotLoad = undefined; }
		});
		this.snapshotLoad = { generation, promise };
		return promise;
	}

	private async loadSnapshot(generation: number): Promise<ICodebaseMemorySnapshotDto | undefined> {
		const key = await this.key();
		if (generation !== this.snapshotGeneration) { return this.getSnapshot(); }
		const snapshot = await this.remote.getSnapshot(key);
		if (generation !== this.snapshotGeneration) { return this.getSnapshot(); }
		if (snapshot) {
			this.snapshotCache = { workspaceKey: key, version: snapshot.version.version, snapshot };
		}
		return snapshot;
	}
}
