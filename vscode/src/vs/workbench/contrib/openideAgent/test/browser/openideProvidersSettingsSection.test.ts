/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, clearNode } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IOpenideProviderService, IProviderConnectionCheck } from '../../browser/openideProviderService.js';
import { OpenideProvidersSettingsSection, providerPageId } from '../../browser/openideProvidersSettingsSection.js';
import { ISubagentRoutingService } from '../../browser/openideSubagentRoutingService.js';
import { IProviderEntry } from '../../common/openideProviderCatalog.js';

suite('OpenIDE providers settings flows', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const entries: IProviderEntry[] = ['alpha', 'beta'].map(id => ({ id, label: id, company: 'Fixture', protocol: 'openai', auth: 'apiKey', baseUrl: `https://${id}.invalid/v1` }));
	async function flush(): Promise<void> { for (let index = 0; index < 60; index++) { await Promise.resolve(); } }
	function fixture(resolveModels: (entry: IProviderEntry) => Promise<string[]> = async () => ['model']) {
		const changes = store.add(new Emitter<void>());
		const calls = { globalDiscovery: 0, models: [] as string[], saves: [] as string[] };
		const choices: string[] = [];
		let connection: IProviderConnectionCheck | Promise<IProviderConnectionCheck> = { status: 'auth-error', checkedAt: 1 };
		const providers = new class extends mock<IOpenideProviderService>() {
			override readonly onDidChange = changes.event;
			override listProviders() { return entries; }
			override findProvider(id: string) { return entries.find(entry => entry.id === id); }
			override getActiveProviderId() { return 'alpha'; }
			override getModel() { return 'model'; }
			override async setActiveProvider(id: string) { choices.push(`provider:${id}`); }
			override async setModel(model: string) { choices.push(`model:${model}`); }
			override async getSecretsPersistence() { return 'persisted' as const; }
			override async canEnableBasicPasswordStore() { return false; }
			override async isConnected() { return true; }
			override async hasApiKey() { return true; }
			override async hasStoredApiKey() { return true; }
			override async credentialOrigin() { return { kind: 'store' as const }; }
			override async listAccounts() { return []; }
			override async listRegistryProviders() { return []; }
			override getModelCatalogStatus() { return { updatedAt: 1, providers: 2, models: 2 }; }
			override async getConnectedModelGroups() { calls.globalDiscovery++; return []; }
			override async resolveProviderModels(entry: IProviderEntry) { calls.models.push(entry.id); return resolveModels(entry); }
			override describeModel(_provider: string, id: string) {
				return { id, name: id, context: '', toolCall: false, reasoning: false, input: [], output: [], costIn: '', costOut: '', hasCost: false, efforts: [], toggle: false };
			}
			override async checkProviderConnection() { return connection; }
			override async setApiKey(_id: string, key: string) { calls.saves.push(key); }
		};
		const host = document.body.appendChild($('.openide-settings'));
		store.add(toDisposable(() => host.remove()));
		const section = store.add(new OpenideProvidersSettingsSection(providers,
			new class extends mock<IContextViewService>() {}, new class extends mock<IOpenerService>() {},
			new class extends mock<IClipboardService>() {}, new class extends mock<IQuickInputService>() {},
			new class extends mock<INotificationService>() {}, new TestConfigurationService(), new class extends mock<ISubagentRoutingService>() {},
		));
		return {
			host, changes, calls, choices, section,
			setCheck(value: IProviderConnectionCheck | Promise<IProviderConnectionCheck>) { connection = value; },
			async navigate(id?: string) {
				clearNode(host);
				section.render(host, { scope: 'user', query: '', category: id ? providerPageId(id) : 'openideAgent/providers' });
				await flush();
			},
		};
	}

	test('a provider detail does not discover unrelated providers', async () => {
		const f = fixture();
		await f.navigate('alpha');
		assert.deepStrictEqual({ calls: f.calls, title: f.host.querySelector('.openide-settings-provider-name')?.textContent }, {
			calls: { globalDiscovery: 0, models: ['alpha'], saves: [] }, title: 'alpha',
		});
	});

	test('navigation during a slow detail load starts the new provider after it settles', async () => {
		const slow = new DeferredPromise<string[]>();
		const f = fixture(entry => entry.id === 'alpha' ? slow.p : Promise.resolve(['model']));
		await f.navigate('alpha');
		await f.navigate('beta');
		await slow.complete(['model']); await flush();
		assert.deepStrictEqual({ models: f.calls.models, title: f.host.querySelector('.openide-settings-provider-name')?.textContent }, { models: ['alpha', 'beta'], title: 'beta' });
	});

	test('background detection keeps the filter, focus and selection', async () => {
		const f = fixture();
		await f.navigate();
		const input = f.host.querySelector<HTMLInputElement>('input[data-provider-focus="provider-filter"]')!;
		input.value = 'alpha'; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); input.setSelectionRange(1, 3);
		f.changes.fire(); await flush();
		const updated = f.host.querySelector<HTMLInputElement>('input[data-provider-focus="provider-filter"]')!;
		assert.deepStrictEqual({ value: updated.value, focused: document.activeElement === updated, selection: [updated.selectionStart, updated.selectionEnd], hidden: f.host.querySelector('.openide-settings-provider-row[data-openide-filter^="beta"]')?.classList.contains('hidden') },
			{ value: 'alpha', focused: true, selection: [1, 3], hidden: true });
	});

	test('rejected replacement keeps the draft and does not mutate the saved credential', async () => {
		const f = fixture();
		await f.navigate('alpha');
		const input = f.host.querySelector<HTMLInputElement>('[data-provider-key-input]')!;
		input.value = 'rejected-fixture'; input.dispatchEvent(new Event('input', { bubbles: true }));
		f.host.querySelector<HTMLElement>('[data-provider-action="save-key"]')!.click();
		await flush();
		assert.deepStrictEqual({ saves: f.calls.saves, draft: f.host.querySelector<HTMLInputElement>('[data-provider-key-input]')?.value, result: f.host.querySelector('[data-provider-check]')?.getAttribute('data-provider-check') },
			{ saves: [], draft: 'rejected-fixture', result: 'auth-error' });
	});

	test('an external credential change invalidates a pending connection check', async () => {
		const f = fixture();
		await f.navigate('alpha');
		const pending = new DeferredPromise<IProviderConnectionCheck>();
		f.setCheck(pending.p);
		f.host.querySelector<HTMLElement>('[data-provider-action="check-key"]')!.click();
		f.changes.fire();
		await pending.complete({ status: 'available', checkedAt: 1 }); await flush();
		assert.strictEqual(f.host.querySelector('[data-provider-check="available"]'), null);
	});

	test('choosing a model also selects its provider without leaving an unapplied draft', async () => {
		const f = fixture();
		await f.navigate('beta');
		f.host.querySelector<HTMLElement>('.openide-settings-provider-model')!.click(); await flush();
		assert.deepStrictEqual(f.choices, ['provider:beta', 'model:model']);
	});
});
