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
		// and would not communicate where it came from.
		'.cursor{position:absolute;top:0;left:0;width:24px;height:24px;transform:translate3d(-40px,-40px,0);opacity:0;',
		'transition:transform var(--oc-travel,420ms) cubic-bezier(.22,.61,.36,1),opacity 200ms ease-out;will-change:transform,opacity}',
		// The first appearance does not travel from the corner (that would be an invented path): it
		// enters where it is about to act. But it enters visibly, because that first step is the one the
		// usuario necesita ver.
		'.cursor.instant{transition:opacity 200ms ease-out}',
		'.cursor.visible{opacity:1}',
		'.cursor svg{display:block;width:24px;height:24px;overflow:visible}',
		'.halo{position:absolute;top:0;left:0;width:34px;height:34px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(80,160,255,.22);opacity:0;transition:opacity 160ms}',
		'.cursor.active .halo{opacity:1}',
		'.ripple{position:absolute;top:0;left:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid rgba(80,160,255,.9);opacity:0;transform:scale(.4)}',
		'.ripple.go{animation:oc-ripple 460ms ease-out forwards}',
		'@keyframes oc-ripple{0%{opacity:.95;transform:scale(.35)}100%{opacity:0;transform:scale(2.9)}}',
		'.tag{position:absolute;top:0;left:0;margin:22px 0 0 18px;padding:3px 8px;border-radius:5px;white-space:nowrap;',
		'font:12px/1.35 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
		'background:rgba(17,19,23,.92);color:#f2f3f5;box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:0;transition:opacity 160ms}',
		'.tag.show{opacity:1}',
		'.tag.error{background:rgba(150,26,32,.95)}',
		// Caret pulsing while typing: without this, typing looks like dead air.
		'.tag .caret{display:none;margin-left:1px;opacity:.9;animation:oc-blink 900ms steps(1,end) infinite}',
		'.tag.typing .caret{display:inline}',
		'@keyframes oc-blink{0%,49%{opacity:.9}50%,100%{opacity:0}}',
		// Box around the resolved element: it says WHICH element the selector matched, which is the
		// real question when a step touches something it should not have.
		'.box{position:absolute;top:0;left:0;border:2px solid rgba(80,160,255,.95);border-radius:5px;',
		'background:rgba(80,160,255,.10);opacity:0;transition:opacity 180ms,transform 180ms;pointer-events:none}',
		'.box.show{opacity:1}',
		'.box.miss{border-color:rgba(226,74,80,.95);background:rgba(226,74,80,.12)}',
		'@media (prefers-reduced-motion: reduce){.cursor{transition:none}.ripple.go{animation-duration:1ms}.tag .caret{animation:none}}',
	].join('');

	const layer = doc.createElement('div');
	layer.className = 'layer';
	const cursor = doc.createElement('div');
	cursor.className = 'cursor instant';
	// Pointer with a dark outline and light fill: legible over light and dark backgrounds alike.
	cursor.innerHTML = '<div class="halo"></div><div class="ripple"></div>'
		+ '<svg viewBox="0 0 24 24" aria-hidden="true">'
		+ '<path d="M5 2.5 L5 18.2 L9.1 14.4 L11.8 20.4 L14.7 19.1 L12 13.2 L17.6 12.9 Z" fill="#ffffff" stroke="#14171c" stroke-width="1.6" stroke-linejoin="round"/>'
		+ '</svg>';
	const tag = doc.createElement('div');
	tag.className = 'tag';
	tag.innerHTML = '<span class="tag-text"></span><span class="caret">▌</span>';
	cursor.appendChild(tag);
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
			if (text) { slot.textContent = text; tag.classList.add('show'); }
			else { tag.classList.remove('show'); tag.classList.remove('typing'); }
		},
		/** Boxes the element the selector resolved to: if the step touched the wrong thing, you see it. */
		highlight(rect: { x: number; y: number; width: number; height: number } | null, miss?: boolean): Promise<void> {
			if (!rect) { box.classList.remove('show'); return Promise.resolve(); }
			box.classList.toggle('miss', miss === true);
			box.style.transform = 'translate3d(' + (rect.x - 3) + 'px,' + (rect.y - 3) + 'px,0)';
			box.style.width = (rect.width + 6) + 'px';
			box.style.height = (rect.height + 6) + 'px';
			box.classList.add('show');
			return new Promise<void>(resolve => scope.setTimeout(resolve, 180));
		},
		clearHighlight(): void { box.classList.remove('show'); },
		/** Typing in progress: the caret pulses so typing does not look like dead air. */
		typing(on: boolean): void { tag.classList.toggle('typing', on === true); },
		/** Turns the real-input mirror on/off. Off by default: the user's mouse must not move this
		 *  pointer. browser_playwright turns it on while it operates. */
		engage(on: boolean): void { engaged = on === true; },
		/** A failed step is information too: it marks where it was attempted and why it did not work. */
		fail(message: string): Promise<void> {
			api.label(message, 'error');
			cursor.classList.add('active');
			return new Promise<void>(resolve => scope.setTimeout(() => { cursor.classList.remove('active'); resolve(); }, 200));
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
