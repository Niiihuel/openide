/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — diagram ENGINE (backend, single source of truth). Parses the GRAPH family of
 *  mermaid (flowchart/graph, stateDiagram, mindmap) into a node+edge spec and computes its
 *  layout por capas; y la familia CHART (pie, gantt, sequenceDiagram, timeline, journey,
 *  quadrantChart, gitGraph) a specs tipados propios. Portado del sistema de ghost-ide.
 *
 *  PURE: no DOM, no vs/* imports — consumed by the chat (via IOpenideAgentService → webview,
 *  which only RENDERS) and by the standalone MCP server (node) for extension chats
 *  (Claude, etc.). Visual rendering lives in the client and is replaceable.
 *--------------------------------------------------------------------------------------------*/

import { INodeMapLayout, INodeMapSpec, layoutNodeMap, looksLikeNodeMap, NodeMapType, parseNodeMap } from './openideNodeMaps.js';
import { ISeqMapLayout, ISeqMapSpec, layoutSeqMap, looksLikeSeqMap, parseSeqMap } from './openideSeqMap.js';

// ---------------------------------- tipos: familia GRAPH ----------------------------------

export type DiagramDirection = 'TD' | 'LR' | 'RL' | 'BT';
export type DiagramNodeShape = 'rect' | 'round' | 'circle' | 'diamond';

export interface IDiagramNode {
	id: string;
	label: string;
	shape: DiagramNodeShape;
	order: number;
}

export interface IDiagramEdge {
	source: string;
	target: string;
	label?: string;
	dashed?: boolean;
}

export interface IGraphSpec {
	direction: DiagramDirection;
	nodes: IDiagramNode[];
	edges: IDiagramEdge[];
}

/** Computed layout (geometry, not style): absolute positions of nodes and edges. */
export interface IGraphLayoutNode {
	x: number; y: number; w: number; h: number;
	shape: DiagramNodeShape;
	label: string;
}

export interface IGraphLayoutEdge {
	sx: number; sy: number; tx: number; ty: number;
	label?: string;
	dashed?: boolean;
}

export interface IGraphLayout {
	width: number;
	height: number;
	horizontal: boolean;
	nodes: Record<string, IGraphLayoutNode>;
	edges: IGraphLayoutEdge[];
}

// ---------------------------------- tipos: familia CHART ----------------------------------

export interface IPieSpec { kind: 'pie'; title?: string; slices: { label: string; value: number }[] }
export interface IGanttTask { label: string; start: number; end: number; status?: 'done' | 'active' | 'crit'; milestone?: boolean }
export interface IGanttSpec { kind: 'gantt'; title?: string; sections: { name: string; tasks: IGanttTask[] }[] }
export type SeqEvent =
	| { type: 'message'; from: string; to: string; text: string; dashed: boolean; open: boolean; activate?: boolean; deactivate?: boolean }
	| { type: 'note'; placement: 'over' | 'left' | 'right'; actors: string[]; text: string }
	| { type: 'block-start'; kind: string; label: string }
	| { type: 'block-else'; label: string }
	| { type: 'block-end' };
export interface ISequenceSpec { kind: 'sequence'; autonumber: boolean; participants: { id: string; label: string; actor: boolean }[]; events: SeqEvent[] }
export interface ITimelineSpec { kind: 'timeline'; title?: string; sections: { name: string; periods: { time: string; events: string[] }[] }[] }
export interface IJourneySpec { kind: 'journey'; title?: string; sections: { name: string; tasks: { label: string; score: number; actors: string[] }[] }[] }
export interface IQuadrantSpec { kind: 'quadrant'; title?: string; xAxis?: [string, string]; yAxis?: [string, string]; quadrants: [string, string, string, string]; points: { label: string; x: number; y: number }[] }
export interface IGitCommit { id: string; branch: string; parents: string[]; tag?: string; highlight?: boolean; x: number }
export interface IGitSpec { kind: 'git'; branches: string[]; commits: IGitCommit[] }

export type ChartSpec = IPieSpec | IGanttSpec | ISequenceSpec | ITimelineSpec | IJourneySpec | IQuadrantSpec | IGitSpec;

/** Resultado del motor: familia graph (spec + layout listo), chart (spec tipado), o los mapas tipados (JSON IR + layout). */
export type DiagramResult =
	| { family: 'graph'; kind: 'flowchart' | 'state' | 'mindmap'; spec: IGraphSpec; layout: IGraphLayout }
	| { family: 'chart'; kind: ChartSpec['kind']; spec: ChartSpec }
	| { family: 'nodemap'; kind: NodeMapType; spec: INodeMapSpec; layout: INodeMapLayout }
	| { family: 'seqmap'; kind: 'seqmap'; spec: ISeqMapSpec; layout: ISeqMapLayout };

export const DIAGRAM_KINDS = ['flowchart', 'state', 'mindmap', 'pie', 'gantt', 'sequence', 'timeline', 'journey', 'quadrant', 'git', 'archmap', 'flowmap', 'lifemap', 'seqmap'] as const;

// ---------------------------------- helpers ----------------------------------

function stripNoise(raw: string): string {
	return raw.replace(/%%\{[\s\S]*?\}%%/g, '').replace(/%%[^\n]*/g, '');
}

function unquote(s: unknown): string {
	return String(s ?? '').trim().replace(/^"|"$/g, '').trim();
}

// ---------------------------------- familia GRAPH: parsers ----------------------------------

const GRAPH_UNSUPPORTED = /^(sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart)\b/i;

function normalizeInlineLabel(line: string): string {
	return line.replace(/-{2}\s+([^-|>][^-]*?)\s+-{2}(>)?/g, (_m, label: string, arrow: string) => {
		return '--' + (arrow ? '>' : '') + '|' + label.trim() + '|';
	});
}

function scanNode(s: string, i: number): { id: string; label: string | null; shape: DiagramNodeShape | null; next: number } | undefined {
	while (i < s.length && /\s/.test(s[i])) { i++; }
	const m = /^[A-Za-z0-9_.-]+/.exec(s.slice(i));
	if (!m) { return undefined; }
	const id = m[0];
	let cursor = i + id.length;
	const rest = s.slice(cursor);
	let shape: DiagramNodeShape | null = null;
	let label: string | null = null;
	let closeLen = 0;
	let dd: RegExpExecArray | null;
	if ((dd = /^\(\(([\s\S]*?)\)\)/.exec(rest))) { shape = 'circle'; label = dd[1]; closeLen = dd[0].length; }
	else if ((dd = /^\[\[([\s\S]*?)\]\]/.exec(rest))) { shape = 'rect'; label = dd[1]; closeLen = dd[0].length; }
	else if ((dd = /^\[([\s\S]*?)\]/.exec(rest))) { shape = 'rect'; label = dd[1]; closeLen = dd[0].length; }
	else if ((dd = /^\(([\s\S]*?)\)/.exec(rest))) { shape = 'round'; label = dd[1]; closeLen = dd[0].length; }
	else if ((dd = /^\{([\s\S]*?)\}/.exec(rest))) { shape = 'diamond'; label = dd[1]; closeLen = dd[0].length; }
	if (label !== null) { label = label.trim().replace(/^"([\s\S]*)"$/, '$1').trim(); cursor += closeLen; }
	return { id, label, shape, next: cursor };
}

function scanConnector(s: string, i: number): { next: number; label?: string; dashed: boolean } | undefined {
	while (i < s.length && /\s/.test(s[i])) { i++; }
	const m = /^(-\.{1,2}|={2,3}|-{2,3})(>)?(\|([^|]*)\|)?/.exec(s.slice(i));
	if (!m) { return undefined; }
	const dashed = m[1].charAt(0) === '-' && m[1].indexOf('.') >= 0;
	return { next: i + m[0].length, label: m[4] !== undefined ? m[4].trim() : undefined, dashed };
}

export function parseFlowchart(text: string): IGraphSpec | undefined {
	const lines = text.split('\n');
	let direction: DiagramDirection = 'TD';
	const nodes: Record<string, IDiagramNode> = {};
	let order = 0;
	let edges: IDiagramEdge[] = [];
	let headerSeen = false;
	const ensureNode = (id: string, label: string | null, shape: DiagramNodeShape | null): void => {
		const n = nodes[id];
		if (!n) { nodes[id] = { id, label: label !== null ? label : id, shape: shape || 'rect', order: order++ }; }
		else {
			if (label !== null && n.label === n.id) { n.label = label; }
			if (shape && n.shape === 'rect') { n.shape = shape; }
		}
	};
	for (const rawLine of lines) {
		const line = rawLine.replace(/%%.*$/, '').trim();
		if (!line) { continue; }
		if (!headerSeen) {
			const h = /^(graph|flowchart)\s+(TB|TD|BT|RL|LR)?/i.exec(line);
			headerSeen = true;
			if (h) {
				if (h[2]) { direction = (h[2].toUpperCase() === 'TB' ? 'TD' : h[2].toUpperCase()) as DiagramDirection; }
				continue;
			}
			if (GRAPH_UNSUPPORTED.test(line)) { return undefined; }
		}
		if (/^subgraph\b/i.test(line) || /^end$/i.test(line) || /^(classDef|class|style|linkStyle|click|direction)\b/i.test(line)) { continue; }
		if (GRAPH_UNSUPPORTED.test(line)) { return undefined; }
		const normalized = normalizeInlineLabel(line);
		const first = scanNode(normalized, 0);
		if (!first) { continue; }
		ensureNode(first.id, first.label, first.shape);
		let cursor = first.next;
		let prevId = first.id;
		for (; ;) {
			const conn = scanConnector(normalized, cursor);
			if (!conn) { break; }
			const next = scanNode(normalized, conn.next);
			if (!next) { break; }
			ensureNode(next.id, next.label, next.shape);
			edges.push({ source: prevId, target: next.id, label: conn.label, dashed: conn.dashed });
			prevId = next.id;
			cursor = next.next;
		}
	}
	const nodeList = Object.values(nodes);
	if (!nodeList.length) { return undefined; }
	nodeList.sort((a, b) => a.order - b.order);
	const ids = new Set(nodeList.map(n => n.id));
	edges = edges.filter(e => ids.has(e.source) && ids.has(e.target));
	return { direction, nodes: nodeList, edges };
}

/** stateDiagram / stateDiagram-v2 (subset): [*] inicial/final → circle; bloques anidados se aplanan. */
export function parseStateDiagram(text: string): IGraphSpec | undefined {
	if (!/^\s*stateDiagram(-v2)?\b/im.test(text)) { return undefined; }
	const nodes: Record<string, IDiagramNode> = {};
	let order = 0;
	const edges: IDiagramEdge[] = [];
	let sawStart = false;
	const ensure = (id: string, label?: string, shape?: DiagramNodeShape): void => {
		const n = nodes[id];
		if (!n) { nodes[id] = { id, label: label ?? id, shape: shape || 'round', order: order++ }; }
		else if (label !== undefined) { n.label = label; }
	};
	for (const rawLine of text.split('\n')) {
		const line = rawLine.replace(/%%.*$/, '').trim();
		if (!line || /^stateDiagram/i.test(line) || /^direction\b/i.test(line) || /^[{}]$/.test(line) || /^note\b/i.test(line) || /^end note$/i.test(line)) { continue; }
		const st = /^state\s+"([^"]+)"\s+as\s+([\w.-]+)/i.exec(line);
		if (st) { ensure(st[2], st[1]); continue; }
		const tr = /^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)\s*(?::\s*(.+))?$/.exec(line);
		if (tr) {
			let a = tr[1];
			let b = tr[2];
			if (a === '[*]') { a = '__ini'; ensure(a, '●', 'circle'); sawStart = true; }
			else { ensure(a); }
			if (b === '[*]') { b = '__fin'; ensure(b, '◎', 'circle'); }
			else { ensure(b); }
			edges.push({ source: a, target: b, label: tr[3]?.trim(), dashed: false });
			continue;
		}
		const solo = /^state\s+([\w.-]+)\s*\{?$/i.exec(line);
		if (solo) { ensure(solo[1]); }
	}
	const nodeList = Object.values(nodes);
	if (!nodeList.length || (!edges.length && !sawStart)) { return undefined; }
	nodeList.sort((a, b) => a.order - b.order);
	return { direction: 'TD', nodes: nodeList, edges };
}

/** mindmap (subset): indentation tree → LR graph. */
export function parseMindmap(text: string): IGraphSpec | undefined {
	if (!/^\s*mindmap\b/im.test(text)) { return undefined; }
	const nodes: IDiagramNode[] = [];
	const edges: IDiagramEdge[] = [];
	const stack: { indent: number; id: string }[] = [];
	let order = 0;
	for (const rawLine of text.split('\n')) {
		const noComment = rawLine.replace(/%%.*$/, '');
		const line = noComment.trim();
		if (!line || /^mindmap\b/i.test(line)) { continue; }
		const indent = (noComment.match(/^\s*/) as RegExpMatchArray)[0].length;
		let label = line;
		let shape: DiagramNodeShape = 'round';
		let m: RegExpExecArray | null;
		if ((m = /^([\w.-]*)\(\(([^)]+)\)\)$/.exec(line))) { label = m[2]; shape = 'circle'; }
		else if ((m = /^([\w.-]*)\[([^\]]+)\]$/.exec(line))) { label = m[2]; shape = 'rect'; }
		else if ((m = /^([\w.-]*)\(([^)]+)\)$/.exec(line))) { label = m[2]; shape = 'round'; }
		label = label.trim().replace(/^"([\s\S]*)"$/, '$1');
		const id = 'mm' + order;
		nodes.push({ id, label, shape, order: order++ });
		while (stack.length && stack[stack.length - 1].indent >= indent) { stack.pop(); }
		if (stack.length) { edges.push({ source: stack[stack.length - 1].id, target: id, dashed: false }); }
		stack.push({ indent, id });
	}
	if (nodes.length < 2) { return undefined; }
	return { direction: 'LR', nodes, edges };
}

// ---------------------------------- familia GRAPH: layout por capas ----------------------------------

/** Measures a node's size from its label: width = longest line (clamped), height = number of
 *  lines (from explicit `<br>` plus wrapping at the usable width). Height used to be fixed (34)
 *  and multi-line text spilled out of the box. */
function measureLabel(label: string): { w: number; h: number } {
	const CHAR = 6.7, PAD_X = 22, MINW = 72, MAXW = 220, LINE_H = 17, PAD_Y = 16;
	const parts = String(label).split(/<br\s*\/?>/i).map(s => s.trim());
	const longest = parts.reduce((mx, l) => Math.max(mx, l.length), 1);
	const w = Math.max(MINW, Math.min(MAXW, Math.round(longest * CHAR) + PAD_X));
	const usable = Math.max(1, w - PAD_X);
	let lines = 0;
	for (const p of parts) {
		lines += Math.max(1, Math.ceil((p.length * CHAR) / usable));
	}
	const h = Math.max(34, lines * LINE_H + PAD_Y);
	return { w, h };
}

export function layoutGraph(spec: IGraphSpec): IGraphLayout {
	const { nodes, edges, direction } = spec;
	const level: Record<string, number> = {};
	nodes.forEach(n => { level[n.id] = 0; });
	const cap = nodes.length + 5;
	for (let iter = 0; iter < cap; iter++) {
		let changed = false;
		for (const e of edges) {
			if (level[e.target] < level[e.source] + 1) { level[e.target] = level[e.source] + 1; changed = true; }
		}
		if (!changed) { break; }
	}
	const horizontal = direction === 'LR' || direction === 'RL';
	const byLevel: Record<number, (IDiagramNode & { __w?: number; __h?: number })[]> = {};
	const dims: Record<string, { w: number; h: number }> = {};
	nodes.forEach(n => {
		const m = measureLabel(String(n.label));
		let w = m.w;
		let h = m.h;
		// diamond/circle: the renderer uses only the central 62%×72% for the label → enlarge the
		// box so the text fits without being clipped.
		if (n.shape === 'diamond') { w = Math.round(m.w * 1.6); h = Math.round(m.h * 1.5); }
		else if (n.shape === 'circle') { const side = Math.round(Math.max(m.w * 1.5, m.h * 1.9)); w = side; h = Math.max(48, Math.round(m.h * 1.5)); }
		dims[n.id] = { w, h };
		const lv = level[n.id];
		(byLevel[lv] = byLevel[lv] || []).push(n);
	});
	const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
	const GAP_CROSS = 18;
	const GAP_MAIN = 56;
	let crossTotal = 0;
	levels.forEach(lv => {
		let extent = 0;
		byLevel[lv].forEach(n => { extent += (horizontal ? dims[n.id].h : dims[n.id].w) + GAP_CROSS; });
		extent = Math.max(0, extent - GAP_CROSS);
		crossTotal = Math.max(crossTotal, extent);
	});
	const pos: Record<string, IGraphLayoutNode> = {};
	let mainOffset = 0;
	levels.forEach(lv => {
		const items = byLevel[lv];
		let extent = 0;
		items.forEach(n => { extent += (horizontal ? dims[n.id].h : dims[n.id].w) + GAP_CROSS; });
		extent = Math.max(0, extent - GAP_CROSS);
		let crossCursor = (crossTotal - extent) / 2;
		let mainSize = 0;
		items.forEach(n => {
			const d = dims[n.id];
			let x: number;
			let y: number;
			if (horizontal) { x = mainOffset; y = crossCursor; mainSize = Math.max(mainSize, d.w); crossCursor += d.h + GAP_CROSS; }
			else { y = mainOffset; x = crossCursor; mainSize = Math.max(mainSize, d.h); crossCursor += d.w + GAP_CROSS; }
			pos[n.id] = { x, y, w: d.w, h: d.h, shape: n.shape, label: n.label };
		});
		mainOffset += mainSize + GAP_MAIN;
	});
	const mainTotal = Math.max(0, mainOffset - GAP_MAIN);
	if (direction === 'RL') { for (const id in pos) { pos[id].x = mainTotal - pos[id].x - pos[id].w; } }
	else if (direction === 'BT') { for (const id in pos) { pos[id].y = mainTotal - pos[id].y - pos[id].h; } }
	for (const id in pos) { pos[id].x += 20; pos[id].y += 20; }
	const width = (horizontal ? mainTotal : crossTotal) + 40;
	const height = (horizontal ? crossTotal : mainTotal) + 40;
	const edgeLines: IGraphLayoutEdge[] = [];
	edges.forEach(e => {
		const s = pos[e.source];
		const t = pos[e.target];
		if (!s || !t) { return; }
		let sx: number; let sy: number; let tx: number; let ty: number;
		if (horizontal) { sx = s.x + s.w; sy = s.y + s.h / 2; tx = t.x; ty = t.y + t.h / 2; }
		else { sx = s.x + s.w / 2; sy = s.y + s.h; tx = t.x + t.w / 2; ty = t.y; }
		edgeLines.push({ sx, sy, tx, ty, label: e.label, dashed: e.dashed });
	});
	return { width: Math.max(width, 100), height: Math.max(height, 80), nodes: pos, edges: edgeLines, horizontal };
}

// ---------------------------------- familia CHART: parsers ----------------------------------

export function parsePie(text: string): IPieSpec | undefined {
	let title: string | undefined;
	const slices: { label: string; value: number }[] = [];
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line) { continue; }
		const head = /^pie(?:\s+showData)?(?:\s+title\s+(.+))?$/i.exec(line);
		if (head) { if (head[1]) { title = unquote(head[1]); } continue; }
		const t = /^title\s+(.+)$/i.exec(line);
		if (t) { title = unquote(t[1]); continue; }
		const slice = /^"([^"]*)"\s*:\s*([\d.]+)$/.exec(line);
		if (slice) { slices.push({ label: slice[1], value: Number(slice[2]) }); }
	}
	return slices.length ? { kind: 'pie', title, slices } : undefined;
}

const DAY = 86400000;

function ganttDuration(tok: string): number | undefined {
	const m = /^(\d+(?:\.\d+)?)\s*(d|w|h|min|m|s)?$/i.exec(tok.trim());
	if (!m) { return undefined; }
	const n = Number(m[1]);
	const unit = (m[2] ?? 'd').toLowerCase();
	const scale: Record<string, number> = { d: DAY, w: 7 * DAY, h: DAY / 24, min: DAY / 1440, m: DAY / 1440, s: DAY / 86400 };
	return n * (scale[unit] ?? DAY);
}

export function parseGantt(text: string): IGanttSpec | undefined {
	let title: string | undefined;
	const sections: IGanttSpec['sections'] = [];
	let current: IGanttSpec['sections'][number] | undefined;
	const byId = new Map<string, IGanttTask>();
	let cursor = 0;
	const ensureSection = () => {
		if (!current) { current = { name: '', tasks: [] }; sections.push(current); }
		return current;
	};
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || /^(gantt|dateFormat|axisFormat|excludes|todayMarker|tickInterval|weekday)\b/i.test(line)) { continue; }
		const t = /^title\s+(.+)$/i.exec(line);
		if (t) { title = unquote(t[1]); continue; }
		const sec = /^section\s+(.+)$/i.exec(line);
		if (sec) { current = { name: unquote(sec[1]), tasks: [] }; sections.push(current); continue; }
		const colon = line.indexOf(':');
		if (colon === -1) { continue; }
		const label = line.slice(0, colon).trim();
		const parts = line.slice(colon + 1).split(',').map(p => p.trim()).filter(Boolean);
		if (!parts.length) { continue; }
		let status: IGanttTask['status'];
		let milestone = false;
		let id: string | undefined;
		const fields: string[] = [];
		for (const p of parts) {
			if (/^(done|active|crit)$/i.test(p)) { status = p.toLowerCase() as IGanttTask['status']; }
			else if (/^milestone$/i.test(p)) { milestone = true; }
			else { fields.push(p); }
		}
		if (fields.length && /^[A-Za-z]/.test(fields[0]) && !/^after\b/i.test(fields[0])) { id = fields.shift(); }
		let start: number;
		if (fields[0]) {
			const after = /^after\s+(.+)$/i.exec(fields[0]);
			if (after) { const dep = byId.get(after[1].trim()); start = dep ? dep.end : cursor; }
			else { const ms = Date.parse(fields[0].trim()); start = isNaN(ms) ? cursor : ms; }
		} else { start = cursor; }
		let end: number;
		const endDate = fields[1] ? Date.parse(fields[1].trim()) : NaN;
		const endDur = fields[1] ? ganttDuration(fields[1]) : undefined;
		if (milestone) { end = start; }
		else if (!isNaN(endDate)) { end = endDate; }
		else if (endDur !== undefined) { end = start + endDur; }
		else { end = start + DAY; }
		const task: IGanttTask = { label, start, end, status, milestone };
		ensureSection().tasks.push(task);
		if (id) { byId.set(id, task); }
		cursor = end;
	}
	return sections.some(s => s.tasks.length) ? { kind: 'gantt', title, sections } : undefined;
}

export function parseSequence(text: string): ISequenceSpec | undefined {
	const participants: ISequenceSpec['participants'] = [];
	const seen = new Set<string>();
	const events: SeqEvent[] = [];
	let autonumber = false;
	const ensure = (id: string, actor = false): void => {
		const key = id.trim();
		if (!seen.has(key)) { seen.add(key); participants.push({ id: key, label: key, actor }); }
	};
	const msgRe = /^([A-Za-z0-9_]+)\s*(-{1,2}>>?|-{1,2}\)|-{1,2}x)\s*([+-]?)\s*([A-Za-z0-9_]+)\s*:\s*(.+)$/;
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || /^sequenceDiagram\b/i.test(line)) { continue; }
		if (/^autonumber\b/i.test(line)) { autonumber = true; continue; }
		const part = /^(participant|actor)\s+(.+)$/i.exec(line);
		if (part) {
			const isActor = /^actor$/i.test(part[1]);
			const asM = /^(.+?)\s+as\s+(.+)$/i.exec(part[2]);
			if (asM) {
				const pid = asM[1].trim();
				ensure(pid, isActor);
				const p = participants.find(x => x.id === pid);
				if (p) { p.label = unquote(asM[2]); }
			} else { ensure(part[2].trim(), isActor); }
			continue;
		}
		const act = /^(activate|deactivate)\s+([A-Za-z0-9_]+)$/i.exec(line);
		if (act) {
			ensure(act[2]);
			const isAct = /^activate$/i.test(act[1]);
			events.push({ type: 'message', from: act[2], to: act[2], text: '', dashed: false, open: false, activate: isAct, deactivate: !isAct });
			continue;
		}
		const note = /^note\s+(over|left of|right of)\s+([^:]+):\s*(.+)$/i.exec(line);
		if (note) {
			const actors = note[2].split(',').map(a => a.trim()).filter(Boolean);
			if (actors.length) {
				actors.forEach(a => ensure(a));
				const placement = /over/i.test(note[1]) ? 'over' : /left/i.test(note[1]) ? 'left' : 'right';
				events.push({ type: 'note', placement, actors, text: unquote(note[3]) });
			}
			continue;
		}
		const block = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i.exec(line);
		if (block) { events.push({ type: 'block-start', kind: block[1].toLowerCase(), label: block[2].trim() }); continue; }
		const els = /^(else|and|option)\b\s*(.*)$/i.exec(line);
		if (els) { events.push({ type: 'block-else', label: els[2].trim() }); continue; }
		if (/^end\b/i.test(line)) { events.push({ type: 'block-end' }); continue; }
		const m = msgRe.exec(line);
		if (m) {
			ensure(m[1]); ensure(m[4]);
			events.push({
				type: 'message', from: m[1], to: m[4], text: m[5].trim(),
				dashed: m[2].indexOf('--') === 0,
				open: /[)x]$/.test(m[2]) || m[2].slice(-2) !== '>>',
				activate: m[3] === '+', deactivate: m[3] === '-'
			});
		}
	}
	return participants.length ? { kind: 'sequence', autonumber, participants, events } : undefined;
}

export function parseTimeline(text: string): ITimelineSpec | undefined {
	let title: string | undefined;
	const sections: ITimelineSpec['sections'] = [];
	let current: ITimelineSpec['sections'][number] | undefined;
	const ensure = () => {
		if (!current) { current = { name: '', periods: [] }; sections.push(current); }
		return current;
	};
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || /^timeline\b/i.test(line)) { continue; }
		const t = /^title\s+(.+)$/i.exec(line);
		if (t) { title = unquote(t[1]); continue; }
		const sec = /^section\s+(.+)$/i.exec(line);
		if (sec) { current = { name: unquote(sec[1]), periods: [] }; sections.push(current); continue; }
		if (line.charAt(0) === ':') {
			const evs = line.slice(1).split(':').map(unquote).filter(Boolean);
			const s2 = ensure();
			const last = s2.periods[s2.periods.length - 1];
			if (last) { last.events = last.events.concat(evs); }
			else { s2.periods.push({ time: '', events: evs }); }
			continue;
		}
		const parts = line.split(':').map(unquote);
		const time = parts.shift() || '';
		ensure().periods.push({ time, events: parts.filter(Boolean) });
	}
	return sections.some(s => s.periods.length) ? { kind: 'timeline', title, sections } : undefined;
}

export function parseJourney(text: string): IJourneySpec | undefined {
	let title: string | undefined;
	const sections: IJourneySpec['sections'] = [];
	let current: IJourneySpec['sections'][number] | undefined;
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || /^journey\b/i.test(line)) { continue; }
		const t = /^title\s+(.+)$/i.exec(line);
		if (t) { title = unquote(t[1]); continue; }
		const sec = /^section\s+(.+)$/i.exec(line);
		if (sec) { current = { name: unquote(sec[1]), tasks: [] }; sections.push(current); continue; }
		const task = /^(.+?)\s*:\s*(\d+)\s*:\s*(.*)$/.exec(line);
		if (task) {
			if (!current) { current = { name: '', tasks: [] }; sections.push(current); }
			current.tasks.push({ label: task[1].trim(), score: Number(task[2]), actors: task[3].split(',').map(a => a.trim()).filter(Boolean) });
		}
	}
	return sections.length ? { kind: 'journey', title, sections } : undefined;
}

function splitAxis(s: string): [string, string] {
	const m = /^(.*?)\s*-->\s*(.*)$/.exec(s);
	return m ? [unquote(m[1]), unquote(m[2])] : [unquote(s), ''];
}

export function parseQuadrant(text: string): IQuadrantSpec | undefined {
	let title: string | undefined;
	let xAxis: [string, string] | undefined;
	let yAxis: [string, string] | undefined;
	const quadrants: [string, string, string, string] = ['', '', '', ''];
	const points: IQuadrantSpec['points'] = [];
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || /^quadrantChart\b/i.test(line)) { continue; }
		const t = /^title\s+(.+)$/i.exec(line);
		if (t) { title = unquote(t[1]); continue; }
		const ax = /^x-axis\s+(.+)$/i.exec(line);
		if (ax) { xAxis = splitAxis(ax[1]); continue; }
		const ay = /^y-axis\s+(.+)$/i.exec(line);
		if (ay) { yAxis = splitAxis(ay[1]); continue; }
		const q = /^quadrant-([1-4])\s+(.+)$/i.exec(line);
		if (q) { quadrants[Number(q[1]) - 1] = unquote(q[2]); continue; }
		const p = /^(.+?)\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/.exec(line);
		if (p) { points.push({ label: unquote(p[1]), x: Number(p[2]), y: Number(p[3]) }); }
	}
	if (!points.length && !quadrants.some(Boolean)) { return undefined; }
	return { kind: 'quadrant', title, xAxis, yAxis, quadrants, points };
}

function parseGitMeta(s: string): { id?: string; tag?: string; highlight?: boolean } {
	return {
		id: /id:\s*"([^"]*)"/i.exec(s)?.[1],
		tag: /tag:\s*"([^"]*)"/i.exec(s)?.[1],
		highlight: /type:\s*HIGHLIGHT/i.test(s),
	};
}

export function parseGitGraph(text: string): IGitSpec | undefined {
	const branches: string[] = ['main'];
	const ensureBranch = (b: string): void => { if (!branches.includes(b)) { branches.push(b); } };
	const tip = new Map<string, string | undefined>();
	const commits: IGitCommit[] = [];
	let current = 'main';
	let seq = 0;
	let auto = 0;
	const unq = (s: string): string => s.replace(/^"|"$/g, '');
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || /^gitGraph\b/i.test(line) || /^(accTitle|accDescr|title)\b/i.test(line)) { continue; }
		const br = /^branch\s+("?[\w/.-]+"?)/i.exec(line);
		if (br) { const name = unq(br[1]); ensureBranch(name); tip.set(name, tip.get(current)); current = name; continue; }
		const co = /^(?:checkout|switch)\s+("?[\w/.-]+"?)/i.exec(line);
		if (co) { current = unq(co[1]); ensureBranch(current); continue; }
		const mg = /^merge\s+("?[\w/.-]+"?)(.*)$/i.exec(line);
		if (mg) {
			const from = unq(mg[1]);
			const meta = parseGitMeta(mg[2]);
			const parents = [tip.get(current), tip.get(from)].filter((p): p is string => !!p);
			const id = meta.id ?? `c${auto++}`;
			commits.push({ id, branch: current, parents, tag: meta.tag, highlight: meta.highlight, x: seq++ });
			tip.set(current, id);
			continue;
		}
		const cm = /^commit\b(.*)$/i.exec(line);
		if (cm) {
			const meta = parseGitMeta(cm[1]);
			const parent = tip.get(current);
			const id = meta.id ?? `c${auto++}`;
			commits.push({ id, branch: current, parents: parent ? [parent] : [], tag: meta.tag, highlight: meta.highlight, x: seq++ });
			tip.set(current, id);
		}
	}
	return commits.length ? { kind: 'git', branches, commits } : undefined;
}

// ---------------------------------- single engine entry point ----------------------------------

/**
 * Parses any supported mermaid source. The graph family includes the computed layout
 * (geometry ready for a client to draw); the chart family returns the typed spec.
 * Returns undefined when the text is not a supported diagram (the caller picks the fallback).
 */
export function parseDiagramSource(raw: string): DiagramResult | undefined {
	// Typed maps first and on the RAW source: they are JSON, where the mermaid comment-stripping
	// would corrupt any "%%" inside a string, and where the flowchart fallback would scrape bogus
	// nodes out of the braces. Invalid map JSON falls back to the code block, never to mermaid.
	if (looksLikeSeqMap(raw)) {
		const parsed = parseSeqMap(raw);
		return parsed.spec ? { family: 'seqmap', kind: 'seqmap', spec: parsed.spec, layout: layoutSeqMap(parsed.spec) } : undefined;
	}
	if (looksLikeNodeMap(raw)) {
		const parsed = parseNodeMap(raw);
		return parsed.spec ? { family: 'nodemap', kind: parsed.spec.type, spec: parsed.spec, layout: layoutNodeMap(parsed.spec) } : undefined;
	}
	const text = stripNoise(raw);
	const hm = /^\s*([A-Za-z][\w-]*)/.exec(text);
	const header = hm ? hm[1].toLowerCase() : '';

	if (header === 'graph' || header === 'flowchart' || !header) {
		const g = parseFlowchart(text);
		if (g && g.nodes.length) { return { family: 'graph', kind: 'flowchart', spec: g, layout: layoutGraph(g) }; }
	}
	if (header === 'statediagram' || header === 'statediagram-v2') {
		const g = parseStateDiagram(text);
		if (g) { return { family: 'graph', kind: 'state', spec: g, layout: layoutGraph(g) }; }
	}
	if (header === 'mindmap') {
		const g = parseMindmap(text);
		if (g) { return { family: 'graph', kind: 'mindmap', spec: g, layout: layoutGraph(g) }; }
	}
	let chart: ChartSpec | undefined;
	if (header === 'pie') { chart = parsePie(text); }
	else if (header === 'gantt') { chart = parseGantt(text); }
	else if (header === 'sequencediagram') { chart = parseSequence(text); }
	else if (header === 'timeline') { chart = parseTimeline(text); }
	else if (header === 'journey') { chart = parseJourney(text); }
	else if (header === 'quadrantchart') { chart = parseQuadrant(text); }
	else if (header === 'gitgraph') { chart = parseGitGraph(text); }
	if (chart) { return { family: 'chart', kind: chart.kind, spec: chart }; }

	// no known header: try a bare flowchart ("A --> B" lines)
	const fallback = parseFlowchart(text);
	if (fallback && fallback.nodes.length && fallback.edges.length) {
		return { family: 'graph', kind: 'flowchart', spec: fallback, layout: layoutGraph(fallback) };
	}
	return undefined;
}
