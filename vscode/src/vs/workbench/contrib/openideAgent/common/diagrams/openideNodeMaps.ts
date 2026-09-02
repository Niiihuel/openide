/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — typed node maps (```archmap / ```flowmap / ```lifemap fences): the JSON IRs the
 *  agent AUTHORS, following Archify's model (tt-a1i/archify, MIT): the agent writes semantics —
 *  components, kinds, boundaries, connections — and validation answers with machine-readable
 *  diagnostics it can act on. The three types share ONE shape ({nodes, edges}) and differ only
 *  in their kind vocabulary, which is the whole trick: one contract to learn, one validator, one
 *  renderer skin. What Archify leaves to the agent (positions, routes, label geometry) is
 *  deliberately NOT in the contract: layout is deterministic here — Archify's COMPOSITION (one
 *  direction of flow, layered depth, minimized crossings, boundaries as real containers),
 *  computed instead of authored — so a whole family of geometry repairs never exists.
 *
 *  PURE like the rest of the engine: no DOM, no services. The one vs/ import is the Project
 *  Map's layout module, which is itself pure (it is also consumed from the shared process) — the
 *  standalone MCP server (node) loads this file and must keep working outside the workbench.
 *--------------------------------------------------------------------------------------------*/

import { ILayoutEdge, ILayoutInputNode, layoutLayered } from '../../../../../code/common/openideCodebaseGraphLayout.js';

/** One kind vocabulary per map type; everything else about the contract is shared. */
export const NODE_MAP_KINDS = {
	archmap: ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'],
	flowmap: ['start', 'step', 'decision', 'tool', 'end', 'failure'],
	lifemap: ['initial', 'active', 'waiting', 'terminal', 'failure'],
} as const;

export type NodeMapType = keyof typeof NODE_MAP_KINDS;
export const NODE_MAP_TYPES = Object.keys(NODE_MAP_KINDS) as readonly NodeMapType[];

export interface INodeMapNode {
	readonly id: string;
	readonly label: string;
	/** Validated against the map type's vocabulary (NODE_MAP_KINDS). */
	readonly kind: string;
	readonly sublabel?: string;
	/** Boundary for an archmap, lane for a flowmap. Members cluster together and get a hull. */
	readonly group?: string;
	/**
	 * The files this node stands for, repo-relative and POSIX — Archify's "evidence passport"
	 * (docs/research-repo-evidence-passport-2026-07-23.md), which is how a drawn box stops being a
	 * claim and becomes a doorway into the code that proves it. One to three, because a component
	 * that needs a fourth is really two components.
	 *
	 * Archify makes the agent author these and then verifies them against a pinned commit. Here the
	 * project's own map fills them from the INDEX, which already knows which files a module is made
	 * of — the code-indexer half Archify explicitly decided not to build.
	 */
	readonly sources?: readonly string[];
	/** Drawn with the Project Map's "god node" ring. */
	readonly emphasis: boolean;
}

export interface INodeMapEdge {
	readonly from: string;
	readonly to: string;
	readonly label?: string;
	/** Async / optional relationship, drawn dashed. */
	readonly dashed: boolean;
}

export interface INodeMapSpec {
	readonly type: NodeMapType;
	readonly title?: string;
	readonly nodes: readonly INodeMapNode[];
	readonly edges: readonly INodeMapEdge[];
}

/**
 * Archify-style diagnostic: a stable code, the exact subject, and — when the repair is not
 * obvious from the message — the supported fix. The MCP `map_validate` tool returns these
 * verbatim so an agent can iterate generate → validate → repair without guessing.
 */
export interface INodeMapDiagnostic {
	readonly code: string;
	readonly severity: 'error' | 'warning';
	/** What the diagnostic is about: a node id, an edge "from→to", or a top-level field. */
	readonly subject: string;
	readonly message: string;
	readonly fix?: string;
}

export interface INodeMapParseResult {
	/** Present only when there is no error-severity diagnostic. Warnings never block. */
	readonly spec?: INodeMapSpec;
	readonly diagnostics: readonly INodeMapDiagnostic[];
}

/** Cheap gate so `parseDiagramSource` does not run JSON.parse on every mermaid fence. */
export function looksLikeNodeMap(source: string): boolean {
	const head = source.trimStart();
	return head.startsWith('{') && NODE_MAP_TYPES.some(type => head.includes(`"${type}"`));
}

const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
/** Past this the map stops being a map and becomes a hairball; Archify caps showcase at 12. */
const DENSITY_NODES = 16;
const DENSITY_EDGES = 32;
const LABEL_MAX = 40;
/** Archify's evidence cap: one to three files per component, no more. */
const SOURCES_MAX = 3;

type Warn = (code: string, subject: string, message: string, fix?: string) => void;

/**
 * The evidence, checked but never blocking: a bad path costs the node its doorway, not its place in
 * the picture. Absolute paths and `..` are refused because evidence that points outside the
 * repository proves nothing about it — and because the file that is written gets committed and read
 * on somebody else's machine.
 */
function parseSources(value: unknown, id: string, warn: Warn): readonly string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		warn('map/sources', id, 'sources debe ser un array de rutas del repo; se ignora');
		return undefined;
	}
	const paths: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string' || !entry.trim()) {
			warn('map/source', id, 'cada source debe ser una ruta no vacía; se ignora');
			continue;
		}
		const path = entry.trim().replace(/\\/g, '/').replace(/^\.\//, '');
		if (path.startsWith('/') || /^[A-Za-z]:\//.test(path) || path.split('/').includes('..')) {
			warn('map/source', id, `ruta "${path}" fuera del repositorio; se ignora`, 'usá una ruta relativa a la raíz del repo, sin ".."');
			continue;
		}
		if (paths.length === SOURCES_MAX) {
			warn('map/sources-max', id, `más de ${SOURCES_MAX} archivos; se toman los primeros ${SOURCES_MAX}`, 'si un componente necesita un cuarto archivo, probablemente son dos componentes');
			break;
		}
		paths.push(path);
	}
	return paths.length ? paths : undefined;
}

export function parseNodeMap(source: string): INodeMapParseResult {
	const diagnostics: INodeMapDiagnostic[] = [];
	const error = (code: string, subject: string, message: string, fix?: string): void => {
		diagnostics.push({ code, severity: 'error', subject, message, fix });
	};
	const warn = (code: string, subject: string, message: string, fix?: string): void => {
		diagnostics.push({ code, severity: 'warning', subject, message, fix });
	};

	let raw: unknown;
	try {
		raw = JSON.parse(source);
	} catch (e) {
		error('map/json', 'source', `JSON inválido: ${e instanceof Error ? e.message : String(e)}`);
		return { diagnostics };
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		error('map/json', 'source', 'la fuente debe ser un objeto JSON');
		return { diagnostics };
	}
	const doc = raw as Record<string, unknown>;
	const type = typeof doc.type === 'string' ? doc.type : '';
	if (!(NODE_MAP_TYPES as readonly string[]).includes(type)) {
		error('map/type', 'type', `falta "type" con uno de: ${NODE_MAP_TYPES.join(', ')}`);
		return { diagnostics };
	}
	const kinds: readonly string[] = NODE_MAP_KINDS[type as NodeMapType];

	const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : undefined;
	if (doc.title !== undefined && typeof doc.title !== 'string') {
		warn('map/title', 'title', 'title debe ser un string; se ignora');
	}

	const nodes: INodeMapNode[] = [];
	const seenIds = new Set<string>();
	const rawNodes = Array.isArray(doc.nodes) ? doc.nodes : undefined;
	if (!rawNodes || !rawNodes.length) {
		error('map/nodes', 'nodes', 'nodes debe ser un array con al menos un componente');
		return { diagnostics };
	}
	rawNodes.forEach((value, index) => {
		const subject = `nodes[${index}]`;
		if (!value || typeof value !== 'object') {
			error('map/node', subject, 'cada nodo debe ser un objeto {id, label, kind}');
			return;
		}
		const node = value as Record<string, unknown>;
		const id = typeof node.id === 'string' ? node.id.trim() : '';
		if (!id || !ID_PATTERN.test(id)) {
			error('map/node-id', subject, 'id requerido: string estable con [A-Za-z0-9_.-]');
			return;
		}
		if (seenIds.has(id)) {
			error('map/node-id', id, 'id duplicado');
			return;
		}
		const label = typeof node.label === 'string' ? node.label.trim() : '';
		if (!label) {
			error('map/node-label', id, 'label requerido y no vacío');
			return;
		}
		if (label.length > LABEL_MAX) {
			warn('map/label-length', id, `label de ${label.length} caracteres; un nombre corto lee mejor`, `acortá a ≤ ${LABEL_MAX} caracteres y mové el detalle a sublabel`);
		}
		const kind = typeof node.kind === 'string' ? node.kind.trim().toLowerCase() : '';
		if (!kinds.includes(kind)) {
			error('map/node-kind', id, `kind "${String(node.kind ?? '')}" no soportado en ${type}`, `usá uno de: ${kinds.join(', ')}`);
			return;
		}
		const sublabel = typeof node.sublabel === 'string' && node.sublabel.trim() ? node.sublabel.trim() : undefined;
		const group = typeof node.group === 'string' && node.group.trim() ? node.group.trim() : undefined;
		const sources = parseSources(node.sources, id, warn);
		seenIds.add(id);
		nodes.push({ id, label, kind, sublabel, group, emphasis: node.emphasis === true, sources });
	});

	const edges: INodeMapEdge[] = [];
	const seenPairs = new Set<string>();
	const rawEdges = Array.isArray(doc.edges) ? doc.edges : [];
	if (doc.edges !== undefined && !Array.isArray(doc.edges)) {
		error('map/edges', 'edges', 'edges debe ser un array');
	}
	rawEdges.forEach((value, index) => {
		const subject = `edges[${index}]`;
		if (!value || typeof value !== 'object') {
			error('map/edge', subject, 'cada conexión debe ser un objeto {from, to}');
			return;
		}
		const edge = value as Record<string, unknown>;
		const from = typeof edge.from === 'string' ? edge.from.trim() : '';
		const to = typeof edge.to === 'string' ? edge.to.trim() : '';
		if (!seenIds.has(from) || !seenIds.has(to)) {
			error('map/edge-endpoint', `${from || '?'}→${to || '?'}`, 'from y to deben referir ids de nodes declarados', `ids declarados: ${[...seenIds].join(', ')}`);
			return;
		}
		if (from === to) {
			warn('map/edge-self', from, 'conexión de un nodo a sí mismo; se omite');
			return;
		}
		const pair = `${from}\0${to}`;
		if (seenPairs.has(pair)) {
			warn('map/edge-duplicate', `${from}→${to}`, 'conexión duplicada; se omite');
			return;
		}
		seenPairs.add(pair);
		const label = typeof edge.label === 'string' && edge.label.trim() ? edge.label.trim() : undefined;
		edges.push({ from, to, label, dashed: edge.dashed === true });
	});

	if (nodes.length > DENSITY_NODES) {
		warn('map/density', 'nodes', `${nodes.length} nodos; un mapa legible tiene ≤ 12 primarios`, 'agrupá detalle en menos componentes o mové lo secundario a sublabel');
	}
	if (edges.length > DENSITY_EDGES) {
		warn('map/density', 'edges', `${edges.length} conexiones; quitá las de bajo valor antes de sumar más`);
	}

	if (diagnostics.some(d => d.severity === 'error')) {
		return { diagnostics };
	}
	return { spec: { type: type as NodeMapType, title, nodes, edges }, diagnostics };
}

// ---------------------------------- shapes & sizing ----------------------------------

export type NodeMapShape = 'card' | 'stadium' | 'diamond';

/**
 * Every diagram type draws the shape its readers already know: an architecture component is a
 * CARD, a workflow start/end is a STADIUM and its decision a DIAMOND, a lifecycle state is a
 * pill. The skin (paper fill, kind-coloured accent, dotted canvas) stays ours; the shape
 * vocabulary is the diagram's.
 */
export function nodeMapShapeFor(type: NodeMapType, kind: string): NodeMapShape {
	if (type === 'flowmap') {
		if (kind === 'decision') { return 'diamond'; }
		if (kind === 'start' || kind === 'end') { return 'stadium'; }
		return 'card';
	}
	if (type === 'lifemap') {
		return 'stadium';
	}
	return 'card';
}

const CHAR_W = 6.6;
const SUB_CHAR_W = 5.4;
const CARD_PAD_X = 34;
const MIN_NODE_W = 104;
const MAX_NODE_W = 208;

/** Label-aware box: the text lives INSIDE the shape now, so the shape must earn its room. */
function measureNode(node: INodeMapNode, shape: NodeMapShape): { w: number; h: number } {
	const textW = Math.max(node.label.length * CHAR_W, (node.sublabel?.length ?? 0) * SUB_CHAR_W);
	let w = Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, Math.round(textW) + CARD_PAD_X));
	let h = node.sublabel ? 52 : 40;
	if (shape === 'stadium') {
		w += 14;
	} else if (shape === 'diamond') {
		// Only the inscribed rectangle holds text; the box grows so the label clears the slopes.
		w = Math.round(w * 1.45);
		h = Math.round(h * 1.6);
	}
	return { w, h };
}

// ---------------------------------- layout ----------------------------------

export interface INodeMapPlacedNode extends INodeMapNode {
	/** Centre of the shape. */
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly shape: NodeMapShape;
	readonly degree: number;
}

/** Bounding hull of one authored group (boundary or lane), label included. */
export interface INodeMapHull {
	readonly label: string;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

export interface INodeMapLayout {
	readonly width: number;
	readonly height: number;
	readonly nodes: readonly INodeMapPlacedNode[];
	readonly hulls: readonly INodeMapHull[];
}

/** Hull padding: sideways past the box, extra on top where the hull's own label sits. */
const HULL_PAD_X = 22;
const HULL_PAD_TOP = 32;
const HULL_PAD_BOTTOM = 18;
/** Flow axis: clear air between one layer's widest box and the next (chips ride here). */
const LAYER_AIR = 110;
/** Rail axis: clear air between rows of boxes. */
const ROW_AIR = 42;
/** Extra separation between bands, so a hull's padding can never reach the next band's rail. */
const BAND_GAP = 26;
const PAD_X = 40;
const PAD_Y = 30;
/** The shared band every ungrouped node packs into (a real group can never be named this: `g:` prefix). */
const FREE_BAND = '\0free';

/**
 * Archify's composition, computed instead of authored. Pass 1 is the Sugiyama pipeline the fork
 * already had waiting (`layoutLayered`: deterministic cycle break, longest-path layers, median
 * crossing reduction) — it decides depth and order, and its layers become COLUMNS so the map reads
 * left → right; a lifemap's retry cycles survive as back edges that simply draw right → left.
 * Pass 2 re-derives the coordinates on BANDS: each authored group (boundary, lane) is one band
 * and every ungrouped node packs into one shared band. A band owns a contiguous strip of rails
 * across every layer, which is what makes a boundary a real container — no foreign node can land
 * inside a group's hull in any layer, which a bounding box over free positions could never
 * promise — while the ungrouped nodes share rails instead of each stretching the canvas.
 */
export function layoutNodeMap(spec: INodeMapSpec): INodeMapLayout {
	const degree = new Map<string, number>();
	const layoutEdges: ILayoutEdge[] = [];
	for (const edge of spec.edges) {
		degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
		degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
		layoutEdges.push({ source: edge.from, target: edge.to });
	}
	const inputs: ILayoutInputNode[] = spec.nodes.map(node => ({
		id: node.id,
		community: node.group ? `g:${node.group}` : `k:${node.kind}`,
		degree: degree.get(node.id) ?? 0,
	}));

	// Pass 1: only the layer and the crossing-reduced ORDER survive; the nominal canvas does not.
	const pass = layoutLayered(inputs, layoutEdges, 1000, 700);
	const layerOf = new Map(pass.nodes.map(node => [node.id, node.layer]));
	const crossOf = new Map(pass.nodes.map(node => [node.id, node.x]));
	const layerCount = Math.max(1, pass.layers);

	const shapeOf = new Map(spec.nodes.map(node => [node.id, nodeMapShapeFor(spec.type, node.kind)]));
	const sizeOf = new Map(spec.nodes.map(node => [node.id, measureNode(node, shapeOf.get(node.id)!)]));

	// Pass 2: bands, ordered by where crossing reduction wanted their members on average.
	interface IBand { readonly key: string; readonly members: string[]; order: number }
	const bandByKey = new Map<string, IBand>();
	for (const node of spec.nodes) {
		const key = node.group ? `g:${node.group}` : FREE_BAND;
		const band = bandByKey.get(key) ?? { key, members: [], order: 0 };
		band.members.push(node.id);
		bandByKey.set(key, band);
	}
	const bandList = [...bandByKey.values()];
	for (const band of bandList) {
		band.order = band.members.reduce((sum, id) => sum + (crossOf.get(id) ?? 0), 0) / band.members.length;
	}
	bandList.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

	// Rails per band = the most members it puts into one single layer.
	const bandTopRail = new Map<string, number>();
	const bandIndex = new Map<string, number>();
	let railCursor = 0;
	bandList.forEach((band, index) => {
		bandIndex.set(band.key, index);
		bandTopRail.set(band.key, railCursor);
		const perLayer = new Map<number, number>();
		for (const id of band.members) {
			const layer = layerOf.get(id) ?? 0;
			perLayer.set(layer, (perLayer.get(layer) ?? 0) + 1);
		}
		railCursor += Math.max(1, ...perLayer.values());
	});

	// Columns are as wide as their widest box; rows share one pitch set by the tallest box.
	const layerWidth = new Array<number>(layerCount).fill(MIN_NODE_W);
	let tallest = 40;
	for (const node of spec.nodes) {
		const size = sizeOf.get(node.id)!;
		const layer = layerOf.get(node.id) ?? 0;
		layerWidth[layer] = Math.max(layerWidth[layer], size.w);
		tallest = Math.max(tallest, size.h);
	}
	const layerCenter: number[] = [];
	let cursorX = PAD_X;
	for (let layer = 0; layer < layerCount; layer++) {
		layerCenter.push(cursorX + layerWidth[layer] / 2);
		cursorX += layerWidth[layer] + LAYER_AIR;
	}
	const rowPitch = tallest + ROW_AIR;

	const width = layerCenter[layerCount - 1] + layerWidth[layerCount - 1] / 2 + PAD_X;
	const height = PAD_Y * 2 + tallest + (Math.max(1, railCursor) - 1) * rowPitch + (bandList.length - 1) * BAND_GAP;

	const placedById = new Map<string, { x: number; y: number }>();
	for (const band of bandList) {
		const byLayer = new Map<number, string[]>();
		for (const id of band.members) {
			const layer = layerOf.get(id) ?? 0;
			const bucket = byLayer.get(layer);
			if (bucket) { bucket.push(id); } else { byLayer.set(layer, [id]); }
		}
		for (const [layer, ids] of byLayer) {
			ids.sort((a, b) => (crossOf.get(a) ?? 0) - (crossOf.get(b) ?? 0) || a.localeCompare(b));
			ids.forEach((id, row) => placedById.set(id, {
				x: layerCenter[layer],
				y: PAD_Y + tallest / 2 + (bandTopRail.get(band.key)! + row) * rowPitch + bandIndex.get(band.key)! * BAND_GAP,
			}));
		}
	}

	const nodes: INodeMapPlacedNode[] = spec.nodes.map(node => {
		const at = placedById.get(node.id);
		const size = sizeOf.get(node.id)!;
		return {
			...node,
			x: at?.x ?? width / 2,
			y: at?.y ?? height / 2,
			w: size.w,
			h: size.h,
			shape: shapeOf.get(node.id)!,
			degree: degree.get(node.id) ?? 0,
		};
	});

	const byGroup = new Map<string, INodeMapPlacedNode[]>();
	for (const node of nodes) {
		if (!node.group) { continue; }
		const bucket = byGroup.get(node.group);
		if (bucket) { bucket.push(node); } else { byGroup.set(node.group, [node]); }
	}
	const hulls: INodeMapHull[] = [...byGroup.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([label, members]) => {
			let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
			for (const node of members) {
				minX = Math.min(minX, node.x - node.w / 2);
				maxX = Math.max(maxX, node.x + node.w / 2);
				minY = Math.min(minY, node.y - node.h / 2);
				maxY = Math.max(maxY, node.y + node.h / 2);
			}
			return {
				label,
				x: minX - HULL_PAD_X,
				y: minY - HULL_PAD_TOP,
				w: maxX - minX + HULL_PAD_X * 2,
				h: maxY - minY + HULL_PAD_TOP + HULL_PAD_BOTTOM,
			};
		});

	return { width, height, nodes, hulls };
}
