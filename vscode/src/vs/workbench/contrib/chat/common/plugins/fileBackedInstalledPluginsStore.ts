/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, ThrottledDelayer } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { revive } from '../../../../../base/common/marshalling.js';
import { IObservable, ITransaction, observableValue } from '../../../../../base/common/observable.js';
import { isEqual, isEqualOrParent, joinPath } from '../../../../../base/common/resources.js';
import { URI, UriComponents } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import type { IPluginSourceDescriptor, MarketplaceType } from './pluginMarketplaceService.js';
import { MarketplaceReferenceKind, parseMarketplaceReference } from './marketplaceReference.js';
import { normalizePluginTreeDigest } from './pluginInstallTransaction.js';
import { getRegistryPluginInstallUri, isCanonicalPluginRelativePath, isPortablePluginPackageName, isPortablePluginPathSegment } from './pluginPathValidation.js';
import { parsePluginPublisherIdentity, parsePluginReleaseManifest, parsePluginReleaseSignature } from './pluginSupplyChain.js';

const INSTALLED_JSON_FILENAME = 'installed.json';
const INSTALLED_JSON_VERSION = 2;

/** Legacy storage key used before migration to file-backed store. */
const LEGACY_INSTALLED_PLUGINS_STORAGE_KEY = 'chat.plugins.installed.v1';
/** Legacy storage key for the marketplace index that cached old URI paths. */
const LEGACY_MARKETPLACE_INDEX_STORAGE_KEY = 'chat.plugins.marketplaces.index.v1';

/**
 * Exact installed metadata persisted independently of the mutable marketplace
 * channel. This prevents a restart from silently replacing the installed
 * version, signed release, or digest with whatever the catalog serves later.
 */
export interface IStoredMarketplacePluginMetadata {
	readonly name: string;
	readonly description: string;
	readonly version: string;
	readonly source: string;
	readonly sourceDescriptor: IPluginSourceDescriptor;
	readonly marketplace: string;
	readonly marketplaceType: MarketplaceType;
	readonly readmeUri?: string;
}

interface IInstalledJsonEntry {
	readonly pluginUri: string;
	readonly marketplace: string;
	readonly name?: string;
	readonly plugin?: IStoredMarketplacePluginMetadata;
}

/**
 * On-disk schema for `installed.json`.
 */
interface IInstalledJson {
	readonly version: number;
	readonly installed: readonly IInstalledJsonEntry[];
}

/**
 * In-memory representation of an installed plugin entry.
 */
export interface IStoredInstalledPlugin {
	readonly pluginUri: URI;
	readonly marketplace: string;
	readonly name?: string;
	readonly plugin?: IStoredMarketplacePluginMetadata;
}

/**
 * An observable store for installed agent plugins that is backed by a
 * `installed.json` file within the agent-plugins directory. This makes
 * the installed-plugin manifest discoverable by external tools (CLIs,
 * other editors, etc.) without depending on VS Code internals.
 *
 * Version 2 stores the plugin URI plus the exact marketplace descriptor used
 * for installation. Version 1 identity-only files remain readable and are
 * hydrated from their marketplace when possible.
 *
 * On construction the store:
 * 1. Attempts to read `installed.json` from the agent-plugins directory.
 * 2. If no file exists, migrates data from the legacy {@link StorageService}
 *    key (`chat.plugins.installed.v1`), rebasing plugin URIs from the old
 *    cache directory to the new agent-plugins directory.
 * 3. Sets up a correlated file watcher so that external edits to
 *    `installed.json` are picked up automatically.
 *
 * Write operations update the in-memory observable synchronously and
 * schedule a debounced file write so that rapid successive mutations
 * (e.g. batch enables) are coalesced into a single I/O operation.
 */
export class FileBackedInstalledPluginsStore extends Disposable {
	private readonly _installed = observableValue<readonly IStoredInstalledPlugin[]>('file/installed.json', []);
	private readonly _fileUri: URI;
	private readonly _writeDelayer: ThrottledDelayer<void>;
	private _suppressFileWatch = false;
	private _initialized = false;

	readonly value: IObservable<readonly IStoredInstalledPlugin[]> = this._installed;

	constructor(
		private readonly _agentPluginsHome: URI,
		private readonly _oldCacheRoot: URI | undefined,
		private readonly _fileService: IFileService,
		private readonly _logService: ILogService,
		private readonly _storageService: IStorageService,
	) {
		super();
		this._fileUri = joinPath(_agentPluginsHome, INSTALLED_JSON_FILENAME);
		this._writeDelayer = this._register(new ThrottledDelayer<void>(100));
		void this._initialize();
	}

	get(): readonly IStoredInstalledPlugin[] {
		return this._installed.get();
	}

	set(newValue: readonly IStoredInstalledPlugin[], tx: ITransaction | undefined): void {
		this._setValue(newValue, tx, true);
	}

	private async _initialize(): Promise<void> {
		try {
			const read = await this._readFromFile();
			if (read !== undefined) {
				this._setValue(read, undefined, false);
			} else {
				// No installed.json yet — attempt migration from legacy storage.
				await this._migrateFromStorage();
			}
		} catch (error) {
			this._logService.error('[FileBackedInstalledPluginsStore] Initialization failed', error);
		}

		this._initialized = true;
		this._setupFileWatcher();
	}

	// --- File I/O ----------------------------------------------------------------

	private async _readFromFile(): Promise<readonly IStoredInstalledPlugin[] | undefined> {
		try {
			const exists = await this._fileService.exists(this._fileUri);
			if (!exists) {
				return undefined;
			}

			const content = await this._fileService.readFile(this._fileUri);
			const json: IInstalledJson = JSON.parse(content.value.toString());
			if (!json || (json.version !== 1 && json.version !== INSTALLED_JSON_VERSION) || !Array.isArray(json.installed)) {
				this._logService.warn('[FileBackedInstalledPluginsStore] installed.json has unexpected format, ignoring');
				return undefined;
			}

			// Version 1 entries contain only identity. Version 2 may additionally
			// carry the exact descriptor that was verified at install time.
			const installed: IStoredInstalledPlugin[] = [];
			for (const rawEntry of json.installed) {
				const entry = parseInstalledJsonEntry(rawEntry);
				if (!entry) {
					this._logService.warn('[FileBackedInstalledPluginsStore] Ignoring malformed installed.json entry');
					continue;
				}
				let pluginUri: URI;
				try {
					pluginUri = URI.parse(entry.pluginUri);
				} catch {
					this._logService.warn(`[FileBackedInstalledPluginsStore] Ignoring invalid plugin URI '${entry.pluginUri}'`);
					continue;
				}
				const plugin = json.version === INSTALLED_JSON_VERSION && entry.plugin !== undefined
					? parseStoredPluginMetadata(entry.plugin, entry.marketplace)
					: undefined;
				if (json.version === INSTALLED_JSON_VERSION && entry.plugin !== undefined && !plugin) {
					this._logService.warn(`[FileBackedInstalledPluginsStore] Ignoring invalid stored metadata for ${pluginUri.toString()}`);
					continue;
				}
				if (plugin && entry.name !== undefined && entry.name !== plugin.name) {
					this._logService.warn(`[FileBackedInstalledPluginsStore] Ignoring installed entry whose name does not match its stored metadata: ${pluginUri.toString()}`);
					continue;
				}
				if (!this._isAllowedPluginUri(pluginUri, entry.pluginUri, entry.marketplace, plugin)) {
					this._logService.warn(`[FileBackedInstalledPluginsStore] Ignoring plugin with an unsafe install URI: ${pluginUri.toString()}`);
					continue;
				}
				installed.push({
					pluginUri,
					marketplace: entry.marketplace,
					name: entry.name,
					plugin,
				});
			}
			return installed;
		} catch {
			return undefined;
		}
	}

	private _scheduleWrite(): void {
		void this._writeDelayer.trigger(async () => {
			await this._writeToFile();
		});
	}

	private async _writeToFile(): Promise<boolean> {
		const entries: IInstalledJsonEntry[] = this.get().map(e => ({
			pluginUri: e.pluginUri.toString(),
			marketplace: e.marketplace,
			...(e.name ? { name: e.name } : {}),
			...(e.plugin ? { plugin: e.plugin } : {}),
		}));

		const data: IInstalledJson = {
			version: INSTALLED_JSON_VERSION,
			installed: entries,
		};

		try {
			this._suppressFileWatch = true;
			const content = JSON.stringify(data, undefined, '\t');
			await this._fileService.createFolder(this._agentPluginsHome);
			await this._fileService.writeFile(this._fileUri, VSBuffer.fromString(content));
			return true;
		} catch (error) {
			this._logService.error('[FileBackedInstalledPluginsStore] Failed to write installed.json', error);
			return false;
		} finally {
			this._suppressFileWatch = false;
		}
	}

	// --- File watching ------------------------------------------------------------

	private _setupFileWatcher(): void {
		if (typeof this._fileService.createWatcher !== 'function') {
			return;
		}
		const dir = this._agentPluginsHome;
		const watcher = this._fileService.createWatcher(dir, { recursive: false, excludes: [] });
		this._register(watcher);

		const scheduler = this._register(new RunOnceScheduler(() => this._onFileChanged(), 100));
		this._register(watcher.onDidChange(e => {
			if (!this._suppressFileWatch && e.affects(this._fileUri)) {
				scheduler.schedule();
			}
		}));
	}

	private async _onFileChanged(): Promise<void> {
		const read = await this._readFromFile();
		if (read !== undefined) {
			// Suppress file write for externally triggered updates.
			this._suppressFileWatch = true;
			try {
				this._setValue(read, undefined, false);
			} finally {
				this._suppressFileWatch = false;
			}
		}
	}

	// --- Write-through to file ----------------------------------------------------

	private _setValue(newValue: readonly IStoredInstalledPlugin[], tx: ITransaction | undefined, scheduleWrite: boolean): void {
		this._installed.set(newValue, tx);
		// Only schedule writes after initialization and when not processing
		// an external file change.
		if (scheduleWrite && this._initialized && !this._suppressFileWatch) {
			this._scheduleWrite();
		}
	}

	// --- Migration from legacy storage -------------------------------------------

	private async _migrateFromStorage(): Promise<void> {
		const raw = this._storageService.get(LEGACY_INSTALLED_PLUGINS_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return;
		}

		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed) || parsed.length === 0) {
				return;
			}

			const migrated: IStoredInstalledPlugin[] = [];
			for (const entry of revive(parsed) as { pluginUri: UriComponents; plugin?: Partial<IStoredMarketplacePluginMetadata> & { marketplaceReference?: { rawValue?: string }; readmeUri?: URI } }[]) {
				const uri = URI.revive(entry.pluginUri);
				const pluginUri = this._rebasePluginUri(uri) ?? uri;
				const marketplace = entry.plugin?.marketplaceReference?.rawValue ?? '';
				if (!entry.plugin || !marketplace) {
					continue;
				}
				const { marketplaceReference: _marketplaceReference, readmeUri, ...legacyMetadata } = entry.plugin;
				const plugin = parseStoredPluginMetadata({
					...legacyMetadata,
					marketplace,
					sourceDescriptor: legacyMetadata.sourceDescriptor ?? (typeof legacyMetadata.source === 'string'
						? { kind: 'relativePath', path: legacyMetadata.source }
						: undefined),
					...(readmeUri ? { readmeUri: readmeUri.toString() } : {}),
				}, marketplace);
				if (!plugin || !this._isAllowedPluginUri(pluginUri, pluginUri.toString(), marketplace, plugin)) {
					this._logService.warn(`[FileBackedInstalledPluginsStore] Ignoring unsafe legacy installed plugin entry: ${pluginUri.toString()}`);
					continue;
				}
				migrated.push({
					pluginUri,
					marketplace,
					name: plugin.name,
					plugin,
				});
			}

			this._logService.info(`[FileBackedInstalledPluginsStore] Migrating ${migrated.length} plugin(s) from storage to installed.json`);

			// Set in memory and persist to file before removing legacy keys.
			this._setValue(migrated, undefined, false);
			const didPersist = await this._writeToFile();
			if (!didPersist) {
				return;
			}

			// Clean up legacy keys.
			this._storageService.remove(LEGACY_INSTALLED_PLUGINS_STORAGE_KEY, StorageScope.APPLICATION);
			this._storageService.remove(LEGACY_MARKETPLACE_INDEX_STORAGE_KEY, StorageScope.APPLICATION);
		} catch (error) {
			this._logService.error('[FileBackedInstalledPluginsStore] Migration from storage failed', error);
		}
	}

	/**
	 * If the plugin URI was under the old cache root, rebase it to the
	 * new agent-plugins directory. Otherwise, return `undefined` to keep
	 * the original.
	 */
	private _rebasePluginUri(uri: URI): URI | undefined {
		if (!this._oldCacheRoot) {
			return undefined;
		}

		const oldRoot = this._oldCacheRoot;
		if (!isEqual(uri, oldRoot) && uri.scheme === oldRoot.scheme && uri.path.startsWith(oldRoot.path + '/')) {
			const relativePart = uri.path.substring(oldRoot.path.length);
			return uri.with({ path: this._agentPluginsHome.path + relativePart });
		}
		return undefined;
	}

	/**
	 * Installed entries normally point at managed copies below agentPluginsHome.
	 * A relative-path plugin from a file:// marketplace is the deliberate
	 * exception: it remains in that local marketplace, and must resolve exactly
	 * to the descriptor path below (or at) the configured local root.
	 */
	private _isAllowedPluginUri(uri: URI, serializedUri: string, marketplaceRawValue: string, plugin: IStoredMarketplacePluginMetadata | undefined): boolean {
		if (uri.toString() !== serializedUri || uri.query || uri.fragment) {
			return false;
		}
		const marketplace = parseMarketplaceReference(marketplaceRawValue);
		if (!marketplace || marketplace.rawValue !== marketplaceRawValue) {
			return false;
		}
		if (marketplace.kind === MarketplaceReferenceKind.LocalFileUri) {
			const localRoot = marketplace.localRepositoryUri;
			if (!localRoot || hasTraversalSegment(localRoot.path)) {
				return false;
			}
			if (!plugin) {
				// Version 1 did not persist a descriptor, so containment is the
				// strongest compatibility-preserving check available.
				return isEqual(uri, localRoot) || isEqualOrParent(uri, localRoot);
			}
			if (plugin.sourceDescriptor.kind !== 'relativePath') {
				return false;
			}
			const expected = plugin.sourceDescriptor.path ? joinPath(localRoot, plugin.sourceDescriptor.path) : localRoot;
			return isEqual(uri, expected);
		}
		if (plugin?.sourceDescriptor.kind === 'registry' && marketplace.kind !== MarketplaceReferenceKind.HttpRegistry
			|| plugin?.sourceDescriptor.kind !== 'registry' && marketplace.kind === MarketplaceReferenceKind.HttpRegistry) {
			return false;
		}
		if (plugin?.sourceDescriptor.kind === 'registry') {
			const descriptor = plugin.sourceDescriptor;
			const expected = getRegistryPluginInstallUri(this._agentPluginsHome, descriptor.url, descriptor.release.publisherId, descriptor.release.pluginId);
			return isEqual(uri, expected);
		}
		return !isEqual(uri, this._agentPluginsHome) && isEqualOrParent(uri, this._agentPluginsHome);
	}
}

function parseInstalledJsonEntry(value: unknown): IInstalledJsonEntry | undefined {
	if (!isRecord(value) || hasUnknownKeys(value, ['pluginUri', 'marketplace', 'name', 'plugin']) || typeof value.pluginUri !== 'string' || typeof value.marketplace !== 'string' || value.name !== undefined && typeof value.name !== 'string') {
		return undefined;
	}
	return {
		pluginUri: value.pluginUri,
		marketplace: value.marketplace,
		...(value.name === undefined ? {} : { name: value.name }),
		...(value.plugin === undefined ? {} : { plugin: value.plugin as IStoredMarketplacePluginMetadata }),
	};
}

function parseStoredPluginMetadata(value: unknown, marketplaceRawValue: string): IStoredMarketplacePluginMetadata | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Partial<IStoredMarketplacePluginMetadata> & Record<string, unknown>;
	if (hasUnknownKeys(candidate, ['name', 'description', 'version', 'source', 'sourceDescriptor', 'marketplace', 'marketplaceType', 'readmeUri'])) {
		return undefined;
	}
	if (typeof candidate.name !== 'string'
		|| !candidate.name
		|| typeof candidate.description !== 'string'
		|| typeof candidate.version !== 'string'
		|| typeof candidate.source !== 'string'
		|| typeof candidate.marketplace !== 'string'
		|| candidate.marketplace.length === 0
		|| candidate.marketplace !== candidate.marketplace.trim()
		|| candidate.marketplace !== candidate.marketplace.normalize('NFC')
		|| /[\u0000-\u001f\u007f]/.test(candidate.marketplace)
		|| (candidate.marketplaceType !== 'copilot' && candidate.marketplaceType !== 'claude' && candidate.marketplaceType !== 'openPlugin')
		|| candidate.readmeUri !== undefined && typeof candidate.readmeUri !== 'string') {
		return undefined;
	}
	const sourceDescriptor = parseStoredPluginSourceDescriptor(candidate.sourceDescriptor, candidate.name, candidate.version, marketplaceRawValue);
	if (!sourceDescriptor
		|| sourceDescriptor.kind === 'relativePath' && candidate.source !== sourceDescriptor.path
		|| sourceDescriptor.kind !== 'relativePath' && candidate.source !== ''
		|| candidate.readmeUri !== undefined && !isValidUriString(candidate.readmeUri)) {
		return undefined;
	}
	return {
		name: candidate.name,
		description: candidate.description,
		version: candidate.version,
		source: candidate.source,
		sourceDescriptor,
		marketplace: candidate.marketplace,
		marketplaceType: candidate.marketplaceType,
		...(candidate.readmeUri ? { readmeUri: candidate.readmeUri } : {}),
	};
}

function parseStoredPluginSourceDescriptor(value: unknown, pluginName: string, pluginVersion: string, marketplaceRawValue: string): IPluginSourceDescriptor | undefined {
	if (!isRecord(value) || typeof value.kind !== 'string') {
		return undefined;
	}
	const digest = parseOptionalDigest(value.digest);
	if (value.digest !== undefined && !digest) {
		return undefined;
	}
	const withDigest = digest ? { digest } : {};
	switch (value.kind) {
		case 'relativePath':
			return !hasUnknownKeys(value, ['kind', 'path', 'digest']) && isCanonicalPluginRelativePath(value.path, true)
				? { kind: 'relativePath', path: value.path, ...withDigest } as IPluginSourceDescriptor
				: undefined;
		case 'github':
			return !hasUnknownKeys(value, ['kind', 'repo', 'ref', 'sha', 'path', 'digest'])
				&& typeof value.repo === 'string' && isPortableGitHubRepo(value.repo)
				&& isOptionalString(value.ref) && isOptionalGitSha(value.sha) && isOptionalCanonicalRelativePath(value.path)
				? { kind: 'github', repo: value.repo, ...(value.ref === undefined ? {} : { ref: value.ref }), ...(value.sha === undefined ? {} : { sha: value.sha }), ...(value.path === undefined ? {} : { path: value.path }), ...withDigest } as IPluginSourceDescriptor
				: undefined;
		case 'url':
			return !hasUnknownKeys(value, ['kind', 'url', 'ref', 'sha', 'path', 'digest'])
				&& typeof value.url === 'string' && isCanonicalGitUri(value.url)
				&& isOptionalString(value.ref) && isOptionalGitSha(value.sha) && isOptionalCanonicalRelativePath(value.path)
				? { kind: 'url', url: value.url, ...(value.ref === undefined ? {} : { ref: value.ref }), ...(value.sha === undefined ? {} : { sha: value.sha }), ...(value.path === undefined ? {} : { path: value.path }), ...withDigest } as IPluginSourceDescriptor
				: undefined;
		case 'npm':
		case 'pip':
			return !hasUnknownKeys(value, ['kind', 'package', 'version', 'registry', 'digest'])
				&& isPortablePluginPackageName(value.package)
				&& isOptionalString(value.version) && isOptionalString(value.registry)
				? { kind: value.kind, package: value.package, ...(value.version === undefined ? {} : { version: value.version }), ...(value.registry === undefined ? {} : { registry: value.registry }), ...withDigest } as IPluginSourceDescriptor
				: undefined;
		case 'registry':
			return parseStoredRegistrySource(value, pluginName, pluginVersion, marketplaceRawValue, digest);
		default:
			return undefined;
	}
}

function parseStoredRegistrySource(value: Record<string, unknown>, pluginName: string, pluginVersion: string, marketplaceRawValue: string, digest: string | undefined): IPluginSourceDescriptor | undefined {
	if (hasUnknownKeys(value, ['kind', 'url', 'artifactSha256', 'release', 'signature', 'publisher', 'digest']) || typeof value.url !== 'string' || typeof value.artifactSha256 !== 'string') {
		return undefined;
	}
	const reference = parseMarketplaceReference(marketplaceRawValue);
	if (reference?.kind !== MarketplaceReferenceKind.HttpRegistry || !reference.registryUri) {
		return undefined;
	}
	try {
		const release = parsePluginReleaseManifest(value.release);
		const signature = parsePluginReleaseSignature(value.signature);
		const publisher = parsePluginPublisherIdentity(value.publisher);
		if (pluginName !== `${release.publisherId}/${release.pluginId}`
			|| pluginVersion !== release.version
			|| !isPortablePluginPathSegment(release.publisherId)
			|| !isPortablePluginPathSegment(release.pluginId)
			|| value.artifactSha256 !== release.artifact.sha256
			|| release.artifact.mediaType !== 'application/vnd.openide.plugin+json'
			|| signature.keyId !== release.signingKeyId
			|| publisher.publisherId !== release.publisherId
			|| !publisher.keys.some(key => key.keyId === release.signingKeyId && key.state === 'active')) {
			return undefined;
		}
		const artifactUrl = new URL(value.url);
		const registryUrl = new URL(reference.registryUri.toString());
		const registryBasePath = registryUrl.pathname.slice(0, -'/v1/marketplace.json'.length);
		const expectedPath = `${registryBasePath}/v1/publishers/${encodeURIComponent(release.publisherId)}/plugins/${encodeURIComponent(release.pluginId)}/versions/${encodeURIComponent(release.version)}/artifact`;
		if (artifactUrl.toString() !== value.url || artifactUrl.origin !== registryUrl.origin || artifactUrl.username || artifactUrl.password || artifactUrl.search || artifactUrl.hash || artifactUrl.pathname !== expectedPath) {
			return undefined;
		}
		return {
			kind: 'registry',
			url: value.url,
			artifactSha256: value.artifactSha256,
			release,
			signature,
			publisher,
			...(digest ? { digest } : {}),
		} as IPluginSourceDescriptor;
	} catch {
		return undefined;
	}
}

function parseOptionalDigest(value: unknown): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	try {
		return normalizePluginTreeDigest(value);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).some(key => !allowed.includes(key));
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

function isOptionalGitSha(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string' && /^[0-9a-fA-F]{40}$/.test(value);
}

function isOptionalCanonicalRelativePath(value: unknown): value is string | undefined {
	return value === undefined || isCanonicalPluginRelativePath(value, true);
}

function isPortableGitHubRepo(value: string): boolean {
	const segments = value.split('/');
	return segments.length === 2
		&& segments.every(segment => /^[A-Za-z0-9_.-]+$/.test(segment) && isPortablePluginPathSegment(segment));
}

function isCanonicalGitUri(value: string): boolean {
	if (!value.toLowerCase().endsWith('.git') || hasTraversalSegment(value)) {
		return false;
	}
	const reference = parseMarketplaceReference(value);
	return reference?.kind === MarketplaceReferenceKind.GitUri && reference.rawValue === value && reference.ref === undefined;
}

function isValidUriString(value: string): boolean {
	try {
		const uri = URI.parse(value);
		return !!uri.scheme && uri.toString() === value;
	} catch {
		return false;
	}
}

function hasTraversalSegment(value: string): boolean {
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return true;
	}
	return decoded.split(/[\\/]/).some(segment => segment === '.' || segment === '..');
}
