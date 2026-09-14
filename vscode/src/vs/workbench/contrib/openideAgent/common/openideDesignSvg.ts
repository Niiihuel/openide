/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { DesignDocument, DesignNode } from './openideDesign.js';
import { createDesignGeometry } from './openideDesignAdvanced.js';
const escape = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
/** Standalone vector export; keyframes remain editable SVG animation elements. */
export function exportDesignSvg(doc: DesignDocument, assets: Record<string, string>): string {
	const duration = doc.duration ?? 5, geometry = createDesignGeometry();
	const render = (n: DesignNode, index: number, depth = 0): string => {
		const f = n.frame ?? { x: 24 + depth * 16, y: 24 + index * 100, width: 1000 - depth * 32, height: n.kind === 'text' ? 80 : 100, rotation: 0 };
		const color = escape(doc.tokens[n.token]);
		let body = '';
		if (n.kind === 'image') {
			body = `<image width="${f.width}" height="${f.height}" href="${escape(assets[n.assetId ?? ''] ?? '')}"/>`;
		}
		else if (n.kind === 'path') {
			body = `<polyline points="${n.points!.map(p => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${Math.max(1, n.spacing / 3)}" stroke-linecap="round"/>`;
		}
		else if (n.object3d) {
			const mesh = geometry.mesh(n.object3d);
			body = mesh.faces.map(face => { const points = face.map(i => mesh.vertices[i]); const depth = points.reduce((a, p) => a + p[2], 0) / 3; return { depth, svg: `<polygon points="${points.map(([x, y, z]) => `${500 + x * 140 * 8 / Math.max(1, 8 - z)},${300 - y * 140 * 8 / Math.max(1, 8 - z)}`).join(' ')}" fill="${color}" stroke="#ffffff" stroke-width=".5"/>` }; }).sort((a, b) => a.depth - b.depth).map(f => f.svg).join('');
		}
		else {
			if (n.kind === 'shape' || n.kind === 'button' || n.kind === 'box') {
				body = n.shape === 'ellipse' ? `<ellipse cx="${f.width / 2}" cy="${f.height / 2}" rx="${f.width / 2 - 2}" ry="${f.height / 2 - 2}" fill="${color}"/>` : n.shape === 'line' || n.shape === 'arrow' ? `<path d="M 2 ${f.height / 2} H ${f.width - 4}${n.shape === 'arrow' ? ` M ${f.width - 20} ${f.height / 2 - 12} L ${f.width - 4} ${f.height / 2} L ${f.width - 20} ${f.height / 2 + 12}` : ''}" stroke="${color}" stroke-width="3" fill="none"/>` : `<rect width="${f.width}" height="${f.height}" rx="${doc.designSystem?.radius ?? 8}" fill="${n.kind === 'box' ? escape(doc.tokens.surface) : color}"/>`;
			}
			if (n.text) {
				const textColor = ['shape', 'button'].includes(n.kind) ? '#ffffff' : color;
				const lines = n.text.match(new RegExp(`.{1,${Math.max(8, Math.floor(f.width / (n.size * .6)))}}(?:\\s|$)|\\S+`, 'g')) ?? [n.text];
				body += `<text x="12" y="${n.size + 12}" fill="${textColor}" font-family="${escape(doc.designSystem?.fontFamily ?? 'sans-serif')}" font-size="${n.size}">${lines.map((line, i) => `<tspan x="12" dy="${i ? n.size * 1.4 : 0}">${escape(line.trim())}</tspan>`).join('')}</text>`;
			}
		}
		body += n.children.map((child, i) => render(child, i, depth + 1)).join('');
		body = `<g transform="translate(${-f.width / 2} ${-f.height / 2})">${body}</g>`;
		if (n.keyframes?.length) {
			const keys = [...n.keyframes];
			if (keys[0].time > 0) {
				keys.unshift({ ...keys[0], time: 0 });
			}
			if (keys.at(-1)!.time < duration) {
				keys.push({ ...keys.at(-1)!, time: duration });
			}
			const times = keys.map(k => k.time / duration).join(';');
			body = `<g><animateTransform attributeName="transform" type="translate" values="${keys.map(k => `${k.x} ${k.y}`).join(';')}" keyTimes="${times}" dur="${duration}s" repeatCount="indefinite"/><g><animateTransform attributeName="transform" type="rotate" values="${keys.map(k => k.rotation + f.rotation).join(';')}" keyTimes="${times}" dur="${duration}s" repeatCount="indefinite"/><g><animateTransform attributeName="transform" type="scale" values="${keys.map(k => k.scale).join(';')}" keyTimes="${times}" dur="${duration}s" repeatCount="indefinite"/><animate attributeName="opacity" values="${keys.map(k => k.opacity).join(';')}" keyTimes="${times}" dur="${duration}s" repeatCount="indefinite"/>${body}</g></g></g>`;
		}
		return `<g id="${escape(n.id)}" transform="translate(${f.x + f.width / 2} ${f.y + f.height / 2}) rotate(${n.keyframes?.length ? 0 : f.rotation})">${body}</g>`;
	};
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${700 * doc.screens.length}" viewBox="0 0 1100 ${700 * doc.screens.length}"><title>${escape(doc.title)}</title>${doc.screens.map((screen, i) => `<g transform="translate(0 ${i * 700})"><rect width="1100" height="700" fill="${escape(doc.tokens.background)}"/>${screen.nodes.map((n, i) => render(n, i)).join('')}</g>`).join('')}</svg>`;
}
/** Import a passive SVG subset. Active content, references and entities are rejected. */
export function validateDesignSvg(source: string): void {
	if (source.length > 500000 || !/<svg[\s>]/i.test(source) || /<!|<\?|\bon\w+\s*=|\b(?:href|src)\s*=|url\s*\(|&(?:#|[a-z])/i.test(source)) {
		throw new Error('SVG must contain only passive inline geometry, without entities, URLs or event handlers.');
	}
	const dimensions = /<svg\b([^>]*)>/i.exec(source)?.[1] ?? '';
	for (const key of ['width', 'height']) {
		const match = new RegExp(`\\b${key}\\s*=\\s*[\"']([^\"']+)[\"']`, 'i').exec(dimensions);
		if (match && !/^(?:[1-9]\d{0,3})(?:px)?$/.test(match[1])) {
			throw new Error('SVG dimensions must be 1–9999 pixels.');
		}
	}
	const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'linearGradient', 'radialGradient', 'stop']);
	for (const match of source.matchAll(/<\/?([\w:-]+)/g)) {
		if (!allowed.has(match[1])) {
			throw new Error(`SVG element is unsupported: ${match[1]}`);
		}
	}
}
