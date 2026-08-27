/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — browser automation (main process). The agent needs a REAL webContents
 *  (the preview iframe is cross-origin: the webview can neither read its DOM nor inject
 *  overlays). Here it runs on native Electron APIs instead of CDP-over-TCP:
 *    - ventana OCULTA con offscreen rendering → capturePage confiable para screenshots;
 *    - executeJavaScript / sendInputEvent / insertText para DOM, clicks y tipeo;
 *    - evento 'console-message' para la consola (buffer circular).
 *  The picker (Pick & Polish) uses a separate VISIBLE window (OSR cannot be shown) with a
 *  overlay inyectado que resalta elementos y captura selector/HTML/estilos/screenshot.
 *  SECURITY: every navigation is validated server-side with isAllowedLocalBrowserUrl (local
 *  apps only), will-navigate is blocked outside that, and window.open is denied.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, WebFrameMain, webContents as electronWebContents } from 'electron';
import { Disposable } from '../../../base/common/lifecycle.js';
import { BrowserOpResult, IBrowserConsoleEntry, IBrowserPickResult, IOpenideBrowserAutomation, isAllowedLocalBrowserUrl, OPENIDE_PICK_STYLE_PROPS } from '../common/openideBrowserAutomation.js';

const PARTITION = 'persist:openide-automation';
const NAV_TIMEOUT_MS = 15_000;
const IDLE_DISPOSE_MS = 120_000;
const PICK_TIMEOUT_MS = 300_000;
const DOM_CAP = 50_000;
const ACTION_TIMEOUT_MS = 5_000; // auto-wait: cuánto reintentar hasta que el elemento sea accionable

function errText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Playwright-style element resolver, injected into the page. It supplies what makes Playwright
 *  robust and a bare querySelector lacks:
 *    - AUTO-WAIT: retries up to ACTION_TIMEOUT instead of failing immediately on a page that is
 *        still mounting (React/Vue take a frame to paint).
 *    - RICH SELECTORS: besides CSS, `text=Send` (by visible text) and `role=button[name=X]`
 *        (by accessible role) — Playwright's most used engines.
 *    - ACTIONABILITY: it requires the element to be connected, visible (non-empty rect, not
 *        display:none) and scrolls it to the centre before returning its click point.
 *  It is defined ONCE per document (window.__openideResolve) and the actions reuse it. */
const RESOLVER_SCRIPT = `(() => {
	if (window.__openideResolve) { return; }
	function visible(el) {
		if (!el || !el.isConnected) { return false; }
		const s = getComputedStyle(el);
		if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity || '1') === 0) { return false; }
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	}
	function byText(root, needle, exact) {
		const want = needle.trim().toLowerCase();
		const els = root.querySelectorAll('button, a, [role], input, label, span, div, li, td, th, summary, option, h1, h2, h3, h4, h5, h6, p');
		let best = null;
		for (const el of els) {
			const t = (el.innerText || el.textContent || el.value || '').trim().toLowerCase();
			if (!t) { continue; }
			const hit = exact ? t === want : t.indexOf(want) >= 0;
			if (hit && visible(el)) {
				// prefer the most specific match (fewest children with the same text)
				if (!best || el.contains(best) === false) { best = el; }
			}
		}
		return best;
	}
	function byRole(root, role, name) {
		const els = root.querySelectorAll('[role="' + role + '"], ' + (({ button: 'button', link: 'a', textbox: 'input,textarea', checkbox: 'input[type=checkbox]', heading: 'h1,h2,h3,h4,h5,h6' })[role] || '*'));
		const want = (name || '').trim().toLowerCase();
		for (const el of els) {
			if (!visible(el)) { continue; }
			if (!want) { return el; }
			const label = (el.getAttribute('aria-label') || el.innerText || el.textContent || el.value || '').trim().toLowerCase();
			if (label.indexOf(want) >= 0) { return el; }
		}
		return null;
	}
	window.__openideFind = function (selector) {
		const s = String(selector || '').trim();
		try {
			if (s.slice(0, 5) === 'text=') { return byText(document, s.slice(5).replace(/^"|"$/g, ''), false); }
			const rm = /^role=([a-z]+)(?:\\[name=["']?([^"'\\]]+)["']?\\])?$/i.exec(s);
			if (rm) { return byRole(document, rm[1].toLowerCase(), rm[2]); }
			return document.querySelector(s);
		} catch (e) { return null; }
	};
	window.__openideResolve = function (selector, needCenter) {
		const el = window.__openideFind(selector);
		if (!el) { return { state: 'missing' }; }
		if (!visible(el)) { return { state: 'hidden' }; }
		el.scrollIntoView({ block: 'center', inline: 'center' });
		const r = el.getBoundingClientRect();
		return { state: 'ok', x: r.x + r.width / 2, y: r.y + r.height / 2, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
	};
})();`;

export class OpenideBrowserAutomationMainService extends Disposable implements IOpenideBrowserAutomation {

	private window: BrowserWindow | undefined;
	private consoleBuffer: IBrowserConsoleEntry[] = [];
	private idleTimer: ReturnType<typeof setTimeout> | undefined;

	override dispose(): void {
		void this.disposeSession();
		super.dispose();
	}

	// ---- ciclo de vida de la ventana oculta ----

	private touch(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
		}
		this.idleTimer = setTimeout(() => this.disposeSession(), IDLE_DISPOSE_MS);
	}

	private ensureWindow(): BrowserWindow {
		if (this.window && !this.window.isDestroyed()) {
			this.touch();
			return this.window;
		}
		const win = new BrowserWindow({
			show: false,
			width: 1280,
			height: 800,
			webPreferences: {
				offscreen: true, // pinta a bitmap siempre → capturePage confiable estando oculta
				sandbox: true,
				partition: PARTITION,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
			},
		});
		this.hardenWebContents(win, () => this.currentExtraHosts);
		win.webContents.setFrameRate(10);
		win.webContents.on('console-message', (...args: any[]) => {
			this.pushConsole(args);
		});
		this.window = win;
		this.consoleBuffer = [];
		this.touch();
		return win;
	}

	private currentExtraHosts: string[] = [];

	/** Blocks navigation outside local URLs and any window.open (in both windows). */
	private hardenWebContents(win: BrowserWindow, extraHosts: () => string[]): void {
		win.webContents.on('will-navigate', (event, url) => {
			if (!isAllowedLocalBrowserUrl(url, extraHosts())) {
				event.preventDefault();
			}
		});
		win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	}

	private pushConsole(args: any[]): void {
		// Electron viejo: (event, level:number, message, line, source); nuevo: (event{level,message}).
		let level = 'log';
		let text = '';
		if (args.length >= 3 && (typeof args[1] === 'number' || typeof args[1] === 'string')) {
			const lv = args[1];
			level = typeof lv === 'number' ? (['debug', 'info', 'warning', 'error'][lv] ?? String(lv)) : String(lv);
			text = String(args[2] ?? '');
		} else {
			const e = args[0] ?? {};
			level = String(e.level ?? 'log');
			text = String(e.message ?? '');
		}
		this.consoleBuffer.push({ level, text: text.slice(0, 2000), at: Date.now() });
		if (this.consoleBuffer.length > 100) {
			this.consoleBuffer.shift();
		}
	}

	/** loadURL esperando el resultado real (finish | fail | timeout). */
	private loadAndWait(win: BrowserWindow, url: string): Promise<BrowserOpResult<{ url: string; title: string }>> {
		return new Promise(resolve => {
			const wc = win.webContents;
			let settled = false;
			const done = (r: BrowserOpResult<{ url: string; title: string }>) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					wc.removeListener('did-finish-load', onFinish);
					wc.removeListener('did-fail-load', onFail);
					resolve(r);
				}
			};
			const onFinish = () => done({ ok: true, url: wc.getURL(), title: wc.getTitle() });
			const onFail = (_e: unknown, code: number, desc: string, _u: string, isMainFrame: boolean) => {
				if (isMainFrame) {
					done({ ok: false, error: `No se pudo cargar (${desc || code}). ¿El server local está corriendo?` });
				}
			};
			const timer = setTimeout(() => done({ ok: false, error: `Timeout cargando ${url} (${NAV_TIMEOUT_MS / 1000}s).` }), NAV_TIMEOUT_MS);
			wc.on('did-finish-load', onFinish);
			wc.on('did-fail-load', onFail);
			wc.loadURL(url).catch(e => done({ ok: false, error: errText(e) }));
		});
	}

	// ---- API del canal ----

	async navigate(url: string, extraHosts: string[]): Promise<BrowserOpResult<{ url: string; title: string }>> {
		if (!isAllowedLocalBrowserUrl(url, extraHosts)) {
			return { ok: false, error: 'URL no permitida: la automatización es SOLO para apps locales (localhost, 127.0.0.1, *.localhost o los hosts de openide.agent.browserAllowedHosts).' };
		}
		this.currentExtraHosts = extraHosts.slice();
		const win = this.ensureWindow();
		this.consoleBuffer = [];
		return this.loadAndWait(win, url);
	}

	async screenshot(selector?: string): Promise<BrowserOpResult<{ base64: string; width: number; height: number }>> {
		const win = this.window;
		if (!win || win.isDestroyed()) {
			return { ok: false, error: 'No hay página cargada: usá browser_navigate primero.' };
		}
		this.touch();
		try {
			let rect: { x: number; y: number; width: number; height: number } | undefined;
			if (selector) {
				const r = await this.resolveElement(win, selector); // auto-wait + text=/role=
				if ('error' in r) {
					return { ok: false, error: r.error };
				}
				rect = { x: Math.max(0, Math.round(r.rect.x)), y: Math.max(0, Math.round(r.rect.y)), width: Math.max(1, Math.round(r.rect.w)), height: Math.max(1, Math.round(r.rect.h)) };
				await new Promise(res => setTimeout(res, 120)); // dejar asentar el scroll
			}
			const image = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
			const size = image.getSize();
			return { ok: true, base64: image.toJPEG(70).toString('base64'), width: size.width, height: size.height };
		} catch (e) {
			return { ok: false, error: errText(e) };
		}
	}

	async readDom(selector?: string): Promise<BrowserOpResult<{ html: string }>> {
		const win = this.window;
		if (!win || win.isDestroyed()) {
			return { ok: false, error: 'No hay página cargada: usá browser_navigate primero.' };
		}
		this.touch();
		try {
			const script = selector
				? `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.outerHTML.slice(0, ${DOM_CAP}) : ''; })()`
				: `document.documentElement.outerHTML.slice(0, ${DOM_CAP})`;
			const html = String(await win.webContents.executeJavaScript(script) ?? '');
			if (!html && selector) {
				return { ok: false, error: `No existe ningún elemento para el selector ${selector}.` };
			}
			return { ok: true, html };
		} catch (e) {
			return { ok: false, error: errText(e) };
		}
	}

	async consoleEntries(): Promise<IBrowserConsoleEntry[]> {
		this.touch();
		return this.consoleBuffer.slice(-50);
	}

	/** Resolves a selector with AUTO-WAIT (Playwright pattern): retries up to ACTION_TIMEOUT_MS
	 *  for the element to exist, be visible and end up centred. Returns its click point. */
	private async resolveElement(win: BrowserWindow, selector: string): Promise<{ x: number; y: number; rect: { x: number; y: number; w: number; h: number } } | { error: string }> {
		await win.webContents.executeJavaScript(RESOLVER_SCRIPT);
		const deadline = Date.now() + ACTION_TIMEOUT_MS;
		let last = 'missing';
		while (Date.now() < deadline) {
			const raw = await win.webContents.executeJavaScript(`JSON.stringify(window.__openideResolve(${JSON.stringify(selector)}, true))`);
			const res = JSON.parse(String(raw || '{}'));
			if (res.state === 'ok') {
				return { x: res.x, y: res.y, rect: res.rect };
			}
			last = res.state;
			await new Promise(r => setTimeout(r, 100));
		}
		const why = last === 'hidden' ? 'existe pero no está visible' : 'no apareció';
		return { error: `El elemento "${selector}" ${why} tras esperar ${ACTION_TIMEOUT_MS / 1000}s. Podés usar CSS, "text=Texto visible" o "role=button[name=Texto]".` };
	}

	async click(selector?: string, x?: number, y?: number): Promise<BrowserOpResult> {
		const win = this.window;
		if (!win || win.isDestroyed()) {
			return { ok: false, error: 'No hay página cargada: usá browser_navigate primero.' };
		}
		this.touch();
		try {
			let cx = x ?? 0;
			let cy = y ?? 0;
			if (selector) {
				const r = await this.resolveElement(win, selector);
				if ('error' in r) {
					return { ok: false, error: r.error };
				}
				cx = r.x;
				cy = r.y;
				await new Promise(res => setTimeout(res, 60)); // dejar asentar el scroll
			}
			win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 });
			await new Promise(res => setTimeout(res, 30));
			win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(cx), y: Math.round(cy), button: 'left', clickCount: 1 });
			return { ok: true };
		} catch (e) {
			return { ok: false, error: errText(e) };
		}
	}

	async typeText(selector: string, text: string): Promise<BrowserOpResult> {
		const win = this.window;
		if (!win || win.isDestroyed()) {
			return { ok: false, error: 'No hay página cargada: usá browser_navigate primero.' };
		}
		this.touch();
		try {
			const r = await this.resolveElement(win, selector);
			if ('error' in r) {
				return { ok: false, error: r.error };
			}
			// click to focus the field (more reliable than .focus() on custom inputs) and type
			win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
			win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
			await new Promise(res => setTimeout(res, 40));
			await win.webContents.insertText(String(text ?? ''));
			return { ok: true };
		} catch (e) {
			return { ok: false, error: errText(e) };
		}
	}

	async evaluate(expression: string): Promise<BrowserOpResult<{ value: string }>> {
		const win = this.window;
		if (!win || win.isDestroyed()) {
			return { ok: false, error: 'No hay página cargada: usá browser_navigate primero.' };
		}
		this.touch();
		try {
			const script = `(async () => { try { const __v = await (${expression}\n); const __s = JSON.stringify(__v); return __s === undefined ? String(__v) : __s; } catch (e) { return 'Error: ' + (e && e.message || String(e)); } })()`;
			const value = String(await win.webContents.executeJavaScript(script) ?? 'undefined');
			return { ok: true, value: value.slice(0, 20_000) };
		} catch (e) {
			return { ok: false, error: errText(e) };
		}
	}

	async setStyle(selector: string, cssText: string): Promise<BrowserOpResult<{ count: number }>> {
		const win = this.window;
		if (!win || win.isDestroyed()) {
			return { ok: false, error: 'No hay página cargada: usá browser_navigate primero.' };
		}
		this.touch();
		try {
			const count = Number(await win.webContents.executeJavaScript(
				`(() => { const els = document.querySelectorAll(${JSON.stringify(selector)}); els.forEach(el => { el.style.cssText += ';' + ${JSON.stringify(cssText)}; }); return els.length; })()`) || 0);
			return count > 0 ? { ok: true, count } : { ok: false, error: `No existe ningún elemento para el selector ${selector}.` };
		} catch (e) {
			return { ok: false, error: errText(e) };
		}
	}

	// ---- Pick & Polish: visible window + selection overlay ----

	async pick(url: string, extraHosts: string[]): Promise<BrowserOpResult<{ result: IBrowserPickResult }> | { ok: false; cancelled: true }> {
		if (!isAllowedLocalBrowserUrl(url, extraHosts)) {
			return { ok: false, error: 'URL no permitida: el picker es SOLO para apps locales.' };
		}
		const win = new BrowserWindow({
			show: true,
			width: 1100,
			height: 800,
			title: 'OpenIDE — Elegí un elemento (Esc cancela)',
			webPreferences: {
				sandbox: true,
				partition: PARTITION,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		this.hardenWebContents(win, () => extraHosts);
		try {
			const loaded = await this.loadAndWait(win, url);
			if (!loaded.ok) {
				win.destroy();
				return loaded;
			}
			await win.webContents.executeJavaScript(PICK_OVERLAY_SCRIPT);
			const started = Date.now();
			while (Date.now() - started < PICK_TIMEOUT_MS) {
				if (win.isDestroyed()) {
					return { ok: false, cancelled: true };
				}
				const state = String(await win.webContents.executeJavaScript('window.__openidePickState || \'\'').catch(() => ''));
				if (state === 'cancelled') {
					win.destroy();
					return { ok: false, cancelled: true };
				}
				if (state) {
					const picked = JSON.parse(state);
					const rect = {
						x: Math.max(0, Math.round(picked.rect.x)),
						y: Math.max(0, Math.round(picked.rect.y)),
						width: Math.max(1, Math.round(picked.rect.w)),
						height: Math.max(1, Math.round(picked.rect.h)),
					};
					const image = await win.webContents.capturePage(rect);
					const result: IBrowserPickResult = {
						selector: String(picked.selector ?? ''),
						html: String(picked.html ?? ''),
						styles: String(picked.styles ?? ''),
						rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
						pageUrl: win.webContents.getURL(),
						screenshotBase64: image.toJPEG(80).toString('base64'),
					};
					win.destroy();
					return { ok: true, result };
				}
				await new Promise(res => setTimeout(res, 250));
			}
			win.destroy();
			return { ok: false, error: 'Pick expirado (5 min sin selección).' };
		} catch (e) {
			// window closed by the user mid-polling → a normal cancellation
			const closedByUser = win.isDestroyed();
			if (!closedByUser) {
				win.destroy();
			}
			return closedByUser ? { ok: false, cancelled: true } : { ok: false, error: errText(e) };
		}
	}

	async disposeSession(): Promise<void> {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = undefined;
		}
		if (this.window && !this.window.isDestroyed()) {
			this.window.destroy();
		}
		this.window = undefined;
		this.consoleBuffer = [];
	}

	// ---- IN-PAGE pick: overlay injected into the IDE preview's iframe ----
	// The localhost iframe is cross-origin FOR THE WEBVIEW, but from the main process
	// webFrameMain.executeJavaScript reaches any subframe → the picker runs INSIDE
	// the native preview (without opening another window). No element screenshot: the rect
	// is relative to the iframe viewport and the absolute offset is not computable cross-origin.

	private findLocalFrame(targetOrigin: string): WebFrameMain | undefined {
		for (const wc of electronWebContents.getAllWebContents()) {
			const main = wc.mainFrame;
			if (!main) {
				continue;
			}
			for (const frame of main.framesInSubtree) {
				try {
					if (frame.url && new URL(frame.url).origin === targetOrigin) {
						return frame;
					}
				} catch { /* frame sin URL válida */ }
			}
		}
		return undefined;
	}

	async pickInPage(url: string, extraHosts: string[], waitFrameMs: number): Promise<BrowserOpResult<{ result: IBrowserPickResult }> | { ok: false; cancelled: true } | { ok: false; noFrame: true }> {
		if (!isAllowedLocalBrowserUrl(url, extraHosts)) {
			return { ok: false, error: 'URL no permitida: el picker es SOLO para apps locales.' };
		}
		let origin: string;
		try {
			origin = new URL(url).origin;
		} catch {
			return { ok: false, error: 'URL inválida.' };
		}
		// wait for the preview iframe to exist (it may be in the middle of opening)
		const findDeadline = Date.now() + Math.max(0, waitFrameMs);
		let frame = this.findLocalFrame(origin);
		while (!frame && Date.now() < findDeadline) {
			await new Promise(res => setTimeout(res, 300));
			frame = this.findLocalFrame(origin);
		}
		if (!frame) {
			return { ok: false, noFrame: true };
		}
		try {
			await frame.executeJavaScript(PICK_OVERLAY_SCRIPT);
			const started = Date.now();
			while (Date.now() - started < PICK_TIMEOUT_MS) {
				let state = '';
				try {
					state = String(await frame.executeJavaScript('window.__openidePickState || \'\'') ?? '');
				} catch {
					// the iframe navigated / the preview closed → cancellation
					return { ok: false, cancelled: true };
				}
				if (state === 'cancelled') {
					return { ok: false, cancelled: true };
				}
				if (state) {
					const picked = JSON.parse(state);
					await frame.executeJavaScript('window.__openidePickState = \'\'').catch(() => { /* best effort */ });
					const result: IBrowserPickResult = {
						selector: String(picked.selector ?? ''),
						html: String(picked.html ?? ''),
						styles: String(picked.styles ?? ''),
						rect: {
							x: Math.max(0, Math.round(picked.rect?.x ?? 0)),
							y: Math.max(0, Math.round(picked.rect?.y ?? 0)),
							w: Math.max(1, Math.round(picked.rect?.w ?? 1)),
							h: Math.max(1, Math.round(picked.rect?.h ?? 1)),
						},
						pageUrl: frame.url,
					};
					return { ok: true, result };
				}
				await new Promise(res => setTimeout(res, 250));
			}
			await frame.executeJavaScript('window.__openidePickCleanup && window.__openidePickCleanup()').catch(() => { /* best effort */ });
			return { ok: false, error: 'Pick expirado (5 min sin selección).' };
		} catch (e) {
			return { ok: false, error: errText(e) };
		}
	}
}

/** Overlay injected into the picker window: highlights on hover, a click captures
 *  selector/HTML/styles/rect into window.__openidePickState (main polls it), Esc cancels.
 *  The overlay is removed BEFORE setting the state so the screenshot comes out clean. */
const PICK_OVERLAY_SCRIPT = `(() => {
	if (window.__openidePickInstalled) { return; }
	window.__openidePickInstalled = true;
	window.__openidePickState = '';
	const Z = 2147483646;
	const box = document.createElement('div');
	box.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #4a9eff;background:rgba(74,158,255,0.10);z-index:' + Z + ';display:none;box-sizing:border-box;';
	const tag = document.createElement('div');
	tag.style.cssText = 'position:fixed;pointer-events:none;background:#4a9eff;color:#fff;font:12px system-ui,sans-serif;padding:2px 6px;border-radius:2px;z-index:' + (Z + 1) + ';display:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
	const banner = document.createElement('div');
	banner.textContent = 'Elegí un elemento para mandar al chat — Esc cancela';
	banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1c1c1c;color:#eee;border:1px solid #444;font:13px system-ui,sans-serif;padding:6px 14px;border-radius:4px;z-index:' + (Z + 1) + ';box-shadow:0 2px 10px rgba(0,0,0,.4);';
	document.documentElement.appendChild(box);
	document.documentElement.appendChild(tag);
	document.documentElement.appendChild(banner);
	function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'); }
	function pathOf(el) {
		if (el.id) { return '#' + cssEscape(el.id); }
		const parts = [];
		let cur = el;
		let depth = 0;
		while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 5) {
			let part = cur.tagName.toLowerCase();
			const cls = Array.from(cur.classList).slice(0, 2).map(cssEscape);
			if (cls.length) { part += '.' + cls.join('.'); }
			const parent = cur.parentElement;
			if (parent) {
				const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
				if (same.length > 1) { part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')'; }
			}
			parts.unshift(part);
			if (cur.id) { parts[0] = '#' + cssEscape(cur.id); break; }
			cur = parent;
			depth++;
		}
		return parts.join(' > ');
	}
	const STYLE_PROPS = ${JSON.stringify(OPENIDE_PICK_STYLE_PROPS)};
	function stylesOf(el) {
		const cs = getComputedStyle(el);
		return STYLE_PROPS.map(p => p + ': ' + cs.getPropertyValue(p) + ';').join('\\n');
	}
	function targetAt(ev) {
		const el = document.elementFromPoint(ev.clientX, ev.clientY);
		return (el === box || el === tag || el === banner) ? null : el;
	}
	function onMove(ev) {
		const el = targetAt(ev);
		if (!el) { box.style.display = 'none'; tag.style.display = 'none'; return; }
		const r = el.getBoundingClientRect();
		box.style.display = 'block';
		box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
		box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
		tag.style.display = 'block';
		tag.textContent = pathOf(el);
		tag.style.left = Math.max(4, r.left) + 'px';
		tag.style.top = Math.max(4, r.top - 22) + 'px';
	}
	function cleanup() {
		document.removeEventListener('mousemove', onMove, true);
		document.removeEventListener('click', onClick, true);
		document.removeEventListener('keydown', onKey, true);
		box.remove(); tag.remove(); banner.remove();
		// in the in-page pick (the preview iframe) the page is STILL alive: leave everything
		// ready for a next pick (in the separate window this dies with the window).
		window.__openidePickInstalled = false;
		window.__openidePickCleanup = undefined;
	}
	window.__openidePickCleanup = cleanup;
	function onClick(ev) {
		const el = targetAt(ev);
		if (!el) { return; }
		ev.preventDefault();
		ev.stopPropagation();
		const r = el.getBoundingClientRect();
		const payload = JSON.stringify({
			selector: pathOf(el),
			html: el.outerHTML.slice(0, 4000),
			styles: stylesOf(el),
			rect: { x: r.x, y: r.y, w: r.width, h: r.height },
		});
		cleanup();
		requestAnimationFrame(() => requestAnimationFrame(() => { window.__openidePickState = payload; }));
	}
	function onKey(ev) {
		if (ev.key === 'Escape') {
			ev.preventDefault();
			cleanup();
			window.__openidePickState = 'cancelled';
		}
	}
	document.addEventListener('mousemove', onMove, true);
	document.addEventListener('click', onClick, true);
	document.addEventListener('keydown', onKey, true);
})();`;
