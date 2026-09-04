/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the visual defects a screenshot shows but nobody reliably sees.
 *
 *  A multimodal model looking at a page is good at "this looks wrong" and bad at "this label is
 *  clipped by two pixels", "these two buttons overlap by a third", "this grey on grey is 2.9:1".
 *  Those are measurements, and the page can be asked for them directly. So the model is not asked
 *  to squint: the page is measured, and what comes back is a list with a selector and a number
 *  attached to every claim.
 *
 *  The rule for what belongs here is FALSIFIABILITY. Every check answers a question with one
 *  right answer — is the text cut off, does the image have pixels, is the contrast ratio below
 *  4.5 — and never a question of taste. Spacing, hierarchy, whether the blue is the right blue:
 *  that is what the video and the contact sheet are for, and the model is better at it than any
 *  rule would be.
 *
 *  ── How it runs ───────────────────────────────────────────────────────────────────────────
 *  `openideVisualLintRuntime` is serialized with `toString()` and evaluated INSIDE the inspected
 *  page (`page.evaluate`), so it sees the real computed styles and the real layout. It therefore
 *  must not reference anything from module scope. It takes an optional document so the browser
 *  test can run the very same source against a constructed DOM instead of a copy of it.
 *--------------------------------------------------------------------------------------------*/

export type VisualLintKind =
	/** Text is cut by an overflow with nothing to say it was cut. */
	| 'clipped-text'
	/** The document is wider than the viewport: a horizontal scrollbar nobody wanted. */
	| 'page-overflow'
	/** An `img` that finished loading with no pixels. */
	| 'broken-image'
	/** Text below the WCAG AA ratio against the background actually behind it. */
	| 'low-contrast'
	/** A control too small to hit. */
	| 'tiny-target'
	/** Two controls sitting on top of each other. */
	| 'overlap';

export interface IVisualLintFinding {
	readonly kind: VisualLintKind;
	/** A selector that finds the element again, best effort. */
	readonly selector: string;
	/** One line, already written for a reader, with the measurement in it. */
	readonly detail: string;
	/** Viewport rectangle, so a caller can draw a box on the screenshot. */
	readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly severity: number;
}

export interface IVisualLintReport {
	readonly findings: readonly IVisualLintFinding[];
	readonly checked: number;
	readonly viewport: { readonly width: number; readonly height: number };
}

/** Below this ratio, normal-size text fails WCAG AA. Large text is allowed 3:1. */
export const CONTRAST_AA = 4.5;
export const CONTRAST_AA_LARGE = 3;

/** A control smaller than this in either axis is hard to hit; WCAG 2.2 AA asks for 24. */
export const MIN_TARGET_PX = 24;

/**
 * The lint, as it runs in the page. One function, no module references, plain JSON out.
 *
 * `doc` exists for the test. In the page it is called with no arguments.
 */
export function openideVisualLintRuntime(doc?: unknown): unknown {
	const d: Document = (doc as Document) || document;
	const view = d.defaultView || window;
	const findings: any[] = [];
	let checked = 0;

	const MIN_TARGET = 24;
	const AA = 4.5;
	const AA_LARGE = 3;
	// A page is allowed to be one pixel wider than the viewport: subpixel layout rounds.
	const OVERFLOW_SLACK = 2;
	// Enough to describe a screen; a document with 20k nodes is not worth walking twice.
	const MAX_ELEMENTS = 4000;

	const selectorFor = (el: Element): string => {
		if (el.id) { return '#' + el.id; }
		const parts: string[] = [];
		let node: Element | null = el;
		let depth = 0;
		while (node && depth < 4 && node.nodeType === 1 && node !== d.body) {
			let part = node.tagName.toLowerCase();
			const cls = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
			if (cls.length) { part += '.' + cls.join('.'); }
			parts.unshift(part);
			node = node.parentElement;
			depth++;
		}
		return parts.join(' > ') || el.tagName.toLowerCase();
	};

	const rectOf = (el: Element) => {
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
	};

	const visible = (el: Element, style: CSSStyleDeclaration): boolean => {
		if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) { return false; }
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) { return false; }
		// Off the bottom of a long page is not a defect; off to the left or above usually is not
		// either (carousels, drawers). Only what the viewport can actually show is judged.
		return r.bottom > 0 && r.top < (view.innerHeight || 0) && r.right > 0 && r.left < (view.innerWidth || 0);
	};

	const parseColor = (value: string): [number, number, number, number] | undefined => {
		const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(value || '');
		return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : undefined;
	};

	const luminance = (rgb: [number, number, number, number]): number => {
		const channel = (raw: number) => {
			const c = raw / 255;
			return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
	};

	/** The colour actually behind an element, or undefined when an image makes it unknowable. */
	const backgroundBehind = (el: Element): [number, number, number, number] | undefined => {
		let node: Element | null = el;
		while (node) {
			const style = view.getComputedStyle(node);
			if (style.backgroundImage && style.backgroundImage !== 'none') { return undefined; }
			const color = parseColor(style.backgroundColor);
			if (color && color[3] >= 0.95) { return color; }
			if (color && color[3] > 0.05) { return undefined; } // translucent: the real colour is a blend
			node = node.parentElement;
		}
		return [255, 255, 255, 1];
	};

	const contrast = (a: [number, number, number, number], b: [number, number, number, number]): number => {
		const la = luminance(a);
		const lb = luminance(b);
		return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
	};

	/** Text this element renders itself, not what its children render. */
	const ownText = (el: Element): string => {
		let text = '';
		for (let i = 0; i < el.childNodes.length; i++) {
			const node = el.childNodes[i];
			if (node.nodeType === 3) { text += node.nodeValue || ''; }
		}
		return text.trim();
	};

	const isControl = (el: Element): boolean => {
		const tag = el.tagName.toLowerCase();
		if (tag === 'button' || tag === 'a' || tag === 'select' || tag === 'textarea') { return true; }
		if (tag === 'input') { return (el as HTMLInputElement).type !== 'hidden'; }
		const role = el.getAttribute('role');
		return role === 'button' || role === 'link' || role === 'checkbox' || role === 'tab' || role === 'menuitem';
	};

	const push = (kind: string, el: Element, detail: string, severity: number) => {
		findings.push({ kind, selector: selectorFor(el), detail, rect: rectOf(el), severity });
	};

	// ---- The document itself ----------------------------------------------------------------
	const docWidth = Math.max(d.documentElement.scrollWidth, d.body ? d.body.scrollWidth : 0);
	const viewportWidth = view.innerWidth || d.documentElement.clientWidth || 0;
	if (docWidth > viewportWidth + OVERFLOW_SLACK) {
		findings.push({
			kind: 'page-overflow',
			selector: 'html',
			detail: `The document is ${docWidth}px wide in a ${viewportWidth}px viewport, so the page scrolls sideways by ${docWidth - viewportWidth}px. Something inside is wider than its container.`,
			rect: { x: 0, y: 0, width: docWidth, height: 0 },
			severity: 0.8,
		});
	}

	// ---- Every element on screen, once ------------------------------------------------------
	const all = d.querySelectorAll('*');
	const controls: { el: Element; rect: DOMRect }[] = [];
	for (let i = 0; i < all.length && i < MAX_ELEMENTS; i++) {
		const el = all[i];
		const tag = el.tagName.toLowerCase();
		if (tag === 'script' || tag === 'style' || tag === 'head' || tag === 'meta' || tag === 'link' || tag === 'title') { continue; }
		const style = view.getComputedStyle(el);
		if (!visible(el, style)) { continue; }
		checked++;

		// Clipped text: cut by an overflow, with no ellipsis to admit it.
		const text = ownText(el);
		if (text && style.overflow !== 'visible' && style.textOverflow !== 'ellipsis') {
			const cutX = el.scrollWidth - el.clientWidth;
			const cutY = el.scrollHeight - el.clientHeight;
			// A scroll container is supposed to be taller than its box; only report what has no way
			// to be reached, i.e. hidden rather than scrollable.
			const hiddenX = style.overflowX === 'hidden' || style.overflowX === 'clip';
			const hiddenY = style.overflowY === 'hidden' || style.overflowY === 'clip';
			if (hiddenX && cutX > 2) {
				push('clipped-text', el, `"${text.slice(0, 40)}" is cut horizontally: ${cutX}px of it is outside a box with overflow hidden and no ellipsis, so the text just stops.`, 0.7);
			} else if (hiddenY && cutY > 2 && el.clientHeight > 0) {
				push('clipped-text', el, `"${text.slice(0, 40)}" is cut vertically: ${cutY}px of it is below a box with overflow hidden, with no way to scroll to it.`, 0.6);
			}
		}

		// An image that loaded nothing.
		if (tag === 'img') {
			const img = el as HTMLImageElement;
			if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
				push('broken-image', el, `The image finished loading with no pixels: src="${String(img.getAttribute('src')).slice(0, 80)}".`, 0.9);
			}
		}

		// Contrast, on the elements that render their own text.
		if (text.length >= 2) {
			const color = parseColor(style.color);
			const background = backgroundBehind(el);
			if (color && background && color[3] >= 0.95) {
				const size = parseFloat(style.fontSize) || 16;
				const weight = Number(style.fontWeight) || 400;
				const large = size >= 24 || (size >= 18.66 && weight >= 700);
				const need = large ? AA_LARGE : AA;
				const ratio = contrast(color, background);
				if (ratio < need) {
					push('low-contrast', el, `Text "${text.slice(0, 30)}" is ${ratio.toFixed(2)}:1 against what is behind it; ${large ? 'large' : 'normal'} text needs ${need}:1. Colour ${style.color} on ${`rgb(${background[0]}, ${background[1]}, ${background[2]})`}.`, Math.min(1, (need - ratio) / need + 0.3));
				}
			}
		}

		// Controls: too small, and (below) overlapping each other.
		if (isControl(el)) {
			const r = el.getBoundingClientRect();
			controls.push({ el, rect: r });
			if (r.width < MIN_TARGET || r.height < MIN_TARGET) {
				push('tiny-target', el, `The control is ${Math.round(r.width)}x${Math.round(r.height)}px; anything under ${MIN_TARGET}x${MIN_TARGET} is below the WCAG 2.2 target size and hard to hit.`, 0.45);
			}
		}
	}

	// ---- Controls sitting on top of each other ----------------------------------------------
	// Quadratic, so it is capped. Overlap is reported only when it is most of the smaller control:
	// a button inside a card overlaps its card, and that is the normal shape of a page.
	const LIMIT = 220;
	for (let i = 0; i < controls.length && i < LIMIT; i++) {
		for (let j = i + 1; j < controls.length && j < LIMIT; j++) {
			const a = controls[i];
			const b = controls[j];
			if (a.el.contains(b.el) || b.el.contains(a.el)) { continue; }
			const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
			const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
			if (x <= 1 || y <= 1) { continue; }
			const area = x * y;
			const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
			if (smaller > 0 && area / smaller > 0.5) {
				findings.push({
					kind: 'overlap',
					selector: selectorFor(a.el),
					detail: `This control and "${selectorFor(b.el)}" overlap over ${Math.round((area / smaller) * 100)}% of the smaller one. Whichever is on top is the only one that can be clicked.`,
					rect: { x: Math.round(a.rect.x), y: Math.round(a.rect.y), width: Math.round(a.rect.width), height: Math.round(a.rect.height) },
					severity: 0.65,
				});
			}
		}
	}

	findings.sort((a, b) => b.severity - a.severity);
	return {
		findings: findings.slice(0, 60),
		checked,
		viewport: { width: viewportWidth, height: view.innerHeight || 0 },
	};
}

/** The function source, ready for `page.evaluate`. */
export function visualLintSource(): string {
	return `(${openideVisualLintRuntime.toString()})()`;
}

/** One line per finding, for the tool result a CLI reads. */
export function describeLint(report: IVisualLintReport): string {
	if (!report.findings.length) {
		return `No measurable visual defects across ${report.checked} visible elements: no clipped text, no broken images, no contrast below WCAG AA, no overlapping or undersized controls, no horizontal overflow.`;
	}
	const lines = report.findings.map(finding => `- ${finding.kind} @ ${finding.selector} (${finding.rect.x},${finding.rect.y} ${finding.rect.width}x${finding.rect.height}): ${finding.detail}`);
	return `${report.findings.length} finding(s) across ${report.checked} visible elements:\n${lines.join('\n')}`;
}
