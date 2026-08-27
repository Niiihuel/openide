/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — browser automation for the agent (common layer). The REAL service lives in the
 *  el main process (electron-main/openideBrowserAutomationMain.ts) sobre BrowserWindows
 *  restricted to LOCAL URLs; the workbench talks to it over IPC (ProxyChannel) using this
 *  contract. The local-URL validation the main process ENFORCES server-side also lives here
 *  (defense in depth: the workbench normalizes, the main process rejects non-local anyway).
 *--------------------------------------------------------------------------------------------*/

export const OPENIDE_BROWSER_AUTOMATION_CHANNEL = 'openideBrowserAutomation';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** STRICT local-URL validation (no normalization: that belongs to the workbench). */
export function isAllowedLocalBrowserUrl(raw: string, extraHosts: readonly string[]): boolean {
	let url: URL;
	try {
		url = new URL(String(raw ?? ''));
	} catch {
		return false;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return false;
	}
	const host = url.hostname.toLowerCase();
	return LOCAL_HOSTS.has(host)
		|| host.endsWith('.localhost')
		|| (extraHosts ?? []).some(e => String(e ?? '').trim().toLowerCase() === host);
}

export interface IBrowserConsoleEntry {
	readonly level: string;
	readonly text: string;
	readonly at: number;
}

/**
 * The properties the picker reads off the chosen element.
 *
 * It lives HERE and not next to the style editor's catalog because the script that reads them is
 * injected from electron-main, which cannot import a workbench module. Longhands, not shorthands:
 * a `padding` shorthand collapses four independently editable numbers into one string, and the
 * editor's whole point is that each side has its own control. `openideStyleModel.ts` is what turns
 * these into labelled controls, and a test there asserts it covers exactly this list.
 */
export const OPENIDE_PICK_STYLE_PROPS: readonly string[] = [
	'display', 'flex-direction', 'justify-content', 'align-items', 'gap', 'position', 'width', 'height',
	'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
	'color', 'background-color',
	'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
	'border-style', 'border-color',
	'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
	'opacity', 'box-shadow', 'transform', 'overflow',
];

export interface IBrowserPickRect {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** Visual picker result (Pick & Polish): the element the user chose. */
export interface IBrowserPickResult {
	readonly selector: string;
	readonly html: string;
	readonly styles: string;
	readonly rect: IBrowserPickRect;
	readonly pageUrl: string;
	/** Base64 JPEG of the element (no data: prefix). Absent for the in-page pick (the rect is
	 *  relative to the preview iframe and cannot be captured cleanly from outside). */
	readonly screenshotBase64?: string;
}

export type BrowserOpResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

/** Automation service contract (one page at a time; implicit, lazy session). */
export interface IOpenideBrowserAutomation {
	navigate(url: string, extraHosts: string[]): Promise<BrowserOpResult<{ url: string; title: string }>>;
	screenshot(selector?: string): Promise<BrowserOpResult<{ base64: string; width: number; height: number }>>;
	readDom(selector?: string): Promise<BrowserOpResult<{ html: string }>>;
	consoleEntries(): Promise<IBrowserConsoleEntry[]>;
	click(selector?: string, x?: number, y?: number): Promise<BrowserOpResult>;
	typeText(selector: string, text: string): Promise<BrowserOpResult>;
	evaluate(expression: string): Promise<BrowserOpResult<{ value: string }>>;
	setStyle(selector: string, cssText: string): Promise<BrowserOpResult<{ count: number }>>;
	/** Opens a VISIBLE window with a selection overlay; resolves with the clicked element. */
	pick(url: string, extraHosts: string[]): Promise<BrowserOpResult<{ result: IBrowserPickResult }> | { ok: false; cancelled: true }>;
	/** Pick INSIDE the IDE preview iframe (no separate window). `noFrame` if no preview is
	 *  open on that origin after waiting waitFrameMs. */
	pickInPage(url: string, extraHosts: string[], waitFrameMs: number): Promise<BrowserOpResult<{ result: IBrowserPickResult }> | { ok: false; cancelled: true } | { ok: false; noFrame: true }>;
	disposeSession(): Promise<void>;
}
