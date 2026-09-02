/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseNodeMap } from '../../common/diagrams/openideNodeMaps.js';
import { t } from '../../common/openideStrings.js';
import { IGraphView } from '../openideCodebaseGraphService.js';

/**
 * The Project Map, told as an architecture. The map shows the measured truth — files, imports,
 * Louvain modules; this projects THAT SAME truth one level up into an archmap: one node per
 * module, one edge per aggregated cross-module dependency. The hard part (detection) is the
 * index's; this is only the retelling, which is why it stays a pure projection with no analysis
 * of its own.
 */

const MAX_MODULES = 12;
const MAX_EDGES = 24;
/** The contract's evidence cap, mirrored here so the projection never trips its own validator. */
const MAX_SOURCES = 3;

/** What a module NAME says about its role. Order matters: the first hit wins. */
const KIND_HINTS: readonly [RegExp, string][] = [
	[/ui|front|view|component|page|web|render|browser|screen|widget/i, 'frontend'],
	[/db|data|storage|sql|model|schema|persist|repo(sitor)?y/i, 'database'],
	[/auth|security|crypt|token|session/i, 'security'],
	[/queue|bus|event|stream|worker|job/i, 'messagebus'],
	[/infra|deploy|cloud|docker|ops|build|ci/i, 'cloud'],
	[/extern|vendor|third|lib|deps/i, 'external'],
];

function kindFor(label: string): string {
	for (const [pattern, kind] of KIND_HINTS) {
		if (pattern.test(label)) { return kind; }
	}
	return 'backend';
}

function idFor(label: string, taken: Set<string>): string {
	const base = label.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'modulo';
	let id = base;
	for (let n = 2; taken.has(id); n++) { id = `${base}-${n}`; }
	taken.add(id);
	return id;
}

/**
 * Projects the graph view into archmap SOURCE (the same JSON the agent authors), or undefined
 * when the index has nothing to say yet. Going through the source and its validator on purpose:
 * the projection obeys the exact contract the agent does, so the viewer, the hulls and the legend
 * cannot diverge between an authored map and this generated one.
 */
export function buildProjectArchMapSource(view: IGraphView, title: string): string | undefined {
	// Aggregate the file edges up to module pairs FIRST: connectivity decides who earns a node.
	// Louvain leaves a trail of one-file singleton communities behind, and a module nobody
	// depends on and that depends on nobody is noise, not architecture — drawn, each one parked
	// on its own rail stretching the canvas while saying nothing.
	const moduleOf = new Map(view.nodes.map(node => [node.id, node.community]));
	const weights = new Map<string, number>();
	const connected = new Set<string>();
	for (const edge of view.edges) {
		const source = moduleOf.get(edge.source);
		const target = moduleOf.get(edge.target);
		if (!source || !target || source === target) { continue; }
		const key = `${source}\0${target}`;
		weights.set(key, (weights.get(key) ?? 0) + 1);
		connected.add(source);
		connected.add(target);
	}

	const ranked = [...view.modules].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	let modules = ranked.filter(module => connected.has(module.label)).slice(0, MAX_MODULES);
	if (modules.length < 2) {
		// An index with no cross-module edges yet: showing the biggest modules beats showing nothing.
		modules = ranked.slice(0, MAX_MODULES);
	}
	if (modules.length < 2) {
		return undefined;
	}

	// The files behind each module, best first. This is the evidence Archify makes an agent author
	// and then verifies against a commit; here it costs nothing, because the index already knows
	// exactly which files a module is made of. Most connected first: the hub of a module is the file
	// that explains it, and it is the one whose header comment the inspector will read.
	const filesByModule = new Map<string, { path: string; degree: number }[]>();
	for (const node of view.nodes) {
		const bucket = filesByModule.get(node.community) ?? filesByModule.set(node.community, []).get(node.community)!;
		bucket.push({ path: node.path, degree: node.degree });
	}
	const sourcesFor = (label: string): string[] | undefined => {
		const files = filesByModule.get(label);
		if (!files?.length) {
			return undefined;
		}
		return files
			.sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path))
			.slice(0, MAX_SOURCES)
			.map(file => file.path);
	};

	const taken = new Set<string>();
	const idByModule = new Map(modules.map(module => [module.label, idFor(module.label, taken)]));
	const emphasis = modules[0].label;
	const nodes = modules.map(module => ({
		id: idByModule.get(module.label)!,
		label: module.label,
		kind: kindFor(module.label),
		sublabel: module.count === 1 ? t('archmap.project.file') : t('archmap.project.files', module.count),
		emphasis: module.label === emphasis,
		sources: sourcesFor(module.label),
	}));
	const edges = [...weights.entries()]
		// Only pairs whose BOTH ends earned a node: the weights were aggregated before the cut.
		.filter(([key]) => key.split('\0').every(label => idByModule.has(label)))
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_EDGES)
		.map(([key, weight]) => {
			const [source, target] = key.split('\0');
			return {
				from: idByModule.get(source)!,
				to: idByModule.get(target)!,
				label: weight > 1 ? `×${weight}` : undefined,
			};
		});

	const source = JSON.stringify({ type: 'archmap', title, nodes, edges });
	// The contract is the arbiter, not this projection: if the index hands back something the
	// validator rejects, showing nothing beats showing a map that lies about being checked.
	return parseNodeMap(source).spec ? source : undefined;
}
