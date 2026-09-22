/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
	RegistryError,
	authorizationHeaders,
	canonicalBytes,
	createAuthorization,
	createPluginArtifact,
	createRelease,
	publicKeyBase64Url,
	publisherKeyId,
	signPluginRelease,
	validateIdentifier,
	validatePublisherIdentifier,
	validateVersion,
} from './registry-lib.mjs';

export function normalizeRegistryBase(value, { allowInsecureLoopback = true } = {}) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new RegistryError('invalid-registry-url', `'${value}' is not a valid registry URL.`);
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
		throw new RegistryError('invalid-registry-url', 'Registry URLs must use HTTP(S) without credentials, query, or fragment.');
	}
	const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1';
	if (url.protocol !== 'https:' && !(allowInsecureLoopback && isLoopback)) {
		throw new RegistryError('insecure-registry-url', 'Remote registries must use HTTPS. Plain HTTP is allowed only on loopback.');
	}
	url.pathname = url.pathname.replace(/\/v1\/marketplace\.json\/?$/, '').replace(/\/$/, '');
	return url.toString().replace(/\/$/, '');
}

export async function loadPublisherPrivateKey(path) {
	const pem = await readFile(path, 'utf8');
	let key;
	try {
		key = createPrivateKey(pem);
	} catch {
		throw new RegistryError('invalid-private-key', `Could not load publisher private key '${path}'.`);
	}
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new RegistryError('invalid-private-key', 'Publisher private keys must use Ed25519.');
	}
	return key;
}

export async function registerPublisher({ registry, adminToken, publisher, displayName, principal, publicKey }) {
	const base = normalizeRegistryBase(registry);
	const body = { id: validatePublisherIdentifier(publisher, 'publisher'), displayName, principal, publicKey };
	return requestJson(`${base}/v1/publishers`, {
		method: 'POST',
		headers: { authorization: `Bearer ${adminToken}` },
		bodyBytes: canonicalBytes(body),
	});
}

export async function uploadPluginRelease({ registry, publisher, pluginDirectory, version, privateKey }) {
	const base = normalizeRegistryBase(registry);
	publisher = validatePublisherIdentifier(publisher, 'publisher');
	const packaged = await createPluginArtifact(pluginDirectory);
	version = validateVersion(version ?? packaged.manifest.version);
	const publicKey = publicKeyBase64Url(privateKey);
	const keyId = publisherKeyId(publicKey);
	const release = createRelease({
		publisherId: publisher,
		pluginId: packaged.manifest.name,
		version,
		artifactBytes: packaged.bytes,
		keyId,
	});
	const envelope = {
		release,
		signature: signPluginRelease(release, privateKey),
		artifact: packaged.artifact,
	};
	return signedRequest({
		registry: base,
		path: `/v1/publishers/${encodeURIComponent(publisher)}/plugins/${encodeURIComponent(release.pluginId)}/versions/${encodeURIComponent(release.version)}`,
		method: 'PUT',
		action: 'release:create',
		resource: `/v1/publishers/${publisher}/plugins/${release.pluginId}/versions/${release.version}`,
		publisher,
		keyId,
		privateKey,
		body: envelope,
	});
}

export async function stagePluginRelease(options) {
	return releaseTransition({ ...options, action: 'release:stage', transition: 'stage' });
}

export async function promotePluginRelease(options) {
	return releaseTransition({ ...options, action: 'release:publish', transition: 'publish' });
}

export async function yankPluginRelease(options) {
	return releaseTransition({ ...options, action: 'release:yank', transition: 'yank' });
}

export async function rollbackPluginRelease({ registry, publisher, name, version, privateKey }) {
	const base = normalizeRegistryBase(registry);
	publisher = validatePublisherIdentifier(publisher, 'publisher');
	name = validateIdentifier(name, 'name');
	version = validateVersion(version);
	const keyId = publisherKeyId(publicKeyBase64Url(privateKey));
	return signedRequest({
		registry: base,
		path: `/v1/publishers/${encodeURIComponent(publisher)}/plugins/${encodeURIComponent(name)}/channels/stable/rollback`,
		action: 'release:rollback',
		resource: `/v1/publishers/${publisher}/plugins/${name}/channels/stable/rollback`,
		publisher,
		keyId,
		privateKey,
		body: { version },
	});
}

async function releaseTransition({ registry, publisher, name, version, privateKey, action, transition }) {
	const base = normalizeRegistryBase(registry);
	publisher = validatePublisherIdentifier(publisher, 'publisher');
	name = validateIdentifier(name, 'name');
	version = validateVersion(version);
	const keyId = publisherKeyId(publicKeyBase64Url(privateKey));
	return signedRequest({
		registry: base,
		path: `/v1/publishers/${encodeURIComponent(publisher)}/plugins/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/${transition}`,
		action,
		resource: `/v1/publishers/${publisher}/plugins/${name}/versions/${version}/${transition}`,
		publisher,
		keyId,
		privateKey,
		body: {},
	});
}

async function signedRequest({ registry, path, method = 'POST', action, resource, publisher, keyId, privateKey, body }) {
	const bodyBytes = canonicalBytes(body);
	const authorization = createAuthorization({ publisher, keyId, privateKey, action, resource, bodyBytes });
	return requestJson(`${registry}${path}`, {
		method,
		headers: authorizationHeaders(authorization),
		bodyBytes,
	});
}

async function requestJson(url, { method = 'GET', headers = {}, bodyBytes } = {}) {
	const response = await fetch(url, {
		method,
		// Publisher authorizations are replay-resistant at the registry, but a
		// redirecting endpoint must never receive or relay signed control-plane
		// requests to a different trust domain.
		redirect: 'error',
		headers: {
			accept: 'application/json',
			...(bodyBytes ? { 'content-type': 'application/json' } : {}),
			...headers,
		},
		body: bodyBytes,
	});
	const text = await response.text();
	let value;
	try {
		value = text ? JSON.parse(text) : undefined;
	} catch {
		throw new RegistryError('registry-response-invalid', `Registry returned non-JSON HTTP ${response.status}.`, 502);
	}
	if (!response.ok) {
		throw new RegistryError(value?.error ?? 'registry-request-failed', value?.message ?? `Registry returned HTTP ${response.status}.`, response.status);
	}
	return value;
}
