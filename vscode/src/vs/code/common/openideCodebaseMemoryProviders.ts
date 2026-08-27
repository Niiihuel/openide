/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — providers jerárquicos de extracción para la memoria del codebase. Cada provider
 *  produce nodos y aristas con su Evidence (provider + confianza). El indexer del shared process
 *  los orquesta en cascada y deduplica por (source, type, target) y por nodeId.
 *
 *  Providers de baja confianza (regex, text) NUNCA sobrescriben aristas verificadas por language
 *  server. Los providers de language server/document symbols se invocan desde el renderer y la
 *  evidencia viaja al shared process por IPC para integrarse al grafo.
 *--------------------------------------------------------------------------------------------*/

import { makeEdgeId, makeEvidence, makeNodeId, ICodebaseMemoryEdge, ICodebaseMemoryNode, CodebaseMemoryNodeKind } from './openideCodebaseMemoryTypes.js';
import { isRelativeSpecifier, isWorkspaceAliasSpecifier, packageNameOf, ALIAS_URI_PREFIX, PACKAGE_URI_PREFIX } from './openideCodebaseImports.js';

/** Archivo de entrada (texto + lenguaje + uri). Lo produce el indexer antes de parsear. */
export interface IProviderSourceFile {
	readonly uri: string;
	readonly content: string;
	readonly language: string;
	readonly workspaceKey: string;
}

/** Resultado de un provider para un archivo: nodos y aristas con evidencia. */
export interface IProviderExtraction {
	readonly nodes: readonly ICodebaseMemoryNode[];
	readonly edges: readonly ICodebaseMemoryEdge[];
}

/** Contrato de un provider de extracción. Los providers del renderer (LS) implementan otra
 *  interfaz asíncrona y mandan resultados por IPC; este es el contrato puro del indexer. */
export interface ICodebaseMemoryProvider {
	readonly id: 'regex' | 'text' | 'ast';
	/** True si el provider puede manejar el lenguaje/archivo dado. */
	supports(file: IProviderSourceFile): boolean;
	/** Extrae nodos y aristas del archivo. Puro: no hace IO. */
	extract(file: IProviderSourceFile): IProviderExtraction;
}

// ---- shared extraction helpers ----

const IDENT_RE = /[A-Za-z_$][\w$]*/;
const TS_KEYWORDS = new Set(['abstract', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'package', 'private', 'protected', 'public', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield']);

function isIdent(name: string): boolean {
	return IDENT_RE.test(name) && !TS_KEYWORDS.has(name);
}

function lineOf(content: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < content.length; i++) { if (content.charCodeAt(i) === 10) { line++; } }
	return line;
}

function kindFromMatch(prefix: string, keyword: string): CodebaseMemoryNodeKind {
	if (keyword === 'class') { return 'class'; }
	if (keyword === 'interface') { return 'interface'; }
	if (keyword === 'enum') { return 'enum'; }
	if (keyword === 'type') { return 'type'; }
	if (prefix === 'method') { return 'method'; }
	if (keyword === 'const') { return 'constant'; }
	if (keyword === 'let' || keyword === 'var') { return 'variable'; }
	return 'function';
}

/** Extrae definiciones de símbolos de lenguajes con sintaxis C-like (TS/JS/Java/C#/Go-ish).
 *  Heurístico y de baja confianza: las aristas que produce no son definitivas. */
function extractClikeSymbols(file: IProviderSourceFile): IProviderExtraction {
	const { content, uri, workspaceKey } = file;
	const evidence = makeEvidence('regex');
	const nodes: ICodebaseMemoryNode[] = [];
	const edges: ICodebaseMemoryEdge[] = [];
	const fileNodeId = makeNodeId(workspaceKey, uri, 'file', uri);
	nodes.push({ id: fileNodeId, kind: 'file', name: uri.split('/').pop() || uri, uri, evidence, degree: 0 });
	const defRe = /\b(export\s+)?(?:default\s+)?(?:abstract\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*(class|interface|enum|type|function|const|let|var|def|fn)\s+([A-Za-z_$][\w$]*)/g;
	let match: RegExpExecArray | null;
	const seen = new Set<string>();
	while ((match = defRe.exec(content)) !== null) {
		const keyword = match[2];
		const name = match[3];
		if (!name || !isIdent(name)) { continue; }
		const line = lineOf(content, match.index);
		const kind = kindFromMatch(keyword === 'function' ? 'function' : 'symbol', keyword);
		const nodeId = makeNodeId(workspaceKey, uri, kind, name, line);
		if (seen.has(nodeId)) { continue; }
		seen.add(nodeId);
		nodes.push({ id: nodeId, kind, name, qualifiedName: name, uri, range: { startLine: line, startColumn: 0, endLine: line, endColumn: 0 }, language: file.language, exported: !!match[1], evidence, degree: 0 });
		edges.push({ source: fileNodeId, target: nodeId, type: 'CONTAINS', evidence });
	}
	return { nodes, edges };
}

/** Extrae imports nombrados y crea aristas DEPENDS_ON/IMPORTS tentativas. Como el resolver real
 *  vive en el renderer (language server), acá solo dejamos una pista de baja confianza. */
function extractClikeImports(file: IProviderSourceFile): IProviderExtraction {
	const { content, uri, workspaceKey } = file;
	const evidence = makeEvidence('regex');
	const nodes: ICodebaseMemoryNode[] = [];
	const edges: ICodebaseMemoryEdge[] = [];
	const fileNodeId = makeNodeId(workspaceKey, uri, 'file', uri);
	const importRe = /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|[A-Za-z_$][\w$]*))*\s*from\s*['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ((match = importRe.exec(content)) !== null) {
		const target = match[1];
		if (!target) { continue; }
		// El módulo importado puede no estar indexado todavía; se materializa como nodo
		// sintético para que la arista no quede huérfana. La fase global (finalizeGraph) los
		// resuelve después contra los archivos reales.
		//
		// La identidad depende del tipo de specifier:
		//  - RELATIVO: se namespacea por el archivo IMPORTADOR, porque './app' desde dos
		//    carpetas distintas son archivos distintos. Sin esto colapsaban en un nodo y se
		//    inventaban aristas archivo↔archivo que distorsionaban las comunidades.
		//  - BARE (paquete externo): id global por nombre de paquete — ahí el colapso SÍ es
		//    correcto: 'react' es el mismo 'react' en todo el repo.
		//  - ALIAS (`@/x`): es interno y ABSOLUTO, así que su id es global por specifier — el
		//    mismo `@/lib/db` es el mismo archivo desde cualquier carpeta. Tratarlo como paquete
		//    externo (lo que se hacía antes) borraba TODAS las aristas archivo↔archivo en los
		//    proyectos que usan alias, y sin aristas el grafo se queda sin comunidades.
		const relative = isRelativeSpecifier(target);
		const alias = isWorkspaceAliasSpecifier(target);
		const internal = relative || alias;
		const targetNodeId = relative
			? makeNodeId(workspaceKey, uri, 'module', target)
			: alias
				? makeNodeId(workspaceKey, ALIAS_URI_PREFIX + target, 'module', target)
				: makeNodeId(workspaceKey, PACKAGE_URI_PREFIX + packageNameOf(target), 'dependency', packageNameOf(target));
		nodes.push({
			id: targetNodeId,
			kind: internal ? 'module' : 'dependency',
			name: internal ? (target.split('/').pop() || target) : packageNameOf(target),
			qualifiedName: target,
			// `uri` debe ser resoluble: un specifier crudo rompe el cálculo de path relativo,
			// el lookup de root del workspace y el mapa de comunidades (keyeado por URI real).
			uri: relative ? uri : alias ? ALIAS_URI_PREFIX + target : PACKAGE_URI_PREFIX + packageNameOf(target),
			evidence,
			degree: 0,
		});
		edges.push({ source: fileNodeId, target: targetNodeId, type: 'IMPORTS', evidence });
	}
	return { nodes, edges };
}

/** Predicado compartido de archivo de test (por nombre; conservador para no matchear
 *  "latest.py"/"contest.cs"). Lo usan el marker de tests y el filtro openide.memory.indexTests. */
export function isTestFilePath(uri: string): boolean {
	return /(\.|_)(test|spec)\.[jt]sx?$|_test\.(go|py|rs)$|test_[^/]+\.py$|Tests?\.(cs|java|kt)$/.test(uri);
}

/** Detecta archivos de test por nombre para aristas TESTS_FILE. */
function extractTestMarker(file: IProviderSourceFile): IProviderExtraction {
	const evidence = makeEvidence('text');
	if (!isTestFilePath(file.uri)) { return { nodes: [], edges: [] }; }
	const fileNodeId = makeNodeId(file.workspaceKey, file.uri, 'file', file.uri);
	const testNode: ICodebaseMemoryNode = { id: fileNodeId + '::test', kind: 'test', name: file.uri.split('/').pop() || file.uri, uri: file.uri, evidence, degree: 0 };
	return { nodes: [testNode], edges: [{ source: testNode.id, target: fileNodeId, type: 'TESTS', evidence }] };
}

const CLIKE_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'java', 'csharp', 'go']);

/** Provider regex: extrae definiciones e imports de sintaxis C-like. Confianza baja. */
export const regexCodebaseMemoryProvider: ICodebaseMemoryProvider = {
	id: 'regex',
	supports(file) { return CLIKE_LANGS.has(file.language) || /\.(ts|tsx|js|jsx|mjs|cjs|java|cs|go)$/.test(file.uri); },
	extract(file) {
		const a = extractClikeSymbols(file);
		const b = extractClikeImports(file);
		const c = extractTestMarker(file);
		const fileNodes = new Map<string, ICodebaseMemoryNode>();
		for (const n of [...a.nodes, ...b.nodes, ...c.nodes]) { fileNodes.set(n.id, n); }
		return { nodes: [...fileNodes.values()], edges: [...a.edges, ...b.edges, ...c.edges] };
	},
};

/** Provider text: siempre soporta; produce un nodo archivo y marca tests por nombre. */
export const textCodebaseMemoryProvider: ICodebaseMemoryProvider = {
	id: 'text',
	supports() { return true; },
	extract(file) {
		const evidence = makeEvidence('text');
		const fileNodeId = makeNodeId(file.workspaceKey, file.uri, 'file', file.uri);
		const nodes: ICodebaseMemoryNode[] = [{ id: fileNodeId, kind: 'file', name: file.uri.split('/').pop() || file.uri, uri: file.uri, evidence, degree: 0 }];
		const edges: ICodebaseMemoryEdge[] = [];
		const test = extractTestMarker(file);
		return { nodes: [...nodes, ...test.nodes], edges: [...edges, ...test.edges] };
	},
};

/** Lista ordenada de providers puros del indexer (regex primero, text fallback). Los providers
 *  de language server se integran desde el renderer por IPC y tienen prioridad sobre estos. */
export const INDEXER_PROVIDERS: readonly ICodebaseMemoryProvider[] = Object.freeze([regexCodebaseMemoryProvider, textCodebaseMemoryProvider]);

/** Deduplica aristas por (source, type, target) conservando la evidencia de mayor confianza. */
export function deduplicateEdges(edges: readonly ICodebaseMemoryEdge[]): ICodebaseMemoryEdge[] {
	const map = new Map<string, ICodebaseMemoryEdge>();
	for (const edge of edges) {
		const id = makeEdgeId(edge.source, edge.type, edge.target);
		const prev = map.get(id);
		if (!prev || edge.evidence.confidence > prev.evidence.confidence) { map.set(id, edge); }
	}
	return [...map.values()];
}

/** Fusiona dos vistas del MISMO nodo: gana el de mayor confianza como base, pero los campos que
 *  sólo trae el otro se conservan. Sin esto, cuando el language server (0.9) le gana al regex
 *  (0.45) se perdían `exported`/`language`/`signature`, que el LS no emite. */
function mergeNodePair(a: ICodebaseMemoryNode, b: ICodebaseMemoryNode): ICodebaseMemoryNode {
	const [winner, loser] = a.evidence.confidence >= b.evidence.confidence ? [a, b] : [b, a];
	const merged: Record<string, unknown> = { ...winner };
	for (const [key, value] of Object.entries(loser)) {
		if (merged[key] === undefined && value !== undefined) { merged[key] = value; }
	}
	return merged as unknown as ICodebaseMemoryNode;
}

/** Deduplica nodos por id, fusionando campo a campo (no reemplazo del objeto entero). */
export function deduplicateNodes(nodes: readonly ICodebaseMemoryNode[]): ICodebaseMemoryNode[] {
	const map = new Map<string, ICodebaseMemoryNode>();
	for (const node of nodes) {
		const prev = map.get(node.id);
		map.set(node.id, prev ? mergeNodePair(prev, node) : node);
	}
	return [...map.values()];
}

/** Combina resultados de varios providers aplicando deduplicación. */
export function mergeExtractions(extractions: readonly IProviderExtraction[]): IProviderExtraction {
	const nodes = deduplicateNodes(extractions.flatMap(e => e.nodes));
	const edges = deduplicateEdges(extractions.flatMap(e => e.edges));
	return { nodes, edges };
}
