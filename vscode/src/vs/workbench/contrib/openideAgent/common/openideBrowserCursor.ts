/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — cursor visible del agente en la vista previa nativa.
 *
 *  When the agent drives the browser NOTHING is visible: Playwright clicks are real input
 *  events, but the system pointer does not move. The page changes on its own and there is no
 *  way to tell where it touched or why. This overlay draws a pointer that glides to the point
 *  and marks the click, so the user can follow what the agent does live — and it also shows up
 *  in screenshots, which is exactly where the intent of a step used to be lost.
 *
 *  Two paths, on purpose:
 *    1. Explicit `moveTo`, used by browser_click and browser_type: the glide happens BEFORE the
 *          action, so the screenshot taken afterwards shows the pointer in the right place.
 *    2. Mirroring of real events (pointermove/mousedown in the capture phase), BUT only while
 *          the agent is operating (engage): this covers browser_playwright without wiring tool by tool.
 *          The user's mouse NEVER moves this pointer — they are independent things.
 *
 *  The overlay lives in a closed shadow root, with pointer-events:none and outside layout: it
 *  can neither intercept a click nor show up in what the page queries about itself.
 *--------------------------------------------------------------------------------------------*/

/** Id of the overlay host. Filtered out of DOM reads so it does not pollute the context. */
export const OPENIDE_CURSOR_HOST_ID = 'openide-agent-cursor';

/** Name of the global object the tools expose to drive the pointer. */
export const OPENIDE_CURSOR_GLOBAL = '__openideAgentCursor';

/**
 * Overlay runtime. Serialized with toString() and evaluated in the page, like the canvas
 * runtime: this way the code lives here as real TypeScript instead of text inside a template
 * literal, where a backslash goes missing silently.
 *
 * It is idempotent: invoked before every action, because a navigation takes the overlay away.
 */
export function openideCursorRuntimeMain(): void {
	// This file lives in `common` (no DOM lib: it has to pass the worker layer check) but the body
	// of this function runs INSIDE the page it is serialized into, so the DOM it touches is typed
	// loosely on purpose — the page's own globals are the only truth at runtime.
	type PageElement = any;
	type PageDocument = any;
	const HOST_ID = 'openide-agent-cursor';
	const GLOBAL = '__openideAgentCursor';
	const scope = globalThis as any;
	const doc = scope.document as PageDocument | undefined;
	if (!doc || !doc.documentElement) { return; }

	const existing = scope[GLOBAL];
	if (existing && existing.host && existing.host.isConnected) { return; }

	const host = doc.createElement('div');
	host.id = HOST_ID;
	host.setAttribute('data-openide-overlay', 'cursor');
	// The host takes part in neither layout nor hit-testing: it cannot cover or steal a click.
	host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;z-index:2147483647';
	const shadow = host.attachShadow({ mode: 'closed' });

	const style = doc.createElement('style');
	style.textContent = [
		':host{all:initial}',
		'.layer{position:fixed;inset:0;pointer-events:none;overflow:hidden}',
		// The glide is the whole point: without a transition the pointer would appear already placed
		// and would not communicate where it came from. The curve decelerates late, the way a hand
		// does, so the arrival reads as intent rather than as a slide.
		'.cursor{position:absolute;top:0;left:0;width:22px;height:22px;transform:translate3d(-40px,-40px,0);opacity:0;',
		'transition:transform var(--oc-travel,420ms) cubic-bezier(.25,.75,.25,1),opacity 180ms ease-out;will-change:transform,opacity}',
		// The first appearance does not travel from the corner (that would be an invented path): it
		// enters where it is about to act. But it enters visibly, because that first step is the one the
		// user needs to see.
		'.cursor.instant{transition:opacity 180ms ease-out}',
		'.cursor.visible{opacity:1}',
		// The system arrow, and nothing around it: white body, hairline dark edge and the shadow the
		// desktop pointer casts. The old halo was a second shape the eye had to explain; a pointer is
		// already the most recognisable glyph on a screen.
		'.cursor svg{display:block;width:22px;height:22px;overflow:visible;transform-origin:4px 3px;transition:transform 120ms cubic-bezier(.2,.7,.2,1);',
		'filter:drop-shadow(0 1px 1px rgba(0,0,0,.35)) drop-shadow(0 2px 4px rgba(0,0,0,.18))}',
		// The press: the pointer dips on its tip and ONE soft bloom spreads from the point of contact.
		//
		// A RADIAL GRADIENT, not a disc and not a ring. Every hard-edged shape here reads as a
		// border — that is what made the first build's stroked ring collapse into a double outline
		// over a field that draws its own focus ring, and a flat disc still shows a crisp rim as it
		// grows. A gradient that fades to transparent well before its own edge has no rim to read,
		// which is the "smoky pulse" the screen recorders use. Only `transform` and `opacity` are
		// animated, so it never costs a layout.
		'.cursor.active svg{transform:scale(.87)}',
		'.ripple{position:absolute;top:0;left:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;',
		'background:radial-gradient(circle closest-side,rgba(120,175,255,.55) 0%,rgba(120,175,255,.28) 42%,rgba(120,175,255,0) 72%);',
		'opacity:0;transform:scale(.28);will-change:transform,opacity}',
		'.ripple.go{animation:oc-ripple 520ms cubic-bezier(.16,.84,.44,1) forwards}',
		'@keyframes oc-ripple{0%{opacity:1;transform:scale(.28)}60%{opacity:.55}100%{opacity:0;transform:scale(1.55)}}',
		// The caption: what the step meant ("Click · Button Save"), as a subtitle at the bottom of the
		// viewport — the way Playwright's own recordings title each action — and not as a tag hanging
		// off the pointer, where it covered the very field being typed into and moved with every
		// glide. It fades on its own; while typing it stays, with a caret.
		'.tag{position:absolute;left:50%;bottom:22px;transform:translate(-50%,6px);max-width:min(70vw,560px);padding:5px 12px;border-radius:999px;',
		'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:500 12px/1.35 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;',
		'background:rgba(17,17,19,.86);color:#f5f5f7;box-shadow:0 2px 10px rgba(0,0,0,.25);opacity:0;transition:opacity 160ms ease-out,transform 160ms ease-out}',
		'.tag.show{opacity:1;transform:translate(-50%,0)}',
		'.tag.error{background:rgba(196,42,50,.94)}',
		// A failed step blooms red: the shape says "it touched here", the colour says how it went.
		'.cursor.failed .ripple{background:radial-gradient(circle closest-side,rgba(255,120,124,.6) 0%,rgba(255,120,124,.3) 42%,rgba(255,120,124,0) 72%)}',
		// Caret pulsing while typing: without this, typing looks like dead air.
		'.tag .caret{display:none;margin-left:2px;opacity:.9;animation:oc-blink 900ms steps(1,end) infinite}',
		'.tag.typing .caret{display:inline}',
		'@keyframes oc-blink{0%,49%{opacity:.9}50%,100%{opacity:0}}',
		// The mark over the element the step touched: a soft WASH with a blurred halo, and no edge of
		// any kind.
		//
		// Two shapes were tried here and both were wrong for the same reason — each drew a border.
		// A ring collapsed into a double outline over a field that already draws its own focus ring;
		// four white corner brackets read as the crop marks of a 2010 screen-capture tool. A tinted
		// pane says "this one" in the same edgeless language as the click's bloom, so the whole
		// overlay speaks with one voice. Only `opacity` and `transform` ever animate.
		'.box{position:absolute;top:0;left:0;border-radius:6px;opacity:0;background:rgba(120,175,255,.15);',
		'box-shadow:0 0 16px 3px rgba(120,175,255,.26);transition:opacity 180ms ease-out;',
		'will-change:transform,opacity;pointer-events:none}',
		'.box.show{opacity:1;animation:oc-box 300ms cubic-bezier(.16,.84,.44,1)}',
		'@keyframes oc-box{0%{opacity:0;transform:scale(.96)}100%{opacity:1;transform:none}}',
		// Typing: the wash breathes instead of the corners moving. `.typing` sits after `.show` so
		// its animation is the one that wins while the keys are landing.
		'.box.typing{animation:oc-breathe 1.6s ease-in-out infinite}',
		'@keyframes oc-breathe{0%,100%{opacity:.58}50%{opacity:1}}',
		'.box.miss{background:rgba(255,120,124,.17);box-shadow:0 0 16px 3px rgba(255,120,124,.3)}',
		'@media (prefers-reduced-motion: reduce){.cursor{transition:none}.cursor svg{transition:none}.ripple.go{animation-duration:1ms}.tag .caret{animation:none}.box.show,.box.typing{animation:none}}',
	].join('');

	const layer = doc.createElement('div');
	layer.className = 'layer';
	const cursor = doc.createElement('div');
	cursor.className = 'cursor instant';
	// The desktop arrow (the Adwaita/macOS silhouette), tip at the origin so the glide lands the
	// point — not the glyph's centre — on the target.
	cursor.innerHTML = '<div class="ripple"></div>'
		+ '<svg viewBox="0 0 24 24" aria-hidden="true">'
		+ '<path d="M4.5 3.2 L4.5 18.6 L8.6 14.9 L11.2 20.6 L13.9 19.4 L11.3 13.8 L16.7 13.6 Z" fill="#ffffff" stroke="#111214" stroke-width="1.4" stroke-linejoin="round"/>'
		+ '</svg>';
	const tag = doc.createElement('div');
	tag.className = 'tag';
	tag.innerHTML = '<span class="tag-text"></span><span class="caret">▍</span>';
	layer.appendChild(tag);
	const box = doc.createElement('div');
	box.className = 'box';
	layer.appendChild(box);
	layer.appendChild(cursor);
	shadow.appendChild(style);
	shadow.appendChild(layer);
	doc.documentElement.appendChild(host);

	const ripple = cursor.querySelector('.ripple') as PageElement;
	let at = { x: -40, y: -40 };
	let placed = false;
	// The real-input mirror only reflects the agent (engage), never the user's mouse: without this
	// gate, any user hover over the preview would move the pointer.
	let engaged = false;
	let labelTimer = 0;

	const APPEAR_MS = 240;

	function place(x: number, y: number, instant: boolean): void {
		at = { x, y };
		if (instant || !placed) { cursor.classList.add('instant'); } else { cursor.classList.remove('instant'); }
		cursor.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
		if (instant || !placed) { void cursor.offsetWidth; cursor.classList.remove('instant'); }
		cursor.classList.add('visible');
		placed = true;
	}

	function travelTime(x: number, y: number): number {
		// First appearance: there is no path to show, but there is a fade that must be awaited before
		// continuing, or the step's screenshot would come out with the pointer still invisible.
		if (!placed) { return APPEAR_MS; }
		const distance = Math.hypot(x - at.x, y - at.y);
		// Neither instant on short hops nor endless when crossing the screen.
		return Math.max(140, Math.min(620, 120 + distance * 0.55));
	}

	const api = {
		host: host,
		/** Glides the pointer and resolves when done, so the next step finds it there. */
		moveTo(x: number, y: number, label?: string): Promise<void> {
			const duration = travelTime(x, y);
			cursor.style.setProperty('--oc-travel', duration + 'ms');
			api.label(label);
			place(x, y, false);
			return new Promise<void>(resolve => scope.setTimeout(resolve, duration + 20));
		},
		/** Marks the click where the pointer is. */
		press(): Promise<void> {
			cursor.classList.add('active');
			ripple.classList.remove('go');
			void ripple.offsetWidth;
			ripple.classList.add('go');
			return new Promise<void>(resolve => scope.setTimeout(() => {
				cursor.classList.remove('active');
				resolve();
			}, 260));
		},
		label(text?: string, kind?: string): void {
			const slot = tag.querySelector('.tag-text') as PageElement;
			tag.classList.toggle('error', kind === 'error');
			if (labelTimer) { scope.clearTimeout(labelTimer); labelTimer = 0; }
			if (text) {
				slot.textContent = text;
				tag.classList.add('show');
				// A caption is narration, not state: it leaves on its own once the step has been
				// read. An error stays a little longer; typing keeps it (see `typing`).
				labelTimer = scope.setTimeout(() => { if (!tag.classList.contains('typing')) { tag.classList.remove('show'); } }, kind === 'error' ? 2600 : 1600);
			} else { tag.classList.remove('show'); tag.classList.remove('typing'); }
		},
		/** Boxes the element the selector resolved to: if the step touched the wrong thing, you see it. */
		highlight(rect: { x: number; y: number; width: number; height: number } | null, miss?: boolean): Promise<void> {
			if (!rect) { box.classList.remove('show'); return Promise.resolve(); }
			box.classList.toggle('miss', miss === true);
			box.classList.remove('typing');
			box.style.transform = 'translate3d(' + rect.x + 'px,' + rect.y + 'px,0)';
			box.style.width = rect.width + 'px';
			box.style.height = rect.height + 'px';
			// Re-run the draw-in even when the ring is already showing on another element.
			box.classList.remove('show');
			void box.offsetWidth;
			box.classList.add('show');
			return new Promise<void>(resolve => scope.setTimeout(resolve, 200));
		},
		clearHighlight(): void { box.classList.remove('show'); box.classList.remove('typing'); },
		/** Typing in progress: the caption stays with a pulsing caret and the brackets breathe, so
		 *  the keys visibly land in the field instead of the text simply appearing. */
		typing(on: boolean): void {
			tag.classList.toggle('typing', on === true);
			box.classList.toggle('typing', on === true);
			if (on) { tag.classList.add('show'); }
			else if (labelTimer === 0) { tag.classList.remove('show'); }
		},
		/** Turns the real-input mirror on/off. Off by default: the user's mouse must not move this
		 *  pointer. browser_playwright turns it on while it operates. */
		engage(on: boolean): void { engaged = on === true; },
		/** A failed step is information too: it marks where it was attempted and why it did not work. */
		fail(message: string): Promise<void> {
			api.label(message, 'error');
			cursor.classList.add('active', 'failed');
			ripple.classList.remove('go');
			void ripple.offsetWidth;
			ripple.classList.add('go');
			return new Promise<void>(resolve => scope.setTimeout(() => { cursor.classList.remove('active', 'failed'); resolve(); }, 300));
		},
		hide(): void {
			api.label(undefined);
			host.remove();
			delete scope[GLOBAL];
		},
		position(): { x: number; y: number } { return { x: at.x, y: at.y }; },
		// The shadow root is closed on purpose, so without these observers there would be no way to
		// verify from outside that what is shown is what is believed. They are read-only.
		opacity(): number { return Number(scope.getComputedStyle(cursor).opacity); },
		boxRect(): { x: number; y: number; width: number; height: number } | null {
			if (!box.classList.contains('show')) { return null; }
			const r = box.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		},
		boxIsMiss(): boolean { return box.classList.contains('miss') && box.classList.contains('show'); },
		labelText(): string { return (tag.querySelector('.tag-text') as PageElement).textContent || ''; },
		labelIsError(): boolean { return tag.classList.contains('error'); },
		typingActive(): boolean { return tag.classList.contains('typing'); },
	};

	// Real-input mirror, gated by `engage`: it only reflects events while the agent operates
	// (browser_playwright), never the user's mouse. Capture-phase and passive so it does not
	// alter the page's behaviour.
	doc.addEventListener('pointermove', (event: any) => {
		if (!event.isTrusted || !engaged) { return; }
		place(event.clientX, event.clientY, false);
	}, { capture: true, passive: true });
	doc.addEventListener('mousedown', (event: any) => {
		if (!event.isTrusted || !engaged) { return; }
		place(event.clientX, event.clientY, true);
		void api.press();
	}, { capture: true, passive: true });

	scope[GLOBAL] = api;
}

/** Expression ready for `page.evaluate`: installs the overlay if it is not there. */
export function cursorInstallScript(): string {
	return `(${openideCursorRuntimeMain.toString()})()`;
}

/** Expression ready for `page.evaluate`: removes the overlay (before "clean" captures). */
export function cursorRemoveScript(): string {
	return `(() => { const c = globalThis['${OPENIDE_CURSOR_GLOBAL}']; if (c) { c.hide(); } else { const h = document.getElementById('${OPENIDE_CURSOR_HOST_ID}'); if (h) { h.remove(); } } })()`;
}

/** Strips the overlay host from HTML read off the page: it is our scaffolding, not content. */
export function stripCursorHost(html: string): string {
	return html.replace(new RegExp(`<div id="${OPENIDE_CURSOR_HOST_ID}"[^>]*>\\s*</div>`, 'gi'), '')
		.replace(new RegExp(`<div[^>]*id="${OPENIDE_CURSOR_HOST_ID}"[^>]*>\\s*</div>`, 'gi'), '');
}
