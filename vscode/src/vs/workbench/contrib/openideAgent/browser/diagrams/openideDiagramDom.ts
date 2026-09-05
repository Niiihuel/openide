/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Exported so a renderer can write it back as an attribute; see `renderGraphDiagramSvg`. */
export const SVG_NAMESPACE = SVG_NS;

/**
 * Node builders shared by every diagram and chart renderer.
 *
 * The webview builds these SVGs by concatenating markup and handing it to `innerHTML`
 *. That route is closed in the workbench: the Trusted Types policy
 * rejects `innerHTML` and `DOMParser.parseFromString`, and taking it once already took the whole
 * chat view down ("Fail to render view workbench.view.openideChat.view" — see the note in
 * openideChatReasoning.ts). So the geometry is ported number for number and only the last mile,
 * turning it into nodes, is different.
 *
 * Escaping disappears with it: every label lands through `textContent`, which is why this module
 * has no counterpart to the webview's `escapeHtml`.
 */

export type SvgAttrs = Readonly<Record<string, string | number | undefined>>;

/**
 * `undefined` attributes are dropped rather than written as the string "undefined".
 *
 * The ported code decides some attributes conditionally (an edge's `stroke-dasharray`, a bar's
 * `stroke`) and the string version simply concatenated an empty fragment; the node version needs
 * the same "not there at all" outcome, because `stroke-dasharray="undefined"` is a parse error the
 * renderer silently swallows into a solid line.
 */
export function applySvgAttrs(node: Element, attrs?: SvgAttrs): void {
	if (!attrs) {
		return;
	}
	for (const name in attrs) {
		const value = attrs[name];
		if (value !== undefined) {
			node.setAttribute(name, String(value));
		}
	}
}

export function svgNode<K extends keyof SVGElementTagNameMap>(
	doc: Document,
	tag: K,
	attrs?: SvgAttrs,
	...children: readonly Element[]
): SVGElementTagNameMap[K] {
	const node = doc.createElementNS(SVG_NS, tag);
	applySvgAttrs(node, attrs);
	for (const child of children) {
		node.appendChild(child);
	}
	return node;
}

/** `<text>` with its content, which is the one SVG tag the ported code always fills with a label. */
export function svgText(doc: Document, attrs: SvgAttrs, text: string): SVGTextElement {
	const node = svgNode(doc, 'text', attrs);
	node.textContent = text;
	return node;
}

/**
 * The native SVG tooltip the webview attaches to slices, bars, commits and milestones.
 *
 * Not the workbench hover on purpose: these live INSIDE the `<svg>`, and that same `<svg>` is
 * handed to the full-screen viewer as `outerHTML`, so a tooltip implemented outside it would
 * disappear the moment the diagram is opened big.
 */
export function svgTooltip(target: Element, text: string): void {
	const doc = target.ownerDocument;
	const title = doc.createElementNS(SVG_NS, 'title');
	title.textContent = text;
	target.appendChild(title);
}

/**
 * `<foreignObject>` wrapping one HTML element.
 *
 * The label of a node and the chip of an edge are HTML, not SVG text, because SVG has no line
 * wrapping: the webview relies on flexbox inside the foreign object to centre and clip them.
 * `createElement` already produces XHTML-namespaced nodes, so the explicit `xmlns` the markup
 * version needed has no equivalent here.
 */
export function svgForeign(doc: Document, attrs: SvgAttrs, child: HTMLElement): SVGForeignObjectElement {
	const node = svgNode(doc, 'foreignObject', attrs);
	node.appendChild(child);
	return node;
}

let sequence = 0;

/**
 * Unique id for one rendered SVG.
 *
 * `<marker>` and `<pattern>` are referenced by `url(#id)`, and those references resolve against the
 * WHOLE document, not against the SVG that declares them — two diagrams sharing an id would make
 * the second one steal the first one's arrowheads. The webview had the same counter for the same
 * reason, plus the full-screen button locates its SVG by id.
 */
export function nextDiagramId(prefix: string): string {
	return `${prefix}-${++sequence}`;
}

/** `<div>` with a class and, when given, its text — the shape of every chart row and key. */
export function chartDiv(doc: Document, className: string, text?: string): HTMLDivElement {
	const node = doc.createElement('div');
	if (className) {
		node.className = className;
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}

/** `<span>` counterpart of `chartDiv`, for the inline pieces of a key or a timeline row. */
export function chartSpan(doc: Document, className: string, text?: string): HTMLSpanElement {
	const node = doc.createElement('span');
	if (className) {
		node.className = className;
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}
