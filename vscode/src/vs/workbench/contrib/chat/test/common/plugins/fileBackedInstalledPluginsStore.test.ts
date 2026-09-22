/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IFileService, IFileSystemWatcher } from '../../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { InMemoryStorageService, IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { FileBackedInstalledPluginsStore } from '../../../common/plugins/fileBackedInstalledPluginsStore.js';
import { MarketplaceType, PluginSourceKind, parseMarketplaceReference } from '../../../common/plugins/pluginMarketplaceService.js';

const LEGACY_INSTALLED_PLUGINS_STORAGE_KEY = 'chat.plugins.installed.v1';
const LEGACY_MARKETPLACE_INDEX_STORAGE_KEY = 'chat.plugins.marketplaces.index.v1';

class TestFileService {
	private readonly _files = new Map<string, string>();
	private readonly _folders = new Set<string>();

	constructor(private readonly _failWrites = false) { }

	async exists(resource: URI): Promise<boolean> {
		const key = resource.toString();
		return this._files.has(key) || this._folders.has(key);
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer }> {
		const key = resource.toString();
		const value = this._files.get(key);
		if (value === undefined) {
			throw new Error(`Missing file: ${key}`);
		}
		return { value: VSBuffer.fromString(value) };
	}

	async writeFile(resource: URI, content: VSBuffer): Promise<unknown> {
		if (this._failWrites) {
			throw new Error('write failed');
		}

		this._files.set(resource.toString(), content.toString());
		return {};
	}

	async createFolder(resource: URI): Promise<unknown> {
		this._folders.add(resource.toString());
		return {};
	}

	createWatcher(): IFileSystemWatcher {
		return {
			onDidChange: Event.None,
			dispose: () => { },
		};
	}

	setFile(resource: URI, content: string): void {
		this._files.set(resource.toString(), content);
	}

	getFile(resource: URI): string | undefined {
		return this._files.get(resource.toString());
	}
}

suite('FileBackedInstalledPluginsStore', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createLegacyEntry(pluginPath: string) {
		const reference = parseMarketplaceReference('microsoft/plugins');
		assert.ok(reference);

		return {
			pluginUri: URI.file(pluginPath),
			plugin: {
				name: 'my-plugin',
				description: 'A plugin',
				version: '1.0.0',
				source: 'plugins/my-plugin',
				sourceDescriptor: { kind: PluginSourceKind.RelativePath, path: 'plugins/my-plugin' } as const,
				marketplace: reference.displayLabel,
				marketplaceReference: reference,
				marketplaceType: MarketplaceType.Copilot,
			},
			enabled: true,
		};
	}

	async function waitFor(predicate: () => boolean): Promise<void> {
		for (let i = 0; i < 40; i++) {
			if (predicate()) {
				return;
			}
			await timeout(10);
		}

		assert.fail('Condition not met in time');
	}

	test('migrates legacy storage to installed.json and removes legacy keys', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const fileService = new TestFileService();

		const legacyEntry = createLegacyEntry('/cache/agentPlugins/github.com/microsoft/plugins/plugins/my-plugin');
		storageService.store(
			LEGACY_INSTALLED_PLUGINS_STORAGE_KEY,
			JSON.stringify([legacyEntry]),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);

		const agentPluginsHome = URI.file('/home/user/.vscode/agent-plugins');
		const installedJson = URI.joinPath(agentPluginsHome, 'installed.json');

		const pluginsStore = store.add(new FileBackedInstalledPluginsStore(
			agentPluginsHome,
			URI.file('/cache/agentPlugins'),
			fileService as unknown as IFileService,
			new NullLogService(),
			storageService as unknown as IStorageService,
		));

		await waitFor(() => !!fileService.getFile(installedJson));

		const serialized = fileService.getFile(installedJson);
		assert.ok(serialized);
		const parsed = JSON.parse(serialized!);
		assert.strictEqual(parsed.version, 2);
		assert.strictEqual(parsed.installed.length, 1);
		assert.ok(parsed.installed[0].pluginUri.includes('/home/user/.vscode/agent-plugins/github.com/microsoft/plugins/plugins/my-plugin'));
		assert.strictEqual(parsed.installed[0].name, 'my-plugin');
		assert.strictEqual(parsed.installed[0].plugin.version, '1.0.0');
		assert.deepStrictEqual(parsed.installed[0].plugin.sourceDescriptor, { kind: PluginSourceKind.RelativePath, path: 'plugins/my-plugin' });
		assert.strictEqual(pluginsStore.get().length, 1);

		assert.strictEqual(storageService.get(LEGACY_INSTALLED_PLUGINS_STORAGE_KEY, StorageScope.APPLICATION), undefined);
		assert.strictEqual(storageService.get(LEGACY_MARKETPLACE_INDEX_STORAGE_KEY, StorageScope.APPLICATION), undefined);
	});

	test('keeps legacy keys when migration write fails', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const fileService = new TestFileService(true);

		const legacyEntry = createLegacyEntry('/cache/agentPlugins/github.com/microsoft/plugins/plugins/my-plugin');
		storageService.store(
			LEGACY_INSTALLED_PLUGINS_STORAGE_KEY,
			JSON.stringify([legacyEntry]),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);

		storageService.store(
			LEGACY_MARKETPLACE_INDEX_STORAGE_KEY,
			JSON.stringify({ any: 'value' }),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);

		const agentPluginsHome = URI.file('/home/user/.vscode/agent-plugins');
		const installedJson = URI.joinPath(agentPluginsHome, 'installed.json');

		store.add(new FileBackedInstalledPluginsStore(
			agentPluginsHome,
			URI.file('/cache/agentPlugins'),
			fileService as unknown as IFileService,
			new NullLogService(),
			storageService as unknown as IStorageService,
		));

		await timeout(30);

		assert.strictEqual(fileService.getFile(installedJson), undefined);
		assert.ok(storageService.get(LEGACY_INSTALLED_PLUGINS_STORAGE_KEY, StorageScope.APPLICATION));
		assert.ok(storageService.get(LEGACY_MARKETPLACE_INDEX_STORAGE_KEY, StorageScope.APPLICATION));
	});

	test('loads existing installed.json on startup', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const fileService = new TestFileService();
		const agentPluginsHome = URI.file('/home/user/.vscode/agent-plugins');
		const installedJson = URI.joinPath(agentPluginsHome, 'installed.json');

		const existingData = {
			version: 1,
			installed: [{
				pluginUri: URI.file('/home/user/.vscode/agent-plugins/github.com/microsoft/plugins/plugins/my-plugin').toString(),
				marketplace: 'microsoft/plugins',
			}],
		};
		fileService.setFile(installedJson, JSON.stringify(existingData));

		const pluginsStore = store.add(new FileBackedInstalledPluginsStore(
			agentPluginsHome,
			URI.file('/cache/agentPlugins'),
			fileService as unknown as IFileService,
			new NullLogService(),
			storageService as unknown as IStorageService,
		));

		await waitFor(() => pluginsStore.get().length === 1);

		assert.strictEqual(pluginsStore.get()[0].pluginUri.path, '/home/user/.vscode/agent-plugins/github.com/microsoft/plugins/plugins/my-plugin');
	});

	test('ignores malicious v2 metadata and plugin URIs outside the managed home', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const fileService = new TestFileService();
		const agentPluginsHome = URI.file('/home/user/.vscode/agent-plugins');
		const installedJson = URI.joinPath(agentPluginsHome, 'installed.json');
		const relativeMetadata = {
			name: 'safe-plugin',
			description: 'Safe',
			version: '1.0.0',
			source: 'plugins/safe-plugin',
			sourceDescriptor: { kind: PluginSourceKind.RelativePath, path: 'plugins/safe-plugin' },
			marketplace: 'Microsoft Plugins',
			marketplaceType: MarketplaceType.Copilot,
		};
		const independentMetadata = {
			...relativeMetadata,
			source: '',
			sourceDescriptor: { kind: PluginSourceKind.GitHub, repo: 'microsoft/vscode' },
		};
		const signingKeyId = `sha256:${'b'.repeat(64)}`;
		const artifactSha256 = 'a'.repeat(64);
		const registryMetadata = {
			...independentMetadata,
			name: 'acme/lint-tools',
			marketplace: 'Acme Registry',
			sourceDescriptor: {
				kind: PluginSourceKind.Registry,
				url: 'https://plugins.example.test/v1/publishers/acme/plugins/lint-tools/versions/1.0.0/artifact',
				artifactSha256,
				release: {
					schemaVersion: 1,
					publisherId: 'acme',
					pluginId: 'lint-tools',
					version: '1.0.0',
					signingKeyId,
					createdAt: '2026-01-02T00:00:00.000Z',
					artifact: { mediaType: 'application/vnd.openide.plugin+json', size: 100, sha256: artifactSha256 },
				},
				signature: { algorithm: 'ed25519', keyId: signingKeyId, signature: 'A'.repeat(86) },
				publisher: {
					schemaVersion: 1,
					publisherId: 'acme',
					displayName: 'Acme',
					principal: { issuer: 'https://identity.example.test/', subject: 'account-42' },
					keys: [{ keyId: signingKeyId, algorithm: 'ed25519', publicKey: 'A'.repeat(43), state: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
				},
			},
		};
		fileService.setFile(installedJson, JSON.stringify({
			version: 2,
			installed: [
				{
					pluginUri: URI.joinPath(agentPluginsHome, 'github.com/microsoft/plugins/plugins/safe-plugin').toString(),
					marketplace: 'microsoft/plugins',
					name: 'safe-plugin',
					plugin: relativeMetadata,
				},
				{
					pluginUri: URI.file('/tmp/outside-plugin').toString(),
					marketplace: 'microsoft/plugins',
					name: 'safe-plugin',
					plugin: independentMetadata,
				},
				{
					pluginUri: URI.joinPath(agentPluginsHome, 'registry/escape').toString(),
					marketplace: 'https://plugins.example.test/v1/marketplace.json',
					name: '../../escape',
					plugin: {
						...independentMetadata,
						name: '../../escape',
						version: '1.0.0',
						sourceDescriptor: {
							kind: PluginSourceKind.Registry,
							url: 'https://plugins.example.test/v1/publishers/escape/plugins/plugin/versions/1.0.0/artifact',
							artifactSha256: 'a'.repeat(64),
							release: { schemaVersion: 1, publisherId: '../../escape' },
							signature: {},
							publisher: {},
						},
					},
				},
				{
					// The descriptor is valid, but its signed coordinates materialize at
					// a different exact URI than the one persisted here.
					pluginUri: URI.joinPath(agentPluginsHome, 'registry/https_plugins.example.test/acme/not-lint-tools').toString(),
					marketplace: 'https://plugins.example.test/v1/marketplace.json',
					name: 'acme/lint-tools',
					plugin: registryMetadata,
				},
				{
					pluginUri: URI.joinPath(agentPluginsHome, 'github.com/CON/repo').toString(),
					marketplace: 'microsoft/plugins',
					plugin: { ...independentMetadata, sourceDescriptor: { kind: PluginSourceKind.GitHub, repo: 'CON/repo' } },
				},
				{
					pluginUri: URI.joinPath(agentPluginsHome, 'npm/dot').toString(),
					marketplace: 'microsoft/plugins',
					plugin: { ...independentMetadata, sourceDescriptor: { kind: PluginSourceKind.Npm, package: '. ' } },
				},
				{
					pluginUri: agentPluginsHome.toString(),
					marketplace: 'microsoft/plugins',
					plugin: independentMetadata,
				},
				{
					pluginUri: URI.joinPath(agentPluginsHome, 'github.com/microsoft/plugins/mismatched').toString(),
					marketplace: 'microsoft/plugins',
					name: 'different-name',
					plugin: relativeMetadata,
				},
			],
		}));

		const pluginsStore = store.add(new FileBackedInstalledPluginsStore(
			agentPluginsHome,
			undefined,
			fileService as unknown as IFileService,
			new NullLogService(),
			storageService as unknown as IStorageService,
		));

		await waitFor(() => pluginsStore.get().length === 1);
		assert.strictEqual(pluginsStore.get()[0].name, 'safe-plugin');
	});

	test('accepts relative-path plugins rooted in a local file marketplace', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const fileService = new TestFileService();
		const agentPluginsHome = URI.file('/home/user/.vscode/agent-plugins');
		const installedJson = URI.joinPath(agentPluginsHome, 'installed.json');
		const marketplaceRoot = URI.file('/workspace/local-marketplace');
		const marketplace = marketplaceRoot.toString();
		fileService.setFile(installedJson, JSON.stringify({
			version: 2,
			installed: [{
				pluginUri: URI.joinPath(marketplaceRoot, 'plugins/local-plugin').toString(),
				marketplace,
				name: 'local-plugin',
				plugin: {
					name: 'local-plugin',
					description: 'Local',
					version: '1.0.0',
					source: 'plugins/local-plugin',
					sourceDescriptor: { kind: PluginSourceKind.RelativePath, path: 'plugins/local-plugin' },
					marketplace: 'Managed Local Marketplace',
					marketplaceType: MarketplaceType.Copilot,
				},
			}],
		}));

		const pluginsStore = store.add(new FileBackedInstalledPluginsStore(
			agentPluginsHome,
			undefined,
			fileService as unknown as IFileService,
			new NullLogService(),
			storageService as unknown as IStorageService,
		));

		await waitFor(() => pluginsStore.get().length === 1);
		assert.strictEqual(pluginsStore.get()[0].pluginUri.path, '/workspace/local-marketplace/plugins/local-plugin');
		assert.strictEqual(pluginsStore.get()[0].plugin?.marketplace, 'Managed Local Marketplace');
	});
});
