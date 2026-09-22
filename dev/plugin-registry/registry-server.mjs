/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServer } from 'node:http';
import { URL } from 'node:url';
import {
	RegistryError,
	canonicalBytes,
	canonicalJson,
	parseAuthorizationHeaders,
	safeTokenEquals,
	sha256,
} from './registry-lib.mjs';
import { RegistryStore } from './registry-store.mjs';

const MAX_REQUEST_BYTES = 48 * 1024 * 1024;

export async function createRegistryServer({ root, name, adminToken, publicBaseUrl, logger = console }) {
	if (typeof adminToken !== 'string' || adminToken.length < 24) {
		throw new RegistryError('admin-token-required', 'The registry admin token must contain at least 24 characters.', 500);
	}
	const store = new RegistryStore(root, { name });
	await store.initialize();

	const server = createServer(async (request, response) => {
		setSecurityHeaders(response);
		if (request.method === 'OPTIONS') {
			response.writeHead(204, {
				'access-control-allow-headers': 'accept, if-none-match',
				'access-control-allow-methods': 'GET, OPTIONS',
				'access-control-allow-origin': '*',
			});
			response.end();
			return;
		}

		try {
			const origin = publicBaseUrl ?? inferLoopbackBaseUrl(request);
			const url = new URL(request.url ?? '/', origin);
			const pathname = decodePathname(url.pathname);

			if (request.method === 'GET' && pathname === '/healthz') {
				return sendJson(response, 200, { ok: true });
			}
			if (request.method === 'GET' && pathname === '/v1/marketplace.json') {
				const marketplace = await store.buildMarketplace(origin);
				const bytes = canonicalBytes(marketplace);
				const etag = `"sha256-${sha256(bytes)}"`;
				if (request.headers['if-none-match'] === etag) {
					response.writeHead(304, {
						'access-control-allow-origin': '*',
						'cache-control': 'public, max-age=30, must-revalidate',
						etag,
					});
					response.end();
					return;
				}
				return sendBytes(response, 200, bytes, 'application/json; charset=utf-8', {
					'access-control-allow-origin': '*',
					'cache-control': 'public, max-age=30, must-revalidate',
					etag,
				});
			}

			const artifactMatch = /^\/v1\/publishers\/([^/]+)\/plugins\/([^/]+)\/versions\/([^/]+)\/artifact$/.exec(pathname);
			if (request.method === 'GET' && artifactMatch) {
				const bytes = await store.getArtifact(artifactMatch[1], artifactMatch[2], artifactMatch[3]);
				const digest = sha256(bytes);
				const etag = `"sha256-${digest}"`;
				if (request.headers['if-none-match'] === etag) {
					response.writeHead(304, {
						'access-control-allow-origin': '*',
						'cache-control': 'public, max-age=31536000, immutable',
						etag,
					});
					response.end();
					return;
				}
				return sendBytes(response, 200, bytes, 'application/vnd.openide.plugin+json', {
					'access-control-allow-origin': '*',
					'cache-control': 'public, max-age=31536000, immutable',
					'content-digest': `sha-256=:${Buffer.from(digest, 'hex').toString('base64')}:`,
					etag,
				});
			}

			const pluginMatch = /^\/v1\/publishers\/([^/]+)\/plugins\/([^/]+)$/.exec(pathname);
			if (request.method === 'GET' && pluginMatch) {
				return sendJson(response, 200, await store.getPlugin(pluginMatch[1], pluginMatch[2]), { 'access-control-allow-origin': '*' });
			}

			if (request.method === 'POST' && pathname === '/v1/publishers') {
				requireAdmin(request, adminToken);
				const { json } = await readJsonBody(request);
				return sendJson(response, 201, await store.registerPublisher(json));
			}

			const uploadMatch = /^\/v1\/publishers\/([^/]+)\/plugins\/([^/]+)\/versions\/([^/]+)$/.exec(pathname);
			if (request.method === 'PUT' && uploadMatch) {
				const { bytes, json } = await readJsonBody(request);
				const [, publisher, pluginName, version] = uploadMatch;
				if (json?.release?.publisherId !== publisher || json?.release?.pluginId !== pluginName || json?.release?.version !== version) {
					throw new RegistryError('release-coordinate-mismatch', 'The signed release coordinates do not match the request path.');
				}
				const authorization = parseAuthorizationHeaders(request.headers);
				return sendJson(response, 201, await store.createRelease(json, authorization, bytes));
			}

			const transitionMatch = /^\/v1\/publishers\/([^/]+)\/plugins\/([^/]+)\/versions\/([^/]+)\/(stage|publish|yank)$/.exec(pathname);
			if (request.method === 'POST' && transitionMatch) {
				const [, publisher, pluginName, version, transition] = transitionMatch;
				const { bytes } = await readJsonBody(request);
				const authorization = parseAuthorizationHeaders(request.headers);
				const result = transition === 'stage'
					? await store.stageRelease(publisher, pluginName, version, authorization, bytes)
					: transition === 'publish'
						? await store.publishRelease(publisher, pluginName, version, authorization, bytes)
						: await store.yankRelease(publisher, pluginName, version, authorization, bytes);
				return sendJson(response, 200, result);
			}

			const rollbackMatch = /^\/v1\/publishers\/([^/]+)\/plugins\/([^/]+)\/channels\/stable\/rollback$/.exec(pathname);
			if (request.method === 'POST' && rollbackMatch) {
				const { bytes, json } = await readJsonBody(request);
				if (!json || typeof json !== 'object' || typeof json.version !== 'string') {
					throw new RegistryError('rollback-body-invalid', 'Rollback requires a version field.');
				}
				const authorization = parseAuthorizationHeaders(request.headers);
				return sendJson(response, 200, await store.rollback(rollbackMatch[1], rollbackMatch[2], json.version, authorization, bytes));
			}

			throw new RegistryError('not-found', 'Registry route not found.', 404);
		} catch (error) {
			const registryError = error instanceof RegistryError
				? error
				: new RegistryError('internal-error', 'The registry could not complete the request.', 500);
			if (registryError.status >= 500) {
				logger.error?.('[plugin-registry]', error);
			}
			if (!response.headersSent) {
				sendJson(response, registryError.status, { error: registryError.code, message: registryError.message });
			} else {
				response.destroy();
			}
		}
	});

	server.requestTimeout = 30_000;
	server.headersTimeout = 15_000;
	server.keepAliveTimeout = 5_000;
	return { server, store };
}

function inferLoopbackBaseUrl(request) {
	const host = request.headers.host;
	if (typeof host !== 'string' || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) {
		throw new RegistryError('public-url-required', 'OPENIDE_PLUGIN_REGISTRY_PUBLIC_URL is required outside loopback.', 500);
	}
	return `http://${host}`;
}

function requireAdmin(request, adminToken) {
	const authorization = request.headers.authorization;
	const token = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
	if (!safeTokenEquals(token, adminToken)) {
		throw new RegistryError('admin-unauthorized', 'A valid registry admin token is required.', 401);
	}
}

async function readJsonBody(request) {
	const declaredLength = Number(request.headers['content-length']);
	if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
		throw new RegistryError('body-too-large', `Request bodies may not exceed ${MAX_REQUEST_BYTES} bytes.`, 413);
	}
	const chunks = [];
	let length = 0;
	for await (const chunk of request) {
		length += chunk.length;
		if (length > MAX_REQUEST_BYTES) {
			throw new RegistryError('body-too-large', `Request bodies may not exceed ${MAX_REQUEST_BYTES} bytes.`, 413);
		}
		chunks.push(chunk);
	}
	const bytes = Buffer.concat(chunks);
	let json;
	try {
		json = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new RegistryError('invalid-json', 'The request body is not valid JSON.');
	}
	return { bytes, json };
}

function decodePathname(pathname) {
	try {
		return pathname.split('/').map(segment => decodeURIComponent(segment)).join('/');
	} catch {
		throw new RegistryError('invalid-path', 'The request path is not valid URL encoding.');
	}
}

function sendJson(response, status, value, headers = {}) {
	return sendBytes(response, status, Buffer.from(`${canonicalJson(value)}\n`, 'utf8'), 'application/json; charset=utf-8', headers);
}

function sendBytes(response, status, bytes, contentType, headers = {}) {
	response.writeHead(status, {
		'content-length': bytes.length,
		'content-type': contentType,
		...headers,
	});
	response.end(bytes);
}

function setSecurityHeaders(response) {
	response.setHeader('x-content-type-options', 'nosniff');
	response.setHeader('referrer-policy', 'no-referrer');
	response.setHeader('x-frame-options', 'DENY');
}
