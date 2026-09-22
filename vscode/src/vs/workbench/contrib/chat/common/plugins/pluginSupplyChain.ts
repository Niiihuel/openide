/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, encodeHex, VSBuffer } from '../../../../../base/common/buffer.js';
import * as semver from '../../../../../base/common/semver/semver.js';

const PUBLISHER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const CHANNEL_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const KEY_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RELEASE_PAYLOAD_DOMAIN = 'openide.plugin-release.v1';

export type PluginReleaseState = 'draft' | 'staged' | 'published' | 'yanked';
export type PluginReleasePromotionKind = 'publish' | 'rollback';
export type PluginPublisherKeyState = 'active' | 'revoked';

export type PluginSupplyChainErrorCode =
	| 'bad-signature'
	| 'crypto-unavailable'
	| 'invalid-date'
	| 'invalid-digest'
	| 'invalid-field'
	| 'invalid-history'
	| 'invalid-key'
	| 'invalid-promotion'
	| 'invalid-shape'
	| 'invalid-transition'
	| 'invalid-version'
	| 'revoked-key'
	| 'unknown-field'
	| 'version-conflict'
	| 'wrong-publisher';

export class PluginSupplyChainError extends Error {
	constructor(readonly code: PluginSupplyChainErrorCode, message: string) {
		super(message);
		this.name = 'PluginSupplyChainError';
	}
}

export interface IPluginPublisherPrincipal {
	readonly issuer: string;
	readonly subject: string;
}

export interface IPluginPublisherKey {
	/** Self-certifying identifier: `sha256:` plus the SHA-256 of the raw public key. */
	readonly keyId: string;
	readonly algorithm: 'ed25519';
	/** Unpadded base64url encoding of the 32-byte raw Ed25519 public key. */
	readonly publicKey: string;
	readonly state: PluginPublisherKeyState;
	readonly createdAt: string;
	readonly revokedAt?: string;
}

export interface IPluginPublisherIdentity {
	readonly schemaVersion: 1;
	readonly publisherId: string;
	readonly displayName: string;
	/** Authenticated registry principal which owns the publisher namespace. */
	readonly principal: IPluginPublisherPrincipal;
	readonly keys: readonly IPluginPublisherKey[];
}

export interface IPluginReleaseArtifact {
	readonly mediaType: string;
	readonly size: number;
	/** Lowercase hexadecimal SHA-256 of the exact uploaded artifact bytes. */
	readonly sha256: string;
}

/**
 * Immutable release identity. Mutable publication state and channel pointers are
 * deliberately kept outside this signed manifest.
 */
export interface IPluginReleaseManifest {
	readonly schemaVersion: 1;
	readonly publisherId: string;
	readonly pluginId: string;
	/** Canonical SemVer without build metadata, so registry coordinates are unambiguous. */
	readonly version: string;
	readonly signingKeyId: string;
	readonly createdAt: string;
	readonly artifact: IPluginReleaseArtifact;
}

export interface IPluginReleaseSignature {
	readonly algorithm: 'ed25519';
	readonly keyId: string;
	/** Unpadded base64url encoding of the 64-byte Ed25519 signature. */
	readonly signature: string;
}

export interface IPluginReleaseRecord {
	readonly manifest: IPluginReleaseManifest;
	readonly signature: IPluginReleaseSignature;
	readonly state: PluginReleaseState;
	readonly stateChangedAt: string;
}

export interface IPluginReleasePromotionTarget {
	readonly version: string;
	readonly artifactSha256: string;
}

/** Append-only channel event. A rollback appends another event targeting a prior release. */
export interface IPluginReleasePromotion extends IPluginReleasePromotionTarget {
	readonly schemaVersion: 1;
	readonly sequence: number;
	readonly publisherId: string;
	readonly pluginId: string;
	readonly channel: string;
	readonly kind: PluginReleasePromotionKind;
	readonly promotedAt: string;
	readonly previous?: IPluginReleasePromotionTarget;
}

type PluginBinary = ArrayBuffer | ArrayBufferView | VSBuffer;

function fail(code: PluginSupplyChainErrorCode, message: string): never {
	throw new PluginSupplyChainError(code, message);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return fail('invalid-shape', `${field} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			fail('unknown-field', `${field}.${key} is not allowed.`);
		}
	}
}

function requiredString(value: unknown, field: string, maxLength = 256): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
		return fail('invalid-field', `${field} must be non-empty text without control characters.`);
	}
	return value;
}

function canonicalTimestamp(value: unknown, field: string): string {
	const timestamp = requiredString(value, field, 24);
	const parsed = new Date(timestamp);
	if (!CANONICAL_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
		return fail('invalid-date', `${field} must be a canonical UTC timestamp.`);
	}
	return timestamp;
}

function publisherId(value: unknown, field: string): string {
	const id = requiredString(value, field, 128);
	if (!PUBLISHER_ID_PATTERN.test(id)) {
		return fail('invalid-field', `${field} is not a canonical publisher identifier.`);
	}
	return id;
}

function pluginId(value: unknown, field: string): string {
	const id = requiredString(value, field, 128);
	if (!PLUGIN_ID_PATTERN.test(id)) {
		return fail('invalid-field', `${field} is not a canonical plugin identifier.`);
	}
	return id;
}

function releaseVersion(value: unknown, field: string): string {
	const version = requiredString(value, field, 128);
	if (version.includes('+') || semver.valid(version) !== version) {
		return fail('invalid-version', `${field} must be canonical SemVer without build metadata.`);
	}
	return version;
}

function keyId(value: unknown, field: string): string {
	const id = requiredString(value, field, 71);
	if (!KEY_ID_PATTERN.test(id)) {
		return fail('invalid-key', `${field} must be a SHA-256 key identifier.`);
	}
	return id;
}

function sha256(value: unknown, field: string): string {
	const digest = requiredString(value, field, 64);
	if (!SHA256_PATTERN.test(digest)) {
		return fail('invalid-digest', `${field} must be a lowercase hexadecimal SHA-256 digest.`);
	}
	return digest;
}

function channel(value: unknown, field: string): string {
	const parsed = requiredString(value, field, 64);
	if (!CHANNEL_PATTERN.test(parsed)) {
		return fail('invalid-field', `${field} is not a canonical channel name.`);
	}
	return parsed;
}

function decodeCanonicalBase64Url(value: unknown, field: string, byteLength: number): Uint8Array<ArrayBuffer> {
	const encoded = requiredString(value, field, Math.ceil(byteLength * 4 / 3));
	if (!BASE64_URL_PATTERN.test(encoded)) {
		return fail('invalid-key', `${field} must be unpadded base64url.`);
	}
	let decoded: VSBuffer;
	try {
		decoded = decodeBase64(encoded);
	} catch {
		return fail('invalid-key', `${field} is not valid base64url.`);
	}
	if (decoded.byteLength !== byteLength || encodeBase64(decoded, false, true) !== encoded) {
		return fail('invalid-key', `${field} is not canonical base64url of ${byteLength} bytes.`);
	}
	return new Uint8Array(decoded.buffer);
}

function parsePrincipal(value: unknown): IPluginPublisherPrincipal {
	const principal = asObject(value, 'publisher.principal');
	exactKeys(principal, ['issuer', 'subject'], 'publisher.principal');
	const issuer = requiredString(principal.issuer, 'publisher.principal.issuer', 512);
	let parsedIssuer: URL;
	try {
		parsedIssuer = new URL(issuer);
	} catch {
		return fail('invalid-field', 'publisher.principal.issuer must be a canonical HTTPS URL.');
	}
	if (parsedIssuer.protocol !== 'https:' || parsedIssuer.username || parsedIssuer.password || parsedIssuer.search || parsedIssuer.hash || parsedIssuer.toString() !== issuer) {
		return fail('invalid-field', 'publisher.principal.issuer must be a canonical HTTPS URL.');
	}
	return Object.freeze({
		issuer,
		subject: requiredString(principal.subject, 'publisher.principal.subject'),
	});
}

function parsePublisherKey(value: unknown, index: number): IPluginPublisherKey {
	const field = `publisher.keys[${index}]`;
	const key = asObject(value, field);
	exactKeys(key, ['keyId', 'algorithm', 'publicKey', 'state', 'createdAt', 'revokedAt'], field);
	if (key.algorithm !== 'ed25519') {
		fail('invalid-key', `${field}.algorithm must be ed25519.`);
	}
	decodeCanonicalBase64Url(key.publicKey, `${field}.publicKey`, 32);
	if (key.state !== 'active' && key.state !== 'revoked') {
		fail('invalid-key', `${field}.state must be active or revoked.`);
	}
	const createdAt = canonicalTimestamp(key.createdAt, `${field}.createdAt`);
	const revokedAt = key.revokedAt === undefined ? undefined : canonicalTimestamp(key.revokedAt, `${field}.revokedAt`);
	if (key.state === 'active' && revokedAt !== undefined || key.state === 'revoked' && revokedAt === undefined || revokedAt !== undefined && revokedAt <= createdAt) {
		fail('invalid-key', `${field} has inconsistent revocation metadata.`);
	}
	return Object.freeze({
		keyId: keyId(key.keyId, `${field}.keyId`),
		algorithm: 'ed25519',
		publicKey: key.publicKey as string,
		state: key.state,
		createdAt,
		...(revokedAt === undefined ? {} : { revokedAt }),
	});
}

/** Parses and deeply freezes a strict publisher identity document. */
export function parsePluginPublisherIdentity(value: unknown): IPluginPublisherIdentity {
	const publisher = asObject(value, 'publisher');
	exactKeys(publisher, ['schemaVersion', 'publisherId', 'displayName', 'principal', 'keys'], 'publisher');
	if (publisher.schemaVersion !== 1) {
		fail('invalid-shape', 'publisher.schemaVersion must be 1.');
	}
	if (!Array.isArray(publisher.keys) || publisher.keys.length === 0 || publisher.keys.length > 32) {
		fail('invalid-key', 'publisher.keys must contain between 1 and 32 keys.');
	}
	const keys = publisher.keys.map(parsePublisherKey);
	if (new Set(keys.map(key => key.keyId)).size !== keys.length) {
		fail('invalid-key', 'publisher.keys contains duplicate key identifiers.');
	}
	return Object.freeze({
		schemaVersion: 1,
		publisherId: publisherId(publisher.publisherId, 'publisher.publisherId'),
		displayName: requiredString(publisher.displayName, 'publisher.displayName'),
		principal: parsePrincipal(publisher.principal),
		keys: Object.freeze(keys),
	});
}

function parseArtifact(value: unknown): IPluginReleaseArtifact {
	const artifact = asObject(value, 'release.artifact');
	exactKeys(artifact, ['mediaType', 'size', 'sha256'], 'release.artifact');
	const mediaType = requiredString(artifact.mediaType, 'release.artifact.mediaType');
	if (!MEDIA_TYPE_PATTERN.test(mediaType)) {
		fail('invalid-field', 'release.artifact.mediaType must be a canonical media type without parameters.');
	}
	if (typeof artifact.size !== 'number' || !Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
		fail('invalid-field', 'release.artifact.size must be a positive safe integer.');
	}
	return Object.freeze({
		mediaType,
		size: artifact.size,
		sha256: sha256(artifact.sha256, 'release.artifact.sha256'),
	});
}

/** Parses and deeply freezes the immutable, signed portion of a release. */
export function parsePluginReleaseManifest(value: unknown): IPluginReleaseManifest {
	const release = asObject(value, 'release');
	exactKeys(release, ['schemaVersion', 'publisherId', 'pluginId', 'version', 'signingKeyId', 'createdAt', 'artifact'], 'release');
	if (release.schemaVersion !== 1) {
		fail('invalid-shape', 'release.schemaVersion must be 1.');
	}
	return Object.freeze({
		schemaVersion: 1,
		publisherId: publisherId(release.publisherId, 'release.publisherId'),
		pluginId: pluginId(release.pluginId, 'release.pluginId'),
		version: releaseVersion(release.version, 'release.version'),
		signingKeyId: keyId(release.signingKeyId, 'release.signingKeyId'),
		createdAt: canonicalTimestamp(release.createdAt, 'release.createdAt'),
		artifact: parseArtifact(release.artifact),
	});
}

/** Parses and freezes a detached Ed25519 signature. */
export function parsePluginReleaseSignature(value: unknown): IPluginReleaseSignature {
	const signature = asObject(value, 'signature');
	exactKeys(signature, ['algorithm', 'keyId', 'signature'], 'signature');
	if (signature.algorithm !== 'ed25519') {
		fail('invalid-key', 'signature.algorithm must be ed25519.');
	}
	decodeCanonicalBase64Url(signature.signature, 'signature.signature', 64);
	return Object.freeze({
		algorithm: 'ed25519',
		keyId: keyId(signature.keyId, 'signature.keyId'),
		signature: signature.signature as string,
	});
}

function parseReleaseState(value: unknown, field: string): PluginReleaseState {
	if (value !== 'draft' && value !== 'staged' && value !== 'published' && value !== 'yanked') {
		return fail('invalid-field', `${field} is not a release state.`);
	}
	return value;
}

/** Parses and deeply freezes a release plus its mutable lifecycle state. */
export function parsePluginReleaseRecord(value: unknown): IPluginReleaseRecord {
	const record = asObject(value, 'releaseRecord');
	exactKeys(record, ['manifest', 'signature', 'state', 'stateChangedAt'], 'releaseRecord');
	const manifest = parsePluginReleaseManifest(record.manifest);
	const signature = parsePluginReleaseSignature(record.signature);
	if (signature.keyId !== manifest.signingKeyId) {
		fail('invalid-key', 'The detached signature key does not match release.signingKeyId.');
	}
	const stateChangedAt = canonicalTimestamp(record.stateChangedAt, 'releaseRecord.stateChangedAt');
	if (stateChangedAt < manifest.createdAt) {
		fail('invalid-date', 'releaseRecord.stateChangedAt cannot precede release.createdAt.');
	}
	return Object.freeze({
		manifest,
		signature,
		state: parseReleaseState(record.state, 'releaseRecord.state'),
		stateChangedAt,
	});
}

/**
 * Canonical, cross-language payload for Ed25519. All members are validated
 * ASCII scalars in a fixed-order JSON array, preceded by a domain separator.
 */
export function canonicalizePluginReleaseManifest(value: IPluginReleaseManifest): string {
	const release = parsePluginReleaseManifest(value);
	return JSON.stringify([
		RELEASE_PAYLOAD_DOMAIN,
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

export function getPluginReleaseSigningPayload(value: IPluginReleaseManifest): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(canonicalizePluginReleaseManifest(value));
}

function toOwnedBytes(value: PluginBinary): Uint8Array<ArrayBuffer> {
	if (value instanceof VSBuffer) {
		return new Uint8Array(value.buffer);
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value.slice(0));
	}
	return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
}

function subtleCrypto(provided?: SubtleCrypto): SubtleCrypto {
	if (provided) {
		return provided;
	}
	if (typeof crypto === 'undefined' || !crypto.subtle) {
		return fail('crypto-unavailable', 'WebCrypto SubtleCrypto is required for plugin release verification.');
	}
	return crypto.subtle;
}

/** Computes the lowercase hexadecimal SHA-256 of exact artifact bytes. */
export async function computePluginArtifactSha256(content: PluginBinary, providedCrypto?: SubtleCrypto): Promise<string> {
	const digest = await subtleCrypto(providedCrypto).digest('SHA-256', toOwnedBytes(content));
	return encodeHex(VSBuffer.wrap(new Uint8Array(digest)));
}

export async function verifyPluginArtifactSha256(content: PluginBinary, expectedSha256: string, providedCrypto?: SubtleCrypto): Promise<boolean> {
	const expected = sha256(expectedSha256, 'expectedSha256');
	return await computePluginArtifactSha256(content, providedCrypto) === expected;
}

export async function derivePluginPublisherKeyId(publicKey: string, providedCrypto?: SubtleCrypto): Promise<string> {
	const rawKey = decodeCanonicalBase64Url(publicKey, 'publisher.publicKey', 32);
	return `sha256:${await computePluginArtifactSha256(rawKey, providedCrypto)}`;
}

/** Verifies that every declared key ID is the fingerprint of its raw public key. */
export async function verifyPluginPublisherIdentity(value: IPluginPublisherIdentity, providedCrypto?: SubtleCrypto): Promise<IPluginPublisherIdentity> {
	const publisher = parsePluginPublisherIdentity(value);
	for (const key of publisher.keys) {
		if (await derivePluginPublisherKeyId(key.publicKey, providedCrypto) !== key.keyId) {
			fail('invalid-key', `Publisher key ${key.keyId} does not match its public-key fingerprint.`);
		}
	}
	return publisher;
}

/** Signs the canonical immutable release payload. Private key material never enters the manifest. */
export async function signPluginReleaseManifest(value: IPluginReleaseManifest, privateKey: CryptoKey, providedCrypto?: SubtleCrypto): Promise<IPluginReleaseSignature> {
	const release = parsePluginReleaseManifest(value);
	if (privateKey.type !== 'private' || privateKey.algorithm.name !== 'Ed25519' || !privateKey.usages.includes('sign')) {
		fail('invalid-key', 'A private Ed25519 signing key is required.');
	}
	const signed = await subtleCrypto(providedCrypto).sign('Ed25519', privateKey, getPluginReleaseSigningPayload(release));
	return Object.freeze({
		algorithm: 'ed25519',
		keyId: release.signingKeyId,
		signature: encodeBase64(VSBuffer.wrap(new Uint8Array(signed)), false, true),
	});
}

/** Resolves the trusted publisher key, checks its fingerprint, and verifies Ed25519. */
export async function verifyPluginReleaseSignature(value: IPluginReleaseManifest, signatureValue: IPluginReleaseSignature, publisherValue: IPluginPublisherIdentity, providedCrypto?: SubtleCrypto): Promise<void> {
	const release = parsePluginReleaseManifest(value);
	const signature = parsePluginReleaseSignature(signatureValue);
	const publisher = parsePluginPublisherIdentity(publisherValue);
	if (release.publisherId !== publisher.publisherId) {
		fail('wrong-publisher', 'The release does not belong to this publisher identity.');
	}
	if (signature.keyId !== release.signingKeyId) {
		fail('invalid-key', 'The detached signature key does not match release.signingKeyId.');
	}
	const publisherKey = publisher.keys.find(key => key.keyId === release.signingKeyId);
	if (!publisherKey) {
		fail('invalid-key', 'The release signing key is not registered for this publisher.');
	}
	if (publisherKey.state !== 'active') {
		fail('revoked-key', 'The release signing key is revoked.');
	}
	const subtle = subtleCrypto(providedCrypto);
	if (await derivePluginPublisherKeyId(publisherKey.publicKey, subtle) !== publisherKey.keyId) {
		fail('invalid-key', 'The release signing key fingerprint is invalid.');
	}
	let publicKey: CryptoKey;
	try {
		publicKey = await subtle.importKey('raw', decodeCanonicalBase64Url(publisherKey.publicKey, 'publisher.publicKey', 32), 'Ed25519', false, ['verify']);
	} catch {
		return fail('invalid-key', 'The publisher Ed25519 public key could not be imported.');
	}
	const signatureBytes = decodeCanonicalBase64Url(signature.signature, 'signature.signature', 64);
	if (!await subtle.verify('Ed25519', publicKey, signatureBytes, getPluginReleaseSigningPayload(release))) {
		fail('bad-signature', 'The plugin release signature is invalid.');
	}
}

/**
 * Enforces immutable coordinates. Re-submitting byte-identical signed content
 * is idempotent; changing any signed field for the same version is rejected.
 */
export function assertPluginReleaseVersionIsImmutable(existingValue: IPluginReleaseManifest, candidateValue: IPluginReleaseManifest): void {
	const existing = parsePluginReleaseManifest(existingValue);
	const candidate = parsePluginReleaseManifest(candidateValue);
	if (existing.publisherId !== candidate.publisherId || existing.pluginId !== candidate.pluginId || existing.version !== candidate.version) {
		return;
	}
	if (canonicalizePluginReleaseManifest(existing) !== canonicalizePluginReleaseManifest(candidate)) {
		fail('version-conflict', `Release ${candidate.publisherId}/${candidate.pluginId}@${candidate.version} already has different immutable content.`);
	}
}

const releaseStateTransitions: Readonly<Record<PluginReleaseState, readonly PluginReleaseState[]>> = Object.freeze({
	draft: Object.freeze(['staged'] as PluginReleaseState[]),
	staged: Object.freeze(['draft', 'published'] as PluginReleaseState[]),
	published: Object.freeze(['yanked'] as PluginReleaseState[]),
	yanked: Object.freeze([] as PluginReleaseState[]),
});

export function canTransitionPluginRelease(from: PluginReleaseState, to: PluginReleaseState): boolean {
	return releaseStateTransitions[from].includes(to);
}

/** Returns a new frozen record; signed release fields are never rewritten. */
export function transitionPluginReleaseState(recordValue: IPluginReleaseRecord, targetValue: PluginReleaseState, changedAtValue: string): IPluginReleaseRecord {
	const record = parsePluginReleaseRecord(recordValue);
	const target = parseReleaseState(targetValue, 'targetState');
	const changedAt = canonicalTimestamp(changedAtValue, 'changedAt');
	if (!canTransitionPluginRelease(record.state, target)) {
		fail('invalid-transition', `Plugin release cannot transition from ${record.state} to ${target}.`);
	}
	if (changedAt <= record.stateChangedAt) {
		fail('invalid-date', 'A release state transition must advance stateChangedAt.');
	}
	return Object.freeze({
		manifest: record.manifest,
		signature: record.signature,
		state: target,
		stateChangedAt: changedAt,
	});
}

function parsePromotionTarget(value: unknown, field: string): IPluginReleasePromotionTarget {
	const target = asObject(value, field);
	exactKeys(target, ['version', 'artifactSha256'], field);
	return Object.freeze({
		version: releaseVersion(target.version, `${field}.version`),
		artifactSha256: sha256(target.artifactSha256, `${field}.artifactSha256`),
	});
}

export function parsePluginReleasePromotion(value: unknown): IPluginReleasePromotion {
	const promotion = asObject(value, 'promotion');
	exactKeys(promotion, ['schemaVersion', 'sequence', 'publisherId', 'pluginId', 'channel', 'version', 'artifactSha256', 'kind', 'promotedAt', 'previous'], 'promotion');
	if (promotion.schemaVersion !== 1) {
		fail('invalid-shape', 'promotion.schemaVersion must be 1.');
	}
	if (typeof promotion.sequence !== 'number' || !Number.isSafeInteger(promotion.sequence) || promotion.sequence <= 0) {
		fail('invalid-promotion', 'promotion.sequence must be a positive safe integer.');
	}
	if (promotion.kind !== 'publish' && promotion.kind !== 'rollback') {
		fail('invalid-promotion', 'promotion.kind must be publish or rollback.');
	}
	return Object.freeze({
		schemaVersion: 1,
		sequence: promotion.sequence,
		publisherId: publisherId(promotion.publisherId, 'promotion.publisherId'),
		pluginId: pluginId(promotion.pluginId, 'promotion.pluginId'),
		channel: channel(promotion.channel, 'promotion.channel'),
		version: releaseVersion(promotion.version, 'promotion.version'),
		artifactSha256: sha256(promotion.artifactSha256, 'promotion.artifactSha256'),
		kind: promotion.kind,
		promotedAt: canonicalTimestamp(promotion.promotedAt, 'promotion.promotedAt'),
		...(promotion.previous === undefined ? {} : { previous: parsePromotionTarget(promotion.previous, 'promotion.previous') }),
	});
}

function samePromotionTarget(left: IPluginReleasePromotionTarget, right: IPluginReleasePromotionTarget): boolean {
	return left.version === right.version && left.artifactSha256 === right.artifactSha256;
}

/** Validates sequence continuity, the hash chain, monotonic publishes, and append-only rollbacks. */
export function validatePluginReleasePromotionHistory(values: readonly IPluginReleasePromotion[]): readonly IPluginReleasePromotion[] {
	const history = values.map(parsePluginReleasePromotion);
	const releaseDigests = new Map<string, string>();
	for (let index = 0; index < history.length; index++) {
		const current = history[index];
		const knownDigest = releaseDigests.get(current.version);
		if (knownDigest !== undefined && knownDigest !== current.artifactSha256) {
			fail('version-conflict', `Promotion history changes the artifact for version ${current.version}.`);
		}
		releaseDigests.set(current.version, current.artifactSha256);
		if (index === 0) {
			if (current.sequence !== 1 || current.kind !== 'publish' || current.previous !== undefined) {
				fail('invalid-history', 'The first promotion must be sequence 1, kind publish, without previous.');
			}
			continue;
		}
		const previous = history[index - 1];
		if (current.publisherId !== previous.publisherId || current.pluginId !== previous.pluginId || current.channel !== previous.channel) {
			fail('invalid-history', 'A promotion history cannot cross publisher, plugin, or channel boundaries.');
		}
		if (current.sequence !== previous.sequence + 1 || current.promotedAt <= previous.promotedAt) {
			fail('invalid-history', 'Promotion sequence and timestamp must advance monotonically.');
		}
		if (!current.previous || !samePromotionTarget(current.previous, previous)) {
			fail('invalid-history', 'promotion.previous must identify the immediately preceding target.');
		}
		if (samePromotionTarget(current, previous)) {
			fail('invalid-promotion', 'A promotion must change the active target.');
		}
		if (current.kind === 'publish') {
			if (!semver.gt(current.version, previous.version)) {
				fail('invalid-promotion', 'A publish promotion must advance the active SemVer.');
			}
		} else {
			if (!semver.lt(current.version, previous.version) || !history.slice(0, index).some(entry => samePromotionTarget(entry, current))) {
				fail('invalid-promotion', 'A rollback must target an exact, previously promoted older release.');
			}
		}
	}
	return Object.freeze(history);
}

/**
 * Creates one new append-only promotion event. Rollback never mutates an old
 * release or event; it can only select the exact bytes of a prior promotion.
 */
export function createPluginReleasePromotion(recordValue: IPluginReleaseRecord, channelValue: string, historyValues: readonly IPluginReleasePromotion[], kind: PluginReleasePromotionKind, promotedAtValue: string): IPluginReleasePromotion {
	const record = parsePluginReleaseRecord(recordValue);
	if (record.state !== 'published') {
		fail('invalid-promotion', 'Only a published, non-yanked release can be promoted.');
	}
	const history = validatePluginReleasePromotionHistory(historyValues);
	const promotionChannel = channel(channelValue, 'channel');
	const previous = history.at(-1);
	if (previous && (previous.publisherId !== record.manifest.publisherId || previous.pluginId !== record.manifest.pluginId || previous.channel !== promotionChannel)) {
		fail('invalid-history', 'Promotion history does not belong to this release and channel.');
	}
	const candidate = parsePluginReleasePromotion({
		schemaVersion: 1,
		sequence: previous ? previous.sequence + 1 : 1,
		publisherId: record.manifest.publisherId,
		pluginId: record.manifest.pluginId,
		channel: promotionChannel,
		version: record.manifest.version,
		artifactSha256: record.manifest.artifact.sha256,
		kind,
		promotedAt: promotedAtValue,
		...(previous ? { previous: { version: previous.version, artifactSha256: previous.artifactSha256 } } : {}),
	});
	validatePluginReleasePromotionHistory([...history, candidate]);
	return candidate;
}
