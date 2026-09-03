/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — LOCAL URL validation for the integrated preview (a lightweight browser in the
 *  spirit of Simple Browser: localhost development apps only, never the open web).
 *--------------------------------------------------------------------------------------------*/

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Normalizes the URL bar input and validates that it is LOCAL. Accepts "3000" (a port),
 *  "localhost:5173", or a full http(s) URL. Returns the normalized URL, or undefined. */
export function normalizeLocalUrl(raw: string, extraHosts?: readonly string[]): string | undefined {
	let input = String(raw ?? '').trim();
	if (!input) {
		return undefined;
	}
	if (/^\d{2,5}$/.test(input)) {
		input = `http://localhost:${input}`; // solo el puerto: atajo común
	}
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
		input = `http://${input}`;
	}
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return undefined;
	}
	const host = url.hostname.toLowerCase();
	const allowed = LOCAL_HOSTS.has(host)
		|| host.endsWith('.localhost')
		|| (extraHosts ?? []).some(h => typeof h === 'string' && h.trim().toLowerCase() === host);
	return allowed ? url.toString() : undefined;
}

/** Hosts for the webview CSP frame-src (the local ones plus the user allowlist). */
export function frameHosts(extraHosts?: readonly string[]): string[] {
	const hosts = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '*.localhost'];
	for (const h of extraHosts ?? []) {
		const clean = String(h ?? '').trim().toLowerCase();
		if (clean && /^[a-z0-9.*[\]:-]+$/.test(clean)) {
			hosts.push(clean);
		}
	}
	return hosts;
}
