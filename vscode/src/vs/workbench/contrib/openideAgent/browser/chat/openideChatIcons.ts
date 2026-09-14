/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stroke icons the codicon font does not carry in the shape the product wants.
 *
 * Codicons are the default everywhere in the chat. These three are the exceptions, each for a
 * reason written next to it: a 24-unit grid, `currentColor`, rounded caps — the same drawing rules
 * as the rest of the product's line icons, so they sit next to a codicon without looking imported.
 */

import { createOpenideElement } from '../openideDom.js';
import { OPENIDE_CONTRACT_ICON_PATH, OPENIDE_EXPAND_ICON_PATH } from '../openideSurfaceCss.js';
import type { OpenideCliSessionStatus } from '../../common/openideAgentCliCatalog.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface IStrokeIconOptions {
	/** Rendered size in px (the grid is always 24). Default 16. */
	readonly size?: number;
	/** Default 1.75; the send arrow uses a heavier stroke on purpose. */
	readonly strokeWidth?: number;
	readonly className?: string;
}

export function createStrokeIcon(document: Document, paths: readonly string[], options: IStrokeIconOptions = {}): SVGSVGElement {
	const size = options.size ?? 16;
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', String(options.strokeWidth ?? 1.75));
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('openide-stroke-icon');
	if (options.className) {
		svg.classList.add(options.className);
	}
	for (const d of paths) {
		const path = document.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', d);
		svg.appendChild(path);
	}
	return svg;
}

/** Cursor's rewind: a thin arrow bent back on itself. `discard` is a circular arrow, `reply` a filled one. */
export function createRewindIcon(document: Document): SVGSVGElement {
	return createStrokeIcon(document, ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'], { className: 'openide-chat-rewind-icon' });
}

/** The classic diagonal paperclip Cursor uses for "attach"; the codicon `attach` is a smaller, upright clip. */
export function createPaperclipIcon(document: Document): SVGSVGElement {
	return createStrokeIcon(document, ['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'], { className: 'openide-chat-paperclip-icon' });
}

/** Circular actions use a 16-unit grid with a compact 14px slot. */
export function createArrowUpIcon(document: Document): SVGSVGElement {
	const svg = createStrokeIcon(document, ['M8 13.5V2.5', 'M2.5 8 8 2.5 13.5 8'], { size: 14, strokeWidth: 1.25, className: 'openide-chat-arrow-up-icon' });
	svg.setAttribute('viewBox', '0 0 16 16');
	return svg;
}

/** Return to latest is the same glyph and weight, pointing down. */
export function createArrowDownIcon(document: Document): SVGSVGElement {
	const svg = createArrowUpIcon(document);
	svg.classList.replace('openide-chat-arrow-up-icon', 'openide-chat-arrow-down-icon');
	for (const path of svg.querySelectorAll('path')) { path.setAttribute('transform', 'rotate(180 8 8)'); }
	return svg;
}

export function createStopIcon(document: Document): SVGSVGElement {
	const svg = createStrokeIcon(document, [], { size: 14, className: 'openide-chat-stop-icon' });
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('stroke', 'none');
	svg.setAttribute('fill', 'currentColor');
	const rect = document.createElementNS(SVG_NS, 'rect');
	for (const [key, value] of Object.entries({ x: '3.5', y: '3.5', width: '9', height: '9', rx: '1.25' })) { rect.setAttribute(key, value); }
	svg.appendChild(rect);
	return svg;
}

/** Bootstrap Icons arrows-angle-expand/contract. Copyright (c) 2019-2024 The Bootstrap Authors.
 * MIT licensed; the complete notice is in ThirdPartyNotices.txt. Original 16-unit filled geometry.
 */
export function createChatExpandIcon(document: Document, expanded: boolean): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '-1 -1 18 18');
	svg.setAttribute('width', '14');
	svg.setAttribute('height', '14');
	svg.setAttribute('fill', 'currentColor');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('openide-chat-expand-icon');
	svg.setAttribute('data-icon', expanded ? 'arrows-angle-contract' : 'arrows-angle-expand');
	const path = document.createElementNS(SVG_NS, 'path');
	path.setAttribute('fill-rule', 'evenodd');
	path.setAttribute('d', expanded ? OPENIDE_CONTRACT_ICON_PATH : OPENIDE_EXPAND_ICON_PATH);
	svg.appendChild(path);
	return svg;
}

/** One status glyph for conversation tabs and session history. Completed/idle rows stay quiet. */
export function createChatSessionStatusIcon(document: Document, status: OpenideCliSessionStatus | undefined): HTMLSpanElement | undefined {
	if (!status || status === 'completed') { return undefined; }
	const icon = createOpenideElement(document, 'span');
	icon.className = `openide-chat-session-status ${status}`;
	icon.setAttribute('aria-hidden', 'true');
	if (status === 'in-progress') {
		icon.classList.add('oi-spinner');
	} else {
		icon.classList.add('codicon', status === 'needs-input' ? 'codicon-bell' : 'codicon-error');
	}
	return icon;
}
