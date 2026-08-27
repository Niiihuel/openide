/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — protocolo puro entre el renderer y el shared process para memoria del codebase.
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
	/** Contadores del último scan ("el silencio se lee como ausencia"): qué quedó afuera y por qué. */
	readonly excludedByUser?: number;
	readonly excludedTests?: number;
	readonly skippedTooLarge?: number;
	/** Advertencia no bloqueante (ej. el índice nuevo es drásticamente más chico que el previo). */
	readonly warning?: string;
}

/** Opciones de indexado que viajan del renderer (dueño de la configuración real, con defaults
 *  del schema) al shared process — el ConfigurationService del shared process NO conoce los
 *  defaults de openide.memory.* y no ve el workspace, así que nunca se consulta allá. */
export interface ICodebaseMemoryIndexOptions {
	readonly exclude: readonly string[];
	readonly include: readonly string[];
	readonly indexTests: boolean;
	readonly enableRegexFallback: boolean;
	readonly persistIndex: boolean;
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
	/** Comunidades a nivel archivo (members = URIs); vacío hasta el primer rebuild completo. */
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

/** IServerChannel/ProxyChannel usa estos métodos de forma remota. Todas las operaciones están
 * aisladas por workspaceKey para que varias ventanas no compartan estado accidentalmente. */
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
