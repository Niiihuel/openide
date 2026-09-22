/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
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

	async function setup(legacy = false, request?: IOpenideAgentRequestService['request']) {
		const storage = store.add(new InMemoryStorageService());
		const secrets = store.add(new TestSecretStorageService());
		const files = store.add(new FileService(new NullLogService()));
		store.add(files.registerProvider('memory', store.add(new InMemoryFileSystemProvider())));
		const cacheHome = URI.parse('memory:/cache');
		await files.writeFile(URI.joinPath(cacheHome, 'openide', 'models.json'), VSBuffer.fromString(JSON.stringify({
			test: { id: 'test', name: 'Test', api: 'https://test.invalid/v1', env: ['TEST_KEY'], models: { baseline: { id: 'baseline', name: 'Baseline', limit: { context: 16000 } } } },
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
				request: request ?? (async options => {
					assert.strictEqual(options.url, 'https://test.invalid/v1/models');
					const authorization = options.headers?.Authorization;
					headers.push(authorization);
					return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify({ data: [{ id: authorization === 'Bearer second' ? 'second-model' : 'first-model' }] }))) };
				}),
			}),
		};
		const makeService = () => store.add(new OpenideProviderService(
			native, secrets, config, storage,
			upcastPartial<IOpenerService>({}), upcastPartial<IQuickInputService>({}), files,
			upcastPartial<IEnvironmentService>({ cacheHome }), upcastPartial<IEncryptionService>({}),
			upcastPartial<IJSONEditingService>({}), upcastPartial<IHostService>({}), upcastPartial<IOpenideUsageService>({}),
			upcastPartial<ISubagentRoutingService>({ clearHealth: id => { if (id) { healthResets.push(id); } } }), picker,
		));
		return { service: makeService(), makeService, secrets, storage, config, headers, healthResets };
	}

	test('migrates provider, model and effort without applying that effort to other models', async () => {
		const { service, makeService, storage } = await setup(true);
		assert.deepStrictEqual([service.getActiveProviderId(), service.getModel(), service.getReasoningEffort()], ['test', 'legacy-model', 'high']);
		await service.setModel('new-model');
		const reloaded = makeService();
		assert.deepStrictEqual({ model: reloaded.getModel(), effort: reloaded.getReasoningEffort(), previous: reloaded.getReasoningEffort('test', 'legacy-model'), legacy: storage.get('openide.agent.reasoningEffort', StorageScope.APPLICATION) },
			{ model: 'new-model', effort: '', previous: 'high', legacy: undefined });
	});

	test('keeps the selected Codex model available to plan validation and the turn runner', async () => {
		const { service } = await setup();
		await service.setApiKey('test', 'first');
		await service.setActiveProvider('test');
		await service.setModel('gpt-6-sol');
		const entry = service.findProvider('test')!;
		assert.deepStrictEqual(await service.resolveProviderModels(entry), ['first-model']);
		const codexEntry = { ...entry, protocol: 'codex' as const, baseUrl: undefined };
		const available = await service.resolveProviderModels(codexEntry);
		assert.ok(available.includes('gpt-6-sol'));
	});

	test('fast mode defaults off, persists per model, and ignores unsupported or malformed stored choices', async () => {
		const { service, makeService, storage } = await setup();
		assert.strictEqual(service.getFastMode('test', 'fast'), false);
		await service.setFastMode(true, 'test', 'fast');
		assert.strictEqual(storage.get('openide.agent.fastModeByModel', StorageScope.APPLICATION), undefined);
		service.getFastModeCapability = (_provider, model) => ({ supported: model === 'fast', serviceTier: model === 'fast' ? 'priority' : undefined });
		await service.setFastMode(true, 'test', 'fast');
		assert.strictEqual(service.getFastMode('test', 'fast'), true);
		assert.strictEqual(service.getFastMode('test', 'other'), false);
		const reloaded = makeService();
		reloaded.getFastModeCapability = service.getFastModeCapability;
		assert.strictEqual(reloaded.getFastMode('test', 'fast'), true);
		await reloaded.setFastMode(false, 'test', 'fast');
		assert.strictEqual(service.getFastMode('test', 'fast'), false);
		storage.store('openide.agent.fastModeByModel', '{"test/fast":"true"}', StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.strictEqual(service.getFastMode('test', 'fast'), false);
		storage.store('openide.agent.fastModeByModel', 'invalid', StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.strictEqual(service.getFastMode('test', 'fast'), false);
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

	test('coalesces concurrent discovery and preserves the Responses protocol and discovery options', async () => {
		const { service, headers, config } = await setup();
		await config.setUserConfiguration('openide.agent.customProviders', [{ id: 'test', protocol: 'openai-responses', dynamicModels: true, auth: 'apiKey', baseUrl: 'https://test.invalid/v1', extraHeaders: { 'X-Client': 'test' } }]);
		await service.setApiKey('test', 'first');
		const entry = service.findProvider('test')!;
		const results = await Promise.all(Array.from({ length: 10 }, () => service.resolveProviderModels(entry)));
		assert.deepStrictEqual({ protocol: entry.protocol, dynamic: entry.dynamicModels, extraHeaders: entry.extraHeaders, calls: headers.length, results },
			{ protocol: 'openai-responses', dynamic: true, extraHeaders: { 'X-Client': 'test' }, calls: 1, results: Array.from({ length: 10 }, () => ['first-model']) });
	});

	test('providers added from the public catalog discover live models automatically', async () => {
		const { service, config } = await setup();
		await config.setUserConfiguration('openide.agent.customProviders', []);
		config.updateValue = async (key, value) => config.setUserConfiguration(key, value);
		await service.ensureModelCatalog();
		await service.addRegistryProvider('test');
		await service.setApiKey('test', 'first');
		const entry = service.findProvider('test')!;
		assert.deepStrictEqual({ dynamic: entry.dynamicModels, models: await service.resolveProviderModels(entry) }, { dynamic: true, models: ['first-model'] });
	});

	test('a late response cannot replace models discovered with a newer key', async () => {
		const began = new DeferredPromise<void>();
		const oldResponse = new DeferredPromise<void>();
		let calls = 0;
		const { service } = await setup(false, async options => {
			calls++;
			if (options.headers?.Authorization === 'Bearer first') { await began.complete(); await oldResponse.p; }
			return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify({ data: [{ id: options.headers?.Authorization === 'Bearer first' ? 'obsolete' : 'current' }] }))) };
		});
		await service.setApiKey('test', 'first');
		const entry = service.findProvider('test')!;
		const oldModels = service.resolveProviderModels(entry);
		await began.p;
		await service.setApiKey('test', 'second');
		assert.deepStrictEqual(await service.resolveProviderModels(entry), ['current']);
		await oldResponse.complete();
		await oldModels;
		assert.deepStrictEqual({ models: await service.resolveProviderModels(entry), calls }, { models: ['current'], calls: 2 });
	});

	test('connection checks classify errors without exposing responses or changing the saved key', async () => {
		let response = { status: 200, body: '{"data":[]}' };
		const { service, secrets } = await setup(false, async () => ({ res: { statusCode: response.status, headers: {} }, stream: bufferToStream(VSBuffer.fromString(response.body)) }));
		await service.setApiKey('test', 'original');
		const results = [];
		for (const item of [
			{ status: 200, body: '{"data":[]}' },
			{ status: 401, body: 'private server response' },
			{ status: 403, body: 'private server response' },
			{ status: 404, body: 'private server response' },
			{ status: 503, body: 'private server response' },
			{ status: 200, body: '<html>unrelated server</html>' },
		]) {
			response = item;
			const { checkedAt: _checkedAt, ...result } = await service.checkProviderConnection('test', 'candidate');
			results.push(result);
		}
		assert.deepStrictEqual({ results, stored: await secrets.get('openide.agent.apiKey.test') }, { results: [
			{ status: 'available', statusCode: 200, models: [] },
			{ status: 'auth-error', statusCode: 401 }, { status: 'auth-error', statusCode: 403 },
			{ status: 'unverified', statusCode: 404 }, { status: 'endpoint-error', statusCode: 503 },
			{ status: 'unverified', statusCode: 200 },
		], stored: 'original' });
	});

	test('local endpoint detection shares requests, rejects HTTP errors, and refreshes immediately', async () => {
		let statusCode = 401, calls = 0;
		const { service, config } = await setup(false, async () => {
			calls++;
			return { res: { statusCode, headers: {} }, stream: bufferToStream(VSBuffer.fromString('{"data":[]}')) };
		});
		await config.setUserConfiguration('openide.agent.customProviders', [{ id: 'test', auth: 'none', baseUrl: 'http://localhost:8000/v1' }]);
		assert.deepStrictEqual(await Promise.all([service.isConnected('test'), service.isConnected('test')]), [false, false]);
		statusCode = 200;
		assert.strictEqual(await service.isConnected('test'), false);
		service.refreshProviderConnections();
		assert.deepStrictEqual({ connected: await service.isConnected('test'), calls }, { connected: true, calls: 2 });
	});

	test('endpoint changes invalidate discovery even before a configuration event is delivered', async () => {
		const urls: string[] = [];
		const { service } = await setup(false, async options => {
			urls.push(options.url!);
			return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify({ data: [{ id: options.url!.includes('changed') ? 'changed-model' : 'original-model' }] }))) };
		});
		await service.setApiKey('test', 'first');
		const entry = service.findProvider('test')!;
		await service.resolveProviderModels(entry);
		const result = await service.resolveProviderModels({ ...entry, baseUrl: 'https://changed.invalid/v1' });
		assert.deepStrictEqual({ result, urls }, { result: ['changed-model'], urls: ['https://test.invalid/v1/models', 'https://changed.invalid/v1/models'] });
	});

	test('an explicitly manual endpoint remains usable without a models route while its check stays unverified', async () => {
		let calls = 0;
		const { service, config } = await setup(false, async () => {
			calls++;
			return { res: { statusCode: 404, headers: {} }, stream: bufferToStream(VSBuffer.fromString('Not found')) };
		});
		await config.setUserConfiguration('openide.agent.customProviders', [{ id: 'test', auth: 'none', baseUrl: 'https://manual.invalid', dynamicModels: false, defaultModel: 'manual-model' }]);
		const connected = await service.isConnected('test');
		const models = await service.resolveProviderModels(service.findProvider('test')!);
		assert.deepStrictEqual({ connected, models, calls }, { connected: true, models: ['manual-model'], calls: 0 });
		assert.strictEqual((await service.checkProviderConnection('test')).status, 'unverified');
	});

	test('connection timeout releases an unresponsive transport and dispose cancels active checks', async () => {
		await runWithFakedTimers({}, async () => {
			const { service } = await setup(false, async () => new Promise(() => { }));
			const entry = { ...service.findProvider('test')!, auth: 'none' as const };
			assert.strictEqual((await service.checkProviderConnection(entry)).status, 'unreachable');
			const check = service.checkProviderConnection(entry);
			service.dispose();
			assert.strictEqual((await check).status, 'unreachable');
		});
	});

	test('custom provider writes keep secrets separate, preserve advanced fields, and roll back on configuration failure', async () => {
		const { service, secrets, config } = await setup();
		const entry = { ...service.findProvider('test')!, id: 'new-provider' };
		config.updateValue = async () => { throw new Error('read-only settings'); };
		await assert.rejects(service.addCustomProvider(entry, 'candidate'));
		assert.strictEqual(await secrets.get('openide.agent.apiKey.new-provider'), undefined);
		config.updateValue = async (key, value) => config.setUserConfiguration(key, value);
		await service.addCustomProvider({ ...entry, extraHeaders: { 'X-Test': 'kept' } }, '  candidate  ');
		await service.updateCustomProvider({ ...entry, label: 'Renamed' });
		assert.deepStrictEqual({ label: service.findProvider(entry.id)?.label, headers: service.findProvider(entry.id)?.extraHeaders, stored: await secrets.get('openide.agent.apiKey.new-provider'), leaked: JSON.stringify(service.customProviders()).includes('candidate') },
			{ label: 'Renamed', headers: { 'X-Test': 'kept' }, stored: 'candidate', leaked: false });
		await assert.rejects(service.setApiKey(entry.id, 'invalid\nkey'));
		assert.strictEqual(await secrets.get('openide.agent.apiKey.new-provider'), 'candidate');
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
