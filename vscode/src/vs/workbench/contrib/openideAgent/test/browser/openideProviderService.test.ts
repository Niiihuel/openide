/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEncryptionService } from '../../../../../platform/encryption/common/encryptionService.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IJSONEditingService } from '../../../../services/configuration/common/jsonEditing.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { OpenidePickerPreferencesService } from '../../browser/openidePickerPreferencesService.js';
import { OpenideProviderService } from '../../browser/openideProviderService.js';
import { ISubagentRoutingService } from '../../browser/openideSubagentRoutingService.js';
import { IOpenideUsageService } from '../../browser/openideUsageService.js';
import { IOpenideAgentRequestService, IOpenideNativeServices } from '../../common/openideNativeServices.js';
import { UnavailableOpenideNativeServices } from '../../common/openideNativeServicesUnavailable.js';

suite('OpenIDE provider service without a chat harness', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	async function setup(legacy = false) {
		const storage = store.add(new InMemoryStorageService());
		const secrets = store.add(new TestSecretStorageService());
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider('memory', store.add(new InMemoryFileSystemProvider())));
		const cacheHome = URI.parse('memory:/cache');
		await files.writeFile(URI.joinPath(cacheHome, 'openide', 'models.json'), VSBuffer.fromString(JSON.stringify({
			test: { id: 'test', name: 'Test', models: { baseline: { id: 'baseline', name: 'Baseline', limit: { context: 16000 } } } },
		})));
		const config = new TestConfigurationService({
			'openide.agent.customProviders': [{ id: 'test', label: 'Test', protocol: 'openai', auth: 'apiKey', baseUrl: 'https://test.invalid/v1', dynamicModels: true }],
			...(legacy ? { 'openide.agent.provider': 'test', 'openide.agent.model': 'legacy-model' } : {}),
		});
		if (legacy) { storage.store('openide.agent.reasoningEffort', 'high', StorageScope.APPLICATION, StorageTarget.MACHINE); }
		const picker = store.add(new OpenidePickerPreferencesService(storage));
		const headers: (string | string[] | undefined)[] = [];
		const healthResets: string[] = [];
		const unavailable = new UnavailableOpenideNativeServices();
		const native: IOpenideNativeServices = {
			...unavailable,
			_serviceBrand: undefined,
			requests: upcastPartial<IOpenideAgentRequestService>({
				request: async options => {
					assert.strictEqual(options.url, 'https://test.invalid/v1/models');
					const authorization = options.headers?.Authorization;
					headers.push(authorization);
					return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify({ data: [{ id: authorization === 'Bearer second' ? 'second-model' : 'first-model' }] }))) };
				},
			}),
		};
		const makeService = () => store.add(new OpenideProviderService(
			native, secrets, config, storage,
			upcastPartial<IOpenerService>({}), upcastPartial<IQuickInputService>({}), files,
			upcastPartial<IEnvironmentService>({ cacheHome }), upcastPartial<IEncryptionService>({}),
			upcastPartial<IJSONEditingService>({}), upcastPartial<IHostService>({}), upcastPartial<IOpenideUsageService>({}),
			upcastPartial<ISubagentRoutingService>({ clearHealth: id => { if (id) { healthResets.push(id); } } }), picker,
		));
		return { service: makeService(), makeService, secrets, storage, headers, healthResets };
	}

	test('migrates provider, model and effort without applying that effort to other models', async () => {
		const { service, makeService, storage } = await setup(true);
		assert.deepStrictEqual([service.getActiveProviderId(), service.getModel(), service.getReasoningEffort()], ['test', 'legacy-model', 'high']);
		await service.setModel('new-model');
		const reloaded = makeService();
		assert.deepStrictEqual({ model: reloaded.getModel(), effort: reloaded.getReasoningEffort(), previous: reloaded.getReasoningEffort('test', 'legacy-model'), legacy: storage.get('openide.agent.reasoningEffort', StorageScope.APPLICATION) },
			{ model: 'new-model', effort: '', previous: 'high', legacy: undefined });
	});

	test('account activation invalidates live discovery and restores refreshed credentials across service reload', async () => {
		const { service, makeService, secrets, headers, healthResets } = await setup();
		await service.setApiKey('test', 'first');
		await service.snapshotAccount('test', { id: 'first', label: 'First' });
		const entry = { ...service.findProvider('test')!, dynamicModels: true };
		assert.deepStrictEqual(await service.resolveProviderModels(entry), ['first-model']);
		assert.deepStrictEqual(await service.resolveProviderModels(entry), ['first-model']);
		await service.setApiKey('test', 'second');
		await service.snapshotAccount('test', { id: 'second', label: 'Second' });
		assert.deepStrictEqual(await service.resolveProviderModels(entry), ['second-model']);
		await secrets.set('openide.agent.apiKey.test', 'refreshed-second');
		await service.switchAccount('test', 'first');
		assert.deepStrictEqual(await service.resolveProviderModels(entry), ['first-model']);
		const reloaded = makeService();
		await reloaded.switchAccount('test', 'second');
		assert.deepStrictEqual({ headers, active: await reloaded.getActiveAccountId('test'), credential: await secrets.get('openide.agent.apiKey.test'), healthResets },
			{ headers: ['Bearer first', 'Bearer second', 'Bearer first'], active: 'second', credential: 'refreshed-second', healthResets: ['test', 'test', 'test', 'test'] });
	});

	test('a credential change from another consumer invalidates the account-specific discovery cache', async () => {
		const { service, secrets, headers } = await setup();
		await service.setApiKey('test', 'first');
		await service.resolveProviderModels({ ...service.findProvider('test')!, dynamicModels: true });
		await secrets.set('openide.agent.apiKey.test', 'second');
		assert.deepStrictEqual(await service.resolveProviderModels({ ...service.findProvider('test')!, dynamicModels: true }), ['second-model']);
		assert.deepStrictEqual(headers, ['Bearer first', 'Bearer second']);
	});
});

suite('OpenIDE picker preference ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps existing storage keys, favorites and disconnected provider positions across reload', async () => {
		const storage = store.add(new InMemoryStorageService());
		storage.store('openide.agent.picker.favorites', '["test/a","test/b"]', StorageScope.APPLICATION, StorageTarget.MACHINE);
		storage.store('openide.agent.picker.providerOrder', '["one","offline","two"]', StorageScope.APPLICATION, StorageTarget.MACHINE);
		const preferences = store.add(new OpenidePickerPreferencesService(storage));
		await preferences.reorderPickerFavorite('test/b', 'test/a');
		await preferences.setProviderOrder(['two', 'one']);
		await preferences.toggleCollapsedSection('provider:test');
		for (const model of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) { await preferences.recordPickerUse(`test/${model}`); }
		const reloaded = store.add(new OpenidePickerPreferencesService(storage));
		assert.deepStrictEqual({ favorites: reloaded.getPickerFavorites(), providers: reloaded.getProviderOrder(), collapsed: reloaded.getCollapsedSections(), recent: reloaded.getPickerRecents() },
			{ favorites: ['test/b', 'test/a'], providers: ['two', 'offline', 'one'], collapsed: ['provider:test'], recent: ['test/c', 'test/f', 'test/e', 'test/d', 'test/b'] });
	});
});
