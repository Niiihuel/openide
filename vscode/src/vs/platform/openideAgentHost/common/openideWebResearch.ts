/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — contracts and pure validation for public web research.
 *--------------------------------------------------------------------------------------------*/

export const WEB_DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
export const WEB_MAX_REDIRECTS = 5;

export interface OpenideWebFetchRequest {
	readonly url: string;
	readonly timeoutMs?: number;
	readonly maxBytes?: number;
	readonly allowHttp?: boolean;
	readonly allowedHosts?: readonly string[];
	readonly blockedHosts?: readonly string[];
}

export interface OpenideWebFetchResponse {
	readonly url: string;
	readonly status: number;
	readonly contentType: string;
	readonly body: string;
	readonly bytes: number;
}

function normalizeHost(hostname: string): string { return hostname.toLowerCase().replace(/\.$/, ''); }

export function isPrivateWebAddress(address: string): boolean {
	const value = address.toLowerCase().replace(/^\[|\]$/g, '');
	if (value === '::' || value === '::1' || value === '0.0.0.0' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) { return true; }
	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
	if (!ipv4) { return false; }
	const octets = ipv4.slice(1).map(Number);
	if (octets.some(part => part > 255)) { return true; }
	const [a, b] = octets;
	return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

export function validatePublicWebUrl(raw: string, options?: { allowHttp?: boolean; allowedHosts?: readonly string[]; blockedHosts?: readonly string[] }): URL {
	let url: URL;
	try { url = new URL(raw); } catch { throw new Error('URL web inválida'); }
	if (url.username || url.password) { throw new Error('La URL web no puede incluir credenciales'); }
	if (url.protocol !== 'https:' && !(options?.allowHttp && url.protocol === 'http:')) { throw new Error('La exploración web requiere HTTPS'); }
	if (url.port && url.port !== '443' && !(options?.allowHttp && url.port === '80')) { throw new Error('Puerto web no permitido'); }
	const host = normalizeHost(url.hostname);
	if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateWebAddress(host)) { throw new Error('Host web local o privado no permitido'); }
	const blocked = (options?.blockedHosts ?? []).map(normalizeHost);
	if (blocked.some(item => host === item || host.endsWith('.' + item))) { throw new Error('Host web bloqueado por configuración'); }
	const allowed = (options?.allowedHosts ?? []).map(normalizeHost).filter(Boolean);
	if (allowed.length && !allowed.some(item => host === item || host.endsWith('.' + item))) { throw new Error('Host web fuera de la allowlist'); }
	url.hash = '';
	return url;
}

export function canonicalWebUrl(raw: string): string {
	const url = new URL(raw);
	url.hash = '';
	for (const key of [...url.searchParams.keys()]) { if (/^(utm_|fbclid$|gclid$)/i.test(key)) { url.searchParams.delete(key); } }
	return url.toString();
}

export function stripWebHtml(html: string, maxChars: number): { title: string; text: string } {
	const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()).slice(0, 500);
	let text = html
		.replace(/<!--([\s\S]*?)-->/g, ' ')
		.replace(/<(script|style|noscript|svg|canvas|form|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ');
	text = decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	return { title, text: text.slice(0, Math.max(1_000, maxChars)) };
}

function decodeEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
		const lower = entity.toLowerCase();
		if (lower === 'amp') { return '&'; } if (lower === 'lt') { return '<'; } if (lower === 'gt') { return '>'; }
		if (lower === 'quot') { return '"'; } if (lower === 'apos') { return "'"; } if (lower === 'nbsp') { return ' '; }
		const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
		return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
	});
}
