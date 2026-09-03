/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — persistent storage of the codebase-memory index. Per workspace, sharded by file
 *  (one JSON per hashed uri) plus a manifest with the hashes and the version. It supports schema
 *  migrations, restoring by marking everything stale, compaction and statistics.
 *
 *  It lives in the shared process (node). It never reaches the renderer or the language server.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import * as crypto from 'crypto';
import { ICodebaseIndexVersion, ICodebaseIndexedFile, ICodebaseMemoryEdge, ICodebaseMemoryNode } from '../../../common/openideCodebaseMemoryTypes.js';
import { ICodebaseCommunity } from '../../../common/openideCodebaseCommunities.js';


const SCHEMA_VERSION = 1;

interface IStoredManifest {
	readonly schema: number;
	readonly workspaceKey: string;
	readonly version: ICodebaseIndexVersion;
	readonly files: Record<string, ICodebaseIndexedFile>;
	/** Communities (modules) at file level — members = URIs. Optional (backwards-compatible schema). */
	readonly communities?: ICodebaseCommunity[];
	/** A synthetic import node → the real `file` node it refers to (resolved in finalizeGraph). */
	readonly nodeAliases?: Record<string, string>;
	/**
	 * The `version.version` finalizeGraph last ran against. Without it an index could be COMPLETE
	 * (every file `indexed`, staleCount 0) yet unfinalized, and nothing would notice: the manifest
	 * looked healthy, the rebuild only fires at version 0, and the map stayed at 0 relations
	 * forever. Comparing against `version.version` makes "not finalized" and "out of date" the same
	 * observable state — and therefore a repairable one.
	 */
	readonly graphVersion?: number;
}

interface IStoredFilePayload {
	readonly uri: string;
	readonly nodes: ICodebaseMemoryNode[];
	readonly edges: ICodebaseMemoryEdge[];
}

/** Hashes a string into a short stable id (for index file names). */
function hashString(s: string): string {
	return crypto.createHash('sha256').update(s).digest('hex');
}

export interface ICodebaseMemoryStorageStats {
	readonly manifestBytes: number;
	readonly fileCount: number;
	readonly nodeCount: number;
	readonly edgeCount: number;
}

export class CodebaseMemoryStorage extends Disposable {

	private manifest: IStoredManifest | undefined;
	private readonly fileCache = new Map<string, IStoredFilePayload>();
	/** With persist=false the index lives in RAM alone: manifest + fileCache, disk untouched. */
	private persist = true;

	constructor(
		private readonly fileService: IFileService,
		private readonly indexRoot: URI,
	) {
		super();
	}

	/** Turning persistence off also deletes what was already written (the privacy expectation);
	 *  turning it back on needs a rebuild to materialize the state on disk. */
	async setPersist(value: boolean): Promise<void> {
		if (this.persist === value) { return; }
		this.persist = value;
		if (!value) { await this.fileService.del(this.indexRoot, { recursive: true }).catch(() => { }); }
	}

	isPersisting(): boolean { return this.persist; }

	private manifestUri(): URI { return joinPath(this.indexRoot, 'manifest.json'); }
	private fileUri(hash: string): URI { return joinPath(this.indexRoot, 'files', `${hash}.json`); }

	/** Loads the manifest. Missing or corrupt, it starts clean. */
	async load(workspaceKey: string): Promise<IStoredManifest> {
		if (this.manifest && this.manifest.workspaceKey === workspaceKey) { return this.manifest; }
		if (!this.persist) {
			// Memory mode: never read from disk — every session starts with an empty index.
			this.manifest = { schema: SCHEMA_VERSION, workspaceKey, version: { version: 0, workspaceKey, builtAt: 0, staleCount: 0, nodeCount: 0, edgeCount: 0 }, files: {} };
			this.fileCache.clear();
			return this.manifest;
		}
		try {
			const raw = (await this.fileService.readFile(this.manifestUri())).value.toString();
			const parsed = JSON.parse(raw) as IStoredManifest;
			const validFiles = !!parsed?.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files) && Object.values(parsed.files).every(file => !!file && typeof file.uri === 'string' && typeof file.hash === 'string' && typeof file.language === 'string' && typeof file.nodeCount === 'number' && (file.status === 'indexed' || file.status === 'stale' || file.status === 'error'));
			const valid = !!parsed && parsed.schema === SCHEMA_VERSION && parsed.workspaceKey === workspaceKey && !!parsed.version && typeof parsed.version.version === 'number' && typeof parsed.version.nodeCount === 'number' && typeof parsed.version.edgeCount === 'number' && validFiles;
			if (!valid) {
				// a migration or a different workspace: start clean (the indexer will rebuild)
				this.manifest = { schema: SCHEMA_VERSION, workspaceKey, version: { version: 0, workspaceKey, builtAt: 0, staleCount: 0, nodeCount: 0, edgeCount: 0 }, files: {} };
			} else {
				this.manifest = parsed;
			}
		} catch {
			this.manifest = { schema: SCHEMA_VERSION, workspaceKey, version: { version: 0, workspaceKey, builtAt: 0, staleCount: 0, nodeCount: 0, edgeCount: 0 }, files: {} };
		}
		this.fileCache.clear();
		return this.manifest;
	}

	/** Marks every file stale on restore (the hash validation confirms them one by one). */
	markAllStale(): void {
		if (!this.manifest) { return; }
		const files: Record<string, ICodebaseIndexedFile> = {};
		for (const [uri, info] of Object.entries(this.manifest.files)) {
			files[uri] = { ...info, status: 'stale' };
		}
		this.manifest = { ...this.manifest, files, version: { ...this.manifest.version, staleCount: Object.values(files).filter(file => file.status === 'stale').length } };
	}

	getFileMeta(uri: string): ICodebaseIndexedFile | undefined { return this.manifest?.files[uri]; }

	/** Reads an indexed file's payload. Cached in memory. */
	async readFile(uri: string): Promise<IStoredFilePayload | undefined> {
		const cached = this.fileCache.get(uri);
		if (cached) { return cached; }
		const meta = this.manifest?.files[uri];
		if (!meta) { return undefined; }
		if (!this.persist) { return undefined; } // memoria pura: si no está en cache, no existe
		try {
			const raw = (await this.fileService.readFile(this.fileUri(hashString(uri)))).value.toString();
				const payload = JSON.parse(raw) as IStoredFilePayload;
			if (!payload || payload.uri !== uri || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) { return undefined; }
			this.fileCache.set(uri, payload);
			return payload;
		} catch { return undefined; }
	}

	/** Writes a file's payload and updates its hash and state in the manifest. */
	async writeFile(uri: string, hash: string, language: string, payload: IStoredFilePayload): Promise<void> {
		if (!this.manifest) { return; }
		if (this.manifest.workspaceKey === 'empty') { return; }
		const previousPayload = await this.readFile(uri);
		const prev = this.manifest.files[uri];
		if (this.persist) {
			await this.fileService.createFolder(this.indexRoot).catch(() => { });
			await this.fileService.createFolder(joinPath(this.indexRoot, 'files')).catch(() => { });
			await this.fileService.writeFile(this.fileUri(hashString(uri)), VSBuffer.fromString(JSON.stringify(payload)));
		}
		this.fileCache.set(uri, payload);
		const nodeCount = payload.nodes.length;
		const files = { ...this.manifest.files, [uri]: { uri, hash, language, indexedAt: Date.now(), nodeCount, status: 'indexed' as const } };
		const deltaNodes = nodeCount - (prev?.nodeCount ?? 0);
		this.manifest = {
			...this.manifest,
			files,
			version: {
				...this.manifest.version,
				version: this.manifest.version.version + 1,
				builtAt: Date.now(),
				staleCount: Object.values(files).filter(file => file.status === 'stale').length,
				nodeCount: this.manifest.version.nodeCount + deltaNodes,
				edgeCount: this.manifest.version.edgeCount + payload.edges.length - (previousPayload?.edges.length ?? 0),
			},
		};
	}


	/** Removes a file from the index (the file was deleted from the workspace). */
	async removeFile(uri: string): Promise<void> {
		if (!this.manifest || !this.manifest.files[uri]) { return; }
		const prev = await this.readFile(uri).catch(() => undefined);
		const files = { ...this.manifest.files };
		delete files[uri];
		this.manifest = {
			...this.manifest,
			files,
			version: {
				...this.manifest.version,
				version: this.manifest.version.version + 1,
				builtAt: Date.now(),
				staleCount: Object.values(files).filter(file => file.status === 'stale').length,
				nodeCount: Math.max(0, this.manifest.version.nodeCount - (prev?.nodes.length ?? 0)),
				edgeCount: Math.max(0, this.manifest.version.edgeCount - (prev?.edges.length ?? 0)),
			},
		};
		this.fileCache.delete(uri);
		if (this.persist) { await this.fileService.del(this.fileUri(hashString(uri))).catch(() => { }); }
	}

	async pruneStale(): Promise<void> {
		if (!this.manifest) { return; }
		for (const uri of Object.keys(this.manifest.files)) {
			if (this.manifest.files[uri].status === 'stale') { await this.removeFile(uri); }
		}
	}

	/** Marks a uri stale (it changed on disk but has not been reindexed yet). */
	markStale(uri: string): void {
		if (!this.manifest?.files[uri]) { return; }
		const files = { ...this.manifest.files };
		files[uri] = { ...files[uri], status: 'stale' };
		this.manifest = { ...this.manifest, files, version: { ...this.manifest.version, staleCount: Object.values(files).filter(file => file.status === 'stale').length } };
	}

	getManifest(): IStoredManifest | undefined { return this.manifest; }
	getVersion(): ICodebaseIndexVersion | undefined { return this.manifest?.version; }
	getCommunities(): ICodebaseCommunity[] { return Array.isArray(this.manifest?.communities) ? this.manifest.communities : []; }
	setCommunities(communities: ICodebaseCommunity[]): void {
		if (!this.manifest) { return; }
		this.manifest = { ...this.manifest, communities };
	}

	getNodeAliases(): Record<string, string> { return this.manifest?.nodeAliases ?? {}; }
	setNodeAliases(nodeAliases: Record<string, string>): void {
		if (!this.manifest) { return; }
		this.manifest = { ...this.manifest, nodeAliases };
	}

	/** true when the derived graph (aliases + communities) matches the current index. */
	isGraphFinalized(): boolean {
		return !!this.manifest && this.manifest.graphVersion === this.manifest.version.version;
	}

	/** Seals the derived graph against the index's current version. finalizeGraph calls it when it
	 *  finishes; any later writeFile/removeFile bumps `version` and invalidates it on its own. */
	markGraphFinalized(): void {
		if (!this.manifest) { return; }
		this.manifest = { ...this.manifest, graphVersion: this.manifest.version.version };
	}
	getStats(): ICodebaseMemoryStorageStats {
		const m = this.manifest;
		if (!m) { return { manifestBytes: 0, fileCount: 0, nodeCount: 0, edgeCount: 0 }; }
		return { manifestBytes: JSON.stringify(m).length, fileCount: Object.keys(m.files).length, nodeCount: m.version.nodeCount, edgeCount: m.version.edgeCount };
	}

	/** Persiste el manifiesto a disco. */
	async flush(): Promise<void> {
		if (!this.manifest || !this.persist) { return; }
		await this.fileService.createFolder(this.indexRoot).catch(() => { });
		await this.fileService.writeFile(this.manifestUri(), VSBuffer.fromString(JSON.stringify(this.manifest)));
	}

	/** Deletes the whole index of the current workspace. */
	async clear(): Promise<void> {
		this.manifest = undefined;
		this.fileCache.clear();
		await this.fileService.del(this.indexRoot).catch(() => { });
	}
}
