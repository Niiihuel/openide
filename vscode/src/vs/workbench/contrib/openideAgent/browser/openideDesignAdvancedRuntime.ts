/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { DesignDocument, DesignNode } from '../common/openideDesign.js';
import type { createDesignGeometry } from '../common/openideDesignAdvanced.js';
/** Serialized into the isolated Canvas. All resources belong to this document. */
export function createAdvancedDesignRuntime(geometry: ReturnType<typeof createDesignGeometry>) {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = (tag: string, parent: Element, attrs: Record<string, string | number> = {}) => { const el = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) {
		el.setAttribute(key, String(value));
	} parent.appendChild(el); return el; };
	const scene = (parent: HTMLElement, nodes: DesignNode[], doc: DesignDocument, yaw = 0, pitch = 0, onSelect?: (id: string) => void) => {
		const root = svg('svg', parent, { viewBox: '0 0 1000 600', width: '100%', height: '100%', 'aria-label': '3D scene', role: 'img' });
		const polygons: {
			points: string;
			depth: number;
			color: string;
			id: string;
			shade: number;
		}[] = [];
		for (const node of nodes) {
			if (!node.object3d) {
				continue;
			}
			const model = geometry.mesh(node.object3d);
			const vertices = model.vertices.map(([x, y, z]) => { const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180; [x, z] = [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)]; [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)]; return [x, y, z]; });
			for (const face of model.faces) {
				const points = face.map(i => vertices[i]);
				const depth = points.reduce((sum, p) => sum + p[2], 0) / 3;
				const p = points.map(([x, y, z]) => { const scale = 140 * 8 / Math.max(1, 8 - z); return `${500 + x * scale},${300 - y * scale}`; }).join(' ');
				const u = points[1].map((v, i) => v - points[0][i]), v = points[2].map((v, i) => v - points[0][i]);
				const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
				const length = Math.hypot(...normal) || 1;
				polygons.push({ points: p, depth, color: doc.tokens[node.token], id: node.id, shade: .45 + .55 * Math.abs((normal[0] * .3 + normal[1] * .6 + normal[2] * .7) / length) });
			}
		}
		for (const p of polygons.sort((a, b) => a.depth - b.depth)) {
			const c = p.color.slice(1).match(/../g)!.map(x => Math.round(parseInt(x, 16) * p.shade));
			const el = svg('polygon', root, { points: p.points, fill: `rgb(${c.join(',')})`, stroke: p.color, 'stroke-width': .4, 'data-object': p.id });
			if (onSelect) {
				el.addEventListener('click', e => { e.stopPropagation(); onSelect(p.id); });
			}
		}
		return root;
	};
	const paint = (el: HTMLElement, node: DesignNode, doc: DesignDocument, assets: Record<string, string>) => {
		if (node.frame) {
			el.style.position = 'absolute';
			el.style.left = `${node.frame.x}px`;
			el.style.top = `${node.frame.y}px`;
			el.style.width = `${node.frame.width}px`;
			el.style.height = `${node.frame.height}px`;
			el.style.transform = `rotate(${node.frame.rotation}deg)`;
			el.style.padding = '0';
			el.style.touchAction = 'none';
		}
		if (node.kind === 'image') {
			const image = document.createElement('img');
			image.src = assets[node.assetId ?? ''] ?? '';
			image.alt = node.text;
			image.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none';
			el.appendChild(image);
			return true;
		}
		if (node.kind === 'model') {
			el.style.minHeight = '300px';
			scene(el, [node], doc);
			return true;
		}
		if (node.kind === 'shape' || node.kind === 'path') {
			const width = node.frame?.width ?? 320, height = node.frame?.height ?? 180;
			const root = svg('svg', el, { viewBox: `0 0 ${width} ${height}`, width: '100%', height: '100%' });
			const color = doc.tokens[node.token];
			if (node.kind === 'path') {
				el.style.pointerEvents = 'none';
				svg('polyline', root, { points: (node.points ?? []).map(p => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': Math.max(1, node.spacing / 3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'stroke' });
			}
			else if (node.shape === 'ellipse') {
				svg('ellipse', root, { cx: width / 2, cy: height / 2, rx: width / 2 - 2, ry: height / 2 - 2, fill: color });
			}
			else if (node.shape === 'line' || node.shape === 'arrow') {
				svg('line', root, { x1: 4, y1: height / 2, x2: width - 8, y2: height / 2, stroke: color, 'stroke-width': 3 });
				if (node.shape === 'arrow') {
					svg('path', root, { d: `M ${width - 24} ${height / 2 - 12} L ${width - 8} ${height / 2} L ${width - 24} ${height / 2 + 12}`, fill: 'none', stroke: color, 'stroke-width': 3 });
				}
			}
			else {
				svg('rect', root, { x: 2, y: 2, width: width - 4, height: height - 4, rx: doc.designSystem?.radius ?? 8, fill: color });
			}
			if (node.text) {
				const text = svg('text', root, { x: width / 2, y: height / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#ffffff', 'font-size': node.size });
				text.textContent = node.text;
			}
			return true;
		}
		return false;
	};
	const animate = (root: HTMLElement, nodes: DesignNode[], time: number) => { const walk = (node: DesignNode) => { if (node.keyframes?.length) {
		const el = root.querySelector<HTMLElement>(`[data-node="${node.id}"]`);
		if (el) {
			const key = geometry.sample(node.keyframes, time);
			el.style.transform = `translate(${key.x}px,${key.y}px) rotate(${(node.frame?.rotation ?? 0) + key.rotation}deg) scale(${key.scale})`;
			el.style.opacity = String(key.opacity);
		}
	} node.children.forEach(walk); }; nodes.forEach(walk); };
	return { paint, scene, animate };
}
