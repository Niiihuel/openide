/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE update manifest v2 — strict, signed and platform-bound.
 *--------------------------------------------------------------------------------------------*/

// Deliberately free of host URL/path dependencies: the contract validates explicit prefixes.

export type OpenideUpdateChannel = 'stable' | 'insider';
export type OpenideUpdatePlatform = 'linux' | 'darwin' | 'win32';
export type OpenideUpdateArchitecture = 'x64' | 'arm64';
export type OpenideUpdateTarget = 'appimage' | 'archive' | 'user' | 'system' | 'msi';

export interface IOpenideUpdateManifestV2 {
	readonly schemaVersion: 2;
	readonly product: 'openide';
	readonly channel: OpenideUpdateChannel;
	readonly platform: OpenideUpdatePlatform;
	readonly architecture: OpenideUpdateArchitecture;
	readonly target: OpenideUpdateTarget;
	readonly productVersion: string;
	readonly buildVersion: string;
	readonly codeOssVersion: string;
	readonly publishedAt: string;
	readonly minimumUpdaterVersion: number;
	readonly artifact: { readonly url: string; readonly size: number; readonly sha256: string; readonly _signatureReserved?: never };
	readonly releaseNotesUrl?: string;
	readonly rollout?: { readonly percentage: number; readonly seed: string };
}

export interface IOpenideUpdateManifestContext {
	readonly channel: OpenideUpdateChannel;
	readonly platform: OpenideUpdatePlatform;
	readonly architecture: OpenideUpdateArchitecture;
	readonly target: OpenideUpdateTarget;
	readonly currentVersion: string;
	readonly minimumUpdaterVersion: number;
	readonly highestSeenVersion?: string;
	readonly highestSeenBuildVersion?: string;
	readonly highestSeenArtifactSha256?: string;
	readonly allowedHosts?: readonly string[];
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BUILD_VERSION = /^[a-f0-9]{40}$/;
const DEFAULT_ALLOWED_HOSTS = ['github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com'];

export class OpenideUpdateManifestError extends Error {
	constructor(readonly code: string, message: string) { super(message); this.name = 'OpenideUpdateManifestError'; }
}

function object(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new OpenideUpdateManifestError('invalid-shape', `${field} debe ser un objeto.`); }
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
	for (const key of Object.keys(value)) { if (!allowed.includes(key)) { throw new OpenideUpdateManifestError('unknown-field', `${field}.${key} no está permitido.`); } }
}

function string(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) { throw new OpenideUpdateManifestError('invalid-field', `${field} debe ser texto no vacío.`); }
	return value;
}

export function compareOpenideVersions(left: string, right: string): number {
	const a = SEMVER.exec(left); const b = SEMVER.exec(right);
	if (!a || !b) { throw new OpenideUpdateManifestError('invalid-version', `Versión inválida: ${!a ? left : right}.`); }
	for (let i = 1; i <= 3; i++) { const av = BigInt(a[i]); const bv = BigInt(b[i]); if (av !== bv) { return av < bv ? -1 : 1; } }
	const ap = a[4]; const bp = b[4];
	if (ap === bp) { return 0; }
	if (!ap) { return 1; }
	if (!bp) { return -1; }
	const ai = ap.split('.'); const bi = bp.split('.');
	for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
		if (ai[i] === undefined) { return -1; } if (bi[i] === undefined) { return 1; }
		if (ai[i] === bi[i]) { continue; }
		const an = /^\d+$/.test(ai[i]); const bn = /^\d+$/.test(bi[i]);
		if (an && bn) { return BigInt(ai[i]) < BigInt(bi[i]) ? -1 : 1; }
		if (an !== bn) { return an ? -1 : 1; }
		return ai[i] < bi[i] ? -1 : 1;
	}
	return 0;
}

function trustedUrl(raw: unknown, field: string, allowedHosts: readonly string[]): string {
	const value = string(raw, field);
	if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(value)) { throw new OpenideUpdateManifestError('invalid-url', `${field} contiene dot-segments.`); }
	let parsed: URL;
	try { parsed = new URL(value); } catch { throw new OpenideUpdateManifestError('invalid-url', `${field} no es una URL válida.`); }
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowedHosts.includes(parsed.hostname)) { throw new OpenideUpdateManifestError('untrusted-url', `${field} apunta a un host no confiable.`); }
	const allowedPath = parsed.hostname === 'github.com' ? /^\/Niiihuel\/openide\/(?:releases|blob)\// : parsed.hostname === 'raw.githubusercontent.com' ? /^\/Niiihuel\/openide\/updates\// : /^\//;
	if (!allowedPath.test(parsed.pathname)) { throw new OpenideUpdateManifestError('untrusted-url', `${field} está fuera de las rutas OpenIDE permitidas.`); }
	return parsed.toString();
}

export function parseOpenideUpdateManifest(value: unknown, context: IOpenideUpdateManifestContext): IOpenideUpdateManifestV2 {
	if (!['stable', 'insider'].includes(context.channel) || !['linux', 'darwin', 'win32'].includes(context.platform) || !['x64', 'arm64'].includes(context.architecture) || !['appimage', 'archive', 'user', 'system', 'msi'].includes(context.target)) { throw new OpenideUpdateManifestError('unsupported-target', 'La plataforma/arquitectura/target no está soportada.'); }
	const root = object(value, 'manifest');
	exactKeys(root, ['schemaVersion', 'product', 'channel', 'platform', 'architecture', 'target', 'productVersion', 'buildVersion', 'codeOssVersion', 'publishedAt', 'minimumUpdaterVersion', 'artifact', 'releaseNotesUrl', 'rollout'], 'manifest');
	if (root.schemaVersion !== 2 || root.product !== 'openide') { throw new OpenideUpdateManifestError('unsupported-schema', 'El manifest no pertenece a OpenIDE schema v2.'); }
	for (const key of ['channel', 'platform', 'architecture', 'target'] as const) { if (root[key] !== context[key]) { throw new OpenideUpdateManifestError('target-mismatch', `${key} no coincide con esta instalación.`); } }
	const productVersion = string(root.productVersion, 'productVersion');
	if (!SEMVER.test(productVersion)) { throw new OpenideUpdateManifestError('invalid-version', 'productVersion no es SemVer válido.'); }
	if (context.channel === 'stable' ? productVersion.includes('-') : !/^\d+\.\d+\.\d+-insider\.\d{8}\.[1-9]\d*(?:\+.+)?$/.test(productVersion)) { throw new OpenideUpdateManifestError('cross-channel', 'La versión no coincide con la política del canal.'); }
	if (compareOpenideVersions(productVersion, context.currentVersion) <= 0 || context.highestSeenVersion && compareOpenideVersions(productVersion, context.highestSeenVersion) < 0) { throw new OpenideUpdateManifestError('rollback', 'La versión publicada no supera el límite anti-rollback.'); }
	if (typeof root.minimumUpdaterVersion !== 'number') { throw new OpenideUpdateManifestError('invalid-field', 'minimumUpdaterVersion debe ser number.'); }
	const minimumUpdaterVersion = root.minimumUpdaterVersion;
	if (!Number.isSafeInteger(minimumUpdaterVersion) || minimumUpdaterVersion < 1 || minimumUpdaterVersion > context.minimumUpdaterVersion) { throw new OpenideUpdateManifestError('updater-too-old', 'Esta versión requiere un updater más nuevo.'); }
	const buildVersion = string(root.buildVersion, 'buildVersion');
	if (!BUILD_VERSION.test(buildVersion)) { throw new OpenideUpdateManifestError('invalid-build', 'buildVersion debe ser un commit SHA-1 de 40 caracteres.'); }
	const codeOssVersion = string(root.codeOssVersion, 'codeOssVersion'); const codeOssMatch = SEMVER.exec(codeOssVersion); const productMatch = SEMVER.exec(productVersion); if (!codeOssMatch || !productMatch || BigInt(codeOssMatch[1]) !== BigInt(productMatch[1]) || BigInt(codeOssMatch[2]) !== BigInt(productMatch[2])) { throw new OpenideUpdateManifestError('invalid-version', 'codeOssVersion no coincide con la línea API OpenIDE.'); }
	const publishedAt = string(root.publishedAt, 'publishedAt'); const publishedDate = new Date(publishedAt); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(publishedAt) || Number.isNaN(publishedDate.getTime()) || publishedDate.toISOString() !== publishedAt) { throw new OpenideUpdateManifestError('invalid-date', 'publishedAt debe ser ISO-8601 UTC canónico.'); }
	const artifact = object(root.artifact, 'artifact'); exactKeys(artifact, ['url', 'size', 'sha256'], 'artifact');
	if (typeof artifact.size !== 'number') { throw new OpenideUpdateManifestError('invalid-field', 'artifact.size debe ser number.'); }
	const size = artifact.size; if (!Number.isSafeInteger(size) || size <= 0) { throw new OpenideUpdateManifestError('invalid-size', 'artifact.size inválido.'); }
	const sha256 = string(artifact.sha256, 'artifact.sha256'); if (!SHA256.test(sha256)) { throw new OpenideUpdateManifestError('invalid-hash', 'artifact.sha256 inválido.'); }
	if (context.highestSeenVersion && compareOpenideVersions(productVersion, context.highestSeenVersion) === 0 && (context.highestSeenBuildVersion && context.highestSeenBuildVersion !== buildVersion || context.highestSeenArtifactSha256 && context.highestSeenArtifactSha256 !== sha256)) { throw new OpenideUpdateManifestError('rollback', 'La identidad del build difiere para una versión ya observada.'); }
	const allowedHosts = context.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
	const parsed: IOpenideUpdateManifestV2 = {
		schemaVersion: 2, product: 'openide', channel: context.channel, platform: context.platform, architecture: context.architecture, target: context.target,
		productVersion, buildVersion, codeOssVersion, publishedAt, minimumUpdaterVersion,
		artifact: { url: trustedUrl(artifact.url, 'artifact.url', allowedHosts), size, sha256 },
	};
	if (root.releaseNotesUrl !== undefined) { (parsed as { releaseNotesUrl?: string }).releaseNotesUrl = trustedUrl(root.releaseNotesUrl, 'releaseNotesUrl', allowedHosts); }
	if (root.rollout !== undefined) {
		const rollout = object(root.rollout, 'rollout'); exactKeys(rollout, ['percentage', 'seed'], 'rollout');
		if (typeof rollout.percentage !== 'number') { throw new OpenideUpdateManifestError('invalid-field', 'rollout.percentage debe ser number.'); }
		const percentage = rollout.percentage; if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) { throw new OpenideUpdateManifestError('invalid-rollout', 'rollout.percentage inválido.'); }
		(parsed as { rollout?: { percentage: number; seed: string } }).rollout = { percentage, seed: string(rollout.seed, 'rollout.seed') };
	}
	return parsed;
}
