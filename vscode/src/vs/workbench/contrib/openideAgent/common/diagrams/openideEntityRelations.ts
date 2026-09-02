/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the index's relations, bucketed into the sections a person reads.
 *
 *  The graph speaks twenty relation types and both directions; a panel that printed all forty
 *  combinations would be a database dump. What a developer actually asks about a file is a short
 *  list — what does it define, what does it pull in, who pulls IT in, who calls it — so the types
 *  are folded into those buckets, in the order that answers "what is this" before "who touches it".
 *
 *  Direction is what most of the meaning hangs on: the SAME `IMPORTS` edge is "importa" from one
 *  end and "importado por" from the other, and confusing the two inverts the architecture.
 *
 *  PURE: ids and edges in, buckets out. No services, no DOM.
 *--------------------------------------------------------------------------------------------*/

import { CodebaseMemoryNodeKind, CodebaseMemoryRelationType, ICodebaseMemoryEdge, ICodebaseMemoryNode } from '../../../../../code/common/openideCodebaseMemoryTypes.js';

export type EntityRelationBucket = 'defines' | 'imports' | 'importedBy' | 'calls' | 'usedBy' | 'related';

/** Reading order: what it IS, then what it needs, then who needs it. */
export const ENTITY_RELATION_ORDER: readonly EntityRelationBucket[] = ['defines', 'imports', 'importedBy', 'calls', 'usedBy', 'related'];

export function bucketFor(type: CodebaseMemoryRelationType, outgoing: boolean): EntityRelationBucket {
	switch (type) {
		case 'CONTAINS':
		case 'DEFINES':
			// Only downwards: a symbol's file is the level you came FROM, not a relation to list.
			return outgoing ? 'defines' : 'related';
		case 'IMPORTS':
		case 'DEPENDS_ON':
			return outgoing ? 'imports' : 'importedBy';
		case 'CALLS':
			return outgoing ? 'calls' : 'usedBy';
		case 'CALLED_BY':
			// The inverse edge, stored the other way around: flip its reading too.
			return outgoing ? 'usedBy' : 'calls';
		case 'REFERENCES':
		case 'USES':
		case 'READS':
		case 'WRITES':
		case 'INSTANTIATES':
			return outgoing ? 'calls' : 'usedBy';
		default:
			return 'related';
	}
}

export interface IEntityRelationGroup {
	readonly bucket: EntityRelationBucket;
	readonly nodes: readonly ICodebaseMemoryNode[];
}

/**
 * Groups one entity's relations for display: deduplicated by node id (the index can hold several
 * edges between the same pair and the panel must not repeat a row), each bucket sorted by degree so
 * the answer that explains the most comes first, and empty buckets left out entirely.
 */
export function groupEntityRelations(
	id: string,
	relations: readonly { readonly edge: ICodebaseMemoryEdge; readonly node: ICodebaseMemoryNode }[],
	maxPerBucket = 12,
): IEntityRelationGroup[] {
	const byBucket = new Map<EntityRelationBucket, Map<string, ICodebaseMemoryNode>>();
	for (const relation of relations) {
		if (relation.node.id === id) {
			continue;
		}
		const bucket = bucketFor(relation.edge.type, relation.edge.source === id);
		const nodes = byBucket.get(bucket) ?? byBucket.set(bucket, new Map()).get(bucket)!;
		if (!nodes.has(relation.node.id)) {
			nodes.set(relation.node.id, relation.node);
		}
	}
	const groups: IEntityRelationGroup[] = [];
	for (const bucket of ENTITY_RELATION_ORDER) {
		const nodes = byBucket.get(bucket);
		if (!nodes?.size) {
			continue;
		}
		groups.push({
			bucket,
			nodes: [...nodes.values()]
				.sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
				.slice(0, maxPerBucket),
		});
	}
	return groups;
}

/**
 * The codicon for an indexed entity, so a function looks like a function and a class like a class.
 * The same glyph on every row is the icon saying nothing the name did not already say — the whole
 * reason to draw one is that the eye can sort the list before reading it.
 *
 * Files are absent on purpose: they get the user's FILE ICON THEME instead, which is richer than
 * any fixed glyph (a `.ts` looks like a `.ts`).
 */
const KIND_ICONS: Partial<Record<CodebaseMemoryNodeKind, string>> = {
	module: 'symbol-namespace',
	namespace: 'symbol-namespace',
	package: 'package',
	folder: 'folder',
	class: 'symbol-class',
	interface: 'symbol-interface',
	trait: 'symbol-interface',
	enum: 'symbol-enum',
	type: 'symbol-structure',
	function: 'symbol-method',
	method: 'symbol-method',
	constructor: 'symbol-constructor',
	property: 'symbol-property',
	field: 'symbol-field',
	variable: 'symbol-variable',
	constant: 'symbol-constant',
	endpoint: 'radio-tower',
	route: 'link',
	databaseEntity: 'database',
	test: 'beaker',
	configuration: 'settings-gear',
	dependency: 'package',
	note: 'note',
};

export function entityIconId(kind: CodebaseMemoryNodeKind): string {
	return KIND_ICONS[kind] ?? 'symbol-misc';
}
