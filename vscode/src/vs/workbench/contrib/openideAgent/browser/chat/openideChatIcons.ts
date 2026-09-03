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

/** The send arrow, heavier than a codicon: at 16px inside a filled circle the 1px glyph read as hairline. */
export function createArrowUpIcon(document: Document): SVGSVGElement {
	return createStrokeIcon(document, ['M12 19V5', 'm5 12 7-7 7 7'], { strokeWidth: 2.5, className: 'openide-chat-arrow-up-icon' });
}
