/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { DesignDocument, DesignNode } from './openideDesign.js';
export interface DesignFrame {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
}
export interface DesignKeyframe {
	time: number;
	x: number;
	y: number;
	rotation: number;
	scale: number;
	opacity: number;
}
export interface DesignObject3D {
	primitive: 'box' | 'sphere' | 'cylinder' | 'mesh';
	position: number[];
	rotation: number[];
	scale: number[];
	vertices?: number[][];
	faces?: number[][];
}
export interface DesignAsset {
	id: string;
	name: string;
	path: string;
	mime: 'image/png' | 'image/jpeg' | 'image/svg+xml';
	bytes: number;
}
export interface DesignSystem {
	name: string;
	source?: string;
	colors: Record<string, string>;
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	spacing: number;
	radius: number;
}
const range = (n: unknown, min: number, max: number): boolean => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) {
	throw new Error('Expected an object.');
} return value as Record<string, unknown>; };
const reject = (message: string): never => { throw new Error(`Invalid Canvas: ${message}`); };
export function validateAdvancedNode(node: Record<string, unknown>): void {
	if (node.sourcePath !== undefined && (typeof node.sourcePath !== 'string' || !/^[\w.-][\w./ -]{0,499}$/.test(node.sourcePath) || node.sourcePath.split('/').includes('..'))) {
		reject('implementation path must remain inside the workspace');
	}
	if (node.frame !== undefined) {
		const f = object(node.frame);
		if (!range(f.x, -10000, 10000) || !range(f.y, -10000, 10000) || !range(f.width, 1, 10000) || !range(f.height, 1, 10000) || !range(f.rotation, -3600, 3600)) {
			reject('frame outside canvas limits');
		}
	}
	if (node.shape !== undefined && !['rectangle', 'ellipse', 'line', 'arrow'].includes(String(node.shape))) {
		reject('unknown shape');
	}
	if (node.points !== undefined && (!Array.isArray(node.points) || node.points.length > 2000 || node.points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !range(v, -10000, 10000))))) {
		reject('invalid drawing points');
	}
	if (node.keyframes !== undefined) {
		if (!Array.isArray(node.keyframes) || node.keyframes.length > 120) {
			reject('too many keyframes');
		}
		let previous = -1;
		for (const value of node.keyframes as unknown[]) {
			const k = object(value);
			if (!range(k.time, 0, 60) || Number(k.time) <= previous || !range(k.x, -10000, 10000) || !range(k.y, -10000, 10000) || !range(k.rotation, -3600, 3600) || !range(k.scale, .01, 20) || !range(k.opacity, 0, 1)) {
				reject('invalid or unordered keyframes');
			}
			previous = Number(k.time);
		}
	}
	if (node.object3d !== undefined) {
		const o = object(node.object3d);
		if (!['box', 'sphere', 'cylinder', 'mesh'].includes(String(o.primitive))) {
			reject('unknown 3D primitive');
		}
		for (const key of ['position', 'rotation', 'scale']) {
			const v = o[key];
			if (!Array.isArray(v) || v.length !== 3 || v.some(n => !range(n, key === 'scale' ? .01 : -1000, 1000))) {
				reject('invalid 3D transform');
			}
		}
		if (o.primitive === 'mesh') {
			if (!Array.isArray(o.vertices) || o.vertices.length < 3 || o.vertices.length > 5000 || o.vertices.some(v => !Array.isArray(v) || v.length !== 3 || v.some(n => !range(n, -10000, 10000)))) {
				reject('mesh requires 3–5000 bounded vertices');
			}
			if (!Array.isArray(o.faces) || !o.faces.length || o.faces.length > 5000 || o.faces.some(f => !Array.isArray(f) || f.length !== 3 || f.some(i => !Number.isInteger(i) || i < 0 || i >= (o.vertices as unknown[]).length))) {
				reject('mesh requires bounded triangular faces');
			}
		}
	}
	if (node.kind === 'model' && !node.object3d) {
		reject('3D node needs geometry');
	}
	if (node.kind === 'path' && !node.points) {
		reject('drawing needs points');
	}
}
export function validateAdvancedDocument(doc: Record<string, unknown>): void {
	if (doc.duration !== undefined && !range(doc.duration, .1, 60)) {
		reject('animation duration must be 0.1–60 seconds');
	}
	const assets = doc.assets ?? [];
	if (!Array.isArray(assets) || assets.length > 50) {
		reject('at most 50 assets');
	}
	const ids = new Set<string>();
	let bytes = 0;
	let triangles = 0;
	let models = 0;
	for (const item of assets as unknown[]) {
		const a = object(item);
		if (typeof a.id !== 'string' || !/^[a-zA-Z][\w-]{0,79}$/.test(a.id) || ids.has(a.id) || typeof a.name !== 'string' || a.name.length > 200 || typeof a.path !== 'string' || !/^assets\/[a-z0-9-]+\.(png|jpg|svg)$/.test(a.path) || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(String(a.mime)) || !range(a.bytes, 1, 5000000)) {
			reject('invalid asset reference');
		}
		ids.add(String(a.id));
		bytes += Number(a.bytes);
	}
	if (bytes > 20000000) {
		reject('asset budget exceeds 20 MB');
	}
	const walk = (node: DesignNode): void => { if (node.kind === 'image' && (!node.assetId || !ids.has(node.assetId))) {
		reject('image asset is missing');
	} if (node.object3d) {
		models++;
		triangles += node.object3d.primitive === 'mesh' ? node.object3d.faces!.length : 256;
	} if (node.keyframes?.some(k => k.time > Number(doc.duration ?? 5))) {
		reject('keyframe exceeds duration');
	} node.children.forEach(walk); };
	for (const screen of doc.screens as DesignDocument['screens']) {
		screen.nodes.forEach(walk);
	}
	if (models > 30 || triangles > 12000) {
		reject('3D scene budget exceeds 30 objects or 12000 triangles');
	}
	if (doc.designSystem !== undefined) {
		const d = object(doc.designSystem);
		if (typeof d.name !== 'string' || d.name.length > 200 || typeof d.fontFamily !== 'string' || !/^[\w ,'-]{1,100}$/.test(d.fontFamily) || !range(d.fontSize, 10, 72) || !range(d.lineHeight, 1, 3) || !range(d.spacing, 0, 80) || !range(d.radius, 0, 80)) {
			reject('invalid design system');
		}
		const colors = object(d.colors);
		if (Object.keys(colors).length > 30 || Object.entries(colors).some(([k, v]) => !/^[a-zA-Z][\w-]{0,79}$/.test(k) || !/^#[0-9a-f]{6}$/i.test(String(v)))) {
			reject('invalid system colors');
		}
	}
}
export function makeAdvancedTemplate(doc: DesignDocument): void {
	if (!['whiteboard', 'animation', 'scene3d'].includes(doc.template)) {
		return;
	}
	doc.fidelity = 'mockup';
	doc.device = 'desktop';
	doc.duration = 5;
	const node: DesignNode = { id: 'hero', kind: doc.template === 'scene3d' ? 'model' : 'shape', text: doc.template === 'whiteboard' ? 'Your first idea' : '', children: [], token: 'accent', spacing: 8, size: 24, shape: 'rectangle', frame: { x: 120, y: 100, width: 280, height: 180, rotation: 0 } };
	if (doc.template === 'scene3d') {
		node.frame = { x: 0, y: 0, width: 1000, height: 600, rotation: 0 };
		node.object3d = { primitive: 'box', position: [0, 0, 0], rotation: [20, 30, 0], scale: [1, 1, 1] };
	}
	if (doc.template === 'animation') {
		node.keyframes = [{ time: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }, { time: 2.5, x: 400, y: 100, rotation: 180, scale: 1.3, opacity: .5 }, { time: 5, x: 0, y: 0, rotation: 360, scale: 1, opacity: 1 }];
	}
	doc.screens = [{ id: 'main', title: doc.template === 'scene3d' ? 'Scene' : 'Canvas', nodes: [node] }];
}
/** Geometry is shared by the editor, standalone exports and OBJ export; no global resources. */
export function createDesignGeometry() {
	const mesh = (object: DesignObject3D): {
		vertices: number[][];
		faces: number[][];
	} => {
		let vertices: number[][] = [];
		const faces: number[][] = [];
		if (object.primitive === 'mesh') {
			vertices = object.vertices!;
			faces.push(...object.faces!);
		}
		else if (object.primitive === 'box') {
			vertices = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
			for (const [a, b, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) {
				faces.push([a, b, c], [a, c, d]);
			}
		}
		else {
			const segments = 16, rings = object.primitive === 'sphere' ? 8 : 1;
			for (let y = 0; y <= rings; y++) {
				const angle = Math.PI * y / rings;
				const radius = object.primitive === 'sphere' ? Math.sin(angle) : 1;
				for (let x = 0; x < segments; x++) {
					vertices.push([radius * Math.cos(x * 2 * Math.PI / segments), object.primitive === 'sphere' ? Math.cos(angle) : 1 - 2 * y, radius * Math.sin(x * 2 * Math.PI / segments)]);
				}
			}
			for (let y = 0; y < rings; y++) {
				for (let x = 0; x < segments; x++) {
					const a = y * segments + x, b = y * segments + (x + 1) % segments, c = b + segments, d = a + segments;
					faces.push([a, b, c], [a, c, d]);
				}
			}
			if (object.primitive === 'cylinder') {
				for (let i = 1; i < segments - 1; i++) {
					faces.push([0, i + 1, i], [segments, segments + i, segments + i + 1]);
				}
			}
		}
		const transform = (point: number[]): number[] => { let [x, y, z] = point.map((v, i) => v * object.scale[i]); const [rx, ry, rz] = object.rotation.map(v => v * Math.PI / 180); [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)]; [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)]; [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)]; return [x + object.position[0], y + object.position[1], z + object.position[2]]; };
		return { vertices: vertices.map(transform), faces };
	};
	const sample = (frames: DesignKeyframe[], time: number): DesignKeyframe => { if (!frames.length) {
		return { time, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };
	} let a = frames[0], b = frames[frames.length - 1]; if (time <= a.time) {
		return { ...a };
	} if (time >= b.time) {
		return { ...b };
	} for (let i = 1; i < frames.length; i++) {
		if (frames[i].time >= time) {
			a = frames[i - 1];
			b = frames[i];
			break;
		}
	} const t = (time - a.time) / (b.time - a.time); return { time, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, rotation: a.rotation + (b.rotation - a.rotation) * t, scale: a.scale + (b.scale - a.scale) * t, opacity: a.opacity + (b.opacity - a.opacity) * t }; };
	return { mesh, sample };
}
export function parseDesignObj(source: string): DesignObject3D {
	if (source.length > 1000000) {
		reject('OBJ exceeds 1 MB');
	}
	const vertices: number[][] = [], faces: number[][] = [];
	for (const raw of source.split(/\r?\n/)) {
		const [type, ...parts] = raw.trim().split(/\s+/);
		if (type === 'v') {
			vertices.push(parts.slice(0, 3).map(Number));
		}
		else if (type === 'f') {
			const indices = parts.map(p => { const value = Number(p.split('/')[0]); return value < 0 ? vertices.length + value : value - 1; });
			for (let i = 1; i < indices.length - 1; i++) {
				faces.push([indices[0], indices[i], indices[i + 1]]);
			}
		}
	}
	const model: DesignObject3D = { primitive: 'mesh', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], vertices, faces };
	validateAdvancedNode({ object3d: model });
	return model;
}
export function exportDesignObj(doc: DesignDocument): string {
	const geometry = createDesignGeometry();
	const lines = ['# OpenIDE Canvas OBJ'];
	let offset = 1;
	const walk = (node: DesignNode) => { if (node.object3d) {
		const m = geometry.mesh(node.object3d);
		lines.push(`o ${node.id}`, ...m.vertices.map(p => `v ${p.join(' ')}`), ...m.faces.map(f => `f ${f.map(i => i + offset).join(' ')}`));
		offset += m.vertices.length;
	} node.children.forEach(walk); };
	doc.screens.forEach(s => s.nodes.forEach(walk));
	if (offset === 1) {
		throw new Error('This design has no 3D geometry.');
	}
	return lines.join('\n') + '\n';
}
/** Accept DTCG JSON, Tokens Studio color tokens or a simple named hex palette. */
export function parseDesignSystem(source: string, name: string): DesignSystem {
	if (source.length > 200000) {
		reject('design system exceeds 200 KB');
	}
	const root = object(JSON.parse(source));
	const entries = new Map<string, {
		type: string;
		value: unknown;
	}>();
	const walk = (value: Record<string, unknown>, prefix: string, type = '') => { if (prefix.split('.').length > 12) {
		reject('token nesting exceeds 12');
	} const tokenType = String(value.$type ?? value.type ?? type); if ('$value' in value || 'value' in value) {
		entries.set(prefix, { type: tokenType, value: value.$value ?? value.value });
		return;
	} for (const [key, item] of Object.entries(value)) {
		if (key.startsWith('$')) {
			continue;
		}
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof item === 'string') {
			entries.set(path, { type: 'color', value: item });
		}
		else if (item && typeof item === 'object' && !Array.isArray(item)) {
			walk(object(item), path, tokenType);
		}
	} };
	walk(root, '');
	const resolve = (key: string, seen = new Set<string>()): unknown => { if (seen.has(key) || seen.size > 20) {
		reject('cyclic token alias');
	} seen.add(key); const token = entries.get(key) ?? reject(`missing token ${key}`); return typeof token.value === 'string' && /^\{.+\}$/.test(token.value) ? resolve(token.value.slice(1, -1), seen) : token.value; };
	const colors: Record<string, string> = {};
	let fontFamily = 'system-ui', fontSize = 16, lineHeight = 1.5, spacing = 12, radius = 8;
	for (const [key, entry] of entries) {
		const value = resolve(key);
		let color: string | undefined;
		if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
			color = value;
		}
		else if (value && typeof value === 'object' && (entry.type === 'color' || 'colorSpace' in value)) {
			const v = object(value);
			if (v.colorSpace === 'srgb' && Array.isArray(v.components) && v.components.length === 3 && v.components.every(n => range(n, 0, 1)) && (v.alpha === undefined || v.alpha === 1)) {
				color = '#' + v.components.map(n => Math.round(Number(n) * 255).toString(16).padStart(2, '0')).join('');
			}
			else {
				reject('only opaque sRGB colors are supported');
			}
		}
		if (color) {
			const id = key.replace(/[^\w-]/g, '-');
			colors[id] = color;
			for (const role of ['background', 'surface', 'text', 'accent']) {
				if (key.split('.').at(-1) === role) {
					colors[role] = color;
				}
			}
		}
		else if (entry.type === 'fontFamily') {
			fontFamily = Array.isArray(value) ? value.join(', ') : String(value);
		}
		else if (entry.type === 'dimension') {
			const v = object(value);
			if (v.unit !== 'px') {
				reject('dimension tokens must use px');
			}
			if (/font.?size/i.test(key)) {
				fontSize = Number(v.value);
			}
			else if (/radius/i.test(key)) {
				radius = Number(v.value);
			}
			else if (/spacing/i.test(key)) {
				spacing = Number(v.value);
			}
		}
		else if (entry.type === 'number' && /line.?height/i.test(key)) {
			lineHeight = Number(value);
		}
	}
	if (!Object.keys(colors).length) {
		reject('no compatible color tokens found');
	}
	const system = { name, colors, fontFamily, fontSize, lineHeight, spacing, radius };
	validateAdvancedDocument({ screens: [], designSystem: system });
	return system;
}
