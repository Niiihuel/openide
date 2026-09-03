/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — the codebase-memory indexer (the coordinator in the shared process). It walks files
 *  in batches with yielding, honours the CPU budget and cancellation, and persists through storage.
 *
 *  The language server providers run in the renderer and arrive over IPC; this indexer only runs
 *  the pure providers (regex/text) plus the remote evidence it receives.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import * as glob from '../../../../base/common/glob.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INDEXER_PROVIDERS, IProviderExtraction, IProviderSourceFile, isTestFilePath, mergeExtractions } from '../../../common/openideCodebaseMemoryProviders.js';
import { DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS, ICodebaseMemoryIndexOptions } from '../../../common/openideCodebaseMemoryProtocol.js';
import { CodebaseMemoryStorage } from './openideCodebaseMemoryStorage.js';
import { CODEBASE_NOTES_PATH, extractCodebaseNotes, isCodebaseNotesUri } from '../../../common/openideCodebaseNotes.js';

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|c|h|cpp|hpp|cc)$/;
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'out', 'build', 'target', 'vendor', 'vendored', '.next', '.nuxt', 'coverage', '__pycache__', '.venv', 'venv', '.cache', '.idea', '.vscode-test', '.build', 'bin', 'obj']);
const MAX_FILES = 6000;
const MAX_FILE_BYTES = 400 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const BATCH_SIZE = 40;
const YIELD_MS = 4;
const SECRET_PATTERNS = [/\b(API_KEY|SECRET|PRIVATE_KEY|PASSWORD|TOKEN|ACCESS_KEY)\s*[:=]/i];
export const CODEBASE_MEMORY_EXCLUDED_PATHS = EXCLUDED_DIRS;

export interface IIndexProgress {
	readonly phase: 'walking' | 'indexing' | 'idle' | 'cancelled';
	readonly processed: number;
	readonly total: number;
	readonly current?: string;
	readonly excludedByUser?: number;
	readonly excludedTests?: number;
	readonly skippedTooLarge?: number;
	readonly warning?: string;
}

interface IScanCounters { excludedByUser: number; excludedTests: number; skippedTooLarge: number }

/** A "folder" pattern (no glob metacharacters, no extension) covers its whole subtree too. */
function normalizePattern(pattern: string): string[] {
	const trimmed = pattern.replace(/^\/+|\/+$/g, '').trim();
	if (!trimmed) { return []; }
	if (!/[*?{}[\]]/.test(trimmed) && !/\.[^/]+$/.test(trimmed)) { return [trimmed, `${trimmed}/**`]; }
	return [trimmed];
}

function compilePatterns(patterns: readonly string[]): glob.ParsedPattern[] {
	return patterns.flatMap(normalizePattern).map(pattern => glob.parse(pattern));
}

function matchesAny(parsed: readonly glob.ParsedPattern[], relPath: string): boolean {
	return parsed.some(pattern => pattern(relPath));
}

export interface IIndexMetrics {
	filesIndexed: number;
	filesSkipped: number;
	indexTimeMs: number;
	nodes: number;
	edges: number;
	incrementalUpdates: number;
	fullRebuilds: number;
}

function languageFromPath(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	const map: Record<string, string> = { ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp' };
	return map[ext] ?? ext ?? 'text';
}

function looksSecret(content: string): boolean { return SECRET_PATTERNS.some(re => re.test(content.slice(0, 2000))); }

function simpleHash(content: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) { h ^= content.charCodeAt(i); h = Math.imul(h, 0x01000193); }
	return (h >>> 0).toString(36);
}

function yieldToEventLoop(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

export class CodebaseMemoryIndexer extends Disposable {

	private readonly _onProgress = this._register(new Emitter<IIndexProgress>());
	readonly onProgress: Event<IIndexProgress> = this._onProgress.event;

	private current: Promise<IIndexProgress> | undefined;
	private cts: CancellationTokenSource | undefined;
	private operationQueue: Promise<unknown> = Promise.resolve();
	private readonly externalExtractions = new Map<string, IProviderExtraction>();
	private readonly metrics: IIndexMetrics = { filesIndexed: 0, filesSkipped: 0, indexTimeMs: 0, nodes: 0, edges: 0, incrementalUpdates: 0, fullRebuilds: 0 };
	private options: ICodebaseMemoryIndexOptions = DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS;
	private excludePatterns: glob.ParsedPattern[] = [];
	private includePatterns: glob.ParsedPattern[] = [];
	/** An include with an explicit extension ("**\/*.vue") widens the extension allowlist;
	 *  a folder-style one ("src") only narrows the scope and keeps CODE_EXT. */
	private includeHasExplicitExtension = false;
	private lastScanCounters: IScanCounters = { excludedByUser: 0, excludedTests: 0, skippedTooLarge: 0 };

	constructor(
		@IFileService private readonly fileService: IFileService,
		private readonly workspaceFolders: readonly URI[],
		private readonly storage: CodebaseMemoryStorage,
	) {
		super();
	}

	getMetrics(): IIndexMetrics { return { ...this.metrics }; }

	setOptions(options: ICodebaseMemoryIndexOptions): void {
		this.options = options;
		this.excludePatterns = compilePatterns(options.exclude);
		this.includePatterns = compilePatterns(options.include);
		this.includeHasExplicitExtension = options.include.some(pattern => /\.[^/]+$/.test(pattern));
	}

	/** Path relative to the first folder containing the uri ('' when it is outside the workspace). */
	private relativePath(uriStr: string): string {
		for (const folder of this.workspaceFolders) {
			const base = folder.toString().endsWith('/') ? folder.toString() : folder.toString() + '/';
			if (uriStr.startsWith(base)) { return decodeURIComponent(uriStr.slice(base.length)); }
		}
		return '';
	}

	/** The single eligibility rule per file (the walk and the incremental path share it). */
	private fileEligible(relPath: string, name: string): { ok: boolean; reason?: 'excluded' | 'test' } {
		if (this.excludePatterns.length && matchesAny(this.excludePatterns, relPath)) { return { ok: false, reason: 'excluded' }; }
		if (!this.options.indexTests && isTestFilePath(relPath)) { return { ok: false, reason: 'test' }; }
		// The shared memory is a source too: its entries become `note` nodes, which is what lets a
		// decision about a module come back from the same query that returns the module.
		if (relPath === CODEBASE_NOTES_PATH) { return this.options.indexNotes === false ? { ok: false, reason: 'excluded' } : { ok: true }; }
		const extOk = CODE_EXT.test(name) || name === 'package.json';
		if (this.includePatterns.length) {
			if (!matchesAny(this.includePatterns, relPath)) { return { ok: false, reason: 'excluded' }; }
			if (!extOk && !this.includeHasExplicitExtension) { return { ok: false, reason: 'excluded' }; }
			return { ok: true };
		}
		return extOk ? { ok: true } : { ok: false };
	}

	setExternalExtraction(uri: string, extraction: IProviderExtraction): void { this.externalExtractions.set(uri, extraction); }
	clearExternalExtractions(): void { this.externalExtractions.clear(); }

	private workspaceKey(): string {
		return this.workspaceFolders.map(folder => folder.toString()).join('|') || 'empty';
	}

	/** A full index. It cancels any indexing already in flight. */
	rebuildFull(token?: CancellationToken): Promise<IIndexProgress> {
		this.cts?.cancel();
		const localCts = new CancellationTokenSource(token);
		this.cts = localCts;
		const operation = this.operationQueue.then(() => this.runFull(localCts.token));
		const tracked = operation.finally(() => {
			localCts.dispose();
			if (this.current === tracked) { this.current = undefined; }
		});
		this.current = tracked;
		this.operationQueue = tracked.catch(() => undefined);
		return tracked;
	}

	private async runFull(token: CancellationToken): Promise<IIndexProgress> {
		const start = Date.now();
		const workspaceKey = this.workspaceKey();
		await this.storage.load(workspaceKey);
		// Anti-shrink guard (Graphify #479): remember the previous size so we can report a rebuild that
		// produces a drastically smaller index (a mistyped exclude, an interrupted walk) — it is
		// reported, never blocked: this index is regenerable.
		const previousFileCount = Object.keys(this.storage.getManifest()?.files ?? {}).length;
		// Keeping the old index until the new one is done needs no second root in this storage: only the
		// logical payload is removed, after the state for cancellation has been captured.
		await this.storage.clear();
		await this.storage.load(workspaceKey);
		// LS evidence from a full generation is not reused: the files are read again anyway.
		this.externalExtractions.clear();
		this.metrics.fullRebuilds++;
		this.lastScanCounters = { excludedByUser: 0, excludedTests: 0, skippedTooLarge: 0 };
		const files = await this.walk(token);
		this._onProgress.fire({ phase: 'indexing', processed: 0, total: files.length });
		let processed = 0;
		for (let i = 0; i < files.length; i += BATCH_SIZE) {
			if (token.isCancellationRequested) { return this.cancelled(processed, files.length); }
			const batch = files.slice(i, i + BATCH_SIZE);
			for (const file of batch) {
				await this.indexOne(file.uri, file.content, workspaceKey, token);
				processed++;
			}
			this._onProgress.fire({ phase: 'indexing', processed, total: files.length, current: batch[batch.length - 1]?.uri });
			await yieldToEventLoop(YIELD_MS);
		}
		await this.storage.flush();
		const stats = this.storage.getStats();
		this.metrics.indexTimeMs += Date.now() - start;
		this.metrics.nodes = stats.nodeCount;
		this.metrics.edges = stats.edgeCount;
		let warning: string | undefined;
		if (previousFileCount > 20 && stats.fileCount < previousFileCount * 0.5) {
			warning = `El índice nuevo tiene ${stats.fileCount} archivos y el anterior tenía ${previousFileCount}. Causas probables: un patrón de exclude/include demasiado agresivo, o un scan interrumpido.`;
		}
		const done: IIndexProgress = { phase: 'idle', processed, total: files.length, ...this.lastScanCounters, warning };
		this._onProgress.fire(done);
		return done;
	}

	/** Incremental indexing: it takes file changes and processes only what changed. */
	indexIncremental(changes: { uri: URI; content?: string; deleted?: boolean }[], token: CancellationToken): Promise<IIndexProgress> {
		const run = this.operationQueue.then(() => this.runIncremental(changes, token));
		this.operationQueue = run.catch(() => undefined);
		return run;
	}

	private async runIncremental(changes: { uri: URI; content?: string; deleted?: boolean }[], token: CancellationToken): Promise<IIndexProgress> {
		const workspaceKey = this.workspaceKey();
		await this.storage.load(workspaceKey);
		const start = Date.now();
		let processed = 0;
		for (const change of changes) {
			if (token.isCancellationRequested) { break; }
			const uriStr = change.uri.toString();
			if (change.deleted) {
				await this.storage.removeFile(uriStr);
				this.metrics.incrementalUpdates++;
				processed++;
				continue;
			}
			if (change.content === undefined) { continue; }
			await this.indexOne(uriStr, change.content, workspaceKey, token);
			this.metrics.incrementalUpdates++;
			processed++;
			await yieldToEventLoop(YIELD_MS);
		}
		await this.storage.flush();
		this.metrics.indexTimeMs += Date.now() - start;
		this._onProgress.fire({ phase: 'idle', processed, total: changes.length });
		return { phase: 'idle', processed, total: changes.length };
	}

	private async indexOne(uri: string, content: string, workspaceKey: string, token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) { return; }
		// A per-file guard: the incremental path does NOT go through walk(). A file that stopped being
		// eligible (a new setting) is purged from the index instead of reindexed.
		const relPath = this.relativePath(uri);
		if (relPath && !this.fileEligible(relPath, relPath.split('/').pop() ?? relPath).ok) {
			await this.storage.removeFile(uri);
			this.metrics.filesSkipped++;
			return;
		}
		if (content.length > MAX_FILE_BYTES || looksSecret(content)) {
			await this.storage.removeFile(uri);
			this.metrics.filesSkipped++;
			return;
		}
		const language = languageFromPath(uri);
		const hash = simpleHash(content);
		const meta = this.storage.getFileMeta(uri);
		if (meta && meta.hash === hash && meta.status === 'indexed') { this.metrics.filesSkipped++; return; }
		if (isCodebaseNotesUri(uri)) {
			// Authored prose, not code: the regex/text providers would read its backticks as
			// symbol definitions and fill the graph with entities that do not exist.
			const notes = extractCodebaseNotes(workspaceKey, uri, content);
			await this.storage.writeFile(uri, hash, 'markdown', { uri, nodes: [...notes.nodes], edges: [...notes.edges] });
			this.metrics.filesIndexed++;
			return;
		}
		const source: IProviderSourceFile = { uri, content, language, workspaceKey };
		const extractions: IProviderExtraction[] = [];
		for (const provider of INDEXER_PROVIDERS) {
			if (provider.id === 'regex' && !this.options.enableRegexFallback) { continue; }
			if (provider.supports(source)) { extractions.push(provider.extract(source)); }
		}
		const external = this.externalExtractions.get(uri);
		const merged = mergeExtractions(external ? [...extractions, external] : extractions);
		await this.storage.writeFile(uri, hash, language, { uri, nodes: [...merged.nodes], edges: [...merged.edges] });
		this.metrics.filesIndexed++;
	}

	private cancelled(processed: number, total: number): IIndexProgress {
		this._onProgress.fire({ phase: 'cancelled', processed, total });
		return { phase: 'cancelled', processed, total };
	}

	private async walk(token: CancellationToken): Promise<{ uri: string; content: string }[]> {
		const files: { uri: string; content: string }[] = [];
		if (!this.workspaceFolders.length) { return files; }
		let totalBytes = 0;
		const counters = this.lastScanCounters;
		const walk = async (uri: URI): Promise<void> => {
			if (token.isCancellationRequested || files.length >= MAX_FILES) { return; }
			let stat;
			try { stat = await this.fileService.resolve(uri); } catch { return; }
			for (const child of stat.children ?? []) {
				if (token.isCancellationRequested || files.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) { return; }
				const relPath = this.relativePath(child.resource.toString());
				if (child.isDirectory) {
					// Dot-directories are noise, with one exception: `.openide` holds the shared
					// memory, and skipping it here is what would keep notes out of the graph.
					if (EXCLUDED_DIRS.has(child.name) || (child.name.startsWith('.') && child.name !== '.openide')) { continue; }
					// Only exclude prunes directories; include is evaluated per file (pruning here would mean
					// testing whether some pattern could match below — not worth the risk).
					if (this.excludePatterns.length && matchesAny(this.excludePatterns, relPath)) { counters.excludedByUser++; continue; }
					await walk(child.resource);
				} else {
					const eligible = this.fileEligible(relPath, child.name);
					if (!eligible.ok) {
						if (eligible.reason === 'excluded') { counters.excludedByUser++; }
						else if (eligible.reason === 'test') { counters.excludedTests++; }
						continue;
					}
					if ((child.size ?? 0) > MAX_FILE_BYTES) { counters.skippedTooLarge++; continue; }
					try {
						const content = (await this.fileService.readFile(child.resource)).value.toString();
						totalBytes += content.length;
						files.push({ uri: child.resource.toString(), content });
					} catch { /* binario/ilegible */ }
				}
			}
		};
		this._onProgress.fire({ phase: 'walking', processed: 0, total: 0 });
		for (const folder of this.workspaceFolders) {
			await walk(folder);
			if (token.isCancellationRequested || files.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) { break; }
		}
		return files;
	}
}
