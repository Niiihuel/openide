/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	authorizationHeaders,
	canonicalBytes,
	compareVersions,
	createAuthorization,
	createPluginArtifact,
	publicKeyBase64Url,
	publisherKeyId,
} from './registry-lib.mjs';
import {
	promotePluginRelease,
	registerPublisher,
	rollbackPluginRelease,
	stagePluginRelease,
	uploadPluginRelease,
} from './registry-client.mjs';
import { createRegistryServer } from './registry-server.mjs';

test('canonical SemVer ordering is locale-independent', () => {
	assert.equal(compareVersions('1.0.0-alpha.9', '1.0.0-alpha.10'), -1);
	assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
	assert.equal(compareVersions('2.0.0', '1.999999999999999999999.0'), 1);
	assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('registry startup recovers a lock left by a dead writer', async t => {
	const temporary = await mkdtemp(join(tmpdir(), 'openide-plugin-registry-stale-lock-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	await writeFile(join(temporary, '.registry-write.lock'), JSON.stringify({ pid: 2_147_483_647, createdAt: '2020-01-01T00:00:00.000Z' }));
	const { store } = await createRegistryServer({ root: temporary, adminToken: 'test-admin-token-at-least-24-characters', logger: { error() { } } });
	assert.equal((await store.getState()).schemaVersion, 1);
	await assert.rejects(access(join(temporary, '.registry-write.lock')), error => error.code === 'ENOENT');
});

test('publisher control-plane client refuses redirects', async t => {
	let redirectedRequests = 0;
	const destination = createHttpServer((_request, response) => {
		redirectedRequests++;
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end('{}');
	});
	await new Promise((resolve, reject) => {
		destination.once('error', reject);
		destination.listen(0, '127.0.0.1', resolve);
	});
	const destinationAddress = destination.address();
	const redirector = createHttpServer((_request, response) => {
		response.writeHead(307, { location: `http://127.0.0.1:${destinationAddress.port}/v1/publishers` });
		response.end();
	});
	await new Promise((resolve, reject) => {
		redirector.once('error', reject);
		redirector.listen(0, '127.0.0.1', resolve);
	});
	t.after(async () => {
		await Promise.all([
			new Promise(resolve => redirector.close(resolve)),
			new Promise(resolve => destination.close(resolve)),
		]);
	});
	const redirectorAddress = redirector.address();
	const keys = generateKeyPairSync('ed25519');
	await assert.rejects(registerPublisher({
		registry: `http://127.0.0.1:${redirectorAddress.port}`,
		adminToken: 'test-admin-token-at-least-24-characters',
		publisher: 'acme',
		displayName: 'Acme',
		principal: { issuer: 'https://identity.example.test/', subject: 'account-42' },
		publicKey: publicKeyBase64Url(keys.publicKey),
	}));
	assert.equal(redirectedRequests, 0, 'signed or privileged control-plane requests must never follow redirects');
});

test('registry publishes immutable signed releases and rolls the channel back without mutation', async t => {
	const temporary = await mkdtemp(join(tmpdir(), 'openide-plugin-registry-'));
	const registryRoot = join(temporary, 'registry');
	const pluginRoot = join(temporary, 'plugin');
	const adminToken = 'test-admin-token-at-least-24-characters';
	const keys = generateKeyPairSync('ed25519');
	const publicKey = publicKeyBase64Url(keys.publicKey);
	const keyId = publisherKeyId(publicKey);
	const { server, store } = await createRegistryServer({ root: registryRoot, name: 'test-registry', adminToken, logger: { error() { } } });
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	const registry = `http://127.0.0.1:${address.port}`;
	await assert.rejects(store.buildMarketplace('http://plugins.example.test'), error => error.code === 'insecure-public-url');
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		await rm(temporary, { recursive: true, force: true });
	});

	await mkdir(join(pluginRoot, 'skills', 'review'), { recursive: true });
	await writePlugin(pluginRoot, '1.0.0', 'first');

	assert.deepEqual(await registerPublisher({
		registry,
		adminToken,
		publisher: 'acme',
		displayName: 'Acme Tools',
		principal: { issuer: 'https://identity.example.test/', subject: 'account-42' },
		publicKey,
	}), { created: true, displayName: 'Acme Tools', id: 'acme', keyId });

	const first = await uploadPluginRelease({ registry, publisher: 'acme', pluginDirectory: pluginRoot, version: '1.0.0', privateKey: keys.privateKey });
	assert.deepEqual(first, {
		digest: first.digest,
		name: 'review-tools',
		publisher: 'acme',
		status: 'draft',
		version: '1.0.0',
	});
	assert.match(first.digest, /^sha256:[a-f0-9]{64}$/);

	await assert.rejects(
		uploadPluginRelease({ registry, publisher: 'acme', pluginDirectory: pluginRoot, version: '1.0.0', privateKey: keys.privateKey }),
		error => error.code === 'version-exists' && error.status === 409,
	);

	await stagePluginRelease({ registry, publisher: 'acme', name: 'review-tools', version: '1.0.0', privateKey: keys.privateKey });
	const unpublishedArtifactUrl = `${registry}/v1/publishers/acme/plugins/review-tools/versions/1.0.0/artifact`;
	assert.equal((await fetch(unpublishedArtifactUrl)).status, 404, 'staged artifacts must not be anonymously downloadable');
	await promotePluginRelease({ registry, publisher: 'acme', name: 'review-tools', version: '1.0.0', privateKey: keys.privateKey });

	const firstCatalogResponse = await fetch(`${registry}/v1/marketplace.json`);
	assert.equal(firstCatalogResponse.status, 200);
	const catalogEtag = firstCatalogResponse.headers.get('etag');
	assert.match(catalogEtag, /^"sha256-[a-f0-9]{64}"$/);
	let marketplace = await firstCatalogResponse.json();
	const notModified = await fetch(`${registry}/v1/marketplace.json`, { headers: { 'if-none-match': catalogEtag } });
	assert.equal(notModified.status, 304);
	assert.equal(notModified.headers.get('etag'), catalogEtag, 'catalog ETags must remain stable when state is unchanged');
	assert.equal(marketplace.plugins[0].version, '1.0.0');
	assert.equal(marketplace.plugins[0].source.signature.keyId, keyId);
	assert.equal(marketplace.plugins[0].source.artifactSha256, first.digest.slice('sha256:'.length));
	assert.equal(marketplace.plugins[0].source.publisher.publisherId, 'acme');
	const firstArtifactResponse = await fetch(marketplace.plugins[0].source.url);
	const artifactEtag = firstArtifactResponse.headers.get('etag');
	assert.match(artifactEtag, /^"sha256-[a-f0-9]{64}"$/);
	const firstArtifactBefore = await firstArtifactResponse.text();
	assert.equal((await fetch(marketplace.plugins[0].source.url, { headers: { 'if-none-match': artifactEtag } })).status, 304);

	await writePlugin(pluginRoot, '1.1.0', 'second');
	await uploadPluginRelease({ registry, publisher: 'acme', pluginDirectory: pluginRoot, version: '1.1.0', privateKey: keys.privateKey });
	await stagePluginRelease({ registry, publisher: 'acme', name: 'review-tools', version: '1.1.0', privateKey: keys.privateKey });
	await promotePluginRelease({ registry, publisher: 'acme', name: 'review-tools', version: '1.1.0', privateKey: keys.privateKey });

	marketplace = await getJson(`${registry}/v1/marketplace.json`);
	assert.equal(marketplace.plugins[0].version, '1.1.0');
	const rollback = await rollbackPluginRelease({ registry, publisher: 'acme', name: 'review-tools', version: '1.0.0', privateKey: keys.privateKey });
	assert.deepEqual(rollback, { name: 'review-tools', previousVersion: '1.1.0', status: 'published', version: '1.0.0' });

	marketplace = await getJson(`${registry}/v1/marketplace.json`);
	assert.equal(marketplace.plugins[0].version, '1.0.0');
	const firstArtifactAfter = await (await fetch(marketplace.plugins[0].source.url)).text();
	assert.equal(firstArtifactAfter, firstArtifactBefore, 'rollback must reuse the immutable v1 artifact');
	await assert.rejects(
		rollbackPluginRelease({ registry, publisher: 'acme', name: 'review-tools', version: '1.1.0', privateKey: keys.privateKey }),
		error => error.code === 'rollback-target-not-older' && error.status === 409,
	);
});

test('packaging rejects plugins outside the Agent Plugin manifest contract', async t => {
	const temporary = await mkdtemp(join(tmpdir(), 'openide-plugin-registry-manifest-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	await writeFile(join(temporary, 'plugin.json'), JSON.stringify({
		name: 'unsigned-shape',
		version: '1.0.0',
		description: 'Missing the portable Agent Plugin schema.',
	}));
	await assert.rejects(
		createPluginArtifact(temporary),
		error => error.code === 'manifest-schema-invalid',
	);
});

test('packaging rejects executable files the portable installer cannot preserve', async t => {
	const temporary = await mkdtemp(join(tmpdir(), 'openide-plugin-registry-mode-'));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	await mkdir(join(temporary, 'skills', 'review'), { recursive: true });
	await writePlugin(temporary, '1.0.0', 'portable');
	const script = join(temporary, 'run.sh');
	await writeFile(script, '#!/bin/sh\n');
	await chmod(script, 0o755);
	await assert.rejects(
		createPluginArtifact(temporary),
		error => error.code === 'executable-file-unsupported',
	);
});

test('registry rejects replayed signed control requests', async t => {
	const temporary = await mkdtemp(join(tmpdir(), 'openide-plugin-registry-replay-'));
	const pluginRoot = join(temporary, 'plugin');
	const keys = generateKeyPairSync('ed25519');
	const publicKey = publicKeyBase64Url(keys.publicKey);
	const keyId = publisherKeyId(publicKey);
	const adminToken = 'test-admin-token-at-least-24-characters';
	const { server } = await createRegistryServer({ root: join(temporary, 'registry'), adminToken, logger: { error() { } } });
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	const registry = `http://127.0.0.1:${address.port}`;
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		await rm(temporary, { recursive: true, force: true });
	});

	await mkdir(join(pluginRoot, 'skills', 'review'), { recursive: true });
	await writePlugin(pluginRoot, '2.0.0', 'replay');
	await registerPublisher({ registry, adminToken, publisher: 'acme', displayName: 'Acme', principal: { issuer: 'https://identity.example.test/', subject: 'account-42' }, publicKey });
	await uploadPluginRelease({ registry, publisher: 'acme', pluginDirectory: pluginRoot, version: '2.0.0', privateKey: keys.privateKey });

	const bodyBytes = canonicalBytes({});
	const resource = '/v1/publishers/acme/plugins/review-tools/versions/2.0.0/stage';
	const authorization = createAuthorization({ publisher: 'acme', keyId, privateKey: keys.privateKey, action: 'release:stage', resource, bodyBytes });
	const request = () => fetch(`${registry}${resource}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...authorizationHeaders(authorization) },
		body: bodyBytes,
	});
	assert.equal((await request()).status, 200);
	const replay = await request();
	assert.equal(replay.status, 409);
	assert.equal((await replay.json()).error, 'authorization-replayed');
});

async function writePlugin(pluginRoot, version, skillBody) {
	await Promise.all([
		writeFile(join(pluginRoot, 'plugin.json'), JSON.stringify({
			$schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
			name: 'review-tools',
			version,
			description: 'Signed review workflows',
		}, null, 2)),
		writeFile(join(pluginRoot, 'skills', 'review', 'SKILL.md'), `---\nname: review\ndescription: Review code\n---\n${skillBody}\n`),
	]);
}

async function getJson(url) {
	const response = await fetch(url);
	assert.equal(response.status, 200);
	return response.json();
}
