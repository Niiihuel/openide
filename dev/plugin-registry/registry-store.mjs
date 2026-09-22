/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'node:crypto';
import { access, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	REGISTRY_SCHEMA_VERSION,
	RegistryError,
	canonicalBytes,
	canonicalJson,
	compareVersions,
	compareCodeUnits,
	publisherKeyId,
	readArtifactManifest,
	validateIdentifier,
	validatePublisherIdentifier,
	validateReleaseEnvelope,
	validateVersion,
	verifyAuthorization,
} from './registry-lib.mjs';

const STATE_FILE = 'registry-state.json';
const LOCK_FILE = '.registry-write.lock';
// Keep nonces beyond the complete +/- authorization clock-skew window so a
// future-dated but valid request cannot be replayed as soon as its nonce ages out.
const NONCE_RETENTION_MS = 15 * 60 * 1_000;

function initialState(name) {
	return {
		schemaVersion: REGISTRY_SCHEMA_VERSION,
		name,
		catalogRevision: 0,
		catalogUpdatedAt: new Date(0).toISOString(),
		publishers: {},
		plugins: {},
		nonces: {},
	};
}

export class RegistryStore {
	constructor(root, { name = 'openide-registry' } = {}) {
		this.root = root;
		this.name = validateIdentifier(name, 'registry name');
		this.statePath = join(root, STATE_FILE);
		this.lockPath = join(root, LOCK_FILE);
		this.writeQueue = Promise.resolve();
	}

	async initialize() {
		await mkdir(this.root, { recursive: true });
		try {
			await access(this.statePath);
		} catch {
			await this.#atomicWriteJson(this.statePath, initialState(this.name));
		}
		await this.#withWrite(async state => {
			await this.#reconcileReleases(state);
		});
	}

	async getState() {
		return this.#readState();
	}

	async registerPublisher({ id, displayName, principal, publicKey }) {
		id = validatePublisherIdentifier(id, 'publisher.id');
		if (typeof displayName !== 'string' || !displayName || displayName !== displayName.trim() || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)) {
			throw new RegistryError('invalid-display-name', 'publisher.displayName must be canonical text containing at most 120 characters.');
		}
		principal = validatePrincipal(principal);
		const keyId = publisherKeyId(publicKey);
		return this.#withWrite(async state => {
			const now = new Date().toISOString();
			const existing = state.publishers[id];
			if (existing && canonicalJson(existing.principal) !== canonicalJson(principal)) {
				throw new RegistryError('publisher-principal-conflict', `Publisher '${id}' is already bound to a different authenticated principal.`, 409);
			}
			if (existing?.keys?.[keyId]) {
				return { id, displayName: existing.displayName, keyId, created: false };
			}
			if (existing) {
				if (Object.keys(existing.keys).length >= 32) {
					throw new RegistryError('too-many-publisher-keys', `Publisher '${id}' already has the maximum of 32 registered keys.`, 409);
				}
				existing.keys[keyId] = { algorithm: 'ed25519', publicKey, state: 'active', createdAt: now };
			} else {
				state.publishers[id] = {
					displayName,
					principal,
					createdAt: now,
					keys: { [keyId]: { algorithm: 'ed25519', publicKey, state: 'active', createdAt: now } },
				};
			}
			touchCatalog(state);
			return { id, displayName: state.publishers[id].displayName, keyId, created: true };
		});
	}

	async createRelease(envelope, authorization, bodyBytes) {
		const release = envelope?.release;
		if (!release || typeof release !== 'object') {
			throw new RegistryError('invalid-envelope', 'The release envelope is malformed.');
		}
		const publisher = validatePublisherIdentifier(release.publisherId, 'release.publisherId');
		const name = validateIdentifier(release.pluginId, 'release.pluginId');
		const version = validateVersion(release.version);
		const resource = releaseResource(publisher, name, version);

		return this.#withWrite(async state => {
			const key = this.#authorize(state, authorization, 'release:create', resource, bodyBytes, publisher);
			if (release.signingKeyId !== authorization.keyId) {
				throw new RegistryError('wrong-signing-key', 'The release and request must use the same registered publisher key.', 401);
			}
			validateReleaseEnvelope(envelope, key.publicKey);
			const pluginDirectory = this.#pluginDirectory(publisher, name);
			const releasesDirectory = join(pluginDirectory, 'releases');
			const releaseDirectory = join(releasesDirectory, version);
			if (await exists(releaseDirectory)) {
				throw new RegistryError('version-exists', `Version '${version}' already exists and immutable releases cannot be overwritten.`, 409);
			}

			await mkdir(releasesDirectory, { recursive: true });
			const temporaryDirectory = join(releasesDirectory, `.${version}.tmp-${randomBytes(8).toString('hex')}`);
			await mkdir(temporaryDirectory, { recursive: false });
			try {
				await writeFile(join(temporaryDirectory, 'release.json'), canonicalBytes(release), { flag: 'wx', mode: 0o644 });
				await writeFile(join(temporaryDirectory, 'signature.json'), canonicalBytes(envelope.signature), { flag: 'wx', mode: 0o644 });
				await writeFile(join(temporaryDirectory, 'artifact.json'), canonicalBytes(envelope.artifact), { flag: 'wx', mode: 0o644 });
				await rename(temporaryDirectory, releaseDirectory);
			} catch (error) {
				await rm(temporaryDirectory, { recursive: true, force: true });
				if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
					throw new RegistryError('version-exists', `Version '${version}' already exists and immutable releases cannot be overwritten.`, 409);
				}
				throw error;
			}

			const coordinate = pluginCoordinate(publisher, name);
			const plugin = state.plugins[coordinate] ??= { publisherId: publisher, pluginId: name, currentVersion: null, versions: {}, promotions: [] };
			const manifest = readArtifactManifest(envelope.artifact);
			plugin.versions[version] = {
				status: 'draft',
				createdAt: release.createdAt,
				release,
				signature: envelope.signature,
				description: manifest.description,
			};
			this.#rememberNonce(state, authorization);
			return { publisher, name, version, status: 'draft', digest: `sha256:${release.artifact.sha256}` };
		});
	}

	async stageRelease(publisher, name, version, authorization, bodyBytes) {
		return this.#transition(publisher, name, version, authorization, bodyBytes, 'release:stage', state => {
			if (state.status !== 'draft') {
				throw new RegistryError('invalid-transition', `Only draft releases can be staged; '${version}' is ${state.status}.`, 409);
			}
			state.status = 'staged';
			state.stagedAt = new Date().toISOString();
		});
	}

	async publishRelease(publisher, name, version, authorization, bodyBytes) {
		publisher = validatePublisherIdentifier(publisher, 'publisherId');
		name = validateIdentifier(name, 'name');
		version = validateVersion(version);
		const resource = `${releaseResource(publisher, name, version)}/publish`;
		return this.#withWrite(async state => {
			const plugin = this.#requirePlugin(state, publisher, name);
			this.#authorize(state, authorization, 'release:publish', resource, bodyBytes, publisher);
			const versionState = plugin.versions[version];
			if (!versionState || versionState.status !== 'staged') {
				throw new RegistryError('invalid-transition', `Only staged releases can be published; '${version}' is ${versionState?.status ?? 'missing'}.`, 409);
			}
			if (plugin.currentVersion && compareVersions(version, plugin.currentVersion) <= 0) {
				throw new RegistryError('non-monotonic-publish', `Publishing must advance the stable SemVer beyond '${plugin.currentVersion}'. Use rollback for an older release.`, 409);
			}
			const envelope = await this.#readAndVerifyRelease(state, publisher, name, version);
			versionState.status = 'published';
			versionState.publishedAt = new Date().toISOString();
			plugin.currentVersion = version;
			plugin.promotions.push(createPromotion(plugin, envelope.release, 'publish', versionState.publishedAt));
			touchCatalog(state);
			this.#rememberNonce(state, authorization);
			return { name, version, status: 'published' };
		});
	}

	async rollback(publisher, name, targetVersion, authorization, bodyBytes) {
		publisher = validatePublisherIdentifier(publisher, 'publisherId');
		name = validateIdentifier(name, 'name');
		targetVersion = validateVersion(targetVersion);
		const resource = `/v1/publishers/${publisher}/plugins/${name}/channels/stable/rollback`;
		return this.#withWrite(async state => {
			const plugin = this.#requirePlugin(state, publisher, name);
			this.#authorize(state, authorization, 'release:rollback', resource, bodyBytes, publisher);
			const target = plugin.versions[targetVersion];
			const wasPublished = plugin.promotions.some(entry => entry.version === targetVersion);
			if (!target || target.status !== 'published' || !wasPublished) {
				throw new RegistryError('rollback-target-invalid', `Rollback target '${targetVersion}' was not previously published or is unavailable.`, 409);
			}
			if (plugin.currentVersion === targetVersion) {
				throw new RegistryError('already-current', `Version '${targetVersion}' is already current.`, 409);
			}
			if (!plugin.currentVersion || compareVersions(targetVersion, plugin.currentVersion) >= 0) {
				throw new RegistryError('rollback-target-not-older', `Rollback target '${targetVersion}' must be older than the current stable release.`, 409);
			}
			const envelope = await this.#readAndVerifyRelease(state, publisher, name, targetVersion);
			const previousVersion = plugin.currentVersion;
			plugin.currentVersion = targetVersion;
			const at = new Date().toISOString();
			plugin.promotions.push(createPromotion(plugin, envelope.release, 'rollback', at));
			touchCatalog(state);
			this.#rememberNonce(state, authorization);
			return { name, version: targetVersion, previousVersion, status: 'published' };
		});
	}

	async yankRelease(publisher, name, version, authorization, bodyBytes) {
		return this.#transition(publisher, name, version, authorization, bodyBytes, 'release:yank', (versionState, plugin) => {
			if (plugin.currentVersion === version) {
				throw new RegistryError('cannot-yank-current', 'Publish or roll back to another version before yanking the current release.', 409);
			}
			if (versionState.status !== 'staged' && versionState.status !== 'published') {
				throw new RegistryError('invalid-transition', `Release '${version}' cannot be yanked from ${versionState.status}.`, 409);
			}
			versionState.status = 'yanked';
			versionState.yankedAt = new Date().toISOString();
		});
	}

	async getArtifact(publisher, name, version) {
		publisher = validatePublisherIdentifier(publisher, 'publisherId');
		name = validateIdentifier(name, 'name');
		version = validateVersion(version);
		const state = await this.#readState();
		const plugin = this.#requirePlugin(state, publisher, name);
		const versionState = plugin.versions[version];
		if (!versionState || versionState.status !== 'published') {
			throw new RegistryError('artifact-not-found', 'The requested artifact is not available.', 404);
		}
		return readFile(join(this.#pluginDirectory(publisher, name), 'releases', version, 'artifact.json'));
	}

	async getPlugin(publisher, name) {
		publisher = validatePublisherIdentifier(publisher, 'publisherId');
		name = validateIdentifier(name, 'name');
		const state = await this.#readState();
		const plugin = this.#requirePlugin(state, publisher, name);
		return {
			name,
			publisher,
			currentVersion: plugin.currentVersion,
			versions: Object.fromEntries(Object.entries(plugin.versions).filter(([, value]) => value.status === 'published')),
			promotions: plugin.promotions,
		};
	}

	async buildMarketplace(publicBaseUrl) {
		const base = normalizePublicBaseUrl(publicBaseUrl);
		const state = await this.#readState();
		const plugins = [];
		for (const coordinate of Object.keys(state.plugins).sort()) {
			const pluginState = state.plugins[coordinate];
			if (!pluginState.currentVersion) {
				continue;
			}
			const publisher = pluginState.publisherId;
			const name = pluginState.pluginId;
			const version = pluginState.currentVersion;
			const versionState = pluginState.versions[version];
			if (!versionState?.release || !versionState.signature) {
				throw new RegistryError('release-metadata-missing', `Release '${publisher}/${name}@${version}' lacks catalog metadata.`, 500);
			}
			const release = versionState.release;
			const publisherState = state.publishers[publisher];
			const key = publisherState?.keys?.[release.signingKeyId];
			if (!key) {
				throw new RegistryError('publisher-key-missing', `Signing key '${release.signingKeyId}' is not registered.`, 500);
			}
			plugins.push({
				name: `${publisher}/${name}`,
				description: versionState.description ?? '',
				version,
				publisher,
				source: {
					source: 'registry',
					url: `${base}/v1/publishers/${encodeURIComponent(publisher)}/plugins/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/artifact`,
					artifactSha256: release.artifact.sha256,
					release,
					signature: versionState.signature,
					publisher: publisherIdentity(publisher, publisherState),
				},
			});
		}
		return {
			schemaVersion: REGISTRY_SCHEMA_VERSION,
			name: state.name,
			generatedAt: state.catalogUpdatedAt,
			plugins,
		};
	}

	async #transition(publisher, name, version, authorization, bodyBytes, action, mutate) {
		publisher = validatePublisherIdentifier(publisher, 'publisherId');
		name = validateIdentifier(name, 'name');
		version = validateVersion(version);
		const suffix = action.slice('release:'.length);
		const resource = `${releaseResource(publisher, name, version)}/${suffix}`;
		return this.#withWrite(async state => {
			const plugin = this.#requirePlugin(state, publisher, name);
			this.#authorize(state, authorization, action, resource, bodyBytes, publisher);
			const versionState = plugin.versions[version];
			if (!versionState) {
				throw new RegistryError('release-not-found', `Release '${name}@${version}' does not exist.`, 404);
			}
			await this.#readAndVerifyRelease(state, publisher, name, version);
			mutate(versionState, plugin);
			this.#rememberNonce(state, authorization);
			return { name, version, status: versionState.status };
		});
	}

	#authorize(state, authorization, action, resource, bodyBytes, expectedPublisher) {
		if (authorization.publisher !== expectedPublisher) {
			throw new RegistryError('publisher-mismatch', 'The publisher authorization does not own this plugin.', 403);
		}
		const publisher = state.publishers[authorization.publisher];
		const key = publisher?.keys?.[authorization.keyId];
		if (!key || key.state !== 'active') {
			throw new RegistryError('publisher-key-unknown', 'The publisher or signing key is not registered.', 401);
		}
		verifyAuthorization({ authorization, action, resource, bodyBytes, publicKey: key.publicKey });
		const usedAt = state.nonces[authorization.keyId]?.[authorization.nonce];
		if (usedAt) {
			throw new RegistryError('authorization-replayed', 'This publisher authorization was already used.', 409);
		}
		return key;
	}

	#rememberNonce(state, authorization) {
		const now = Date.now();
		for (const [keyId, nonces] of Object.entries(state.nonces)) {
			for (const [nonce, usedAt] of Object.entries(nonces)) {
				if (now - usedAt > NONCE_RETENTION_MS) {
					delete nonces[nonce];
				}
			}
			if (Object.keys(nonces).length === 0) {
				delete state.nonces[keyId];
			}
		}
		(state.nonces[authorization.keyId] ??= {})[authorization.nonce] = now;
	}

	#requirePlugin(state, publisher, name) {
		const plugin = state.plugins[pluginCoordinate(publisher, name)];
		if (!plugin) {
			throw new RegistryError('plugin-not-found', `Plugin '${publisher}/${name}' does not exist.`, 404);
		}
		return plugin;
	}

	async #readAndVerifyRelease(state, publisher, name, version) {
		const releaseDirectory = join(this.#pluginDirectory(publisher, name), 'releases', version);
		const [release, signature, artifact] = await Promise.all([
			readJson(join(releaseDirectory, 'release.json'), 'release'),
			readJson(join(releaseDirectory, 'signature.json'), 'signature'),
			readJson(join(releaseDirectory, 'artifact.json'), 'artifact'),
		]).catch(error => {
			if (error?.code === 'ENOENT') {
				throw new RegistryError('release-corrupt', `Release '${name}@${version}' is incomplete.`, 500);
			}
			throw error;
		});
		const key = state.publishers[release.publisherId]?.keys?.[release.signingKeyId];
		if (!key || signature.algorithm !== 'ed25519' || signature.keyId !== release.signingKeyId) {
			throw new RegistryError('release-key-invalid', `Release '${name}@${version}' references an unavailable signing key.`, 500);
		}
		return validateReleaseEnvelope({ release, signature, artifact }, key.publicKey);
	}

	#pluginDirectory(publisher, name) {
		return join(this.root, 'publishers', validatePublisherIdentifier(publisher, 'publisherId'), 'plugins', validateIdentifier(name, 'name'));
	}

	async #readState() {
		const state = await readJson(this.statePath, 'registry state');
		if (state.schemaVersion !== REGISTRY_SCHEMA_VERSION || typeof state.name !== 'string' || !state.publishers || !state.plugins || !state.nonces) {
			throw new RegistryError('state-corrupt', 'The registry state file is invalid.', 500);
		}
		return state;
	}

	async #reconcileReleases(state) {
		state.catalogRevision ??= 0;
		state.catalogUpdatedAt ??= new Date(0).toISOString();
		const publishersRoot = join(this.root, 'publishers');
		for (const publisherEntry of await readdir(publishersRoot, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))) {
			if (!publisherEntry.isDirectory()) {
				continue;
			}
			let publisher;
			try {
				publisher = validatePublisherIdentifier(publisherEntry.name, 'publisher directory');
			} catch {
				continue;
			}
			if (!state.publishers[publisher]) {
				continue;
			}
			const pluginsRoot = join(publishersRoot, publisher, 'plugins');
			for (const pluginEntry of await readdir(pluginsRoot, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))) {
				if (!pluginEntry.isDirectory()) {
					continue;
				}
				let name;
				try {
					name = validateIdentifier(pluginEntry.name, 'plugin directory');
				} catch {
					continue;
				}
				const coordinate = pluginCoordinate(publisher, name);
				const plugin = state.plugins[coordinate] ??= { publisherId: publisher, pluginId: name, currentVersion: null, versions: {}, promotions: [] };
				plugin.promotions ??= [];
				for (const releaseEntry of await readdir(join(pluginsRoot, name, 'releases'), { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))) {
					if (!releaseEntry.isDirectory() || releaseEntry.name.startsWith('.')) {
						continue;
					}
					try {
						const version = validateVersion(releaseEntry.name);
						const envelope = await this.#readAndVerifyRelease(state, publisher, name, version);
						const manifest = readArtifactManifest(envelope.artifact);
						plugin.versions[version] ??= {
							status: 'draft',
							createdAt: envelope.release.createdAt,
							release: envelope.release,
							signature: envelope.signature,
							description: manifest.description,
						};
					} catch {
						// Invalid release directories remain quarantined and never enter the index.
					}
				}
			}
		}
	}

	async #withWrite(operation) {
		const run = async () => {
			await mkdir(this.root, { recursive: true });
			const lock = await this.#acquireWriteLock();
			try {
				const state = await this.#readState();
				const result = await operation(state);
				await this.#atomicWriteJson(this.statePath, state);
				return result;
			} finally {
				await lock.close();
				await unlink(this.lockPath).catch(() => undefined);
			}
		};
		const queued = this.writeQueue.then(run, run);
		this.writeQueue = queued.then(() => undefined, () => undefined);
		return queued;
	}

	async #acquireWriteLock() {
		for (let attempt = 0; attempt < 2; attempt++) {
			let handle;
			try {
				handle = await open(this.lockPath, 'wx', 0o600);
				try {
					await handle.writeFile(`${canonicalJson({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
					await handle.sync();
					return handle;
				} catch (error) {
					await handle.close().catch(() => undefined);
					await unlink(this.lockPath).catch(() => undefined);
					throw error;
				}
			} catch (error) {
				if (error?.code !== 'EEXIST') {
					throw error;
				}
			}

			if (!await this.#isWriteLockStale()) {
				throw new RegistryError('registry-busy', 'Another registry writer is active; retry the request.', 503);
			}
			const quarantined = `${this.lockPath}.stale-${process.pid}-${randomBytes(8).toString('hex')}`;
			try {
				await rename(this.lockPath, quarantined);
				await rm(quarantined, { force: true });
			} catch (error) {
				if (error?.code !== 'ENOENT') {
					throw new RegistryError('registry-busy', 'Another registry writer is recovering the registry lock; retry the request.', 503);
				}
			}
		}
		throw new RegistryError('registry-busy', 'Another registry writer is active; retry the request.', 503);
	}

	async #isWriteLockStale() {
		try {
			const metadata = JSON.parse(await readFile(this.lockPath, 'utf8'));
			if (!Number.isSafeInteger(metadata?.pid) || metadata.pid <= 0 || typeof metadata.createdAt !== 'string') {
				throw new Error('invalid lock metadata');
			}
			try {
				process.kill(metadata.pid, 0);
				return false;
			} catch (error) {
				return error?.code === 'ESRCH';
			}
		} catch {
			// An acquiring writer can briefly expose an empty lock before metadata
			// is flushed. Only recover malformed locks after a conservative delay.
			const lockStat = await stat(this.lockPath).catch(() => undefined);
			return !!lockStat && Date.now() - lockStat.mtimeMs > 60_000;
		}
	}

	async #atomicWriteJson(path, value) {
		const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
		try {
			await writeFile(temporary, `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 });
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true }).catch(() => undefined);
		}
	}
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function readJson(path, label) {
	let raw;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		throw error;
	}
	try {
		return JSON.parse(raw);
	} catch {
		throw new RegistryError('invalid-json', `${label} is not valid JSON.`, 500);
	}
}

function normalizePublicBaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new RegistryError('invalid-public-url', 'The registry public URL is invalid.', 500);
	}
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
		throw new RegistryError('invalid-public-url', 'The registry public URL must be an HTTP(S) origin or base path without credentials, query, or fragment.', 500);
	}
	const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1';
	if (url.protocol !== 'https:' && !isLoopback) {
		throw new RegistryError('insecure-public-url', 'Remote registry public URLs must use HTTPS. Plain HTTP is allowed only on loopback.', 500);
	}
	return url.toString().replace(/\/$/, '');
}

function validatePrincipal(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'issuer,subject') {
		throw new RegistryError('invalid-principal', 'publisher.principal must contain issuer and subject.');
	}
	let issuer;
	try {
		issuer = new URL(value.issuer);
	} catch {
		throw new RegistryError('invalid-principal', 'publisher.principal.issuer must be a canonical HTTPS URL.');
	}
	if (typeof value.issuer !== 'string' || value.issuer.length > 512 || issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.toString() !== value.issuer || typeof value.subject !== 'string' || !value.subject || value.subject.length > 256 || /[\u0000-\u001f\u007f]/.test(value.subject)) {
		throw new RegistryError('invalid-principal', 'publisher.principal is invalid.');
	}
	return { issuer: value.issuer, subject: value.subject };
}

function pluginCoordinate(publisher, name) {
	return `${validatePublisherIdentifier(publisher, 'publisherId')}/${validateIdentifier(name, 'pluginId')}`;
}

function releaseResource(publisher, name, version) {
	return `/v1/publishers/${publisher}/plugins/${name}/versions/${version}`;
}

function publisherIdentity(publisherId, state) {
	return {
		schemaVersion: 1,
		publisherId,
		displayName: state.displayName,
		principal: state.principal,
		keys: Object.entries(state.keys)
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.map(([keyId, key]) => ({
				keyId,
				algorithm: 'ed25519',
				publicKey: key.publicKey,
				state: key.state,
				createdAt: key.createdAt,
				...(key.revokedAt ? { revokedAt: key.revokedAt } : {}),
			})),
	};
}

function createPromotion(plugin, release, kind, promotedAt) {
	const previous = plugin.promotions.at(-1);
	return {
		schemaVersion: 1,
		sequence: plugin.promotions.length + 1,
		publisherId: release.publisherId,
		pluginId: release.pluginId,
		channel: 'stable',
		version: release.version,
		artifactSha256: release.artifact.sha256,
		kind,
		promotedAt,
		...(previous ? { previous: { version: previous.version, artifactSha256: previous.artifactSha256 } } : {}),
	};
}

function touchCatalog(state) {
	state.catalogRevision = (state.catalogRevision ?? 0) + 1;
	state.catalogUpdatedAt = new Date().toISOString();
}
