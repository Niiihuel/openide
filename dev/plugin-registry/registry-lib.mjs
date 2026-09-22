/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, timingSafeEqual, verify } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, posix, relative, resolve, sep } from 'node:path';

export const REGISTRY_SCHEMA_VERSION = 1;
export const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
export const MAX_ARTIFACT_FILES = 1_000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_AUTH_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const PUBLISHER_IDENTIFIER = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function compareCodeUnits(left, right) {
	return left === right ? 0 : left < right ? -1 : 1;
}

export class RegistryError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.name = 'RegistryError';
		this.code = code;
		this.status = status;
	}
}

export function canonicalJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new RegistryError('invalid-number', 'Canonical JSON does not support non-finite numbers.');
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value)
			.filter(([, child]) => child !== undefined)
			.sort(([left], [right]) => compareCodeUnits(left, right));
		return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
	}
	throw new RegistryError('invalid-json-value', `Canonical JSON cannot encode ${typeof value}.`);
}

export function canonicalBytes(value) {
	return Buffer.from(canonicalJson(value), 'utf8');
}

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function validateIdentifier(value, field) {
	if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
		throw new RegistryError('invalid-identifier', `${field} must be a lowercase identifier containing only letters, numbers, dot, dash, or underscore.`);
	}
	return value;
}

export function validatePublisherIdentifier(value, field) {
	if (typeof value !== 'string' || !PUBLISHER_IDENTIFIER.test(value)) {
		throw new RegistryError('invalid-publisher-identifier', `${field} must be a lowercase publisher identifier containing only letters, numbers, dot, or dash.`);
	}
	return value;
}

export function validateVersion(value) {
	if (typeof value !== 'string' || value.includes('+') || !SEMVER.test(value)) {
		throw new RegistryError('invalid-version', 'version must be canonical SemVer without build metadata.');
	}
	return value;
}

/** SemVer precedence for canonical versions accepted by {@link validateVersion}. */
export function compareVersions(left, right) {
	left = validateVersion(left);
	right = validateVersion(right);
	const parse = value => {
		const match = SEMVER.exec(value);
		return {
			core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
			prerelease: match[4]?.split('.'),
		};
	};
	const leftVersion = parse(left);
	const rightVersion = parse(right);
	for (let index = 0; index < leftVersion.core.length; index++) {
		if (leftVersion.core[index] !== rightVersion.core[index]) {
			return leftVersion.core[index] < rightVersion.core[index] ? -1 : 1;
		}
	}
	if (!leftVersion.prerelease || !rightVersion.prerelease) {
		return leftVersion.prerelease ? -1 : rightVersion.prerelease ? 1 : 0;
	}
	for (let index = 0; index < Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length); index++) {
		const leftIdentifier = leftVersion.prerelease[index];
		const rightIdentifier = rightVersion.prerelease[index];
		if (leftIdentifier === undefined || rightIdentifier === undefined) {
			return leftIdentifier === undefined ? -1 : 1;
		}
		if (leftIdentifier === rightIdentifier) {
			continue;
		}
		const leftNumeric = /^\d+$/.test(leftIdentifier);
		const rightNumeric = /^\d+$/.test(rightIdentifier);
		if (leftNumeric && rightNumeric) {
			return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
		}
		if (leftNumeric !== rightNumeric) {
			return leftNumeric ? -1 : 1;
		}
		return compareCodeUnits(leftIdentifier, rightIdentifier);
	}
	return 0;
}

export function validateArtifactPath(value) {
	if (typeof value !== 'string' || !value || value.length > 1024 || value !== value.normalize('NFC') || value.includes('\\') || value.startsWith('/') || value.endsWith('/') || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new RegistryError('invalid-path', `Invalid artifact path '${String(value)}'.`);
	}
	const normalized = posix.normalize(value);
	if (normalized !== value || normalized === '.' || normalized.startsWith('../') || value.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.length > 255 || /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || WINDOWS_RESERVED_FILE_NAME.test(segment))) {
		throw new RegistryError('invalid-path', `Artifact path '${value}' is unsafe or not portable.`);
	}
	return value;
}

export function publicKeyBase64Url(key) {
	const publicKey = key && typeof key === 'object' && key.type === 'public' ? key : createPublicKey(key);
	if (publicKey.asymmetricKeyType !== 'ed25519') {
		throw new RegistryError('invalid-key', 'Publisher keys must use Ed25519.');
	}
	const exported = publicKey.export({ format: 'jwk' });
	if (exported.kty !== 'OKP' || exported.crv !== 'Ed25519' || typeof exported.x !== 'string') {
		throw new RegistryError('invalid-key', 'The Ed25519 public key could not be exported.');
	}
	decodeBase64Url(exported.x, 'publicKey', 32);
	return exported.x;
}

export function publisherKeyId(publicKey) {
	return `sha256:${sha256(decodeBase64Url(publicKey, 'publicKey', 32))}`;
}

export function signCanonical(value, privateKey) {
	const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey) ? createPrivateKey(privateKey) : privateKey;
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new RegistryError('invalid-key', 'Publisher keys must use Ed25519.');
	}
	return sign(null, canonicalBytes(value), key).toString('base64url');
}

export function verifyCanonical(value, signature, publicKey) {
	const signatureBytes = decodeBase64Url(signature, 'signature', 64);
	if (signatureBytes.length !== 64) {
		return false;
	}
	try {
		const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
		return key.asymmetricKeyType === 'ed25519' && verify(null, canonicalBytes(value), key, signatureBytes);
	} catch {
		return false;
	}
}

export function safeTokenEquals(actual, expected) {
	if (typeof actual !== 'string' || typeof expected !== 'string') {
		return false;
	}
	const actualHash = Buffer.from(sha256(actual));
	const expectedHash = Buffer.from(sha256(expected));
	return timingSafeEqual(actualHash, expectedHash);
}

export function createAuthorization({ publisher, keyId, privateKey, action, resource, bodyBytes, timestamp = new Date().toISOString(), nonce = randomBytes(18).toString('base64url') }) {
	const payload = {
		action,
		bodySha256: sha256(bodyBytes),
		keyId,
		nonce,
		publisher,
		resource,
		timestamp,
	};
	return {
		...payload,
		signature: signCanonical(payload, privateKey),
	};
}

export function verifyAuthorization({ authorization, action, resource, bodyBytes, publicKey, now = Date.now() }) {
	if (!authorization || typeof authorization !== 'object') {
		throw new RegistryError('missing-authorization', 'A signed publisher authorization is required.', 401);
	}
	const { publisher, keyId, timestamp, nonce, bodySha256, signature } = authorization;
	validatePublisherIdentifier(publisher, 'authorization.publisher');
	if (typeof keyId !== 'string' || !keyId || typeof timestamp !== 'string' || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || typeof signature !== 'string') {
		throw new RegistryError('invalid-authorization', 'The publisher authorization is malformed.', 401);
	}
	const timestampMs = Date.parse(timestamp);
	if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > MAX_AUTH_CLOCK_SKEW_MS) {
		throw new RegistryError('expired-authorization', 'The publisher authorization timestamp is outside the allowed clock skew.', 401);
	}
	const expectedBodySha256 = sha256(bodyBytes);
	if (bodySha256 !== expectedBodySha256) {
		throw new RegistryError('authorization-body-mismatch', 'The publisher authorization does not match the request body.', 401);
	}
	if (action !== authorization.action) {
		throw new RegistryError('authorization-action-mismatch', 'The publisher authorization does not match the request action.', 401);
	}
	if (resource !== authorization.resource) {
		throw new RegistryError('authorization-resource-mismatch', 'The publisher authorization does not match the request resource.', 401);
	}
	const payload = { action, bodySha256, keyId, nonce, publisher, resource, timestamp };
	if (!verifyCanonical(payload, signature, publicKey)) {
		throw new RegistryError('bad-authorization-signature', 'The publisher authorization signature is invalid.', 401);
	}
	return payload;
}

export function parseAuthorizationHeaders(headers) {
	return {
		action: headers['x-openide-action'],
		bodySha256: headers['x-openide-content-sha256'],
		keyId: headers['x-openide-key-id'],
		nonce: headers['x-openide-nonce'],
		publisher: headers['x-openide-publisher'],
		resource: headers['x-openide-resource'],
		signature: headers['x-openide-signature'],
		timestamp: headers['x-openide-timestamp'],
	};
}

export function authorizationHeaders(authorization) {
	return {
		'x-openide-action': authorization.action,
		'x-openide-content-sha256': authorization.bodySha256,
		'x-openide-key-id': authorization.keyId,
		'x-openide-nonce': authorization.nonce,
		'x-openide-publisher': authorization.publisher,
		'x-openide-resource': authorization.resource,
		'x-openide-signature': authorization.signature,
		'x-openide-timestamp': authorization.timestamp,
	};
}

export async function createPluginArtifact(pluginDirectory) {
	const root = resolve(pluginDirectory);
	const rootStat = await lstat(root).catch(() => undefined);
	if (!rootStat?.isDirectory()) {
		throw new RegistryError('plugin-not-found', `Plugin directory '${pluginDirectory}' does not exist.`);
	}

	const files = [];
	let totalContentBytes = 0;
	const visit = async directory => {
		const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareCodeUnits(left.name, right.name));
		for (const entry of entries) {
			if (entry.name === '.git' || entry.name === '.DS_Store') {
				continue;
			}
			const absolute = join(directory, entry.name);
			const stat = await lstat(absolute);
			if (stat.isSymbolicLink()) {
				throw new RegistryError('symlink-not-allowed', `Symbolic links are not allowed in plugin artifacts: ${absolute}`);
			}
			if (stat.isDirectory()) {
				await visit(absolute);
				continue;
			}
			if (!stat.isFile()) {
				throw new RegistryError('special-file-not-allowed', `Only regular files are allowed in plugin artifacts: ${absolute}`);
			}
			if ((stat.mode & 0o111) !== 0) {
				throw new RegistryError('executable-file-unsupported', `Executable files are not supported by portable registry installs: ${absolute}. Invoke scripts through an explicit interpreter instead.`);
			}
			if (stat.size > MAX_FILE_BYTES) {
				throw new RegistryError('file-too-large', `Plugin file '${absolute}' exceeds ${MAX_FILE_BYTES} bytes.`);
			}
			if (files.length >= MAX_ARTIFACT_FILES) {
				throw new RegistryError('too-many-files', `Plugin artifacts may contain at most ${MAX_ARTIFACT_FILES} files.`);
			}
			const path = validateArtifactPath(relative(root, absolute).split(sep).join('/'));
			const contents = await readFile(absolute);
			totalContentBytes += contents.length;
			if (totalContentBytes > MAX_ARTIFACT_BYTES) {
				throw new RegistryError('artifact-too-large', `Plugin artifact content exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
			}
			files.push({
				path,
				mode: 0o644,
				size: contents.length,
				sha256: sha256(contents),
				content: contents.toString('base64'),
			});
		}
	};
	await visit(root);

	const artifact = { schemaVersion: REGISTRY_SCHEMA_VERSION, files };
	validateArtifact(artifact);
	const manifestEntry = files.find(file => file.path === 'plugin.json');
	if (!manifestEntry) {
		throw new RegistryError('manifest-missing', `Plugin '${basename(root)}' must contain a root plugin.json.`);
	}
	let manifest;
	try {
		manifest = JSON.parse(Buffer.from(manifestEntry.content, 'base64').toString('utf8'));
	} catch {
		throw new RegistryError('manifest-invalid', 'plugin.json is not valid JSON.');
	}
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new RegistryError('manifest-invalid', 'plugin.json must contain a JSON object.');
	}
	const parsedManifest = validateAgentPluginManifest(manifest);
	return {
		artifact,
		manifest: parsedManifest,
		bytes: canonicalBytes(artifact),
	};
}

export function validateArtifact(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(value.files)) {
		throw new RegistryError('invalid-artifact', 'The artifact does not use the supported schema.');
	}
	if (value.files.length === 0 || value.files.length > MAX_ARTIFACT_FILES) {
		throw new RegistryError('invalid-artifact', `The artifact must contain between 1 and ${MAX_ARTIFACT_FILES} files.`);
	}
	let total = 0;
	let previousPath = '';
	const seen = new Set();
	const portablePaths = new Set();
	for (const file of value.files) {
		if (!file || typeof file !== 'object' || Array.isArray(file)) {
			throw new RegistryError('invalid-artifact-file', 'Every artifact file entry must be an object.');
		}
		const keys = Object.keys(file).sort();
		if (keys.join(',') !== 'content,mode,path,sha256,size') {
			throw new RegistryError('invalid-artifact-file', 'Artifact file entries contain unsupported fields.');
		}
		const path = validateArtifactPath(file.path);
		const portablePath = path.toLowerCase();
		if (seen.has(path) || portablePaths.has(portablePath) || compareCodeUnits(previousPath, path) >= 0) {
			throw new RegistryError('invalid-artifact-order', 'Artifact files must be unique and sorted by path.');
		}
		for (const parentPath of path.split('/').slice(0, -1).map((_, index, segments) => segments.slice(0, index + 1).join('/'))) {
			if (portablePaths.has(parentPath.toLowerCase())) {
				throw new RegistryError('invalid-path-conflict', `Artifact file '${path}' conflicts with file '${parentPath}'.`);
			}
		}
		seen.add(path);
		portablePaths.add(portablePath);
		previousPath = path;
		if (file.mode !== 0o644) {
			throw new RegistryError('invalid-file-mode', `Artifact file '${path}' must use portable mode 0644.`);
		}
		if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES || typeof file.sha256 !== 'string' || !SHA256.test(file.sha256) || typeof file.content !== 'string') {
			throw new RegistryError('invalid-artifact-file', `Artifact file '${path}' has invalid metadata.`);
		}
		const contents = decodeBase64(file.content, `files[${path}].content`);
		if (contents.length !== file.size || sha256(contents) !== file.sha256) {
			throw new RegistryError('artifact-file-integrity', `Artifact file '${path}' does not match its declared size or SHA-256.`);
		}
		total += contents.length;
		if (total > MAX_ARTIFACT_BYTES) {
			throw new RegistryError('artifact-too-large', `Plugin artifact content exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
		}
	}
	if (!seen.has('plugin.json')) {
		throw new RegistryError('manifest-missing', 'The artifact does not contain a root plugin.json.');
	}
	return value;
}

export function readArtifactManifest(artifact) {
	validateArtifact(artifact);
	const manifestEntry = artifact.files.find(file => file.path === 'plugin.json');
	let manifest;
	try {
		manifest = JSON.parse(Buffer.from(manifestEntry.content, 'base64').toString('utf8'));
	} catch {
		throw new RegistryError('manifest-invalid', 'plugin.json is not valid JSON.');
	}
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new RegistryError('manifest-invalid', 'plugin.json must contain a JSON object.');
	}
	return validateAgentPluginManifest(manifest);
}

function validateAgentPluginManifest(manifest) {
	if (typeof manifest.$schema !== 'string' || !/^https:\/\/agent-plugins\.org\/schemas\/[^/]+\/plugin\.schema\.json$/.test(manifest.$schema)) {
		throw new RegistryError('manifest-schema-invalid', 'plugin.json must declare an Agent Plugins schema from agent-plugins.org.');
	}
	const name = validateIdentifier(manifest.name, 'plugin.json.name');
	const version = validateVersion(manifest.version);
	if (manifest.description !== undefined && typeof manifest.description !== 'string') {
		throw new RegistryError('manifest-description-invalid', 'plugin.json.description must be a string when provided.');
	}
	return { name, version, description: manifest.description ?? '' };
}

export function createRelease({ publisherId, pluginId, version, artifactBytes, keyId, createdAt = new Date().toISOString(), mediaType = 'application/vnd.openide.plugin+json' }) {
	validatePublisherIdentifier(publisherId, 'publisherId');
	validateIdentifier(pluginId, 'pluginId');
	validateVersion(version);
	if (typeof keyId !== 'string' || !keyId) {
		throw new RegistryError('invalid-key-id', 'keyId is required.');
	}
	if (typeof mediaType !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(mediaType)) {
		throw new RegistryError('invalid-media-type', 'mediaType must be a canonical media type without parameters.');
	}
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime()) || date.toISOString() !== createdAt) {
		throw new RegistryError('invalid-date', 'createdAt must be canonical UTC ISO-8601.');
	}
	return {
		schemaVersion: REGISTRY_SCHEMA_VERSION,
		publisherId,
		pluginId,
		version,
		signingKeyId: keyId,
		createdAt,
		artifact: {
			mediaType,
			sha256: sha256(artifactBytes),
			size: artifactBytes.length,
		},
	};
}

export function validateRelease(release) {
	if (!release || typeof release !== 'object' || Array.isArray(release)) {
		throw new RegistryError('invalid-release', 'release must be an object.');
	}
	const keys = Object.keys(release).sort();
	if (keys.join(',') !== 'artifact,createdAt,pluginId,publisherId,schemaVersion,signingKeyId,version') {
		throw new RegistryError('invalid-release', 'release contains unsupported or missing fields.');
	}
	if (release.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
		throw new RegistryError('unsupported-schema', 'release schemaVersion is not supported.');
	}
	validatePublisherIdentifier(release.publisherId, 'release.publisherId');
	validateIdentifier(release.pluginId, 'release.pluginId');
	validateVersion(release.version);
	if (typeof release.signingKeyId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(release.signingKeyId)) {
		throw new RegistryError('invalid-release', 'release signingKeyId is invalid.');
	}
	const date = new Date(release.createdAt);
	if (Number.isNaN(date.getTime()) || date.toISOString() !== release.createdAt) {
		throw new RegistryError('invalid-date', 'release.createdAt must be canonical UTC ISO-8601.');
	}
	if (!release.artifact || typeof release.artifact !== 'object' || Array.isArray(release.artifact) || Object.keys(release.artifact).sort().join(',') !== 'mediaType,sha256,size' || typeof release.artifact.mediaType !== 'string' || !/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(release.artifact.mediaType) || !SHA256.test(release.artifact.sha256) || !Number.isSafeInteger(release.artifact.size) || release.artifact.size <= 0) {
		throw new RegistryError('invalid-release-artifact', 'release.artifact metadata is invalid.');
	}
	return release;
}

export function validateReleaseEnvelope(envelope, publicKey) {
	if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !envelope.artifact || !envelope.release || !envelope.signature || typeof envelope.signature !== 'object') {
		throw new RegistryError('invalid-envelope', 'The release envelope is malformed.');
	}
	validateArtifact(envelope.artifact);
	validateRelease(envelope.release);
	const artifactBytes = canonicalBytes(envelope.artifact);
	if (artifactBytes.length !== envelope.release.artifact.size || sha256(artifactBytes) !== envelope.release.artifact.sha256) {
		throw new RegistryError('artifact-integrity', 'The artifact does not match the signed release metadata.');
	}
	if (envelope.signature.algorithm !== 'ed25519' || envelope.signature.keyId !== envelope.release.signingKeyId || !verifyPluginReleaseSignature(envelope.release, envelope.signature.signature, publicKey)) {
		throw new RegistryError('bad-release-signature', 'The release signature is invalid.', 401);
	}
	const manifest = readArtifactManifest(envelope.artifact);
	if (manifest.name !== envelope.release.pluginId) {
		throw new RegistryError('manifest-name-mismatch', 'plugin.json.name does not match release.pluginId.');
	}
	if (manifest.version !== undefined && manifest.version !== envelope.release.version) {
		throw new RegistryError('manifest-version-mismatch', 'plugin.json.version does not match release.version.');
	}
	return envelope;
}

export function canonicalPluginReleasePayload(release) {
	validateRelease(release);
	return JSON.stringify([
		'openide.plugin-release.v1',
		release.schemaVersion,
		release.publisherId,
		release.pluginId,
		release.version,
		release.signingKeyId,
		release.createdAt,
		release.artifact.mediaType,
		release.artifact.size,
		release.artifact.sha256,
	]);
}

export function signPluginRelease(release, privateKey) {
	const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey) ? createPrivateKey(privateKey) : privateKey;
	if (key.asymmetricKeyType !== 'ed25519') {
		throw new RegistryError('invalid-key', 'Publisher keys must use Ed25519.');
	}
	return {
		algorithm: 'ed25519',
		keyId: release.signingKeyId,
		signature: sign(null, Buffer.from(canonicalPluginReleasePayload(release), 'utf8'), key).toString('base64url'),
	};
}

export function verifyPluginReleaseSignature(release, signature, publicKey) {
	let key;
	try {
		key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
	} catch {
		return false;
	}
	return verify(null, Buffer.from(canonicalPluginReleasePayload(release), 'utf8'), key, decodeBase64Url(signature, 'signature', 64));
}

export function decodeBase64(value, field) {
	if (typeof value !== 'string' || !BASE64.test(value)) {
		throw new RegistryError('invalid-base64', `${field} must be canonical base64.`);
	}
	const decoded = Buffer.from(value, 'base64');
	if (decoded.toString('base64') !== value) {
		throw new RegistryError('invalid-base64', `${field} must be canonical base64.`);
	}
	return decoded;
}

export function decodeBase64Url(value, field, expectedLength) {
	if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new RegistryError('invalid-base64url', `${field} must be unpadded canonical base64url.`);
	}
	const decoded = Buffer.from(value, 'base64url');
	if (decoded.toString('base64url') !== value || expectedLength !== undefined && decoded.length !== expectedLength) {
		throw new RegistryError('invalid-base64url', `${field} must be unpadded canonical base64url${expectedLength === undefined ? '' : ` of ${expectedLength} bytes`}.`);
	}
	return decoded;
}
