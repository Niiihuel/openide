/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — hierarchical view and bounded queries over the canonical graph. The visual editor
 *  consumes this service, never the full snapshot directly: each operation returns only the
 *  scope y la profundidad solicitados.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodebaseMemoryService } from './openideCodebaseMemoryService.js';
import { ICodebaseMemoryEdge, ICodebaseMemoryNode, CodebaseMemoryNodeKind } from '../../../../code/common/openideCodebaseMemoryTypes.js';

export const IOpenideCodebaseGraphService = createDecorator<IOpenideCodebaseGraphService>('openideCodebaseGraphService');

export type ArchitectureItemKind = 'workspace' | 'folder' | 'module' | 'file' | 'symbol';
export type ArchitectureMode = 'architecture' | 'dependencies' | 'impact' | 'matrix';

export interface IArchitectureItem {
	readonly id: string;
	readonly parentId?: string;
	readonly kind: ArchitectureItemKind;
	readonly name: string;
	readonly path?: string;
	readonly uri?: string;
	readonly rootId?: string;
	readonly line?: number;
	readonly fileCount: number;
	readonly symbolCount: number;
	readonly confidence?: number;
	readonly provider?: string;
	/** Community (module) label of the file, when the index has already computed it. */
	readonly community?: string;
	readonly hasChildren: boolean;
}

export interface IArchitectureScope {
	readonly path: string;
	readonly breadcrumbs: IArchitectureItem[];
	readonly items: IArchitectureItem[];
	readonly total: number;
}

export interface IGraphRelations {
	readonly target: ICodebaseMemoryNode;
	readonly relations: { readonly edge: ICodebaseMemoryEdge; readonly node: ICodebaseMemoryNode }[];
	readonly depth: number;
}

/** Visual map node: a FILE, with its module (community) and its real degree. */
export interface IGraphViewNode {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly uri: string;
	readonly community: string;
	readonly degree: number;
}

export interface IGraphViewModule {
	readonly label: string;
	readonly count: number;
}

export interface IGraphView {
	readonly nodes: IGraphViewNode[];
	readonly edges: { readonly source: string; readonly target: string }[];
	readonly modules: IGraphViewModule[];
	/** Nodes left out by the cap (silence reads as absence). */
	readonly truncated: number;
}

export interface IArchitectureMatrixCell {
	readonly source: string;
	readonly target: string;
	readonly sourceName: string;
	readonly targetName: string;
	readonly count: number;
	readonly relations: ICodebaseMemoryEdge[];
}

export interface IOpenideCodebaseGraphService {
	readonly _serviceBrand: undefined;
	getArchitecture(path?: string, maxItems?: number): Promise<IArchitectureScope>;
	getRelations(targetIds: string[], depth: number, maxItems?: number, direction?: 'incoming' | 'outgoing' | 'both'): Promise<IGraphRelations[]>;
	search(query: string, maxItems?: number): Promise<ICodebaseMemoryNode[]>;
	getNodes(ids: string[]): Promise<ICodebaseMemoryNode[]>;
	getDependencyMatrix(path?: string, maxCells?: number): Promise<IArchitectureMatrixCell[]>;
	getGraphView(path?: string, maxNodes?: number): Promise<IGraphView>;
	getSnapshotVersion(): Promise<number>;
}

interface IPathAggregate { path: string; files: Set<string>; symbols: number; }

function isSymbol(kind: CodebaseMemoryNodeKind): boolean {
	return !['workspace', 'folder', 'file', 'module', 'package', 'dependency'].includes(kind);
}

function relPath(uri: string, folders: readonly URI[]): string {
	try {
		const parsed = URI.parse(uri);
		for (const folder of folders) {
			if (parsed.path === folder.path || parsed.path.startsWith(folder.path.endsWith('/') ? folder.path : folder.path + '/')) { return parsed.path.slice(folder.path.length).replace(/^\/+/, ''); }
		}
	} catch { /* fallback below */ }
	const value = uri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
	const slash = value.indexOf('/');
	return slash >= 0 ? value.slice(slash + 1) : value;
}

export class OpenideCodebaseGraphService extends Disposable implements IOpenideCodebaseGraphService {
	declare readonly _serviceBrand: undefined;
	private snapshot: { nodes: readonly ICodebaseMemoryNode[]; edges: readonly ICodebaseMemoryEdge[]; version: number; communityLabelByUri: ReadonlyMap<string, string> } | undefined;
	private loadPromise: Promise<void> | undefined;
	private workspaceGeneration = 0;

	constructor(
		@ICodebaseMemoryService private readonly memory: ICodebaseMemoryService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
	) {
		super();
		this._register(this.memory.onDidChange(() => { this.snapshot = undefined; this.workspaceGeneration++; }));
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => { this.snapshot = undefined; this.workspaceGeneration++; }));
	}

	private async ensure(): Promise<void> {
		if (this.snapshot) { return; }
		if (!this.loadPromise) {
			this.loadPromise = this.memory.getSnapshot().then(snapshot => {
				const communityLabelByUri = new Map<string, string>();
				for (const community of snapshot?.communities ?? []) {
					for (const member of community.members) { communityLabelByUri.set(member, community.label); }
				}
				this.snapshot = snapshot ? { nodes: snapshot.nodes, edges: snapshot.edges, version: snapshot.version.version, communityLabelByUri } : { nodes: [], edges: [], version: 0, communityLabelByUri };
			}).finally(() => { this.loadPromise = undefined; });
		}
		await this.loadPromise;
	}

	private async current() {
		const generation = this.workspaceGeneration;
		await this.ensure();
		if (generation !== this.workspaceGeneration) { await this.ensure(); }
		return this.snapshot!;
	}

	private itemForNode(node: ICodebaseMemoryNode, parentId?: string): IArchitectureItem {
		const kind: ArchitectureItemKind = node.kind === 'file' ? 'file' : 'symbol';
		const folders = this.contextService.getWorkspace().folders.map(folder => folder.uri);
		const root = folders.find(folder => { try { const parsed = URI.parse(node.uri); return parsed.path === folder.path || parsed.path.startsWith(folder.path.endsWith('/') ? folder.path : folder.path + '/'); } catch { return false; } });
		return { id: node.id, parentId, kind, name: node.name, path: relPath(node.uri, folders), uri: node.uri, rootId: root?.toString(), line: node.range?.startLine, fileCount: kind === 'file' ? 1 : 0, symbolCount: kind === 'symbol' ? 1 : 0, confidence: node.evidence.confidence, provider: node.evidence.provider, community: this.snapshot?.communityLabelByUri.get(node.uri), hasChildren: false };
	}

	async getArchitecture(path = '', maxItems = 300): Promise<IArchitectureScope> {
		const snapshot = await this.current();
		const workspaceUris = this.contextService.getWorkspace().folders.map(folder => folder.uri);
		let normalized = path.replace(/^\/+|\/+$/g, '');
		if (normalized.includes('://')) { normalized = relPath(normalized, workspaceUris); }
		const fileNodes = snapshot.nodes.filter(node => node.kind === 'file');
		const symbolByUri = new Map<string, ICodebaseMemoryNode[]>();
		for (const node of snapshot.nodes) {
			if (!isSymbol(node.kind)) { continue; }
			const list = symbolByUri.get(node.uri) ?? [];
			list.push(node);
			symbolByUri.set(node.uri, list);
		}
		const folders = new Map<string, IPathAggregate>();
		for (const file of fileNodes) {
			const filePath = relPath(file.uri, workspaceUris);
			const parts = filePath.split('/');
			const limit = Math.max(0, parts.length - 1);
			for (let i = 0; i <= limit; i++) {
				const folderPath = parts.slice(0, i).join('/');
				const key = folderPath || '(root)';
				const aggregate = folders.get(key) ?? { path: folderPath, files: new Set<string>(), symbols: 0 };
				aggregate.files.add(file.uri);
				aggregate.symbols += symbolByUri.get(file.uri)?.length ?? 0;
				folders.set(key, aggregate);
			}
		}

		const exactFile = fileNodes.find(file => relPath(file.uri, workspaceUris) === normalized);
		if (exactFile) {
			const symbols = symbolByUri.get(exactFile.uri) ?? [];
			const items = symbols.slice(0, maxItems).map(node => this.itemForNode(node, exactFile.id));
			const fileItem = { ...this.itemForNode(exactFile), fileCount: 1, symbolCount: symbols.length, hasChildren: symbols.length > 0 };
			return { path: normalized, breadcrumbs: [{ id: 'workspace', kind: 'workspace', name: 'Workspace', fileCount: fileNodes.length, symbolCount: snapshot.nodes.filter(n => isSymbol(n.kind)).length, hasChildren: true }, fileItem], items, total: symbols.length };
		}

		const baseParts = normalized ? normalized.split('/') : [];
		const children = new Map<string, IArchitectureItem>();
		for (const file of fileNodes) {
			const filePath = relPath(file.uri, workspaceUris);
			const parts = filePath.split('/');
			if (normalized && parts.slice(0, baseParts.length).join('/') !== normalized) { continue; }
			const remaining = parts.slice(baseParts.length);
			if (remaining.length === 1) {
				const symbols = symbolByUri.get(file.uri) ?? [];
				children.set(file.id, { ...this.itemForNode(file), fileCount: 1, symbolCount: symbols.length, hasChildren: symbols.length > 0 });
			} else {
				const childPath = [...baseParts, remaining[0]].join('/');
				const aggregate = folders.get(childPath) ?? { path: childPath, files: new Set<string>(), symbols: 0 };
				children.set('folder:' + childPath, { id: 'folder:' + childPath, parentId: normalized || undefined, kind: remaining.length > 1 ? 'module' : 'folder', name: remaining[0], path: childPath, fileCount: aggregate.files.size, symbolCount: aggregate.symbols, hasChildren: true });
			}
		}
		const items = [...children.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).slice(0, maxItems);
		const breadcrumbs: IArchitectureItem[] = [{ id: 'workspace', kind: 'workspace', name: 'Workspace', fileCount: fileNodes.length, symbolCount: snapshot.nodes.filter(n => isSymbol(n.kind)).length, hasChildren: true }];
		let currentPath = '';
		for (const part of baseParts) {
			currentPath = currentPath ? currentPath + '/' + part : part;
			const aggregate = folders.get(currentPath);
			breadcrumbs.push({ id: 'folder:' + currentPath, kind: 'folder', name: part, path: currentPath, fileCount: aggregate?.files.size ?? 0, symbolCount: aggregate?.symbols ?? 0, hasChildren: true });
		}
		return { path: normalized, breadcrumbs, items, total: children.size };
	}

	async getRelations(targetIds: string[], depth = 1, maxItems = 150, direction: 'incoming' | 'outgoing' | 'both' = 'both'): Promise<IGraphRelations[]> {
		const snapshot = await this.current();
		const nodes = new Map(snapshot.nodes.map(node => [node.id, node] as const));
		const bySource = new Map<string, ICodebaseMemoryEdge[]>();
		const byTarget = new Map<string, ICodebaseMemoryEdge[]>();
		for (const edge of snapshot.edges) {
			(bySource.get(edge.source) ?? (bySource.set(edge.source, []), bySource.get(edge.source)!)).push(edge);
			(byTarget.get(edge.target) ?? (byTarget.set(edge.target, []), byTarget.get(edge.target)!)).push(edge);
		}
		return targetIds.map(id => {
			const target = nodes.get(id);
			if (!target) { return undefined; }
			const result: { edge: ICodebaseMemoryEdge; node: ICodebaseMemoryNode }[] = [];
			const seen = new Set<string>([id]);
			let frontier = [id];
			for (let level = 0; level < Math.max(0, depth); level++) {
				const next: string[] = [];
				for (const current of frontier) {
					for (const edge of [...(direction !== 'incoming' ? (bySource.get(current) ?? []) : []), ...(direction !== 'outgoing' ? (byTarget.get(current) ?? []) : [])]) {
						const other = edge.source === current ? edge.target : edge.source;
						const node = nodes.get(other);
						if (!node || seen.has(other)) { continue; }
						seen.add(other); next.push(other); result.push({ edge, node });
						if (result.length >= maxItems) { break; }
					}
					if (result.length >= maxItems) { break; }
				}
				frontier = next;
				if (!frontier.length || result.length >= maxItems) { break; }
			}
			return { target, relations: result, depth };
		}).filter((value): value is IGraphRelations => !!value);
	}

	async search(query: string, maxItems = 50): Promise<ICodebaseMemoryNode[]> {
		const snapshot = await this.current();
		const q = query.trim().toLowerCase();
		if (!q) { return []; }
		return snapshot.nodes.filter(node => [node.name, node.qualifiedName, node.uri].some(value => value?.toLowerCase().includes(q))).sort((a, b) => (a.name.toLowerCase() === q ? -1 : 1) - (b.name.toLowerCase() === q ? -1 : 1) || b.evidence.confidence - a.evidence.confidence).slice(0, maxItems);
	}

	async getNodes(ids: string[]): Promise<ICodebaseMemoryNode[]> {
		const snapshot = await this.current();
		const wanted = new Set(ids);
		return snapshot.nodes.filter(node => wanted.has(node.id));
	}

	/**
	 * Mapa visual a NIVEL ARCHIVO: nodos = archivos, aristas = relaciones entre archivos
	 * (symbol-to-symbol ones are projected onto the file containing them, the same way
	 * finalizeGraph does to compute the communities). The highest-degree files stay,
	 * since they are the ones that give the map its shape.
	 */
	async getGraphView(path = '', maxNodes = 300): Promise<IGraphView> {
		const snapshot = await this.current();
		const folders = this.contextService.getWorkspace().folders.map(folder => folder.uri);
		const normalized = path.replace(/^\/+|\/+$/g, '');

		const files = snapshot.nodes.filter(node => node.kind === 'file');
		const inScope = new Map<string, { node: ICodebaseMemoryNode; path: string }>();
		for (const file of files) {
			const filePath = relPath(file.uri, folders);
			if (normalized && filePath !== normalized && !filePath.startsWith(normalized + '/')) { continue; }
			inScope.set(file.uri, { node: file, path: filePath });
		}
		// Symbol → containing file, to project the edges.
		const uriByNodeId = new Map<string, string>();
		for (const node of snapshot.nodes) { uriByNodeId.set(node.id, node.uri); }

		const degree = new Map<string, number>();
		const pairs = new Set<string>();
		for (const edge of snapshot.edges) {
			const sourceUri = uriByNodeId.get(edge.source);
			const targetUri = uriByNodeId.get(edge.target);
			if (!sourceUri || !targetUri || sourceUri === targetUri) { continue; }
			if (!inScope.has(sourceUri) || !inScope.has(targetUri)) { continue; }
			pairs.add(`${sourceUri}\0${targetUri}`);
			degree.set(sourceUri, (degree.get(sourceUri) ?? 0) + 1);
			degree.set(targetUri, (degree.get(targetUri) ?? 0) + 1);
		}

		const ranked = [...inScope.entries()]
			.sort((a, b) => (degree.get(b[0]) ?? 0) - (degree.get(a[0]) ?? 0) || a[1].path.localeCompare(b[1].path));
		const kept = ranked.slice(0, Math.max(1, maxNodes));

		// The id is the index node's, NOT the uri: selecting in the map reuses `getRelations`,
		// which resolves by id — with the uri the inspector would always be empty.
		const nodes: IGraphViewNode[] = kept.map(([uri, entry]) => ({
			id: entry.node.id,
			name: entry.path.split('/').pop() || entry.path,
			path: entry.path,
			uri,
			community: this.snapshot?.communityLabelByUri.get(uri) ?? '(sin módulo)',
			degree: degree.get(uri) ?? 0,
		}));
		const nodeIdByUri = new Map(kept.map(([uri, entry]) => [uri, entry.node.id] as const));
		const edges: { source: string; target: string }[] = [];
		for (const pair of pairs) {
			const [sourceUri, targetUri] = pair.split('\0');
			const source = nodeIdByUri.get(sourceUri);
			const target = nodeIdByUri.get(targetUri);
			if (source && target) { edges.push({ source, target }); }
		}
		const counts = new Map<string, number>();
		for (const node of nodes) { counts.set(node.community, (counts.get(node.community) ?? 0) + 1); }
		const modules = [...counts.entries()]
			.map(([label, count]) => ({ label, count }))
			.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

		return { nodes, edges, modules, truncated: Math.max(0, ranked.length - kept.length) };
	}

	async getDependencyMatrix(path = '', maxCells = 300): Promise<IArchitectureMatrixCell[]> {
		const snapshot = await this.current();
		const folders = this.contextService.getWorkspace().folders.map(folder => folder.uri);
		const modules = new Map<string, { name: string; files: Set<string> }>();
		for (const node of snapshot.nodes.filter(node => node.kind === 'file')) {
			const filePath = relPath(node.uri, folders);
			const parts = filePath.split('/');
			const modulePath = parts.slice(0, Math.min(parts.length - 1, 2)).join('/');
			if (path && modulePath !== path && !modulePath.startsWith(path.endsWith('/') ? path : path + '/')) { continue; }
			const module = modules.get(modulePath) ?? { name: parts[Math.max(0, Math.min(parts.length - 2, 1))] || '(root)', files: new Set<string>() };
			module.files.add(node.id);
			modules.set(modulePath, module);
		}
		const byNode = new Map(snapshot.nodes.map(node => [node.id, node] as const));
		const cells = new Map<string, IArchitectureMatrixCell>();
		for (const edge of snapshot.edges.filter(edge => edge.type === 'IMPORTS' || edge.type === 'DEPENDS_ON' || edge.type === 'USES')) {
			const source = byNode.get(edge.source); const target = byNode.get(edge.target);
			if (!source || !target) { continue; }
			const sourcePath = relPath(source.uri, folders); const targetPath = relPath(target.uri, folders);
			const sourceModule = [...modules.entries()].find(([, value]) => [...value.files].some(file => byNode.get(file)?.uri === source.uri))?.[0] ?? sourcePath.split('/').slice(0, 2).join('/');
			const targetModule = [...modules.entries()].find(([, value]) => [...value.files].some(file => byNode.get(file)?.uri === target.uri))?.[0] ?? targetPath.split('/').slice(0, 2).join('/');
			if (sourceModule === targetModule) { continue; }
			const key = sourceModule + '::' + targetModule; const current = cells.get(key);
			if (current) { cells.set(key, { ...current, count: current.count + 1, relations: [...current.relations, edge] }); } else { cells.set(key, { source: sourceModule, target: targetModule, sourceName: modules.get(sourceModule)?.name ?? sourceModule, targetName: modules.get(targetModule)?.name ?? targetModule, count: 1, relations: [edge] }); }
		}
		return [...cells.values()].sort((a, b) => b.count - a.count).slice(0, maxCells);
	}

	async getSnapshotVersion(): Promise<number> { return (await this.current()).version; }
}
