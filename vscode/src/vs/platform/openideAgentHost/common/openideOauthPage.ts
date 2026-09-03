/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — OAuth login return page. The system browser opens it, so it inherits NOTHING from
 *  the IDE: no theme tokens, no fonts, no icons. Everything is embedded and uses literal
 *  colors, with the logo as inline SVG (it cannot request a file from disk).
 *--------------------------------------------------------------------------------------------*/

/** Product logo, with gradient ids prefixed so they cannot collide with anything on the page. */
const OPENIDE_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="220 210 560 560"> <defs> <linearGradient id="oi-a" x1="300" y1="330" x2="520" y2="470" gradientUnits="userSpaceOnUse"><stop stop-color="#62666d"/><stop offset="1" stop-color="#25282e"/></linearGradient> <linearGradient id="oi-b" x1="280" y1="405" x2="390" y2="570" gradientUnits="userSpaceOnUse"><stop stop-color="#363a41"/><stop offset="1" stop-color="#171a1f"/></linearGradient> <linearGradient id="oi-c" x1="470" y1="395" x2="485" y2="590" gradientUnits="userSpaceOnUse"><stop stop-color="#080a0e"/><stop offset=".62" stop-color="#16191e"/><stop offset="1" stop-color="#555960"/></linearGradient> <linearGradient id="oi-d" x1="590" y1="300" x2="675" y2="535" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".22" stop-color="#e5e7ea"/><stop offset=".65" stop-color="#aeb3ba"/><stop offset="1" stop-color="#70767e"/></linearGradient> <linearGradient id="oi-e" x1="390" y1="565" x2="600" y2="625" gradientUnits="userSpaceOnUse"><stop stop-color="#f4f5f6"/><stop offset=".34" stop-color="#c7cbd0"/><stop offset=".74" stop-color="#676c73"/><stop offset="1" stop-color="#24272c"/></linearGradient> <linearGradient id="oi-f" x1="435" y1="600" x2="675" y2="680" gradientUnits="userSpaceOnUse"><stop stop-color="#090b0f"/><stop offset=".52" stop-color="#202329"/><stop offset="1" stop-color="#34383f"/></linearGradient> </defs> <g stroke="#0b0d11" stroke-width="5" stroke-linejoin="round"> <path fill="url(#oi-f)" d="M311 585 526 624 708 474v132c0 26-15 46-39 56l-119 47c-25 10-51 7-73-7z"/> <path fill="url(#oi-a)" d="M291 382 500 273c23-12 46-12 69-1l23 12-215 153z"/> <path fill="url(#oi-b)" d="M291 382c-10 6-16 17-16 29v126c0 36 33 61 66 48l36-14V437z"/> <path fill="url(#oi-c)" d="m377 437 190-62v202l-190 2z"/> <path fill="url(#oi-d)" d="m568 280 76 30c41 16 64 50 64 93v71L567 600z"/> <path fill="url(#oi-e)" d="m311 585 216 39 181-150-141 103-190 2z"/> </g> <path fill="none" stroke="#fff" stroke-opacity=".78" stroke-width="5" d="m569 282 75 30c39 15 61 48 61 89v72L527 621"/> </svg>`;

export interface IOauthPageOptions {
	/** Name of the connected provider ("ChatGPT", "Claude"…). Empty = generic message. */
	readonly provider?: string;
	/** true when the user cancelled or the provider returned an error. */
	readonly failed?: boolean;
	/** Error detail, when the provider supplied one. */
	readonly detail?: string;
}

/**
 * The "done, go back to the IDE" page. It looks the same in light and dark system themes
 * because it declares both: the user's browser may be in either one.
 */
export function getOpenideOauthPage(options: IOauthPageOptions = {}): string {
	const failed = !!options.failed;
	const provider = (options.provider || '').trim();
	const title = failed
		? 'No se completó la conexión'
		: provider ? `Conectaste ${escapeHtml(provider)}` : 'Cuenta conectada';
	const subtitle = failed
		? (options.detail ? escapeHtml(options.detail) : 'Podés cerrar esta pestaña y volver a intentarlo desde OpenIDE.')
		: 'Ya podés cerrar esta pestaña y volver a OpenIDE.';
	return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${failed ? 'Conexión no completada' : 'Cuenta conectada'} · OpenIDE</title>
<style>
	:root { --bg: #ffffff; --fg: #1b1d21; --muted: #6b7078; }
	@media (prefers-color-scheme: dark) { :root { --bg: #131417; --fg: #f2f3f5; --muted: #9aa0a8; } }
	* { box-sizing: border-box; }
	html, body { height: 100%; margin: 0; }
	body { display: grid; place-items: center; padding: 32px; background: var(--bg); color: var(--fg);
		font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
	main { max-width: 420px; text-align: center; }
	/* The logo sits bare on the background: no box, no border, no shadow. Any container
	   alrededor lo convierte en un "badge" y le da un peso que la página no necesita. */
	.mark { width: 64px; height: 64px; margin: 0 auto 24px; }
	.mark svg { width: 100%; height: 100%; display: block; }
	h1 { margin: 0 0 10px; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
	p { margin: 0; color: var(--muted); overflow-wrap: anywhere; }
	/* Status: text and nothing else. No pill, no border, no colored dot. */
	.state { margin: 0 0 14px; font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
<main class="${failed ? 'failed' : ''}">
	<div class="mark">${OPENIDE_MARK}</div>
	<div class="state">${failed ? 'Sin conectar' : 'Conectado'}</div>
	<h1>${title}</h1>
	<p>${subtitle}</p>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}
