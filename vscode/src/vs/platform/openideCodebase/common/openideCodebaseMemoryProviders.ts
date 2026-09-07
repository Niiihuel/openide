/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — the layered extraction providers of the codebase memory. Each provider produces
 *  nodes and edges with their Evidence (provider + confidence). The shared process indexer runs
 *  them in cascade and deduplicates by (source, type, target) and by nodeId.
 *
 *  A low-confidence provider (regex, text) NEVER overwrites an edge verified by a language
 *  server. The language-server / document-symbol providers are invoked from the renderer and the
 *  evidence travels to the shared process over IPC to be merged into the graph.
 *--------------------------------------------------------------------------------------------*/

import { makeEdgeId, makeEvidence, makeNodeId, ICodebaseMemoryEdge, ICodebaseMemoryNode, CodebaseMemoryNodeKind } from './openideCodebaseMemoryTypes.js';
import { isRelativeSpecifier, isWorkspaceAliasSpecifier, packageNameOf, ALIAS_URI_PREFIX, PACKAGE_URI_PREFIX } from './openideCodebaseImports.js';

/** An input file (text + language + uri). The indexer produces it before parsing. */
export interface IProviderSourceFile {
	readonly uri: string;
	readonly content: string;
	readonly language: string;
	readonly workspaceKey: string;
}

/** A provider's result for one file: nodes and edges with their evidence. */
export interface IProviderExtraction {
	readonly nodes: readonly ICodebaseMemoryNode[];
	readonly edges: readonly ICodebaseMemoryEdge[];
}

/** The contract of an extraction provider. The renderer's providers (LS) implement a different
 *  asynchronous interface and send results over IPC; this is the indexer's pure contract. */
export interface ICodebaseMemoryProvider {
	readonly id: 'regex' | 'text' | 'ast';
	/** True si el provider puede manejar el lenguaje/archivo dado. */
	supports(file: IProviderSourceFile): boolean;
	/** Extracts nodes and edges from the file. Pure: it does no IO. */
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

/** Extracts symbol definitions from languages with C-like syntax (TS/JS/Java/C#/Go-ish).
 *  Heuristic and low confidence: the edges it produces are not final. */
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

/** Extracts named imports and creates tentative DEPENDS_ON/IMPORTS edges. The real resolver
 *  lives in the renderer (language server), so this only leaves a low-confidence hint. */
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
		// The imported module may not be indexed yet; it is materialized as a synthetic node so the
		// edge is not orphaned. The global phase (finalizeGraph) resolves them later against the
		// real files.
		//
		// La identidad depende del tipo de specifier:
		//  - RELATIVE: namespaced by the IMPORTING file, because './app' from two different folders
		//    are two different files. Without this they collapsed into one node and invented
		//    file↔file edges that distorted the communities.
		//  - BARE (an external package): a global id by package name — there the collapse IS the
		//    right answer: 'react' is the same 'react' across the repo.
		//  - ALIAS (`@/x`): internal and ABSOLUTE, so its id is global by specifier — the same
		//    `@/lib/db` is the same file from any folder. Treating it as an external package (which
		//    is what happened before) erased EVERY file↔file edge in projects that use aliases, and
		//    with no edges the graph has no communities left.
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
			// `uri` has to be resolvable: a raw specifier breaks the relative-path computation, the
			// workspace-root lookup and the community map (keyed by real URI).
			uri: relative ? uri : alias ? ALIAS_URI_PREFIX + target : PACKAGE_URI_PREFIX + packageNameOf(target),
			evidence,
			degree: 0,
		});
		edges.push({ source: fileNodeId, target: targetNodeId, type: 'IMPORTS', evidence });
	}
	return { nodes, edges };
}

/** The shared "is a test file" predicate (by name; conservative so it does not match
 *  "latest.py"/"contest.cs"). Used by the test marker and by openide.memory.indexTests. */
export function isTestFilePath(uri: string): boolean {
	return /(\.|_)(test|spec)\.[jt]sx?$|_test\.(go|py|rs)$|test_[^/]+\.py$|Tests?\.(cs|java|kt)$/.test(uri);
}

/** Detects test files by name, for TESTS_FILE edges. */
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

/** The text provider: it supports everything; it produces a file node and marks tests by name. */
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

/** The indexer's pure providers, in order (regex first, text as the fallback). The language
 *  server providers come in from the renderer over IPC and take precedence over these. */
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

/** Merges two views of the SAME node: the more confident one is the base, but the fields only
 *  the other one carries are kept. Without this, when the language server (0.9) beat the regex
 *  (0.45), `exported`/`language`/`signature` were lost — the LS does not emit them. */
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

/** Combines the results of several providers, deduplicating them. */
export function mergeExtractions(extractions: readonly IProviderExtraction[]): IProviderExtraction {
	const nodes = deduplicateNodes(extractions.flatMap(e => e.nodes));
	const edges = deduplicateEdges(extractions.flatMap(e => e.edges));
	return { nodes, edges };
}
