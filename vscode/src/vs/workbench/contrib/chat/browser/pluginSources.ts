/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from '../../../../base/common/actions.js';
import { CancelablePromise, SequencerByKey, timeout } from '../../../../base/common/async.js';
import { decodeBase64, encodeBase64, VSBuffer, type VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../base/common/platform.js';
import { dirname, extUri, isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { listenStream } from '../../../../base/common/stream.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { readAgentPluginManifest } from '../../../../platform/agentPlugins/common/agentPluginParser.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IRequestService, isSuccess, readHeader } from '../../../../platform/request/common/request.js';
import { TerminalCapability, type ITerminalCommand } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { IEnsureRepositoryOptions, IPullRepositoryOptions } from '../common/plugins/agentPluginRepositoryService.js';
import { IGitHubPluginSource, IGitUrlPluginSource, IMarketplacePlugin, INpmPluginSource, IPipPluginSource, IPluginSourceDescriptor, IRegistryPluginSource, MarketplaceReferenceKind, PluginSourceKind } from '../common/plugins/pluginMarketplaceService.js';
import { IPluginSource } from '../common/plugins/pluginSource.js';
import { IPluginGitService } from '../common/plugins/pluginGitService.js';
import { IPluginInstallProvenance, runPluginInstallTransaction, verifyPluginInstall } from '../common/plugins/pluginInstallTransaction.js';
import { getRegistryPluginInstallUri } from '../common/plugins/pluginPathValidation.js';
import { computePluginArtifactSha256, parsePluginPublisherIdentity, parsePluginReleaseManifest, parsePluginReleaseSignature, verifyPluginPublisherIdentity, verifyPluginReleaseSignature } from '../common/plugins/pluginSupplyChain.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sanitizeCacheSegment(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, '_');
}

function gitRevisionCacheSuffix(ref?: string, sha?: string): string[] {
	if (sha) {
		return [`sha_${sanitizeCacheSegment(sha)}`];
	}
	if (ref) {
		return [`ref_${sanitizeCacheSegment(ref)}`];
	}
	return [];
}

function shellEscapeArg(value: string): string {
	if (isWindows) {
		return `"${value.replace(/[`$"]/g, '`$&')}"`;
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatShellCommand(args: readonly string[]): string {
	const [command, ...rest] = args;
	return [command, ...rest.map(arg => shellEscapeArg(arg))].join(' ');
}

function pluginInstallProvenance(plugin: IMarketplacePlugin, source: string): IPluginInstallProvenance {
	const descriptor = plugin.sourceDescriptor;
	const revision = descriptor.kind === PluginSourceKind.GitHub || descriptor.kind === PluginSourceKind.GitUrl
		? descriptor.sha
		: descriptor.kind === PluginSourceKind.Registry
			? descriptor.artifactSha256
			: undefined;
	const ref = descriptor.kind === PluginSourceKind.GitHub || descriptor.kind === PluginSourceKind.GitUrl
		? descriptor.ref
		: undefined;
	return {
		sourceKind: descriptor.kind,
		source,
		...(ref ? { ref } : {}),
		...(revision ? { revision } : {}),
		...(descriptor.kind === PluginSourceKind.Registry ? {
			publisherId: descriptor.release.publisherId,
			artifactSha256: descriptor.artifactSha256,
			signingKeyId: descriptor.release.signingKeyId,
		} : {}),
		marketplace: plugin.marketplaceReference.rawValue,
		pluginName: plugin.name,
		...(plugin.version ? { pluginVersion: plugin.version } : {}),
	};
}

// ---------------------------------------------------------------------------
// Base for git-based sources (GitHub shorthand & arbitrary Git URL)
// ---------------------------------------------------------------------------

abstract class AbstractGitPluginSource implements IPluginSource {
	abstract readonly kind: PluginSourceKind;
	constructor(
		@ICommandService protected readonly _commandService: ICommandService,
		@IFileService protected readonly _fileService: IFileService,
		@ILogService protected readonly _logService: ILogService,
		@INotificationService protected readonly _notificationService: INotificationService,
		@IPluginGitService protected readonly _pluginGit: IPluginGitService,
		@IProgressService protected readonly _progressService: IProgressService,
	) { }

	abstract getInstallUri(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI;
	abstract getLabel(descriptor: IPluginSourceDescriptor): string;
	protected abstract _cloneUrl(descriptor: IPluginSourceDescriptor): string;
	protected abstract _displayLabel(descriptor: IPluginSourceDescriptor): string;

	getCleanupTarget(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI | undefined {
		return this._getRepoDir(cacheRoot, descriptor);
	}

	/**
	 * Returns the on-disk directory of the cloned repository. Subclasses that
	 * support a sub-path within a repository should override this to return the
	 * repository root, while {@link getInstallUri} returns root + sub-path.
	 */
	protected _getRepoDir(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		return this.getInstallUri(cacheRoot, descriptor);
	}

	async ensure(cacheRoot: URI, plugin: IMarketplacePlugin, options?: IEnsureRepositoryOptions): Promise<URI> {
		const descriptor = plugin.sourceDescriptor;
		const repoDir = this._getRepoDir(cacheRoot, descriptor);
		const repoExists = await this._fileService.exists(repoDir);
		const label = this._displayLabel(descriptor);
		const artifactPath = this._artifactPath(descriptor);

		if (repoExists && await verifyPluginInstall(this._fileService, repoDir, descriptor.digest, artifactPath)) {
			return this.getInstallUri(cacheRoot, descriptor);
		}

		const progressTitle = options?.progressTitle ?? localize('cloningPluginSource', "Cloning plugin source '{0}'...", label);
		const failureLabel = options?.failureLabel ?? label;
		const ref = (descriptor as IGitHubPluginSource | IGitUrlPluginSource).ref;

		await this._installRepository(repoDir, plugin, progressTitle, failureLabel, async (staging, token) => {
			if (repoExists) {
				await this._fileService.copy(repoDir, staging, false);
			} else {
				await this._pluginGit.cloneRepository(this._cloneUrl(descriptor), staging, ref, token);
			}
			await this._checkoutRevision(staging, descriptor, failureLabel, token);
		});
		return this.getInstallUri(cacheRoot, descriptor);
	}

	async update(cacheRoot: URI, plugin: IMarketplacePlugin, options?: IPullRepositoryOptions): Promise<boolean> {
		const descriptor = plugin.sourceDescriptor;
		const repoDir = this._getRepoDir(cacheRoot, descriptor);
		const repoExists = await this._fileService.exists(repoDir);
		if (!repoExists) {
			this._logService.warn(`[${this.kind}] Cannot update plugin '${options?.pluginName ?? plugin.name}': source repository not cloned`);
			return false;
		}

		const updateLabel = options?.pluginName ?? plugin.name;
		const failureLabel = options?.failureLabel ?? updateLabel;

		try {
			const doUpdate = async (cts?: CancellationTokenSource) => {
				const git = descriptor as IGitHubPluginSource | IGitUrlPluginSource;
				const result = await runPluginInstallTransaction(this._fileService, {
					target: repoDir,
					expectedDigest: descriptor.digest,
					artifactPath: this._artifactPath(descriptor),
					provenance: pluginInstallProvenance(plugin, this.getLabel(descriptor)),
					prepare: async staging => {
						await this._fileService.copy(repoDir, staging, false);
						if (git.sha) {
							await this._pluginGit.fetch(staging, cts?.token);
						} else {
							await this._pluginGit.pull(staging, cts?.token);
						}
						await this._checkoutRevision(staging, descriptor, failureLabel, cts?.token);
					},
				});
				return result.changed;
			};

			if (options?.silent) {
				return await doUpdate();
			}

			const cts = new CancellationTokenSource();
			try {
				return await this._progressService.withProgress(
					{
						location: ProgressLocation.Notification,
						title: localize('updatingPluginSource', "Updating plugin '{0}'...", updateLabel),
						cancellable: true,
					},
					() => doUpdate(cts),
					() => cts.dispose(true),
				);
			} finally {
				cts.dispose();
			}
		} catch (err) {
			this._logService.error(`[${this.kind}] Failed to update plugin source '${updateLabel}':`, err);
			if (!options?.silent) {
				this._notificationService.notify({
					severity: Severity.Error,
					message: localize('pullPluginSourceFailed', "Failed to update plugin '{0}': {1}", failureLabel, err?.message ?? String(err)),
				});
			}
			throw err;
		}
	}

	// -- internal helpers ---

	private _artifactPath(descriptor: IPluginSourceDescriptor): string | undefined {
		const git = descriptor as IGitHubPluginSource | IGitUrlPluginSource;
		return git.path;
	}

	private async _installRepository(
		repoDir: URI,
		plugin: IMarketplacePlugin,
		progressTitle: string,
		failureLabel: string,
		prepare: (staging: URI, token: CancellationToken) => Promise<void>,
	): Promise<void> {
		const cts = new CancellationTokenSource();
		try {
			await this._progressService.withProgress(
				{
					location: ProgressLocation.Notification,
					title: progressTitle,
					cancellable: true,
				},
				() => runPluginInstallTransaction(this._fileService, {
					target: repoDir,
					expectedDigest: plugin.sourceDescriptor.digest,
					artifactPath: this._artifactPath(plugin.sourceDescriptor),
					provenance: pluginInstallProvenance(plugin, this.getLabel(plugin.sourceDescriptor)),
					prepare: staging => prepare(staging, cts.token),
				}),
				() => cts.dispose(true),
			);
		} catch (err) {
			this._logService.error(`[${this.kind}] Failed to install ${this.getLabel(plugin.sourceDescriptor)}:`, err);
			this._notificationService.notify({
				severity: Severity.Error,
				message: localize('pluginSourceInstallFailed', "Failed to install plugin '{0}': {1}", failureLabel, err?.message ?? String(err)),
			});
			throw err;
		} finally {
			cts.dispose();
		}
	}

	private async _checkoutRevision(repoDir: URI, descriptor: IPluginSourceDescriptor, failureLabel: string, token?: CancellationToken): Promise<void> {
		const git = descriptor as IGitHubPluginSource | IGitUrlPluginSource;
		if (!git.sha && !git.ref) {
			return;
		}

		try {
			if (git.sha) {
				await this._pluginGit.checkoutCommit(repoDir, git.sha, token);
				return;
			}
			// git.ref is guaranteed non-nullish by the guard above
			await this._pluginGit.checkout(repoDir, git.ref!, undefined, token);
		} catch (err) {
			this._logService.error(`[${this.kind}] Failed to checkout revision for '${failureLabel}':`, err);
			this._notificationService.notify({
				severity: Severity.Error,
				message: localize('checkoutPluginSourceFailed', "Failed to checkout plugin '{0}' to requested revision: {1}", failureLabel, err?.message ?? String(err)),
			});
			throw err;
		}
	}
}

// ---------------------------------------------------------------------------
// RelativePath — plugin lives inside a shared marketplace repository
// ---------------------------------------------------------------------------

export class RelativePathPluginSource implements IPluginSource {
	readonly kind = PluginSourceKind.RelativePath;

	getInstallUri(_cacheRoot: URI, _descriptor: IPluginSourceDescriptor): URI {
		throw new Error('Use getPluginInstallUri() for relative-path sources');
	}

	async ensure(_cacheRoot: URI, _plugin: IMarketplacePlugin, _options?: IEnsureRepositoryOptions): Promise<URI> {
		throw new Error('Use ensureRepository() for relative-path sources');
	}

	async update(_cacheRoot: URI, _plugin: IMarketplacePlugin, _options?: IPullRepositoryOptions): Promise<boolean> {
		throw new Error('Use pullRepository() for relative-path sources');
	}

	getCleanupTarget(_cacheRoot: URI, _descriptor: IPluginSourceDescriptor): URI | undefined {
		return undefined;
	}

	getLabel(descriptor: IPluginSourceDescriptor): string {
		return (descriptor as { path: string }).path || '.';
	}
}

// ---------------------------------------------------------------------------
// GitHub — `{ source: "github", repo: "owner/repo" }`
// ---------------------------------------------------------------------------

export class GitHubPluginSource extends AbstractGitPluginSource {
	readonly kind = PluginSourceKind.GitHub;

	/** Returns the URI where the plugin content lives (repo root + optional sub-path). */
	getInstallUri(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const repoDir = this._getRepoDir(cacheRoot, descriptor);
		const gh = descriptor as IGitHubPluginSource;
		if (gh.path) {
			const normalizedPath = gh.path.trim().replace(/^\.?\/+|\/+$/g, '');
			if (normalizedPath) {
				const target = joinPath(repoDir, normalizedPath);
				if (isEqualOrParent(target, repoDir)) {
					return target;
				}
			}
		}
		return repoDir;
	}

	/** Returns the cloned repository root (without sub-path). */
	protected override _getRepoDir(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const gh = descriptor as IGitHubPluginSource;
		const [owner, repo] = gh.repo.split('/');
		return joinPath(cacheRoot, 'github.com', owner, repo, ...gitRevisionCacheSuffix(gh.ref, gh.sha));
	}

	getLabel(descriptor: IPluginSourceDescriptor): string {
		const gh = descriptor as IGitHubPluginSource;
		return gh.path ? `${gh.repo}/${gh.path}` : gh.repo;
	}

	protected _cloneUrl(descriptor: IPluginSourceDescriptor): string {
		return `https://github.com/${(descriptor as IGitHubPluginSource).repo}.git`;
	}

	protected _displayLabel(descriptor: IPluginSourceDescriptor): string {
		return (descriptor as IGitHubPluginSource).repo;
	}
}

// ---------------------------------------------------------------------------
// GitUrl — `{ source: "url", url: "https://…/repo.git" }`
// ---------------------------------------------------------------------------

export class GitUrlPluginSource extends AbstractGitPluginSource {
	readonly kind = PluginSourceKind.GitUrl;

	/** Returns the URI where the plugin content lives (repo root + optional sub-path). */
	getInstallUri(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const repoDir = this._getRepoDir(cacheRoot, descriptor);
		const git = descriptor as IGitUrlPluginSource;
		if (git.path) {
			const normalizedPath = git.path.trim().replace(/^\.?\/+|\/+$/g, '');
			if (normalizedPath) {
				const target = joinPath(repoDir, normalizedPath);
				if (isEqualOrParent(target, repoDir)) {
					return target;
				}
			}
		}
		return repoDir;
	}

	/** Returns the cloned repository root (without sub-path). */
	protected override _getRepoDir(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const git = descriptor as IGitUrlPluginSource;
		const segments = this._gitUrlCacheSegments(git.url, git.ref, git.sha);
		return joinPath(cacheRoot, ...segments);
	}

	getLabel(descriptor: IPluginSourceDescriptor): string {
		const git = descriptor as IGitUrlPluginSource;
		return git.path ? `${git.url}/${git.path}` : git.url;
	}

	protected _cloneUrl(descriptor: IPluginSourceDescriptor): string {
		return (descriptor as IGitUrlPluginSource).url;
	}

	protected _displayLabel(descriptor: IPluginSourceDescriptor): string {
		return (descriptor as IGitUrlPluginSource).url;
	}

	private _gitUrlCacheSegments(url: string, ref?: string, sha?: string): string[] {
		try {
			const parsed = URI.parse(url);
			const authority = (parsed.authority || 'unknown').replace(/[\\/:*?"<>|]/g, '_').toLowerCase();
			const pathPart = parsed.path.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/g, '');
			const segments = pathPart.split('/').map(s => s.replace(/[\\/:*?"<>|]/g, '_'));
			return [authority, ...segments, ...gitRevisionCacheSuffix(ref, sha)];
		} catch {
			return ['git', url.replace(/[\\/:*?"<>|]/g, '_'), ...gitRevisionCacheSuffix(ref, sha)];
		}
	}
}

// ---------------------------------------------------------------------------
// Registry — immutable, signed artifact served by an HTTP registry
// ---------------------------------------------------------------------------

const REGISTRY_ARTIFACT_MEDIA_TYPE = 'application/vnd.openide.plugin+json';
const MAX_REGISTRY_ARTIFACT_RESPONSE_BYTES = 48 * 1024 * 1024;
const MAX_REGISTRY_ARTIFACT_CONTENT_BYTES = 32 * 1024 * 1024;
const MAX_REGISTRY_ARTIFACT_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REGISTRY_ARTIFACT_FILES = 1_000;
const REGISTRY_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REGISTRY_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const WINDOWS_RESERVED_FILE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

interface IRegistryArtifactFile {
	readonly path: string;
	readonly mode: 0o644;
	readonly contents: VSBuffer;
}

function assertExactObjectKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const canonicalExpected = [...expected].sort();
	if (actual.length !== canonicalExpected.length || actual.some((key, index) => key !== canonicalExpected[index])) {
		throw new Error(`${label} contains unsupported or missing fields`);
	}
}

function asRegistryObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function compareRegistryPaths(left: string, right: string): number {
	return left === right ? 0 : left < right ? -1 : 1;
}

function validateRegistryArtifactPath(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value !== value.normalize('NFC')) {
		throw new Error('Registry artifact file path is invalid');
	}
	if (value.startsWith('/') || value.endsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error(`Registry artifact path '${value}' is unsafe`);
	}
	const segments = value.split('/');
	if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.length > 255 || /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || WINDOWS_RESERVED_FILE_NAME_PATTERN.test(segment))) {
		throw new Error(`Registry artifact path '${value}' is not portable`);
	}
	return value;
}

async function parseRegistryArtifact(bytes: VSBuffer): Promise<readonly IRegistryArtifactFile[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString());
	} catch {
		throw new Error('Registry artifact is not valid JSON');
	}

	const artifact = asRegistryObject(parsed, 'Registry artifact');
	assertExactObjectKeys(artifact, ['schemaVersion', 'files'], 'Registry artifact');
	if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.files) || artifact.files.length === 0 || artifact.files.length > MAX_REGISTRY_ARTIFACT_FILES) {
		throw new Error('Registry artifact does not use the supported schema');
	}

	const files: IRegistryArtifactFile[] = [];
	const exactPaths = new Set<string>();
	const portablePaths = new Set<string>();
	let previousPath = '';
	let totalContentBytes = 0;
	for (let index = 0; index < artifact.files.length; index++) {
		const rawFile = asRegistryObject(artifact.files[index], `Registry artifact file ${index}`);
		assertExactObjectKeys(rawFile, ['content', 'mode', 'path', 'sha256', 'size'], `Registry artifact file ${index}`);
		const path = validateRegistryArtifactPath(rawFile.path);
		const portablePath = path.toLowerCase();
		if (exactPaths.has(path) || portablePaths.has(portablePath) || previousPath && compareRegistryPaths(previousPath, path) >= 0) {
			throw new Error(`Registry artifact path '${path}' is duplicated or out of order`);
		}
		exactPaths.add(path);
		portablePaths.add(portablePath);
		previousPath = path;

		// Artifact schema v1 intentionally supports regular non-executable files
		// only: IFileService has no portable API for setting executable mode.
		if (rawFile.mode !== 0o644) {
			throw new Error(`Registry artifact file '${path}' has an unsupported mode`);
		}
		if (!Number.isSafeInteger(rawFile.size) || typeof rawFile.size !== 'number' || rawFile.size < 0 || rawFile.size > MAX_REGISTRY_ARTIFACT_FILE_BYTES || typeof rawFile.sha256 !== 'string' || !REGISTRY_SHA256_PATTERN.test(rawFile.sha256) || typeof rawFile.content !== 'string' || !REGISTRY_BASE64_PATTERN.test(rawFile.content)) {
			throw new Error(`Registry artifact file '${path}' has invalid metadata`);
		}

		let contents: VSBuffer;
		try {
			contents = decodeBase64(rawFile.content);
		} catch {
			throw new Error(`Registry artifact file '${path}' has invalid base64 content`);
		}
		if (encodeBase64(contents, true, false) !== rawFile.content || contents.byteLength !== rawFile.size || await computePluginArtifactSha256(contents) !== rawFile.sha256) {
			throw new Error(`Registry artifact file '${path}' failed integrity verification`);
		}
		totalContentBytes += contents.byteLength;
		if (totalContentBytes > MAX_REGISTRY_ARTIFACT_CONTENT_BYTES) {
			throw new Error('Registry artifact content exceeds the size limit');
		}
		files.push({ path, mode: rawFile.mode, contents });
	}
	const portableDirectories = new Map<string, string>();
	for (const file of files) {
		const fileKey = file.path.toLowerCase();
		const conflictingDirectory = portableDirectories.get(fileKey);
		if (conflictingDirectory) {
			throw new Error(`Registry artifact file '${file.path}' conflicts with directory '${conflictingDirectory}'`);
		}
		const segments = file.path.split('/');
		for (let index = 1; index < segments.length; index++) {
			const directory = segments.slice(0, index).join('/');
			const directoryKey = directory.toLowerCase();
			if (portablePaths.has(directoryKey)) {
				throw new Error(`Registry artifact path '${file.path}' conflicts with file '${directory}'`);
			}
			const previousDirectory = portableDirectories.get(directoryKey);
			if (previousDirectory && previousDirectory !== directory) {
				throw new Error(`Registry artifact directories '${previousDirectory}' and '${directory}' are not portable`);
			}
			portableDirectories.set(directoryKey, directory);
		}
	}

	if (!exactPaths.has('plugin.json')) {
		throw new Error('Registry artifact does not contain a root plugin.json');
	}
	return files;
}

export class RegistryPluginSource implements IPluginSource {
	readonly kind = PluginSourceKind.Registry;
	private readonly _installSequencer = new SequencerByKey<string>();

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IProgressService private readonly _progressService: IProgressService,
		@IRequestService private readonly _requestService: IRequestService,
	) { }

	getInstallUri(cacheRoot: URI, descriptorValue: IPluginSourceDescriptor): URI {
		const descriptor = descriptorValue as IRegistryPluginSource;
		return getRegistryPluginInstallUri(cacheRoot, descriptor.url, descriptor.release.publisherId, descriptor.release.pluginId);
	}

	getCleanupTarget(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI | undefined {
		return this.getInstallUri(cacheRoot, descriptor);
	}

	getLabel(descriptorValue: IPluginSourceDescriptor): string {
		const descriptor = descriptorValue as IRegistryPluginSource;
		return `${descriptor.release.publisherId}/${descriptor.release.pluginId}@${descriptor.release.version}`;
	}

	async ensure(cacheRoot: URI, plugin: IMarketplacePlugin, options?: IEnsureRepositoryOptions): Promise<URI> {
		const target = this.getInstallUri(cacheRoot, plugin.sourceDescriptor);
		return this._installSequencer.queue(target.toString(), async () => {
			if (await this._isCurrentInstall(target, plugin)) {
				return target;
			}
			await this._install(plugin, target, {
				progressTitle: options?.progressTitle ?? localize('installingRegistryPlugin', "Installing plugin '{0}'...", plugin.name),
				failureLabel: options?.failureLabel ?? plugin.name,
				parentToken: options?.token,
			});
			return target;
		});
	}

	async update(cacheRoot: URI, plugin: IMarketplacePlugin, options?: IPullRepositoryOptions): Promise<boolean> {
		const target = this.getInstallUri(cacheRoot, plugin.sourceDescriptor);
		return this._installSequencer.queue(target.toString(), async () => {
			if (await this._isCurrentInstall(target, plugin)) {
				return false;
			}
			return await this._install(plugin, target, {
				progressTitle: localize('updatingRegistryPlugin', "Updating plugin '{0}'...", options?.pluginName ?? plugin.name),
				failureLabel: options?.failureLabel ?? options?.pluginName ?? plugin.name,
				silent: options?.silent,
			});
		});
	}

	private async _isCurrentInstall(target: URI, plugin: IMarketplacePlugin): Promise<boolean> {
		const descriptor = plugin.sourceDescriptor as IRegistryPluginSource;
		const receipt = await verifyPluginInstall(this._fileService, target, descriptor.digest);
		return receipt?.provenance.sourceKind === PluginSourceKind.Registry
			&& receipt.provenance.source === descriptor.url
			&& receipt.provenance.publisherId === descriptor.release.publisherId
			&& receipt.provenance.artifactSha256 === descriptor.artifactSha256
			&& receipt.provenance.signingKeyId === descriptor.release.signingKeyId
			&& receipt.provenance.pluginName === plugin.name
			&& receipt.provenance.pluginVersion === descriptor.release.version;
	}

	private async _install(plugin: IMarketplacePlugin, target: URI, options: { progressTitle: string; failureLabel: string; silent?: boolean; parentToken?: CancellationToken }): Promise<boolean> {
		const perform = async (token: CancellationToken): Promise<boolean> => {
			const descriptor = plugin.sourceDescriptor as IRegistryPluginSource;
			const release = parsePluginReleaseManifest(descriptor.release);
			const signature = parsePluginReleaseSignature(descriptor.signature);
			const publisher = await verifyPluginPublisherIdentity(parsePluginPublisherIdentity(descriptor.publisher));
			const registryUri = plugin.marketplaceReference.registryUri;
			const artifactUri = URI.parse(descriptor.url);
			const catalogSuffix = '/v1/marketplace.json';
			const registryBasePath = registryUri?.path.endsWith(catalogSuffix) ? registryUri.path.slice(0, -catalogSuffix.length) : undefined;
			const expectedArtifactPath = registryBasePath === undefined ? undefined : `${registryBasePath}/v1/publishers/${release.publisherId}/plugins/${release.pluginId}/versions/${release.version}/artifact`;
			if (plugin.marketplaceReference.kind !== MarketplaceReferenceKind.HttpRegistry
				|| !registryUri
				|| artifactUri.scheme.toLowerCase() !== registryUri.scheme.toLowerCase()
				|| artifactUri.authority.toLowerCase() !== registryUri.authority.toLowerCase()
				|| artifactUri.path !== expectedArtifactPath
				|| !!artifactUri.query
				|| !!artifactUri.fragment) {
				throw new Error('Registry artifact URL does not match the catalog origin and signed release coordinates');
			}
			if (descriptor.artifactSha256 !== release.artifact.sha256) {
				throw new Error('Registry artifact digest does not match the signed release');
			}
			if (release.artifact.mediaType !== REGISTRY_ARTIFACT_MEDIA_TYPE || release.artifact.size > MAX_REGISTRY_ARTIFACT_RESPONSE_BYTES) {
				throw new Error('Registry artifact has an unsupported media type or size');
			}
			if (plugin.name !== `${release.publisherId}/${release.pluginId}` || plugin.version !== release.version || publisher.publisherId !== release.publisherId) {
				throw new Error('Registry plugin coordinates do not match the signed release');
			}
			await verifyPluginReleaseSignature(release, signature, publisher);
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			const response = await this._requestService.request({
				url: descriptor.url,
				type: 'GET',
				headers: { Accept: REGISTRY_ARTIFACT_MEDIA_TYPE },
				followRedirects: 0,
				callSite: 'registryPluginSource',
			}, token);
			if (!isSuccess(response)) {
				response.stream.destroy();
				throw new Error(`Registry artifact request failed with HTTP ${response.res.statusCode ?? 0}`);
			}
			const contentType = readHeader(response.res.headers, 'content-type');
			if (contentType !== REGISTRY_ARTIFACT_MEDIA_TYPE) {
				response.stream.destroy();
				throw new Error(`Registry artifact response has unsupported Content-Type '${contentType ?? ''}'`);
			}
			const contentLength = readHeader(response.res.headers, 'content-length');
			if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) !== release.artifact.size)) {
				response.stream.destroy();
				throw new Error('Registry artifact response Content-Length does not match the signed release');
			}
			const artifactBytes = await this._readExactResponse(response.stream, release.artifact.size, token);
			if (await computePluginArtifactSha256(artifactBytes) !== descriptor.artifactSha256) {
				throw new Error('Registry artifact response failed SHA-256 verification');
			}
			const files = await parseRegistryArtifact(artifactBytes);

			const transaction = await runPluginInstallTransaction(this._fileService, {
				target,
				expectedDigest: descriptor.digest,
				provenance: pluginInstallProvenance(plugin, descriptor.url),
				prepare: async staging => {
					await this._fileService.createFolder(staging);
					for (const file of files) {
						const resource = joinPath(staging, ...file.path.split('/'));
						if (!isEqualOrParent(resource, staging)) {
							throw new Error(`Registry artifact path '${file.path}' escapes the staging directory`);
						}
						await this._fileService.createFolder(dirname(resource));
						await this._fileService.writeFile(resource, file.contents);
					}
					const manifest = await readAgentPluginManifest(staging, this._fileService);
					if (!manifest || manifest.name !== release.pluginId || manifest.version !== release.version) {
						throw new Error('Registry artifact plugin.json does not match the signed release');
					}
				},
			});
			return transaction.changed;
		};

		try {
			if (options.silent) {
				return await perform(options.parentToken ?? CancellationToken.None);
			}
			const cts = new CancellationTokenSource(options.parentToken);
			try {
				return await this._progressService.withProgress(
					{
						location: ProgressLocation.Notification,
						title: options.progressTitle,
						cancellable: true,
					},
					() => perform(cts.token),
					() => cts.dispose(true),
				);
			} finally {
				cts.dispose();
			}
		} catch (error) {
			this._logService.error(`[${this.kind}] Failed to install signed registry plugin '${plugin.name}':`, error);
			if (!options.silent) {
				this._notificationService.notify({
					severity: Severity.Error,
					message: localize('registryPluginInstallFailed', "Failed to install plugin '{0}': {1}", options.failureLabel, error instanceof Error ? error.message : String(error)),
				});
			}
			throw error;
		}
	}

	private async _readExactResponse(stream: VSBufferReadableStream, expectedSize: number, token: CancellationToken): Promise<VSBuffer> {
		if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_REGISTRY_ARTIFACT_RESPONSE_BYTES) {
			stream.destroy();
			throw new Error('Registry artifact response size is invalid');
		}
		if (token.isCancellationRequested) {
			stream.destroy();
			throw new CancellationError();
		}
		return new Promise<VSBuffer>((resolve, reject) => {
			const chunks: VSBuffer[] = [];
			let received = 0;
			let settled = false;
			let cancellation: IDisposable | undefined;
			const settleError = (error: unknown): void => {
				if (settled) {
					return;
				}
				settled = true;
				cancellation?.dispose();
				stream.destroy();
				reject(error);
			};
			cancellation = token.onCancellationRequested(() => settleError(new CancellationError()));
			if (token.isCancellationRequested) {
				settleError(new CancellationError());
				return;
			}
			listenStream(stream, {
				onData: chunk => {
					if (settled) {
						return;
					}
					received += chunk.byteLength;
					if (received > expectedSize || received > MAX_REGISTRY_ARTIFACT_RESPONSE_BYTES) {
						settleError(new Error('Registry artifact response exceeds its signed size'));
						return;
					}
					chunks.push(chunk);
				},
				onError: settleError,
				onEnd: () => {
					if (settled) {
						return;
					}
					if (received !== expectedSize) {
						settleError(new Error(`Registry artifact response size mismatch: expected ${expectedSize}, got ${received}`));
						return;
					}
					settled = true;
					cancellation?.dispose();
					resolve(VSBuffer.concat(chunks, received));
				},
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Base for package-manager-based sources (npm, pip)
// ---------------------------------------------------------------------------

export abstract class AbstractPackagePluginSource implements IPluginSource {
	abstract readonly kind: PluginSourceKind;
	constructor(
		@IDialogService protected readonly _dialogService: IDialogService,
		@IFileService protected readonly _fileService: IFileService,
		@ILogService protected readonly _logService: ILogService,
		@INotificationService protected readonly _notificationService: INotificationService,
		@IProgressService protected readonly _progressService: IProgressService,
		@ITerminalService protected readonly _terminalService: ITerminalService,
	) { }

	abstract getInstallUri(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI;
	abstract getLabel(descriptor: IPluginSourceDescriptor): string;

	getCleanupTarget(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI | undefined {
		return this._getCacheDir(cacheRoot, descriptor);
	}

	/**
	 * Return the parent directory (prefix / target) where the package
	 * manager installs into. This is above the actual plugin content dir.
	 */
	protected abstract _getCacheDir(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI;

	/** Build the terminal command args for install. */
	protected abstract _buildInstallArgs(installDir: URI, plugin: IMarketplacePlugin): string[];

	/** Human-readable package manager name for messages. */
	protected abstract get _managerName(): string;

	async ensure(cacheRoot: URI, plugin: IMarketplacePlugin, _options?: IEnsureRepositoryOptions): Promise<URI> {
		const cacheDir = this._getCacheDir(cacheRoot, plugin.sourceDescriptor);
		await this._fileService.createFolder(dirname(cacheDir));
		return cacheDir;
	}

	async update(cacheRoot: URI, plugin: IMarketplacePlugin, _options?: IPullRepositoryOptions): Promise<boolean> {
		// For package-manager sources, "update" re-runs install.
		const installDir = this._getCacheDir(cacheRoot, plugin.sourceDescriptor);
		const pluginDir = this.getInstallUri(cacheRoot, plugin.sourceDescriptor);
		const result = await this.runInstall(installDir, pluginDir, plugin, { silent: _options?.silent });
		return result?.changed ?? false;
	}

	async runInstall(installDir: URI, pluginDir: URI, plugin: IMarketplacePlugin, options?: { silent?: boolean }): Promise<{ pluginDir: URI; changed: boolean } | undefined> {
		const displayCommand = formatShellCommand(this._buildInstallArgs(installDir, plugin));
		const confirmed = await this._confirmTerminalCommand(plugin.name, displayCommand, options?.silent);
		if (!confirmed) {
			return undefined;
		}

		const progressTitle = localize('installingPackagePlugin', "Installing {0} plugin '{1}'...", this._managerName, plugin.name);
		const artifactPath = extUri.relativePath(installDir, pluginDir);
		if (artifactPath === undefined) {
			throw new Error(`Plugin directory '${pluginDir.toString()}' is outside install directory '${installDir.toString()}'`);
		}

		let terminal: ITerminalInstance | undefined;
		let commandFailed = false;
		try {
			const transaction = await runPluginInstallTransaction(this._fileService, {
				target: installDir,
				expectedDigest: plugin.sourceDescriptor.digest,
				artifactPath,
				provenance: pluginInstallProvenance(plugin, this.getLabel(plugin.sourceDescriptor)),
				prepare: async staging => {
					const stagedPluginDir = artifactPath ? joinPath(staging, artifactPath) : staging;
					const command = formatShellCommand(this._buildInstallArgs(staging, plugin));
					const result = await this._runTerminalCommand(command, progressTitle);
					terminal = result.terminal;
					if (!result.success) {
						commandFailed = true;
						throw new Error('Package manager command failed');
					}
					if (!await this._fileService.exists(stagedPluginDir)) {
						this._notificationService.notify({
							severity: Severity.Error,
							message: localize('packagePluginNotFound', "{0} package '{1}' was not found after installation.", this._managerName, this.getLabel(plugin.sourceDescriptor)),
						});
						throw new Error('Installed package plugin directory not found');
					}
				},
			});
			terminal?.dispose();
			return { pluginDir, changed: transaction.changed };
		} catch (err) {
			if (!commandFailed) {
				this._logService.error(`[${this.kind}] Package plugin verification failed:`, err);
				this._notificationService.notify({
					severity: Severity.Error,
					message: localize('packagePluginVerificationFailed', "Plugin '{0}' could not be verified or promoted: {1}", plugin.name, err instanceof Error ? err.message : String(err)),
				});
			}
			return undefined;
		}
	}

	// -- terminal helpers (moved from PluginInstallService) ---

	private async _confirmTerminalCommand(pluginName: string, command: string, silent?: boolean): Promise<boolean> {
		if (silent) {
			return new Promise<boolean>(resolve => {
				const n = this._notificationService.notify({
					severity: Severity.Info,
					message: localize('confirmPluginInstallNotification', "Plugin '{0}' wants to run: {1}", pluginName, command),
					actions: {
						primary: [
							new Action('installPlugin', localize('install', "Install"), undefined, true, async () => resolve(true)),
						],
					},
				});

				Event.once(n.onDidClose)(() => resolve(false));
			});
		}

		const { confirmed } = await this._dialogService.confirm({
			type: 'question',
			message: localize('confirmPluginInstall', "Install Plugin '{0}'?", pluginName),
			detail: localize('confirmPluginInstallDetail', "This will run the following command in a terminal:\n\n{0}", command),
			primaryButton: localize({ key: 'confirmInstall', comment: ['&& denotes a mnemonic'] }, "&&Install"),
		});
		return confirmed;
	}

	private async _runTerminalCommand(command: string, progressTitle: string) {
		let terminal: ITerminalInstance | undefined;
		try {
			await this._progressService.withProgress(
				{
					location: ProgressLocation.Notification,
					title: progressTitle,
					cancellable: false,
				},
				async () => {
					terminal = await this._terminalService.createTerminal({
						config: {
							name: localize('pluginInstallTerminal', "Plugin Install"),
							forceShellIntegration: true,
							isTransient: true,
							isFeatureTerminal: true,
						},
					});
					await terminal.processReady;
					this._terminalService.setActiveInstance(terminal);

					const commandResultPromise = this._waitForTerminalCommandCompletion(terminal);
					await terminal.runCommand(command, true);
					const exitCode = await commandResultPromise;
					if (exitCode !== 0) {
						throw new Error(localize('terminalCommandExitCode', "Command exited with code {0}", exitCode));
					}
				}
			);
			return { success: true, terminal };
		} catch (err) {
			this._logService.error(`[${this.kind}] Terminal command failed:`, err);
			this._notificationService.notify({
				severity: Severity.Error,
				message: localize('terminalCommandFailed', "Plugin installation command failed: {0}", err?.message ?? String(err)),
			});
			return { success: false, terminal };
		}
	}

	private _waitForTerminalCommandCompletion(terminal: ITerminalInstance): Promise<number | undefined> {
		return new Promise<number | undefined>(resolve => {
			const disposables = new DisposableStore();
			let isResolved = false;

			const resolveAndDispose = (exitCode: number | undefined): void => {
				if (isResolved) {
					return;
				}
				isResolved = true;
				disposables.dispose();
				resolve(exitCode);
			};

			const attachCommandFinishedListener = (): void => {
				const commandDetection = terminal.capabilities.get(TerminalCapability.CommandDetection);
				if (!commandDetection) {
					return;
				}
				disposables.add(commandDetection.onCommandFinished((command: ITerminalCommand) => {
					resolveAndDispose(command.exitCode ?? 0);
				}));
			};

			attachCommandFinishedListener();
			disposables.add(terminal.capabilities.onDidAddCommandDetectionCapability(() => attachCommandFinishedListener()));

			const timeoutHandle: CancelablePromise<void> = timeout(120_000);
			disposables.add(toDisposable(() => timeoutHandle.cancel()));
			void timeoutHandle.then(() => {
				if (isResolved) {
					return;
				}
				this._logService.warn(`[${this.kind}] Terminal command completion timed out`);
				resolveAndDispose(undefined);
			});
		});
	}
}

// ---------------------------------------------------------------------------
// npm — `{ source: "npm", package: "@org/plugin" }`
// ---------------------------------------------------------------------------

export class NpmPluginSource extends AbstractPackagePluginSource {
	readonly kind = PluginSourceKind.Npm;
	protected readonly _managerName = 'npm';

	getInstallUri(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const npm = descriptor as INpmPluginSource;
		return joinPath(cacheRoot, 'npm', sanitizeCacheSegment(npm.package), 'node_modules', npm.package);
	}

	getLabel(descriptor: IPluginSourceDescriptor): string {
		const npm = descriptor as INpmPluginSource;
		return npm.version ? `${npm.package}@${npm.version}` : npm.package;
	}

	protected _getCacheDir(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const npm = descriptor as INpmPluginSource;
		return joinPath(cacheRoot, 'npm', sanitizeCacheSegment(npm.package));
	}

	protected _buildInstallArgs(installDir: URI, plugin: IMarketplacePlugin): string[] {
		const npm = plugin.sourceDescriptor as INpmPluginSource;
		const packageSpec = npm.version ? `${npm.package}@${npm.version}` : npm.package;
		const args = ['npm', 'install', '--prefix', installDir.fsPath, packageSpec];
		if (npm.registry) {
			args.push('--registry', npm.registry);
		}
		return args;
	}
}

// ---------------------------------------------------------------------------
// pip — `{ source: "pip", package: "my-plugin" }`
// ---------------------------------------------------------------------------

export class PipPluginSource extends AbstractPackagePluginSource {
	readonly kind = PluginSourceKind.Pip;
	protected readonly _managerName = 'pip';

	getInstallUri(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const pip = descriptor as IPipPluginSource;
		return joinPath(cacheRoot, 'pip', sanitizeCacheSegment(pip.package));
	}

	getLabel(descriptor: IPluginSourceDescriptor): string {
		const pip = descriptor as IPipPluginSource;
		return pip.version ? `${pip.package}==${pip.version}` : pip.package;
	}

	protected _getCacheDir(cacheRoot: URI, descriptor: IPluginSourceDescriptor): URI {
		const pip = descriptor as IPipPluginSource;
		return joinPath(cacheRoot, 'pip', sanitizeCacheSegment(pip.package));
	}

	protected _buildInstallArgs(installDir: URI, plugin: IMarketplacePlugin): string[] {
		const pip = plugin.sourceDescriptor as IPipPluginSource;
		const packageSpec = pip.version ? `${pip.package}==${pip.version}` : pip.package;
		const args = ['pip', 'install', '--target', installDir.fsPath, packageSpec];
		if (pip.registry) {
			args.push('--index-url', pip.registry);
		}
		return args;
	}
}
