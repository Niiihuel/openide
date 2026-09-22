/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { basename, dirname, isEqualOrParent, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IFileService, IFileStat } from '../../../../../platform/files/common/files.js';

export const PLUGIN_INSTALL_RECEIPT_FILENAME = '.plugin-install-receipt.json';

const SHA256_DIGEST_PATTERN = /^(?:sha256:)?(?<digest>[a-f0-9]{64})$/i;

/** Provenance persisted with a transactionally installed plugin tree. */
export interface IPluginInstallProvenance {
	readonly sourceKind: string;
	readonly source: string;
	readonly ref?: string;
	readonly revision?: string;
	readonly marketplace?: string;
	readonly pluginName?: string;
	readonly pluginVersion?: string;
	/** Registry publisher namespace, when the source is a signed release. */
	readonly publisherId?: string;
	/** SHA-256 of the exact downloaded registry artifact bytes. */
	readonly artifactSha256?: string;
	/** Publisher key which signed the immutable registry release. */
	readonly signingKeyId?: string;
}

/** Receipt promoted atomically with an installed plugin tree. */
export interface IPluginInstallReceipt {
	readonly schemaVersion: 1;
	readonly treeDigest: string;
	readonly expectedDigest?: string;
	readonly artifactPath?: string;
	readonly installedAt: string;
	readonly provenance: IPluginInstallProvenance;
}

export interface IPluginInstallTransactionOptions {
	readonly target: URI;
	readonly expectedDigest?: string;
	/** Optional plugin subdirectory to hash while promoting the complete target. */
	readonly artifactPath?: string;
	readonly provenance: IPluginInstallProvenance;
	readonly prepare: (staging: URI) => Promise<void>;
}

export interface IPluginInstallTransactionResult {
	readonly digest: string;
	readonly changed: boolean;
	readonly receipt: IPluginInstallReceipt;
}

interface IPluginTreeFileIdentity {
	readonly path: string;
	readonly executable: boolean;
	readonly size: number;
	readonly sha256: string;
}

function bytesToHex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes: Uint8Array): Promise<string> {
	return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
}

/** Normalizes a raw or `sha256:`-prefixed digest to its canonical form. */
export function normalizePluginTreeDigest(value: string): string {
	const match = SHA256_DIGEST_PATTERN.exec(value.trim());
	if (!match?.groups?.digest) {
		throw new Error(`Invalid plugin tree digest '${value}'`);
	}
	return `sha256:${match.groups.digest.toLowerCase()}`;
}

function compareCodeUnits(left: string, right: string): number {
	return left === right ? 0 : left < right ? -1 : 1;
}

function isExcludedTreeEntry(relativePath: string): boolean {
	return relativePath === PLUGIN_INSTALL_RECEIPT_FILENAME
		|| relativePath === '.git'
		|| relativePath.startsWith('.git/');
}

async function collectPluginTreeFiles(fileService: IFileService, root: URI): Promise<IPluginTreeFileIdentity[]> {
	const files: IPluginTreeFileIdentity[] = [];

	const visit = async (directory: URI, prefix: string): Promise<void> => {
		const stat = await fileService.resolve(directory);
		const children = [...(stat.children ?? [])].sort((left, right) => compareCodeUnits(left.name, right.name));
		for (const child of children) {
			const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
			if (isExcludedTreeEntry(relativePath)) {
				continue;
			}
			if (child.isSymbolicLink) {
				throw new Error(`Plugin tree contains unsupported symbolic link '${relativePath}'`);
			}
			if (child.isDirectory) {
				await visit(child.resource, relativePath);
				continue;
			}
			if (!child.isFile) {
				throw new Error(`Plugin tree contains unsupported entry '${relativePath}'`);
			}
			const contents = await fileService.readFile(child.resource);
			files.push({
				path: relativePath,
				executable: child.executable === true,
				size: contents.value.byteLength,
				sha256: await sha256(contents.value.buffer),
			});
		}
	};

	await visit(root, '');
	return files;
}

/**
 * Computes a deterministic SHA-256 identity for a plugin tree. Paths are
 * code-unit sorted and the digest binds path, executable state, size, and
 * exact file bytes. Git metadata and the transaction receipt are excluded.
 */
export async function computePluginTreeDigest(fileService: IFileService, root: URI): Promise<string> {
	const files = await collectPluginTreeFiles(fileService, root);
	const canonical = new TextEncoder().encode(JSON.stringify(files));
	return `sha256:${await sha256(canonical)}`;
}

function isPluginInstallReceipt(value: unknown): value is IPluginInstallReceipt {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const receipt = value as Partial<IPluginInstallReceipt>;
	return receipt.schemaVersion === 1
		&& typeof receipt.treeDigest === 'string'
		&& (receipt.expectedDigest === undefined || typeof receipt.expectedDigest === 'string')
		&& (receipt.artifactPath === undefined || typeof receipt.artifactPath === 'string')
		&& typeof receipt.installedAt === 'string'
		&& !!receipt.provenance
		&& typeof receipt.provenance.sourceKind === 'string'
		&& typeof receipt.provenance.source === 'string'
		&& (receipt.provenance.publisherId === undefined || typeof receipt.provenance.publisherId === 'string')
		&& (receipt.provenance.artifactSha256 === undefined || typeof receipt.provenance.artifactSha256 === 'string')
		&& (receipt.provenance.signingKeyId === undefined || typeof receipt.provenance.signingKeyId === 'string');
}

function resolveArtifactRoot(target: URI, artifactPath: string | undefined): { root: URI; path: string | undefined } {
	const normalizedPath = artifactPath?.trim().replace(/^\.?\/+|\/+$/g, '') || undefined;
	const root = normalizedPath ? joinPath(target, normalizedPath) : target;
	if (!isEqualOrParent(root, target)) {
		throw new Error(`Invalid plugin artifact path '${artifactPath}'`);
	}
	return { root, path: normalizedPath };
}

/** Reads a valid receipt from an installed plugin tree. */
export async function readPluginInstallReceipt(fileService: IFileService, target: URI): Promise<IPluginInstallReceipt | undefined> {
	try {
		const contents = await fileService.readFile(joinPath(target, PLUGIN_INSTALL_RECEIPT_FILENAME));
		const parsed: unknown = JSON.parse(contents.value.toString());
		return isPluginInstallReceipt(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** Re-hashes an installed tree and returns its receipt only when both agree. */
export async function verifyPluginInstall(fileService: IFileService, target: URI, expectedDigest?: string, artifactPath?: string): Promise<IPluginInstallReceipt | undefined> {
	const receipt = await readPluginInstallReceipt(fileService, target);
	if (!receipt) {
		return undefined;
	}
	const normalizedExpected = expectedDigest ? normalizePluginTreeDigest(expectedDigest) : undefined;
	if (normalizedExpected && receipt.treeDigest !== normalizedExpected) {
		return undefined;
	}
	try {
		const requestedArtifact = resolveArtifactRoot(target, artifactPath);
		if (requestedArtifact.path !== receipt.artifactPath) {
			return undefined;
		}
		const artifact = resolveArtifactRoot(target, receipt.artifactPath);
		return await computePluginTreeDigest(fileService, artifact.root) === receipt.treeDigest ? receipt : undefined;
	} catch {
		return undefined;
	}
}

async function bestEffortDelete(fileService: IFileService, resource: URI): Promise<void> {
	try {
		if (await fileService.exists(resource)) {
			await fileService.del(resource, { recursive: true, useTrash: false });
		}
	} catch {
		// Recovery artifacts are intentionally left in place if cleanup fails.
	}
}

async function restorePreviousInstall(fileService: IFileService, target: URI, backup: URI, backupCreated: boolean, promoted: boolean): Promise<void> {
	if (backupCreated && await fileService.exists(backup)) {
		await fileService.move(backup, target, true);
		return;
	}
	if (promoted) {
		await bestEffortDelete(fileService, target);
	}
}

/**
 * Prepares a plugin in a sibling staging directory, verifies its deterministic
 * digest, writes provenance, and promotes it with rollback protection.
 */
export async function runPluginInstallTransaction(fileService: IFileService, options: IPluginInstallTransactionOptions): Promise<IPluginInstallTransactionResult> {
	const expectedDigest = options.expectedDigest ? normalizePluginTreeDigest(options.expectedDigest) : undefined;
	const artifactPath = resolveArtifactRoot(options.target, options.artifactPath).path;
	const transactionId = generateUuid();
	const targetName = basename(options.target);
	const targetParent = dirname(options.target);
	const staging = joinPath(targetParent, `.${targetName}.plugin-staging-${transactionId}`);
	const backup = joinPath(targetParent, `.${targetName}.plugin-backup-${transactionId}`);
	let hadPrevious = false;
	let backupCreated = false;
	let previousDigest: string | undefined;
	let promoted = false;
	let succeeded = false;

	await fileService.createFolder(targetParent);
	try {
		await options.prepare(staging);
		const stagingStat: IFileStat = await fileService.resolve(staging);
		if (!stagingStat.isDirectory) {
			throw new Error('Plugin staging path is not a directory');
		}

		const stagingArtifact = resolveArtifactRoot(staging, artifactPath);
		const digest = await computePluginTreeDigest(fileService, stagingArtifact.root);
		if (expectedDigest && digest !== expectedDigest) {
			throw new Error(`Plugin tree digest mismatch: expected ${expectedDigest}, got ${digest}`);
		}

		const receipt: IPluginInstallReceipt = {
			schemaVersion: 1,
			treeDigest: digest,
			...(expectedDigest ? { expectedDigest } : {}),
			...(artifactPath ? { artifactPath } : {}),
			installedAt: new Date().toISOString(),
			provenance: options.provenance,
		};
		await fileService.writeFile(
			joinPath(staging, PLUGIN_INSTALL_RECEIPT_FILENAME),
			VSBuffer.fromString(`${JSON.stringify(receipt, undefined, '\t')}\n`),
		);

		hadPrevious = await fileService.exists(options.target);
		if (hadPrevious) {
			const previousReceipt = await readPluginInstallReceipt(fileService, options.target);
			previousDigest = previousReceipt && previousReceipt.artifactPath === artifactPath ? previousReceipt.treeDigest : undefined;
			await fileService.move(options.target, backup, false);
			backupCreated = true;
		}

		await fileService.move(staging, options.target, false);
		promoted = true;
		const promotedArtifact = resolveArtifactRoot(options.target, artifactPath);
		if (await computePluginTreeDigest(fileService, promotedArtifact.root) !== digest) {
			throw new Error('Promoted plugin tree failed digest verification');
		}

		succeeded = true;
		await bestEffortDelete(fileService, backup);
		return { digest, changed: previousDigest !== digest, receipt };
	} catch (error) {
		if (promoted || backupCreated) {
			try {
				await restorePreviousInstall(fileService, options.target, backup, backupCreated, promoted);
			} catch (rollbackError) {
				throw new Error(`Plugin installation failed and the previous version could not be restored: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error });
			}
		}
		throw error;
	} finally {
		await bestEffortDelete(fileService, staging);
		if (succeeded) {
			await bestEffortDelete(fileService, backup);
		}
	}
}
