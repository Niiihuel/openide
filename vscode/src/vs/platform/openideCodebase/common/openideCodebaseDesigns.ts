/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { URI } from '../../../base/common/uri.js';
import { ICodebaseMemoryNode, ICodebaseMemoryEdge, makeEvidence, makeNodeId } from './openideCodebaseMemoryTypes.js';
export function isCodebaseDesignDocument(uri: string): boolean { return /\/\.openide\/designs\/[a-z0-9][a-z0-9-]*\/design\.json$/.test(URI.parse(uri).path); }
/** A bounded derived view of the current design. Undo history and assets are not indexed. */
export function extractCodebaseDesign(workspaceKey: string, uri: string, content: string): {
	nodes: ICodebaseMemoryNode[];
	edges: ICodebaseMemoryEdge[];
} {
	const empty = { nodes: [], edges: [] };
	if (!isCodebaseDesignDocument(uri) || content.length > 2000000) {
		return empty;
	}
	let file: {
		schemaVersion: number;
		revision: number;
		document: {
			title: string;
			screens: {
				id: string;
				title: string;
				nodes: {
					id: string;
					text: string;
					action?: string;
					target?: string;
					sourcePath?: string;
					children: unknown[];
				}[];
			}[];
		};
	};
	try {
		file = JSON.parse(content);
	}
	catch {
		return empty;
	}
	if (file?.schemaVersion !== 1 || !Number.isSafeInteger(file.revision) || typeof file.document?.title !== 'string' || !Array.isArray(file.document.screens) || file.document.screens.length > 50) {
		return empty;
	}
	const evidence = makeEvidence('text');
	const resource = URI.parse(uri);
	const root = resource.with({ path: resource.path.split('/.openide/designs/')[0] });
	const fileId = makeNodeId(workspaceKey, uri, 'file', uri), designId = makeNodeId(workspaceKey, uri, 'note', 'canvas');
	const nodes: ICodebaseMemoryNode[] = [{ id: fileId, kind: 'file', name: file.document.title, uri, evidence, degree: 0, metadata: { canvasKind: 'design', revision: file.revision } }, { id: designId, kind: 'note', name: `Canvas: ${file.document.title}`, uri, evidence, degree: 0, metadata: { canvasKind: 'design', revision: file.revision, provenance: 'document_projection' } }];
	const edges: ICodebaseMemoryEdge[] = [{ source: fileId, target: designId, type: 'CONTAINS', evidence }];
	const screens = new Map<string, string>();
	for (const screen of file.document.screens) {
		if (!screen || typeof screen.id !== 'string' || !/^\w[\w-]{0,79}$/.test(screen.id) || screens.has(screen.id) || typeof screen.title !== 'string' || !Array.isArray(screen.nodes)) {
			return empty;
		}
		const id = makeNodeId(workspaceKey, uri, 'note', `screen:${screen.id}`);
		screens.set(screen.id, id);
		nodes.push({ id, kind: 'note', name: `Screen: ${screen.title}`, uri, evidence, degree: 0, metadata: { canvasKind: 'screen', screenId: screen.id, revision: file.revision } });
		edges.push({ source: designId, target: id, type: 'CONTAINS', evidence });
	}
	let count = 0;
	for (const screen of file.document.screens) {
		const description: string[] = [];
		const walk = (values: unknown[], depth: number): void => { if (depth > 12) {
			return;
		} for (const value of values) {
			if (++count > 500 || !value || typeof value !== 'object') {
				return;
			}
			const node = value as {
				text?: string;
				target?: string;
				sourcePath?: string;
				children?: unknown[];
			};
			if (typeof node.text === 'string') {
				description.push(node.text.slice(0, 300));
			}
			if (typeof node.target === 'string' && screens.has(node.target)) {
				edges.push({ source: screens.get(screen.id)!, target: screens.get(node.target)!, type: 'REFERENCES', evidence });
			}
			if (typeof node.sourcePath === 'string' && /^[\w.-][\w./ -]*$/.test(node.sourcePath) && !node.sourcePath.split('/').includes('..')) {
				const target = URI.joinPath(root, node.sourcePath).toString();
				edges.push({ source: screens.get(screen.id)!, target: makeNodeId(workspaceKey, target, 'file', target), type: 'REFERENCES', evidence });
			}
			if (Array.isArray(node.children)) {
				walk(node.children, depth + 1);
			}
		} };
		walk(screen.nodes, 0);
		const index = nodes.findIndex(n => n.id === screens.get(screen.id));
		nodes[index] = { ...nodes[index], documentation: description.join('\n').slice(0, 8000) };
	}
	return count <= 500 ? { nodes, edges } : empty;
}
