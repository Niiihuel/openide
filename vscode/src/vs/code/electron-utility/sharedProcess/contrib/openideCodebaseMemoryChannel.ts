/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — canal IPC de memoria del codebase en shared process. Cada ventana inicializa un
 *  runtime aislado por workspaceKey; el índice y el storage nunca se comparten accidentalmente.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CodebaseMemoryIndexer, IIndexProgress } from './openideCodebaseMemoryIndexer.js';
import { CodebaseMemoryStorage } from './openideCodebaseMemoryStorage.js';
import { ICodebaseIndexVersion, ICodebaseMemoryEdge, ICodebaseMemoryNode } from '../../../common/openideCodebaseMemoryTypes.js';
import { CODEBASE_MEMORY_MAX_CHANGE_BYTES, CODEBASE_MEMORY_MAX_CHANGES, CODEBASE_MEMORY_MAX_EXTRACTION_EDGES, CODEBASE_MEMORY_MAX_EXTRACTION_NODES, DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS, ICodebaseMemoryChange, ICodebaseMemoryChannel, ICodebaseMemoryIndexOptions, ICodebaseMemorySnapshotDto, ICodebaseIndexProgress } from '../../../common/openideCodebaseMemoryProtocol.js';
import { deduplicateEdges, deduplicateNodes, IProviderExtraction, mergeExtractions } from '../../../common/openideCodebaseMemoryProviders.js';
import { DEFAULT_NOTE_LINKING, linkCodebaseNotes, NoteLinkingMode } from '../../../common/openideCodebaseNotes.js';

/** Accepted values, so a bad one over IPC falls back instead of disabling linking silently. */
const NOTE_LINKING_MODES: readonly NoteLinkingMode[] = ['explicit', 'identifiers', 'off'];
import { detectCommunities, ICommunityGraphEdge } from '../../../common/openideCodebaseCommunities.js';
import { ALIAS_URI_PREFIX, isInternalSpecifier, PACKAGE_URI_PREFIX, resolveInternalImport } from '../../../common/openideCodebaseImports.js';

interface IRuntime {
	readonly folders: readonly URI[];
	readonly storage: CodebaseMemoryStorage;
	readonly indexer: CodebaseMemoryIndexer;
	trusted: boolean;
	/** Kept on the runtime because getSnapshot links notes on READ, outside the indexer. */
	noteLinking: NoteLinkingMode;
	mutationQueue: Promise<void>;
	/** Flush del manifiesto agendado (coalesce ráfagas del bridge del language server). */
	flushTimer?: ReturnType<typeof setTimeout>;
}

/** Ventana para agrupar extracciones antes de reescribir el manifiesto y avisar a la UI. */
const MANIFEST_FLUSH_DEBOUNCE_MS = 400;

function workspaceKey(folders: readonly URI[]): string {
	return folders.map(folder => folder.toString()).join('|') || 'empty';
}

/**
 * Nombra cada módulo por su carpeta PREDOMINANTE, no por la carpeta común: los módulos cruzan
 * directorios, así que el prefijo común colapsaba a la raíz del proyecto y la leyenda mostraba
 * "src" repetido una docena de veces. Los empates se resuelven alfabéticamente (determinismo) y
 * las etiquetas repetidas se profundizan hasta ser únicas.
 */
function labelCommunities<T extends { readonly label: string; readonly members: readonly string[] }>(communities: readonly T[]): T[] {
	const directoryOf = (uri: string): string[] => uri.split('/').slice(0, -1).filter(segment => segment && !segment.includes(':'));
	const dominant = communities.map(community => {
		const counts = new Map<string, number>();
		for (const member of community.members) {
			const directory = directoryOf(member).join('/');
			counts.set(directory, (counts.get(directory) ?? 0) + 1);
		}
		const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
		return best ? best[0].split('/') : [];
	});
	const used = new Set<string>();
	return communities.map((community, index) => {
		const segments = dominant[index];
		// Techo de DOS segmentos: sin él, desambiguar un módulo de un solo archivo escalaba hasta
		// la raíz del disco y la leyenda mostraba "home/nihuel/projects/…" en vez de un módulo.
		let label = '';
		for (let depth = 1; depth <= Math.min(2, segments.length); depth++) {
			label = segments.slice(-depth).join('/');
			if (!used.has(label)) { break; }
		}
		// Si dos módulos comparten carpeta, los distingue su archivo central, no un path más largo.
		if (!label) { label = community.label; }
		if (used.has(label)) { label = `${label} · ${community.label}`; }
		let unique = label;
		for (let suffix = 2; used.has(unique); suffix++) { unique = `${label} (${suffix})`; }
		used.add(unique);
		return { ...community, label: unique };
	});
}

export class CodebaseMemoryChannel extends Disposable implements ICodebaseMemoryChannel {

	private readonly runtimes = new Map<string, IRuntime>();
	private readonly _onProgress = this._register(new Emitter<{ workspaceKey: string; progress: ICodebaseIndexProgress }>());
	readonly onProgress: Event<{ workspaceKey: string; progress: ICodebaseIndexProgress }> = this._onProgress.event;
	private readonly _onDidChange = this._register(new Emitter<{ workspaceKey: string; version: ICodebaseIndexVersion }>());
	readonly onDidChange: Event<{ workspaceKey: string; version: ICodebaseIndexVersion }> = this._onDidChange.event;

	constructor(private readonly fileService: IFileService) {
		super();
	}

	async initialize(workspaceFolders: string[], trusted: boolean, options?: ICodebaseMemoryIndexOptions): Promise<string> {
		if (!trusted) { throw new Error('La memoria está deshabilitada en un workspace no confiable.'); }
		const folders = workspaceFolders.map(value => URI.parse(value)).filter(uri => uri.scheme === 'file');
		if (folders.length !== workspaceFolders.length) { throw new Error('La memoria sólo puede inicializarse para roots locales autorizados.'); }
		const key = workspaceKey(folders);
		if (!this.runtimes.has(key)) {
			const storageFolder = folders[0] ?? URI.file('/tmp/openide-memory-index');
			const workspaceHash = Array.from(key).reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
			const indexRoot = URI.joinPath(storageFolder, '.openide', 'memory-indexes', workspaceHash.toString(16));
			const storage = new CodebaseMemoryStorage(this.fileService, indexRoot);
			const indexer = new CodebaseMemoryIndexer(this.fileService, folders, storage);
			const runtime: IRuntime = { folders, storage, indexer, trusted, noteLinking: DEFAULT_NOTE_LINKING, mutationQueue: Promise.resolve() };
			indexer.onProgress(progress => this._onProgress.fire({ workspaceKey: key, progress: this.toProtocolProgress(progress) }));
			this.runtimes.set(key, runtime);
			// Las opciones se aplican ANTES de load(): persistIndex=false debe impedir la
			// lectura del índice viejo de disco, no descubrirlo después.
			await this.applyOptions(runtime, options ?? DEFAULT_CODEBASE_MEMORY_INDEX_OPTIONS);
			await storage.load(key);
			storage.markAllStale();
		} else if (options) {
			await this.applyOptions(this.runtimes.get(key)!, options);
		}
		return key;
	}

	private async applyOptions(runtime: IRuntime, options: ICodebaseMemoryIndexOptions): Promise<void> {
		const sanitized: ICodebaseMemoryIndexOptions = {
			exclude: Array.isArray(options.exclude) ? options.exclude.filter(value => typeof value === 'string' && value.trim()).slice(0, 200) : [],
			include: Array.isArray(options.include) ? options.include.filter(value => typeof value === 'string' && value.trim()).slice(0, 200) : [],
			indexTests: options.indexTests !== false,
			enableRegexFallback: options.enableRegexFallback !== false,
			persistIndex: options.persistIndex !== false,
			indexNotes: options.indexNotes !== false,
			noteLinking: NOTE_LINKING_MODES.includes(options.noteLinking) ? options.noteLinking : DEFAULT_NOTE_LINKING,
		};
		runtime.noteLinking = sanitized.noteLinking;
		runtime.indexer.setOptions(sanitized);
		await runtime.storage.setPersist(sanitized.persistIndex);
	}

	async setOptions(key: string, options: ICodebaseMemoryIndexOptions): Promise<void> {
		await this.applyOptions(this.rawRuntime(key), options);
	}

	private toProtocolProgress(progress: IIndexProgress): ICodebaseIndexProgress {
		return { phase: progress.phase, processed: progress.processed, total: progress.total, current: progress.current, excludedByUser: progress.excludedByUser, excludedTests: progress.excludedTests, skippedTooLarge: progress.skippedTooLarge, warning: progress.warning };
	}

	private runtime(key: string): IRuntime {
		const runtime = this.runtimes.get(key);
		if (!runtime || !runtime.trusted) { throw new Error(`Memoria de codebase no autorizada para ${key}.`); }
		return runtime;
	}

	private rawRuntime(key: string): IRuntime {
		const runtime = this.runtimes.get(key);
		if (!runtime) { throw new Error(`Memoria de codebase no inicializada para ${key}.`); }
		return runtime;
	}

	private isAuthorized(runtime: IRuntime, uri: URI): boolean {
		return runtime.trusted && runtime.folders.some(folder => uri.scheme === folder.scheme && uri.authority === folder.authority && (uri.path === folder.path || uri.path.startsWith(folder.path.endsWith('/') ? folder.path : folder.path + '/')));
	}

	async setTrusted(key: string, trusted: boolean): Promise<void> {
		const runtime = this.rawRuntime(key);
		runtime.trusted = trusted;
	}

	async addLanguageServerExtraction(key: string, uriString: string, extraction: IProviderExtraction): Promise<void> {
		const runtime = this.runtime(key);
		const mutation = runtime.mutationQueue.then(() => this.addLanguageServerExtractionUnsafe(key, uriString, extraction));
		runtime.mutationQueue = mutation.catch(() => undefined);
		return mutation;
	}

	private async addLanguageServerExtractionUnsafe(key: string, uriString: string, extraction: IProviderExtraction): Promise<void> {
		const runtime = this.runtime(key);
		const uri = URI.parse(uriString);
		if (!this.isAuthorized(runtime, uri)) { throw new Error('URI fuera del workspace autorizado.'); }
		if (extraction.nodes.length > CODEBASE_MEMORY_MAX_EXTRACTION_NODES || extraction.edges.length > CODEBASE_MEMORY_MAX_EXTRACTION_EDGES) { throw new Error('Extracción LS demasiado grande.'); }
		const nodeIds = new Set(extraction.nodes.map(node => node.id));
		for (const node of extraction.nodes) {
			if (node.uri.includes('://') && !this.isAuthorized(runtime, URI.parse(node.uri))) { throw new Error('La extracción LS contiene una URI fuera del workspace.'); }
			if (node.name.length > 500 || node.qualifiedName && node.qualifiedName.length > 2000 || node.signature && node.signature.length > 4000 || node.documentation && node.documentation.length > 10000) { throw new Error('La extracción LS contiene strings demasiado grandes.'); }
		}
		for (const edge of extraction.edges) { if (!nodeIds.has(edge.source) && !nodeIds.has(edge.target)) { throw new Error('La extracción LS contiene una arista sin endpoints.'); } }
		runtime.indexer.setExternalExtraction(uriString, extraction);
		const existing = await runtime.storage.readFile(uriString);
		const existingWithoutLs = existing ? { nodes: existing.nodes.filter(node => node.evidence.provider !== 'languageServer' && node.evidence.provider !== 'documentSymbols'), edges: existing.edges.filter(edge => edge.evidence.provider !== 'languageServer' && edge.evidence.provider !== 'documentSymbols') } : { nodes: [], edges: [] };
		const merged = mergeExtractions([existingWithoutLs, extraction]);
		const meta = runtime.storage.getFileMeta(uriString);
		await runtime.storage.writeFile(uriString, meta?.hash ?? 'language-server', meta?.language ?? 'unknown', { uri: uriString, nodes: [...merged.nodes], edges: [...merged.edges] });
		// El flush serializa el manifiesto ENTERO: hacerlo por archivo durante el barrido del
		// bridge era O(N²) de CPU y de bytes, y la tormenta de onDidChange que le seguía dejaba
		// sin responder al resto del canal. Se agenda uno solo por ráfaga.
		this.scheduleManifestFlush(key, runtime);
	}

	/** Coalesce el flush del manifiesto + el evento de cambio de una ráfaga de extracciones. */
	private scheduleManifestFlush(key: string, runtime: IRuntime): void {
		if (runtime.flushTimer) { return; }
		runtime.flushTimer = setTimeout(() => {
			runtime.flushTimer = undefined;
			const mutation = runtime.mutationQueue.then(async () => {
				await runtime.storage.flush();
				const version = runtime.storage.getVersion();
				if (version) { this._onDidChange.fire({ workspaceKey: key, version }); }
			});
			runtime.mutationQueue = mutation.catch(() => undefined);
		}, MANIFEST_FLUSH_DEBOUNCE_MS);
	}

	async rebuildFull(key: string, token?: import('../../../../base/common/cancellation.js').CancellationToken): Promise<ICodebaseIndexProgress> {
		const runtime = this.runtime(key);
		const cts = new CancellationTokenSource(token);
		try {
			const previousCommunities = runtime.storage.getCommunities();
			const result = await runtime.indexer.rebuildFull(cts.token);
			if (result.phase === 'cancelled') { return this.toProtocolProgress(result); }
			await this.finalizeGraph(runtime, previousCommunities);
			await runtime.storage.flush();
			const version = runtime.storage.getVersion();
			if (version) { this._onDidChange.fire({ workspaceKey: key, version }); }
			return this.toProtocolProgress(result);
		} finally { cts.dispose(); }
	}

	/**
	 * Fase global post-indexado, en UNA sola pasada sobre los payloads:
	 *  1. resuelve los imports sintéticos contra los archivos reales → tabla de alias,
	 *  2. proyecta las aristas a nivel archivo (ya con los alias aplicados),
	 *  3. corre Louvain sobre el grafo limpio.
	 *
	 * Los payloads por archivo NO se reescriben: la tabla de alias vive en el manifiesto y la
	 * aplica `getSnapshot` al concatenar. Así el camino incremental (que no pasa por acá) sigue
	 * sirviendo snapshots coherentes con los alias ya conocidos.
	 */
	private async finalizeGraph(runtime: IRuntime, previous: ReturnType<CodebaseMemoryStorage['getCommunities']>): Promise<void> {
		const manifest = runtime.storage.getManifest();
		if (!manifest) { return; }
		const fileUris = Object.keys(manifest.files);
		const knownUris = new Set(fileUris);
		const payloads = new Map<string, { nodes: readonly ICodebaseMemoryNode[]; edges: readonly ICodebaseMemoryEdge[] }>();
		const uriByNodeId = new Map<string, string>();
		const fileNodeIdByUri = new Map<string, string>();
		// Nodos de import sin resolver: id sintético → { importador, specifier }.
		const pendingImports = new Map<string, { importer: string; specifier: string }>();

		for (const uri of fileUris) {
			const payload = await runtime.storage.readFile(uri);
			if (!payload) { continue; }
			payloads.set(uri, payload);
			for (const node of payload.nodes) {
				// Los nodos sintéticos (import por alias, paquete externo) tienen un id GLOBAL: el
				// mismo `@/lib/db` aparece en el payload de cada importador. Mapearlos al uri del
				// payload los ataba al último archivo leído, así que si el alias no se resolvía la
				// arista no moría — se proyectaba contra un importador cualquiera e inventaba una
				// relación. Se los mapea a su propio uri sintético, que no está en knownUris: sin
				// resolver, sin arista.
				uriByNodeId.set(node.id, node.uri.startsWith(ALIAS_URI_PREFIX) || node.uri.startsWith(PACKAGE_URI_PREFIX) ? node.uri : uri);
				if (node.kind === 'file' && node.uri === uri) { fileNodeIdByUri.set(uri, node.id); }
				if (node.kind === 'module' && node.qualifiedName && isInternalSpecifier(node.qualifiedName)) {
					pendingImports.set(node.id, { importer: uri, specifier: node.qualifiedName });
				}
			}
		}

		// Alias: nodo de import sintético → nodo `file` real del archivo que referencia.
		const aliasByNodeId: Record<string, string> = {};
		for (const [nodeId, { importer, specifier }] of pendingImports) {
			const resolved = resolveInternalImport(importer, specifier, knownUris);
			const fileNodeId = resolved ? fileNodeIdByUri.get(resolved) : undefined;
			if (fileNodeId && fileNodeId !== nodeId) { aliasByNodeId[nodeId] = fileNodeId; }
		}
		runtime.storage.setNodeAliases(aliasByNodeId);

		const canonical = (id: string): string => aliasByNodeId[id] ?? id;
		const fileEdges: ICommunityGraphEdge[] = [];
		for (const [uri, payload] of payloads) {
			void uri;
			for (const edge of payload.edges) {
				const sourceUri = uriByNodeId.get(canonical(edge.source));
				const targetUri = uriByNodeId.get(canonical(edge.target));
				if (sourceUri && targetUri && sourceUri !== targetUri && knownUris.has(sourceUri) && knownUris.has(targetUri)) {
					fileEdges.push({ source: sourceUri, target: targetUri });
				}
			}
		}
		const degreeByUri = new Map<string, number>();
		for (const edge of fileEdges) {
			degreeByUri.set(edge.source, (degreeByUri.get(edge.source) ?? 0) + 1);
			degreeByUri.set(edge.target, (degreeByUri.get(edge.target) ?? 0) + 1);
		}
		const detected = detectCommunities(fileUris, fileEdges, degreeByUri, uri => uri.split('/').pop() ?? uri, previous);
		// La etiqueta del hub ("utils.ts") no nombra un módulo; la carpeta común de sus miembros
		// sí ("src/components/ui"), que es como se llama a un módulo al hablar del proyecto.
		const communities = labelCommunities(detected);
		runtime.storage.setCommunities(communities);
		runtime.storage.markGraphFinalized();
	}

	/**
	 * Corre finalizeGraph si el grafo derivado quedó atrás del índice, y lo persiste.
	 *
	 * Existe porque finalizeGraph colgaba de UN solo camino (`rebuildFull`), y ese camino corre
	 * como mucho una vez: `rebuildIfNeeded` sólo dispara con `version === 0`. Si se lo salteaba
	 * —cancelación, cierre de ventana, o un índice construido incrementalmente— el manifiesto
	 * quedaba completo pero sin tabla de alias. Y sin alias TODA arista de import muere: la
	 * relativa apunta al uri del propio importador (se descarta como self-edge) y la de alias a un
	 * `openide-alias:` que no es un archivo del scope. De ahí el "0 relaciones · 1 módulos".
	 *
	 * Al colgarlo de la lectura, un índice ya roto en disco se repara solo al abrirlo, sin
	 * reindexar; y el camino incremental —que nunca finalizó— queda cubierto por el mismo chequeo.
	 */
	private async ensureGraphFinalized(runtime: IRuntime): Promise<boolean> {
		if (!runtime.storage.getManifest() || runtime.storage.isGraphFinalized()) { return false; }
		const mutation = runtime.mutationQueue.then(async () => {
			// Revalidar dentro de la cola: otra llamada en vuelo puede haberlo finalizado ya.
			if (runtime.storage.isGraphFinalized()) { return; }
			await this.finalizeGraph(runtime, runtime.storage.getCommunities());
			await runtime.storage.flush();
		});
		runtime.mutationQueue = mutation.catch(() => undefined);
		await mutation;
		return true;
	}

	async indexIncremental(key: string, changes: ICodebaseMemoryChange[], token?: import('../../../../base/common/cancellation.js').CancellationToken): Promise<ICodebaseIndexProgress> {
		if (changes.length > CODEBASE_MEMORY_MAX_CHANGES) { throw new Error('Demasiados cambios en un lote IPC.'); }
		if (changes.some(change => (change.content?.length ?? 0) > CODEBASE_MEMORY_MAX_CHANGE_BYTES)) { throw new Error('Archivo demasiado grande para actualización IPC.'); }
		const runtime = this.runtime(key);
		const cts = new CancellationTokenSource(token);
		try {
			const mapped = changes.filter(change => this.isAuthorized(runtime, URI.parse(change.uri))).map(change => ({ uri: URI.parse(change.uri), content: change.content, deleted: change.deleted }));
			const result = await runtime.indexer.indexIncremental(mapped, cts.token);
			const version = runtime.storage.getVersion();
			if (version) { this._onDidChange.fire({ workspaceKey: key, version }); }
			return this.toProtocolProgress(result);
		} finally { cts.dispose(); }
	}

	async getVersion(key: string): Promise<ICodebaseIndexVersion | undefined> {
		return this.runtime(key).storage.getVersion();
	}

	async getSnapshot(key: string): Promise<ICodebaseMemorySnapshotDto | undefined> {
		const runtime = this.runtime(key);
		await this.ensureGraphFinalized(runtime);
		const storage = runtime.storage;
		const manifest = storage.getManifest();
		if (!manifest) { return undefined; }
		const rawNodes: ICodebaseMemoryNode[] = [];
		const rawEdges: ICodebaseMemoryEdge[] = [];
		const dirtyUris: string[] = [];
		for (const uri of Object.keys(manifest.files)) {
			const payload = await storage.readFile(uri);
			if (!payload) { continue; }
			rawNodes.push(...payload.nodes);
			rawEdges.push(...payload.edges);
			if (manifest.files[uri].status === 'stale') { dirtyUris.push(uri); }
		}
		// El índice se guarda por archivo, así que un mismo nodo aparece en varios payloads:
		// hay que resolver alias de imports y deduplicar ACÁ, o el consumidor recibe duplicados
		// (y `nodeCount` queda inflado). La dedup es exacta por id, con union de campos.
		const aliases = storage.getNodeAliases();
		const canonical = (id: string): string => aliases[id] ?? id;
		const aliasedNodes = rawNodes.filter(node => !aliases[node.id]);
		const aliasedEdges = rawEdges.map(edge => (aliases[edge.source] || aliases[edge.target])
			? { ...edge, source: canonical(edge.source), target: canonical(edge.target) }
			: edge);
		const nodes = deduplicateNodes(aliasedNodes);
		// Notes are wired to what they mention HERE and not at index time, for the same reason the
		// alias table is applied here: a note's target may live in a file that was reindexed after
		// the note was. Computed on read, the link can never be stale; stored, it would be.
		const edges = deduplicateEdges([...aliasedEdges, ...linkCodebaseNotes(nodes, runtime.noteLinking)].filter(edge => edge.source !== edge.target));
		return { version: manifest.version, nodes, edges, dirtyUris, communities: storage.getCommunities() };
	}

	async getFileNodes(key: string, uri: string): Promise<ICodebaseMemoryNode[]> {
		const payload = await this.runtime(key).storage.readFile(uri);
		return payload?.nodes ?? [];
	}

	async clear(key: string): Promise<void> {
		const runtime = this.runtime(key);
		const mutation = runtime.mutationQueue.then(async () => {
			runtime.indexer.clearExternalExtractions();
			await runtime.storage.clear();
		});
		runtime.mutationQueue = mutation.catch(() => undefined);
		await mutation;
		const version: ICodebaseIndexVersion = { version: 0, workspaceKey: key, builtAt: Date.now(), staleCount: 0, nodeCount: 0, edgeCount: 0 };
		this._onDidChange.fire({ workspaceKey: key, version });
	}

	override dispose(): void {
		for (const runtime of this.runtimes.values()) {
			if (runtime.flushTimer) { clearTimeout(runtime.flushTimer); runtime.flushTimer = undefined; }
			runtime.indexer.dispose();
		}
		this.runtimes.clear();
		super.dispose();
	}
}
