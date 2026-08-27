/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the agent's browser_* tools over the same native BrowserView the user sees.
 *  Playwright connects over CDP to the integrated WebContentsView; it creates neither a Chromium
 *  instance nor a parallel automation page. The legacy channel is kept only for Pick & Polish.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64 } from '../../../../base/common/buffer.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IPlaywrightService, IInvokeFunctionResult } from '../../../../platform/browserView/common/playwrightService.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IOpenideBrowserAutomation, OPENIDE_BROWSER_AUTOMATION_CHANNEL } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { normalizeLocalUrl } from '../common/openideLocalUrl.js';
import { cursorInstallScript, OPENIDE_CURSOR_GLOBAL, stripCursorHost } from '../common/openideBrowserCursor.js';
import { IAgentTool, IAgentToolContext, OpenideToolRegistry } from './openideTools.js';

/** Prefix of the image marker in tool results (interpreted by the run loop). */
export const SCREENSHOT_MARKER = '[[openide-screenshot:';

export function screenshotMarker(mimeType: string, base64: string, note: string): string {
	return `${SCREENSHOT_MARKER}${mimeType};base64,${base64}]]\n${note}`;
}

export function parseScreenshotMarker(out: string): { mimeType: string; data: string; note: string } | undefined {
	if (!out.startsWith(SCREENSHOT_MARKER)) {
		return undefined;
	}
	const end = out.indexOf(']]');
	const head = out.slice(SCREENSHOT_MARKER.length, end);
	const sep = head.indexOf(';base64,');
	if (end < 0 || sep < 0) {
		return undefined;
	}
	return {
		mimeType: head.slice(0, sep),
		data: head.slice(sep + ';base64,'.length),
		note: out.slice(end + 2).trim() || 'Screenshot capturado.',
	};
}

/**
 * Body of the function deriving a HUMAN label from the resolved element (Button/Link/Field +
 * accessible name), for the cursor tooltip instead of the raw CSS selector. It is interpolated
 * into `page.evaluate`/`locator.evaluate` where `el` is the element. Returns '' with no name.
 *
 * It lives as a separate string to avoid duplicating it between browser_click (selector and
 * coordinates) and to allow reuse; the `\\s` becomes `\s` in the regex running in the page.
 */
const FRIENDLY_LABEL_BODY = `if (!el) { return ''; }
const tag = (el.tagName || '').toLowerCase();
const type = (el.getAttribute('type') || '').toLowerCase();
const role = el.getAttribute('role');
const aria = el.getAttribute('aria-label');
const title = el.getAttribute('title');
const alt = el.getAttribute('alt');
const placeholder = el.getAttribute('placeholder');
const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
const isButton = tag === 'button' || type === 'button' || type === 'submit' || type === 'reset' || type === 'image' || role === 'button';
// For an <input type=submit value="Send"> the label lives in value, not in text: we only
// consider it for buttons, so a text input does not show its content as if it were a label.
const valueAttr = isButton ? (el.getAttribute('value') || '') : '';
const name = (aria || title || alt || placeholder || valueAttr || text || '').slice(0, 32);
if (isButton) { return name ? 'Bot\\u00f3n ' + name : 'Bot\\u00f3n'; }
if (tag === 'a' || role === 'link') { return name ? 'Enlace ' + name : 'Enlace'; }
if (tag === 'input' || tag === 'textarea' || role === 'textbox') { return name ? 'Campo ' + name : 'Campo'; }
if (tag === 'select') { return name ? 'Lista ' + name : 'Lista'; }
if (tag === 'img') { return alt || name || 'Imagen'; }
return name;`;

export class OpenideBrowserAutomation {

	private readonly client: IOpenideBrowserAutomation;
	private readonly playwrightSessionId = 'openide-native-browser';

	constructor(
		mainProcessService: IMainProcessService,
		private readonly configurationService: IConfigurationService,
		private readonly browserViewService: IBrowserViewWorkbenchService,
		private readonly playwrightService: IPlaywrightService,
	) {
		this.client = ProxyChannel.toService<IOpenideBrowserAutomation>(mainProcessService.getChannel(OPENIDE_BROWSER_AUTOMATION_CHANNEL));
	}

	/** Channel used only by the Pick & Polish visual selector. */
	get automation(): IOpenideBrowserAutomation {
		return this.client;
	}

	extraHosts(): string[] {
		const raw = this.configurationService.getValue<string[]>('openide.agent.browserAllowedHosts');
		return Array.isArray(raw) ? raw.map(String) : [];
	}

	private enabled(): boolean {
		return this.configurationService.getValue('openide.agent.browserTools.enabled') !== false;
	}

	private actionTimeoutMs(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.actionTimeoutMs'));
		return Number.isFinite(value) && value > 0 ? value : 5000;
	}

	private navigationTimeoutMs(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.navigationTimeoutMs'));
		return Number.isFinite(value) && value > 0 ? value : 10000;
	}

	private maxDomReadChars(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.maxDomReadChars'));
		return Number.isFinite(value) && value > 0 ? value : 50000;
	}

	/** Visible agent cursor. It can be turned off: in a headless run it adds nothing and
	 *  introduces the glide before every action. */
	private cursorEnabled(): boolean {
		return this.configurationService.getValue('openide.agent.browserTools.showCursor') !== false;
	}

	/** Overlay install script, or '' when it is off — the tools pass it as an arg and the empty
	 *  string is the "do not show it" signal on the page side. */
	private cursorScript(): string {
		return this.cursorEnabled() ? cursorInstallScript() : '';
	}

	private keystrokeDelayMs(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.keystrokeDelayMs'));
		return Number.isFinite(value) && value >= 0 ? value : 28;
	}

	/** Cap on text typed key by key. Longer than this and the animation time stops being
	 *  information and becomes waiting. */
	private maxKeystrokes(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.maxKeystrokes'));
		return Number.isFinite(value) && value >= 0 ? value : 80;
	}

	/** Pause after clicking/typing so the page's animations finish before moving on to the next
	 *  step. 0 = no pause. */
	private settleMs(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.settleMs'));
		return Number.isFinite(value) && value >= 0 ? value : 140;
	}

	private screenshotQuality(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.screenshotQuality'));
		return Number.isFinite(value) && value > 0 && value <= 100 ? value : 80;
	}

	registerTools(registry: OpenideToolRegistry): void {
		for (const tool of this.buildTools()) {
			const invoke = tool.invoke;
			tool.invoke = async (args: any, token, context?: IAgentToolContext) => {
				if (!this.enabled()) {
					return 'Error: las tools de navegador del agente están deshabilitadas (openide.agent.browserTools.enabled).';
				}
				return invoke(args, token, context);
			};
			registry.registerTool(tool);
		}
	}

	private async getPage(): Promise<{ pageId: string; model: IBrowserViewModel }> {
		const input = this.browserViewService.getPreview();
		if (!input) {
			throw new Error('No hay una vista previa conectada. Usá browser_navigate o browser_open primero.');
		}
		const model = await input.resolve();
		await this.playwrightService.startTrackingPage(input.id);
		return { pageId: input.id, model };
	}

	private async invokeRaw<T>(fn: string, ...args: unknown[]): Promise<T> {
		const { pageId } = await this.getPage();
		return this.playwrightService.invokeFunctionRaw<T>(this.playwrightSessionId, pageId, fn, ...args);
	}

	private formatPlaywrightResult(result: IInvokeFunctionResult): string {
		const parts: string[] = [];
		if (result.result !== undefined) {
			parts.push(`Resultado: ${JSON.stringify(result.result, undefined, 2)}`);
		}
		if (result.error) {
			parts.push(`Error: ${result.error}`);
		}
		if (result.deferredResultId) {
			parts.push(`Ejecución pendiente: ${result.deferredResultId}. Volvé a llamar browser_playwright con deferredResultId.`);
		}
		if (result.summary) {
			parts.push(result.summary);
		}
		return parts.join('\n\n') || 'OK';
	}

	private buildTools(): IAgentTool[] {
		return [
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_navigate',
					description: 'Abre o navega la única vista previa nativa de OpenIDE a una URL LOCAL y espera su carga. Es el mismo browser visible que usa browser_screenshot, browser_snapshot y browser_playwright; no crea otra instancia.',
					parameters: {
						type: 'object',
						properties: { url: { type: 'string', description: 'URL local (ej: http://localhost:5173) o sólo el puerto (ej: 5173)' } },
						required: ['url'],
					},
				},
				approvalInfo: (args: any) => ({ title: 'Navegar la vista previa', detail: String(args?.url ?? '') }),
				invoke: async (args: any) => {
					const url = normalizeLocalUrl(String(args.url ?? ''), this.extraHosts());
					if (!url) {
						return 'Error: URL no permitida — el browser integrado es sólo para apps locales.';
					}
					const input = await this.browserViewService.openPreview(url);
					const model = await input.resolve();
					await this.playwrightService.startTrackingPage(input.id);
					const result = await this.playwrightService.invokeFunctionRaw<{ url: string; title: string }>(this.playwrightSessionId, input.id, `async (page, timeoutMs, cursorScript) => {
						await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
						// Navigation takes the overlay away: reinstalling it here leaves the event mirror
						// active from the first step, without waiting for a click.
						if (cursorScript) { await page.evaluate(cursorScript).catch(() => {}); }
						return { url: page.url(), title: await page.title() };
					}`, this.navigationTimeoutMs(), this.cursorScript());
					return model.error ? `Error: ${model.error.errorDescription}` : `OK: cargada ${result.url} (título: ${result.title || 'sin título'}).`;
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_snapshot',
					description: 'Obtiene el snapshot accesible Playwright de la vista previa nativa: estructura, roles, nombres y referencias estables para interactuar.',
					parameters: { type: 'object', properties: {} },
				},
				invoke: async () => {
					try {
						const { pageId } = await this.getPage();
						return await this.playwrightService.getSummary(this.playwrightSessionId, pageId);
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_screenshot',
					description: 'Captura la vista previa nativa visible completa o un elemento. La imagen llega como el mensaje siguiente.',
					parameters: {
						type: 'object',
						properties: { selector: { type: 'string', description: 'Selector Playwright/CSS opcional' } },
					},
				},
				invoke: async (args: any) => {
					try {
						const { model } = await this.getPage();
						const selector = args?.selector ? String(args.selector) : undefined;
						const bounds = selector ? await this.invokeRaw<{ x: number; y: number; width: number; height: number }>(`async (page, selector, timeoutMs) => {
							const locator = page.locator(selector).first();
							await locator.waitFor({ state: 'visible', timeout: timeoutMs });
							await locator.scrollIntoViewIfNeeded();
							const bounds = await locator.boundingBox();
							if (!bounds) throw new Error('El elemento no tiene bounds visibles');
							return bounds;
						}`, selector, this.actionTimeoutMs()) : undefined;
						const screenshot = await model.captureScreenshot({ pageRect: bounds, quality: this.screenshotQuality() });
						return screenshotMarker('image/jpeg', encodeBase64(screenshot), `Screenshot capturado${selector ? ` de ${selector}` : ' de la vista previa nativa'}.`);
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_read_dom',
					description: 'Lee el HTML renderizado de la vista previa nativa o de un elemento. Longitud máxima configurable (openide.agent.browserTools.maxDomReadChars).',
					parameters: { type: 'object', properties: { selector: { type: 'string', description: 'Selector Playwright/CSS opcional' } } },
				},
				invoke: async (args: any) => {
					try {
						// The overlay host is trimmed BEFORE the slice: otherwise it would take part of the
						// character budget with our own scaffolding instead of content.
						const html = await this.invokeRaw<string>(`async (page, selector, timeoutMs) => {
							const locator = selector ? page.locator(selector).first() : page.locator('html');
							await locator.waitFor({ state: 'attached', timeout: timeoutMs });
							return await locator.evaluate(element => element.outerHTML);
						}`, args?.selector ? String(args.selector) : '', this.actionTimeoutMs());
						return stripCursorHost(html).slice(0, this.maxDomReadChars());
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_console',
					description: 'Devuelve la consola de la misma vista previa nativa (errores, warnings y logs).',
					parameters: { type: 'object', properties: {} },
				},
				invoke: async () => {
					try {
						const { model } = await this.getPage();
						return (await model.getConsoleLogs()) || '(consola vacía)';
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_click',
					description: 'Hace click con Playwright en la vista previa nativa usando selector, texto, rol o coordenadas.',
					parameters: {
						type: 'object',
						properties: { selector: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
					},
				},
				approvalInfo: (args: any) => ({ title: 'Click en la vista previa', detail: String(args?.selector ?? `${args?.x},${args?.y}`) }),
				invoke: async (args: any) => {
					try {
						// The pointer glides BEFORE the click: that way you see where it came from and the
						// next screenshot shows it over the element, not halfway there.
						await this.invokeRaw(`async (page, selector, x, y, timeoutMs, cursorScript, cursorGlobal, settleMs) => {
							let point = null;
							let rect = null;
							let label = '';
							if (selector) {
								const locator = page.locator(selector).first();
								await locator.waitFor({ state: 'visible', timeout: timeoutMs });
								await locator.scrollIntoViewIfNeeded();
								const box = await locator.boundingBox();
								if (box) {
									point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
									rect = box;
									label = await locator.evaluate(el => { ${FRIENDLY_LABEL_BODY} }).catch(() => '');
								}
							} else if (typeof x === 'number' && typeof y === 'number') {
								point = { x: x, y: y };
								label = await page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); ${FRIENDLY_LABEL_BODY} }, [x, y]).catch(() => '');
							} else {
								throw new Error('Falta selector o coordenadas x/y');
							}
							if (cursorScript && point) {
								try {
									await page.evaluate(cursorScript);
									await page.evaluate(([g, px, py, l]) => globalThis[g].moveTo(px, py, l), [cursorGlobal, point.x, point.y, label]);
									// The box answers the question a blind click leaves
									// open: WHICH element this selector resolved to.
									if (rect) await page.evaluate(([g, r]) => globalThis[g].highlight(r), [cursorGlobal, rect]);
									await page.evaluate(g => globalThis[g].press(), cursorGlobal);
								} catch (e) { /* el cursor es decorativo: nunca puede hacer fallar el paso */ }
							}
							try {
								if (selector) await page.locator(selector).first().click({ timeout: timeoutMs });
								else await page.mouse.click(point.x, point.y);
							} catch (error) {
								if (cursorScript) {
									const detail = String((error && error.message) || error).split('\\n')[0].slice(0, 70);
									await page.evaluate(([g, m]) => globalThis[g].fail(m), [cursorGlobal, 'no se pudo clickear: ' + detail]).catch(() => {});
									await page.evaluate(([g, r]) => globalThis[g].highlight(r, true), [cursorGlobal, rect]).catch(() => {});
								}
								throw error;
							}
							if (cursorScript) await page.evaluate(g => globalThis[g].clearHighlight(), cursorGlobal).catch(() => {});
							if (settleMs > 0) await page.waitForTimeout(settleMs);
						}`, args?.selector ? String(args.selector) : '', args?.x, args?.y, this.actionTimeoutMs(), this.cursorScript(), OPENIDE_CURSOR_GLOBAL, this.settleMs());
						return 'OK: click enviado en la vista previa nativa.';
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_type',
					description: 'Completa un input, textarea o contenteditable con Playwright en la vista previa nativa.',
					parameters: {
						type: 'object',
						properties: { selector: { type: 'string' }, text: { type: 'string' } },
						required: ['selector', 'text'],
					},
				},
				approvalInfo: (args: any) => ({ title: 'Escribir en la vista previa', detail: String(args?.selector ?? '') }),
				invoke: async (args: any) => {
					try {
						// fill() does not move the mouse, so without this, typing was the most invisible
						// step of all: the text appeared with nothing indicating where.
						const typed = await this.invokeRaw<{ mode: string; value: string | null }>(`async (page, selector, text, timeoutMs, cursorScript, cursorGlobal, keyDelayMs, maxKeystrokes, settleMs) => {
							const locator = page.locator(selector).first();
							await locator.waitFor({ state: 'visible', timeout: timeoutMs });
							let rect = null;
							if (cursorScript) {
								try {
									await locator.scrollIntoViewIfNeeded();
									const box = await locator.boundingBox();
									if (box) {
										rect = box;
										await page.evaluate(cursorScript);
										const label = text.length > 28 ? text.slice(0, 28) + '…' : text;
										await page.evaluate(([g, px, py, l]) => globalThis[g].moveTo(px, py, l), [cursorGlobal, box.x + box.width / 2, box.y + box.height / 2, label]);
										await page.evaluate(([g, r]) => globalThis[g].highlight(r), [cursorGlobal, box]);
										await page.evaluate(g => globalThis[g].press(), cursorGlobal);
									}
								} catch (e) { /* decorativo: nunca puede hacer fallar el paso */ }
							}
							// Key by key is NOT merely cosmetic: it fires real keydown/keyup, so it
							// exercises autocompletes, masks and type-time validation that a
							// single fill() never touches. But an input that reformats can
							// end up with a different value: hence it is verified and falls back to fill().
							const perKey = !!cursorScript && text.length > 0 && text.length <= maxKeystrokes;
							let mode = 'fill';
							if (perKey) {
								try {
									await page.evaluate(g => globalThis[g].typing(true), cursorGlobal).catch(() => {});
									await locator.fill('');
									await locator.pressSequentially(text, { timeout: timeoutMs + text.length * keyDelayMs, delay: keyDelayMs });
									mode = (await locator.inputValue().catch(() => text)) === text ? 'keys' : 'fallback';
								} catch (e) {
									mode = 'fallback';
								} finally {
									await page.evaluate(g => globalThis[g].typing(false), cursorGlobal).catch(() => {});
								}
							}
							if (mode !== 'keys') { await locator.fill(text); }
							if (cursorScript) { await page.evaluate(g => globalThis[g].clearHighlight(), cursorGlobal).catch(() => {}); }
							// A masked field reformats what was typed: no method can avoid that,
							// but returning a bare "OK" would leave the model believing the value is the
							// one it asked for. It is re-read and the difference reported. The preceding pause lets
							// the field's formatting/animations finish before re-reading it.
							if (settleMs > 0) { await page.waitForTimeout(settleMs); }
							const value = await locator.inputValue().catch(() => null);
							return { mode: mode, value: value };
						}`, String(args.selector ?? ''), String(args.text ?? ''), this.actionTimeoutMs(), this.cursorScript(), OPENIDE_CURSOR_GLOBAL, this.keystrokeDelayMs(), this.maxKeystrokes(), this.settleMs());
						const wanted = String(args.text ?? '');
						const how = typed.mode === 'keys' ? ' tecla por tecla' : '';
						if (typed.value !== null && typed.value !== wanted) {
							return `OK: texto ingresado${how}, pero el campo lo normalizó: quedó ${JSON.stringify(typed.value)} en vez de ${JSON.stringify(wanted)} (máscara o formateo del propio campo).`;
						}
						return typed.mode === 'fallback'
							? 'OK: texto ingresado. El campo no aceptó la escritura tecla por tecla (¿máscara o autocompletado?) y se completó de una vez.'
							: `OK: texto ingresado${how} en la vista previa nativa.`;
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_evaluate',
					description: 'Evalúa una expresión JavaScript mediante Playwright en la vista previa nativa.',
					parameters: {
						type: 'object',
						properties: { expression: { type: 'string' } },
						required: ['expression'],
					},
				},
				approvalInfo: (args: any) => ({ title: 'Evaluar JavaScript en la vista previa', detail: String(args?.expression ?? '').slice(0, 120) }),
				invoke: async (args: any) => {
					try {
						const value = await this.invokeRaw<unknown>(`async (page, expression) => page.evaluate(expression => (0, eval)(expression), expression)`, String(args.expression ?? ''));
						return JSON.stringify(value, undefined, 2) ?? 'undefined';
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_set_style',
					description: 'Aplica CSS inline en vivo mediante Playwright a la vista previa nativa. No persiste en el código.',
					parameters: {
						type: 'object',
						properties: { selector: { type: 'string' }, css: { type: 'string' } },
						required: ['selector', 'css'],
					},
				},
				approvalInfo: (args: any) => ({ title: 'Aplicar estilos en vivo', detail: `${args?.selector ?? ''} → ${String(args?.css ?? '').slice(0, 80)}` }),
				invoke: async (args: any) => {
					try {
						const count = await this.invokeRaw<number>(`async (page, selector, css) => page.locator(selector).evaluateAll((elements, css) => {
							for (const element of elements) element.style.cssText += ';' + css;
							return elements.length;
						}, css)`, String(args.selector ?? ''), String(args.css ?? ''));
						return `OK: estilos aplicados a ${count} elemento(s) en la vista previa nativa.`;
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_playwright',
					description: 'Ejecuta un bloque Playwright autocontenido contra la vista previa nativa actual. La variable page ya existe. No abras ni cierres páginas: operá siempre sobre esa page. Usalo para flujos que las tools específicas no cubren.',
					parameters: {
						type: 'object',
						properties: {
							code: { type: 'string', description: 'Cuerpo async Playwright, por ejemplo: await page.getByRole("button", { name: "Guardar" }).click(); return await page.title();' },
							deferredResultId: { type: 'string', description: 'ID de una ejecución anterior todavía pendiente' },
							timeoutMs: { type: 'number', description: 'Espera máxima antes de devolver un deferredResultId; default openide.agent.browserTools.actionTimeoutMs' },
						},
					},
				},
				approvalInfo: (args: any) => ({ title: 'Ejecutar Playwright en la vista previa', detail: String(args?.code ?? args?.deferredResultId ?? '').slice(0, 160) }),
				invoke: async (args: any) => {
					try {
						if (args?.deferredResultId) {
							return this.formatPlaywrightResult(await this.playwrightService.waitForDeferredResult(this.playwrightSessionId, String(args.deferredResultId), Number(args.timeoutMs) || this.actionTimeoutMs()));
						}
						const code = String(args?.code ?? '').trim();
						if (!code) {
							return 'Error: falta code o deferredResultId.';
						}
						if (/\b(?:newPage|chromium|firefox|webkit|browser\.close|page\.close)\b/.test(code)) {
							return 'Error: browser_playwright opera exclusivamente sobre la page nativa existente; no puede crear ni cerrar browsers o páginas.';
						}
						const { pageId } = await this.getPage();
						// Here the code is arbitrary and cannot be instrumented step by step; the
						// overlay covers it anyway by mirroring the real events Playwright generates.
						const cursorScript = this.cursorScript();
						if (cursorScript) {
							await this.playwrightService.invokeFunctionRaw(this.playwrightSessionId, pageId, `async (page, cursorScript) => { await page.evaluate(cursorScript).catch(() => {}); }`, cursorScript).catch(() => { /* decorativo */ });
						}
						// engage turns the cursor mirror on only for this execution: that way the
						// pointer reflects what the model's code does, but the user's mouse does
						// not move it. The try/finally guarantees release even on return or failure.
						const engageOn = cursorScript ? `try { await page.evaluate(g => { const c = globalThis[g]; if (c) { c.engage(true); } }, ${JSON.stringify(OPENIDE_CURSOR_GLOBAL)}); } catch (e) {}` : '';
						const engageOff = cursorScript ? `try { await page.evaluate(g => { const c = globalThis[g]; if (c) { c.engage(false); } }, ${JSON.stringify(OPENIDE_CURSOR_GLOBAL)}); } catch (e) {}` : '';
						const result = await this.playwrightService.invokeFunction(this.playwrightSessionId, pageId, `async (page) => { ${engageOn} try { ${code} } finally { ${engageOff} } }`, [], Number(args.timeoutMs) || this.actionTimeoutMs());
						return this.formatPlaywrightResult(result);
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_dialog',
					description: 'Responde el diálogo, prompt o selector de archivos que interrumpió el último paso Playwright en la vista previa nativa.',
					parameters: {
						type: 'object',
						properties: {
							accept: { type: 'boolean' },
							promptText: { type: 'string' },
							files: { type: 'array', items: { type: 'string' }, description: 'Paths para un file chooser; array vacío lo cancela' },
						},
					},
				},
				approvalInfo: () => ({ title: 'Responder diálogo del browser', detail: 'Vista previa nativa' }),
				invoke: async (args: any) => {
					try {
						const { pageId } = await this.getPage();
						const result = Array.isArray(args?.files)
							? await this.playwrightService.replyToFileChooser(this.playwrightSessionId, pageId, args.files.map(String))
							: await this.playwrightService.replyToDialog(this.playwrightSessionId, pageId, args?.accept !== false, args?.promptText === undefined ? undefined : String(args.promptText));
						return result.summary;
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
		];
	}
}
