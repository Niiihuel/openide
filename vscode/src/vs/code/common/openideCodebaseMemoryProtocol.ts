/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — the pure protocol between the renderer and the shared process for codebase memory.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_NOTE_LINKING, NoteLinkingMode } from './openideCodebaseNotes.js';
import { Event } from '../../base/common/event.js';
import { ICodebaseIndexVersion, ICodebaseMemoryEdge, ICodebaseMemoryNode } from './openideCodebaseMemoryTypes.js';
import { IProviderExtraction } from './openideCodebaseMemoryProviders.js';
import { ICodebaseCommunity } from './openideCodebaseCommunities.js';

export interface ICodebaseIndexProgress {
	readonly phase: 'walking' | 'indexing' | 'idle' | 'cancelled';
	readonly processed: number;
	readonly total: number;
	readonly current?: string;
	/** Counters of the last scan ("silence reads as absence"): what was left out, and why. */
	readonly excludedByUser?: number;
	readonly excludedTests?: number;
	readonly skippedTooLarge?: number;
	/** A non-blocking warning (e.g. the new index is drastically smaller than the previous one). */
	readonly warning?: string;
}

/** The indexing options travelling from the renderer — which owns the real configuration, with
 *  the schema's defaults — to the shared process: the shared process's ConfigurationService does
 *  NOT know the openide.memory.* defaults and cannot see the workspace, so it is never asked. */
export interface ICodebaseMemoryIndexOptions {
	readonly exclude: readonly string[];
	readonly include: readonly string[];
	readonly indexTests: boolean;
	readonly enableRegexFallback: boolean;
	readonly persistIndex: boolean;
	/**
	 * Folder the persisted indexes go under, as a file URI string — the IDE's own storage, never
	 * the workspace. The index used to be written to `<workspace>/.openide/memory-indexes/`: 273
	 * JSON files and 74 MB inside the user's repo, untracked in git, listed by the explorer,
	 * matched by search and fed back to every watcher. Absent (an older client) ⇒ the old spot.
	 */
	readonly storageRoot?: string;
	/** Index `.openide/MEMORY.md` into the graph as `note` nodes. */
	readonly indexNotes: boolean;
	/** How hard to try connecting a note to the entities it talks about. */
	readonly noteLinking: NoteLinkingMode;
}

export const DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS: ICodebaseMemoryIndexOptions = Object.freeze({
	exclude: [], include: [], indexTests: true, enableRegexFallback: true, persistIndex: true,
	indexNotes: true, noteLinking: DEFAULT_NOTE_LINKING,
});

export interface ICodebaseMemorySnapshotDto {
	readonly version: ICodebaseIndexVersion;
	readonly nodes: ICodebaseMemoryNode[];
	readonly edges: ICodebaseMemoryEdge[];
	readonly dirtyUris: string[];
	/** Communities at file level (members = URIs); empty until the first full rebuild. */
	readonly communities?: ICodebaseCommunity[];
}

export interface ICodebaseMemoryChange {
	readonly uri: string;
	readonly content?: string;
	readonly deleted?: boolean;
}

export const CODEBASE_MEMORY_MAX_CHANGES = 500;
export const CODEBASE_MEMORY_MAX_CHANGE_BYTES = 500 * 1024;
export const CODEBASE_MEMORY_MAX_EXTRACTION_NODES = 5000;
export const CODEBASE_MEMORY_MAX_EXTRACTION_EDGES = 10000;

/** IServerChannel/ProxyChannel calls these methods remotely. Every operation is isolated by
 * workspaceKey so several windows never share state by accident. */
export interface ICodebaseMemoryChannel {
	initialize(workspaceFolders: string[], trusted: boolean, options?: ICodebaseMemoryIndexOptions): Promise<string>;
	setTrusted(workspaceKey: string, trusted: boolean): Promise<void>;
	setOptions(workspaceKey: string, options: ICodebaseMemoryIndexOptions): Promise<void>;
	onProgress: Event<{ workspaceKey: string; progress: ICodebaseIndexProgress }>;
	onDidChange: Event<{ workspaceKey: string; version: ICodebaseIndexVersion }>;
	addLanguageServerExtraction(workspaceKey: string, uri: string, extraction: IProviderExtraction): Promise<void>;
	rebuildFull(workspaceKey: string): Promise<ICodebaseIndexProgress>;
	indexIncremental(workspaceKey: string, changes: ICodebaseMemoryChange[]): Promise<ICodebaseIndexProgress>;
	getVersion(workspaceKey: string): Promise<ICodebaseIndexVersion | undefined>;
	getSnapshot(workspaceKey: string): Promise<ICodebaseMemorySnapshotDto | undefined>;
	getFileNodes(workspaceKey: string, uri: string): Promise<ICodebaseMemoryNode[]>;
	clear(workspaceKey: string): Promise<void>;
}
