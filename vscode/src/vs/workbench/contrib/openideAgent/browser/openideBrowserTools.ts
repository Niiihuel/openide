/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the agent's browser_* tools over the same native BrowserView the user sees.
 *  Playwright connects over CDP to the integrated WebContentsView; it creates neither a Chromium
 *  instance nor a parallel automation page. The legacy channel is kept only for Pick & Polish.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPlaywrightService, IInvokeFunctionResult } from '../../../../platform/browserView/common/playwrightService.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IOpenideBrowserAutomation, OPENIDE_BROWSER_AUTOMATION_CHANNEL } from '../../../../platform/openideBrowser/common/openideBrowserAutomation.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { normalizeLocalUrl } from '../common/openideLocalUrl.js';
import { cursorInstallScript, OPENIDE_CURSOR_GLOBAL, stripCursorHost } from '../common/openideBrowserCursor.js';
import { flowSlug, formatFlowTime, IFlowFrame, IFlowVideoResult, IRecorderStatus, pickKeyFrames, recorderRuntimeSource, videoMarker } from '../common/openideBrowserRecorder.js';
import { encodeFlowWebm, frameBytes, frameSignatures, renderContactSheet } from './openideFlowVideo.js';
import { analyseFlow, describeFindings, IVisualFinding } from '../common/openideVisualAnalysis.js';
import { describeLint, IVisualLintReport, visualLintSource } from '../common/openideVisualLint.js';
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
	/** The flow being recorded, if any. Mirrors the recorder that lives on the page, so the
	 *  action tools can add their marks without a round trip when nothing is recording. */
	private recording: { id: string; label: string } | undefined;

	constructor(
		mainProcessService: IMainProcessService,
		private readonly configurationService: IConfigurationService,
		private readonly browserViewService: IBrowserViewWorkbenchService,
		private readonly playwrightService: IPlaywrightService,
		private readonly fileService: IFileService,
		private readonly environmentService: IEnvironmentService,
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

	private recordFps(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.recordFps'));
		return Number.isFinite(value) && value >= 2 && value <= 30 ? value : 12;
	}

	private recordMaxSeconds(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.recordMaxSeconds'));
		return Number.isFinite(value) && value >= 5 && value <= 300 ? value : 90;
	}

	/** Key frames attached to the model as pictures, on top of the strip. 0 = strip only. */
	private recordFramesToModel(): number {
		const value = Number(this.configurationService.getValue('openide.agent.browserTools.recordFramesToModel'));
		return Number.isFinite(value) && value >= 0 && value <= 12 ? Math.floor(value) : 6;
	}

	/** One command of the recorder that lives on the page (see openideBrowserRecorder.ts). */
	private recorder<T>(command: string, options?: Record<string, unknown>): Promise<T> {
		return this.invokeRaw<T>(recorderRuntimeSource(), command, options ?? {});
	}

	/** A mark on the recording, if one is running. Never fails the action it annotates. */
	private async mark(label: string, kind: string): Promise<void> {
		if (!this.recording) {
			return;
		}
		try {
			await this.recorder('mark', { label: label.slice(0, 120), kind });
		} catch {
			// The recorder may be gone (page closed); the action itself already happened.
		}
	}

	/**
	 * Measures the page itself: clipped text, contrast, overlapping or undersized controls,
	 * horizontal overflow. The lint runs INSIDE the page — computed styles and real layout are the
	 * whole point — so it is `page.evaluate` of a serialized function, not a call in the vm.
	 */
	private lintCurrentPage(): Promise<IVisualLintReport> {
		return this.invokeRaw<IVisualLintReport>(`async (page, source) => await page.evaluate(source)`, visualLintSource());
	}

	/** Where recordings land: beside the other per-user agent data, one folder per flow. */
	private recordingsRoot() {
		return joinPath(this.environmentService.userRoamingDataHome, 'openideAgent', 'recordings');
	}

	/**
	 * Stops the capture, pulls the frames over in batches, encodes, and writes everything to
	 * disk. Returns the marker the run loop turns into a card and into pictures for the model.
	 */
	private async finishRecording(framesToModel: number): Promise<string> {
		const status = await this.recorder<IRecorderStatus>('stop');
		const frames: IFlowFrame[] = [];
		for (let from = 0; from < status.frames; from += 40) {
			const batch = await this.recorder<{ frames: IFlowFrame[]; total: number }>('take', { from, count: 40 });
			frames.push(...batch.frames);
			if (frames.length >= batch.total) {
				break;
			}
		}
		// The page no longer needs to hold the frames: from here on they are ours.
		await this.recorder('discard').catch(() => { });
		this.recording = undefined;
		if (!frames.length) {
			return 'Error: the recording captured no frames — the preview did not paint while it ran (is it visible?).';
		}

		const label = status.label || 'flow';
		const fps = this.recordFps();
		const keyFrames = pickKeyFrames(frames, status.marks, this.settleMs());
		const durationMs = Math.max(frames[frames.length - 1].t, status.elapsedMs);
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
		const dir = joinPath(this.recordingsRoot(), `${stamp}-${flowSlug(label)}`);
		await this.fileService.createFolder(joinPath(dir, 'frames'));

		// The video can fail on a build without WebCodecs; the strip and the frames still land.
		let videoPath = '';
		let width = status.width;
		let height = status.height;
		let videoError = '';
		try {
			const encoded = await encodeFlowWebm(frames, fps);
			const videoUri = joinPath(dir, 'flow.webm');
			await this.fileService.writeFile(videoUri, VSBuffer.wrap(encoded.webm));
			videoPath = videoUri.fsPath;
			width = encoded.width;
			height = encoded.height;
		} catch (error) {
			videoError = error instanceof Error ? error.message : String(error);
		}

		// The measurements. Neither can stop a recording from being returned: a build without
		// OffscreenCanvas has no signatures, and a page that navigated away cannot be linted — in
		// both cases the video and the strip are still the answer, just without the pointer.
		let findings: IVisualFinding[] = [];
		try {
			const signatures = await frameSignatures(frames);
			findings = [...analyseFlow(signatures, status.marks).findings];
		} catch { /* measurement is an extra, never the deliverable */ }
		let lint: IVisualLintReport | undefined;
		try {
			lint = await this.lintCurrentPage();
		} catch { /* idem */ }

		const sheetBytes = await renderContactSheet(keyFrames, { title: label, durationMs });
		const sheetUri = joinPath(dir, 'sheet.jpg');
		await this.fileService.writeFile(sheetUri, VSBuffer.wrap(sheetBytes));

		const keyFrameEntries: IFlowVideoResult['keyFrames'][number][] = [];
		for (let i = 0; i < keyFrames.length; i++) {
			const key = keyFrames[i];
			const file = joinPath(dir, 'frames', `${String(i + 1).padStart(2, '0')}-${flowSlug(`${key.mark.kind} ${key.mark.label}`, key.mark.kind)}.jpg`);
			await this.fileService.writeFile(file, VSBuffer.wrap(frameBytes(key.frame)));
			keyFrameEntries.push({ file: file.fsPath, t: key.mark.t, label: key.mark.label, kind: key.mark.kind, ...(i < framesToModel ? { data: key.frame.data } : {}) });
		}

		const result: IFlowVideoResult = {
			id: status.id,
			label,
			dir: dir.fsPath,
			videoPath,
			sheetPath: sheetUri.fsPath,
			manifestPath: joinPath(dir, 'manifest.json').fsPath,
			durationMs,
			width,
			height,
			fps,
			frameCount: frames.length,
			truncated: status.truncated,
			sheet: { mimeType: 'image/jpeg', data: encodeBase64(VSBuffer.wrap(sheetBytes)) },
			keyFrames: keyFrameEntries,
			findings: findings.map(finding => ({ kind: finding.kind, t: finding.t, durationMs: finding.durationMs, detail: finding.detail, severity: finding.severity })),
			lint: (lint?.findings ?? []).map(finding => ({ kind: finding.kind, selector: finding.selector, detail: finding.detail, severity: finding.severity })),
		};
		const manifest = { ...result, sheet: 'sheet.jpg', keyFrames: keyFrameEntries.map(entry => ({ file: entry.file, t: entry.t, label: entry.label, kind: entry.kind })), marks: status.marks };
		await this.fileService.writeFile(joinPath(dir, 'manifest.json'), VSBuffer.fromString(JSON.stringify(manifest, undefined, 2)));

		const steps = keyFrameEntries.map((entry, index) => ` ${index + 1}. ${formatFlowTime(entry.t)}  ${entry.kind}${entry.label ? ' · ' + entry.label : ''}`).join('\n');
		const note = [
			`Flow recorded: "${label}" — ${formatFlowTime(durationMs)}, ${frames.length} frames at ${fps} fps, ${width}×${height}${status.truncated ? ' (cut at the size limit)' : ''}.`,
			videoPath ? `Video (WebM, VP8/VP9): ${videoPath}` : `Video: not encoded (${videoError}).`,
			`Contact sheet (all steps in one image, attached as the next message): ${sheetUri.fsPath}`,
			`Key frames (one per action): ${joinPath(dir, 'frames').fsPath}`,
			`Manifest: ${result.manifestPath}`,
			'Steps:',
			steps,
			'',
			'Motion (measured from the frame timings, not guessed from the picture):',
			describeFindings(findings, formatFlowTime),
			'',
			'Page at the end of the flow:',
			lint ? describeLint(lint) : 'not measured (the page was gone when the recording stopped).',
			'',
			'Give the video path to a model that accepts video to review animations and transitions; the sheet and the frames cover the ones that only read images. The timestamps above are where to look first.',
		].join('\n');
		return videoMarker(result, note);
	}

	registerTools(registry: OpenideToolRegistry): void {
		for (const tool of this.buildTools()) {
			const invoke = tool.invoke;
			tool.invoke = async (args: any, token, context?: IAgentToolContext) => {
				if (!this.enabled()) {
					return 'Error: the agent browser tools are disabled (openide.agent.browserTools.enabled).';
				}
				return invoke(args, token, context);
			};
			registry.registerTool(tool);
		}
	}

	private async getPage(): Promise<{ pageId: string; model: IBrowserViewModel }> {
		const input = this.browserViewService.getPreview();
		if (!input) {
			throw new Error('No preview is connected. Use browser_navigate or browser_open first.');
		}
		const model = await input.resolve();
		await model.shareWithAgentSession(this.playwrightSessionId);
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
			parts.push(`Run still pending: ${result.deferredResultId}. Call browser_playwright again with deferredResultId.`);
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
					description: 'Opens or navigates the single native OpenIDE preview to a LOCAL URL and waits for it to load. It is the same visible browser used by browser_screenshot, browser_snapshot and browser_playwright; it does not create another instance.',
					parameters: {
						type: 'object',
						properties: { url: { type: 'string', description: 'Local URL (e.g. http://localhost:5173) or just the port (e.g. 5173)' } },
						required: ['url'],
					},
				},
				approvalInfo: (args: any) => ({ title: 'Navegar la vista previa', detail: String(args?.url ?? '') }),
				invoke: async (args: any) => {
					const url = normalizeLocalUrl(String(args.url ?? ''), this.extraHosts());
					if (!url) {
						return 'Error: URL not allowed — the built-in browser is for local apps only.';
					}
					const input = await this.browserViewService.openPreview(url, undefined, { preserveFocus: true });
					const model = await input.resolve();
					await model.shareWithAgentSession(this.playwrightSessionId);
					const result = await this.playwrightService.invokeFunctionRaw<{ url: string; title: string }>(this.playwrightSessionId, input.id, `async (page, timeoutMs, cursorScript) => {
						await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
						// Navigation takes the overlay away: reinstalling it here leaves the event mirror
						// active from the first step, without waiting for a click.
						if (cursorScript) { await page.evaluate(cursorScript).catch(() => {}); }
						return { url: page.url(), title: await page.title() };
					}`, this.navigationTimeoutMs(), this.cursorScript());
					await this.mark(result.url, 'navigate');
					return model.error ? `Error: ${model.error.errorDescription}` : `OK: loaded ${result.url} (title: ${result.title || 'untitled'}).`;
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_snapshot',
					description: 'Gets the Playwright accessibility snapshot of the native preview: structure, roles, names and stable references to interact with.',
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
					description: 'Captures the whole visible native preview, or one element. The image arrives as the next message.',
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
					description: 'Reads the rendered HTML of the native preview, or of one element. The maximum length is configurable (openide.agent.browserTools.maxDomReadChars).',
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
					description: 'Returns the console of that same native preview (errors, warnings and logs).',
					parameters: { type: 'object', properties: {} },
				},
				invoke: async () => {
					try {
						const { model } = await this.getPage();
						return (await model.getConsoleLogs()) || '(console empty)';
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_click',
					description: 'Clicks in the native preview with Playwright, using a selector, text, role or coordinates.',
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
						const clicked = await this.invokeRaw<{ label: string }>(`async (page, selector, x, y, timeoutMs, cursorScript, cursorGlobal, settleMs) => {
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
							return { label: label };
						}`, args?.selector ? String(args.selector) : '', args?.x, args?.y, this.actionTimeoutMs(), this.cursorScript(), OPENIDE_CURSOR_GLOBAL, this.settleMs());
						await this.mark(clicked?.label || (args?.selector ? String(args.selector) : `${args?.x},${args?.y}`), 'click');
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
					description: 'Fills an input, textarea or contenteditable in the native preview with Playwright.',
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
						const typed = await this.invokeRaw<{ mode: string; value: string | null; field: string }>(`async (page, selector, text, timeoutMs, cursorScript, cursorGlobal, keyDelayMs, maxKeystrokes, settleMs) => {
							const locator = page.locator(selector).first();
							await locator.waitFor({ state: 'visible', timeout: timeoutMs });
							const field = await locator.evaluate(el => { ${FRIENDLY_LABEL_BODY} }).catch(() => '');
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
							return { mode: mode, value: value, field: field };
						}`, String(args.selector ?? ''), String(args.text ?? ''), this.actionTimeoutMs(), this.cursorScript(), OPENIDE_CURSOR_GLOBAL, this.keystrokeDelayMs(), this.maxKeystrokes(), this.settleMs());
						const wanted = String(args.text ?? '');
						await this.mark(`${typed.field || String(args.selector ?? '')} ← ${JSON.stringify(wanted.length > 24 ? wanted.slice(0, 24) + '…' : wanted)}`, 'type');
						const how = typed.mode === 'keys' ? ' tecla por tecla' : '';
						if (typed.value !== null && typed.value !== wanted) {
							return `OK: text entered${how}, but the field normalised it: it ended up as ${JSON.stringify(typed.value)} instead of ${JSON.stringify(wanted)} (the field applies a mask or formatting).`;
						}
						return typed.mode === 'fallback'
							? 'OK: text entered. The field did not accept key-by-key typing (a mask or autocomplete?) and was filled in one go.'
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
					description: 'Evaluates a JavaScript expression through Playwright in the native preview.',
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
					description: 'Applies live inline CSS through Playwright to the native preview. It does not persist to the source.',
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
					description: 'Runs a self-contained Playwright block against the current native preview. The page variable already exists. Do not open or close pages: always operate on that page. Use it for flows the specific tools do not cover.',
					parameters: {
						type: 'object',
						properties: {
							code: { type: 'string', description: 'An async Playwright body, for example: await page.getByRole("button", { name: "Save" }).click(); return await page.title();' },
							deferredResultId: { type: 'string', description: 'ID of an earlier run that is still pending' },
							timeoutMs: { type: 'number', description: 'Maximum wait before returning a deferredResultId; defaults to openide.agent.browserTools.actionTimeoutMs' },
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
							return 'Error: browser_playwright operates exclusively on the existing native page; it cannot create or close browsers or pages.';
						}
						const { pageId } = await this.getPage();
						await this.mark(code.replace(/\s+/g, ' ').slice(0, 80), 'playwright');
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
				risk: 'safe' as const,
				def: {
					name: 'browser_record_start',
					description: 'Starts recording the native preview as video (screencast of the same visible page). Every browser_click / browser_type / browser_navigate / browser_playwright that follows is marked as a step; browser_record_stop encodes a WebM plus a contact sheet and one key frame per step, AND measures the tape: a stall inside an animation, a one-frame flash, motion that never settles, a layout that shifts with nothing to explain it, an action that changed nothing on screen. Use it whenever the question is about MOTION or about a multi-step flow — an animation that feels wrong, a transition that stutters, a button that seems dead — because none of that survives a screenshot. Keep recordings short and focused (one flow per recording).',
					parameters: {
						type: 'object',
						properties: {
							label: { type: 'string', description: 'What this flow is ("login", "open settings modal"). Names the files and the card.' },
							fps: { type: 'number', description: 'Frames per second, 2-30. Default from openide.agent.browserTools.recordFps (12).' },
							maxSeconds: { type: 'number', description: 'Automatic stop, 5-300 s. Default from openide.agent.browserTools.recordMaxSeconds (90).' },
						},
					},
				},
				invoke: async (args: any) => {
					try {
						const { pageId } = await this.getPage();
						// The pointer is part of the story: install it before the first frame.
						const cursorScript = this.cursorScript();
						if (cursorScript) {
							await this.playwrightService.invokeFunctionRaw(this.playwrightSessionId, pageId, `async (page, cursorScript) => { await page.evaluate(cursorScript).catch(() => {}); }`, cursorScript).catch(() => { /* decorativo */ });
						}
						const label = String(args?.label ?? '').trim();
						const status = await this.recorder<IRecorderStatus & { alreadyActive?: boolean }>('start', {
							label,
							fps: Number(args?.fps) || this.recordFps(),
							maxSeconds: Number(args?.maxSeconds) || this.recordMaxSeconds(),
							quality: this.screenshotQuality(),
						});
						this.recording = { id: status.id, label: status.label };
						if (status.alreadyActive) {
							return `OK: a recording is already running ("${status.label || status.id}", ${formatFlowTime(status.elapsedMs)} so far). Call browser_record_stop when the flow is done.`;
						}
						return `OK: recording "${label || status.id}" at ${this.recordFps()} fps (auto-stop at ${this.recordMaxSeconds()} s). Drive the flow with the browser tools — each action becomes a step — then call browser_record_stop.`;
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_check_visual',
					description: 'Measures the CURRENT page for visual defects and returns them with a selector and a number each: text clipped by an overflow with no ellipsis, images that loaded no pixels, text below the WCAG AA contrast ratio against what is actually behind it, controls under 24x24, controls overlapping each other, and a document wider than its viewport. These are the defects a screenshot contains but a reader cannot reliably measure — use it together with browser_screenshot, not instead of it: this answers "is the text cut off, is the contrast 2.9:1", and the picture answers "does this look right". Safe and read-only; it changes nothing on the page.',
					parameters: { type: 'object', properties: {} },
				},
				invoke: async () => {
					try {
						const report = await this.lintCurrentPage();
						return describeLint(report);
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_record_mark',
					description: 'Adds a named step to the running recording, for moments no tool produced (an animation finished, a state to point at). The browser tools add their own marks automatically.',
					parameters: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
				},
				invoke: async (args: any) => {
					try {
						if (!this.recording) {
							return 'Error: nothing is recording. Call browser_record_start first.';
						}
						const status = await this.recorder<IRecorderStatus>('mark', { label: String(args?.label ?? ''), kind: 'mark' });
						return `OK: step ${status.marks.length} at ${formatFlowTime(status.elapsedMs)}.`;
					} catch (error) {
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'safe' as const,
				def: {
					name: 'browser_record_stop',
					description: 'Stops the recording and produces: flow.webm (video), sheet.jpg (every step tiled in one image, attached as the next message), frames/ (one JPEG per step) and manifest.json, all under the user\'s OpenIDE data folder. The result also carries two lists of measurements — what the frame timings say about the motion, each with the millisecond to look at, and what the page said about itself at the end (clipped text, contrast, overlap). Read those first and use them to aim: they turn "review this video" into "look at 00:04.2". The result lists absolute paths, so a model or CLI that accepts video can be handed the .webm and one that only reads images gets the sheet and the frames.',
					parameters: {
						type: 'object',
						properties: {
							framesToModel: { type: 'number', description: 'How many key frames to attach as images besides the sheet, 0-12. Default from openide.agent.browserTools.recordFramesToModel (6).' },
							discard: { type: 'boolean', description: 'Stop and throw the recording away without writing anything.' },
						},
					},
				},
				invoke: async (args: any) => {
					try {
						if (!this.recording) {
							return 'Error: nothing is recording. Call browser_record_start first.';
						}
						if (args?.discard) {
							await this.recorder('discard');
							this.recording = undefined;
							return 'OK: recording discarded.';
						}
						const framesToModel = Number.isFinite(Number(args?.framesToModel)) ? Math.max(0, Math.min(12, Math.floor(Number(args.framesToModel)))) : this.recordFramesToModel();
						return await this.finishRecording(framesToModel);
					} catch (error) {
						this.recording = undefined;
						return `Error: ${error instanceof Error ? error.message : String(error)}`;
					}
				},
			},
			{
				risk: 'exec' as const,
				def: {
					name: 'browser_dialog',
					description: 'Answers the dialog, prompt or file chooser that interrupted the last Playwright step in the native preview.',
					parameters: {
						type: 'object',
						properties: {
							accept: { type: 'boolean' },
							promptText: { type: 'string' },
							files: { type: 'array', items: { type: 'string' }, description: 'Paths for a file chooser; an empty array cancels it' },
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
