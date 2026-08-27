/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — tipos de la MEMORIA del codebase (grafo integrado). Modelo extendido con evidencia,
 *  confianza, versionado y preservación de relaciones. Puro: lo consumen indexer, storage,
 *  providers, servicios renderer y tools del agente. Mantiene compatibilidad con el formato
 *  anterior (openideMemoryTypes.ts) que usa el editor visual legacy.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../base/common/uri.js';

/** Taxonomía extendida de nodos del codebase. Compatible con MemoryNodeLabel legacy. */
export type CodebaseMemoryNodeKind =
	| 'workspace' | 'folder' | 'file' | 'module' | 'namespace' | 'package'
	| 'class' | 'interface' | 'trait' | 'enum' | 'type'
	| 'function' | 'method' | 'constructor' | 'property' | 'field' | 'variable' | 'constant'
	| 'endpoint' | 'route'
	| 'databaseEntity' | 'test' | 'configuration' | 'dependency'
	/**
	 * A fact a HUMAN or an agent wrote down, from `.openide/MEMORY.md`.
	 *
	 * The only kind in this list that is not read off the code. It is here rather than in a store
	 * of its own so that a decision about a module comes back from the SAME query that returns the
	 * module: memory that has to be read separately, in full, every session is memory nobody reads.
	 */
	| 'note';

/** Relaciones tipadas. Compatible con MemoryEdgeType legacy. */
export type CodebaseMemoryRelationType =
	| 'CONTAINS' | 'DEFINES'
	| 'IMPORTS' | 'EXPORTS' | 'DEPENDS_ON'
	| 'CALLS' | 'CALLED_BY' | 'REFERENCES' | 'USES'
	| 'INHERITS' | 'IMPLEMENTS' | 'OVERRIDES'
	| 'INSTANTIATES' | 'READS' | 'WRITES'
	| 'TESTS' | 'TESTED_BY'
	| 'ROUTES_TO' | 'CONFIGURES' | 'RELATED_TO'
	/** A note is about this entity. Only ever emitted from an unambiguous, explicit mention. */
	| 'ANNOTATES';

/** Procedencia de un nodo o relación. Determina el nivel de confianza. */
export type CodebaseMemoryProvider =
	| 'languageServer' | 'workspaceSymbols' | 'documentSymbols'
	| 'callHierarchy' | 'typeHierarchy' | 'references'
	| 'treeSitter' | 'ast' | 'regex' | 'text'
	/**
	 * Written on purpose by a person or an agent, not extracted from anything.
	 *
	 * Confidence 1 and verified: this is not a guess the indexer made about the code, it is a
	 * statement somebody committed to the repo. It outranks every extractor precisely because
	 * nobody inferred it.
	 */
	| 'authored';

/** Evidencia de cómo se extrajo/verificó una entidad del grafo. */
export interface ICodebaseMemoryEvidence {
	readonly provider: CodebaseMemoryProvider;
	/** 0..1 — confianza según provider. */
	readonly confidence: number;
	/** Validado por language server / compiler (true) o inferido (false). */
	readonly verified: boolean;
	readonly indexedAt: number;
}

/** Nodo del grafo de memoria. Extiende IMemoryNode (id/label/name/path/line/degree). */
export interface ICodebaseMemoryNode {
	/** Id determinístico: `workspace + uri + kind + qualifiedName + (línea|firma)`. */
	readonly id: string;
	readonly kind: CodebaseMemoryNodeKind;
	readonly name: string;
	/** Nombre calificado (ej: `module:UserService.authenticate`). */
	readonly qualifiedName?: string;
	readonly uri: string;
	readonly range?: { readonly startLine: number; readonly startColumn: number; readonly endLine: number; readonly endColumn: number };
	readonly language?: string;
	readonly signature?: string;
	readonly documentation?: string;
	readonly exported?: boolean;
	readonly deprecated?: boolean;
	/** Hash del archivo en el momento de la indexación (para detectar stale). */
	readonly hash?: string;
	readonly evidence: ICodebaseMemoryEvidence;
	readonly degree: number;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Arista tipada del grafo de memoria. */
export interface ICodebaseMemoryEdge {
	readonly source: string;
	readonly target: string;
	readonly type: CodebaseMemoryRelationType;
	readonly evidence: ICodebaseMemoryEvidence;
}

/** Versión del índice; incrementa en cada actualización atómica. */
export interface ICodebaseIndexVersion {
	readonly version: number;
	readonly workspaceKey: string;
	readonly builtAt: number;
	readonly staleCount: number;
	readonly nodeCount: number;
	readonly edgeCount: number;
}

/** Resultado de una consulta con marca de frescura y procedencia. */
export interface ICodebaseMemoryQueryResult<T> {
	readonly data: T;
	readonly indexVersion: number;
	readonly isStale: boolean;
	readonly confidence: number;
	readonly providers: readonly CodebaseMemoryProvider[];
}

/** Snapshot inmutable del grafo completo (o de una región). Lo consumen query/context/editor. */
export interface ICodebaseMemorySnapshot {
	readonly version: ICodebaseIndexVersion;
	readonly nodes: readonly ICodebaseMemoryNode[];
	readonly edges: readonly ICodebaseMemoryEdge[];
	readonly dirtyUris: ReadonlySet<string>;
}

/** Archivo indexado con su hash y metadatos. */
export interface ICodebaseIndexedFile {
	readonly uri: string;
	readonly hash: string;
	readonly language: string;
	readonly indexedAt: number;
	readonly nodeCount: number;
	readonly status: 'indexed' | 'stale' | 'error';
}

/** Confianza por defecto según el provider. */
export const PROVIDER_CONFIDENCE: Readonly<Record<CodebaseMemoryProvider, number>> = Object.freeze({
	languageServer: 1.0,
	workspaceSymbols: 0.95,
	documentSymbols: 0.9,
	callHierarchy: 0.95,
	typeHierarchy: 0.95,
	references: 0.9,
	treeSitter: 0.8,
	ast: 0.75,
	regex: 0.45,
	text: 0.25,
	authored: 1.0,
});

/** True si el provider es considerado verificado por compiler/language server. */
export function isVerifiedProvider(provider: CodebaseMemoryProvider): boolean {
	// `authored` counts as verified for the same reason a language server does: nothing was
	// inferred. A person wrote it down.
	return provider === 'authored' || provider === 'languageServer' || provider === 'workspaceSymbols' || provider === 'callHierarchy' || provider === 'typeHierarchy' || provider === 'references' || provider === 'documentSymbols';
}

/** Crea una evidencia normalizada a partir del provider. */
export function makeEvidence(provider: CodebaseMemoryProvider, indexedAt: number = Date.now()): ICodebaseMemoryEvidence {
	return Object.freeze({ provider, confidence: PROVIDER_CONFIDENCE[provider] ?? 0.3, verified: isVerifiedProvider(provider), indexedAt });
}

/** ID determinístico para un nodo. Estable ante renombrados si (uri, kind, qualifiedName, línea) no cambian. */
export function makeNodeId(workspaceKey: string, uri: string, kind: CodebaseMemoryNodeKind, qualifiedName: string, line?: number): string {
	const parts = [workspaceKey, uri, kind, qualifiedName];
	if (Number.isFinite(line) && line! > 0) { parts.push(String(line)); }
	return parts.join('::');
}

/** ID determinístico para una arista. Deduplica `(source, type, target)`. */
export function makeEdgeId(source: string, type: CodebaseMemoryRelationType, target: string): string {
	return `${source}::${type}::${target}`;
}

/** Clona y congela un nodo (defensa contra mutación externa). */
export function cloneNode(node: ICodebaseMemoryNode): ICodebaseMemoryNode {
	return Object.freeze({
		...node,
		range: node.range ? Object.freeze({ ...node.range }) : undefined,
		evidence: Object.freeze({ ...node.evidence }),
		metadata: node.metadata ? Object.freeze({ ...node.metadata }) : undefined,
	});
}

/** Clona y congela una arista. */
export function cloneEdge(edge: ICodebaseMemoryEdge): ICodebaseMemoryEdge {
	return Object.freeze({ ...edge, evidence: Object.freeze({ ...edge.evidence }) });
}

/** Normaliza un URI a path relativo al workspace (para mostrar en UI). */
export function uriToRelativePath(uri: string, workspaceFolders: readonly URI[]): string {
	try {
		const parsed = URI.parse(uri);
		for (const folder of workspaceFolders) {
			if (parsed.path === folder.path || parsed.path.startsWith(folder.path.endsWith('/') ? folder.path : folder.path + '/')) {
				const rel = parsed.path.slice(folder.path.length).replace(/^\/+/, '');
				return rel || parsed.path;
			}
		}
		return parsed.path;
	} catch { return uri; }
}

/** True si una URI corresponde a un archivo del workspace (no remoto/virtual). */
export function isLocalWorkspaceUri(uri: string): boolean {
	return uri.startsWith('file:') || uri.startsWith('vscode-userdata:');
}
