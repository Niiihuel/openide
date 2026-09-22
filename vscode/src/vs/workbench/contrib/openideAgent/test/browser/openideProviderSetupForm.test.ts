/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IOpenideProviderSetupFormOptions, OpenideProviderSetupForm } from '../../browser/openideProviderSetupForm.js';
import { createProviderSetupDraft, IOpenideProviderSetupDraft } from '../../common/openideProviderSetup.js';

suite('OpenIDE provider setup form', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	async function flush(): Promise<void> {
		for (let index = 0; index < 12; index++) { await Promise.resolve(); }
	}
	function fixture(options: Partial<IOpenideProviderSetupFormOptions> = {}, draft: IOpenideProviderSetupDraft = createProviderSetupDraft()) {
		const host = document.body.appendChild($('.monaco-workbench'));
		store.add(toDisposable(() => host.remove()));
		const form = store.add(new OpenideProviderSetupForm(host, draft, {
			existingIds: [], onSubmit: async () => { }, onCancel: () => { }, ...options,
		}, new class extends mock<IContextViewService>() { }));
		const input = (name: string) => host.querySelector<HTMLInputElement>(`input[data-provider-field="${name}"]`)!;
		const fill = (name: string, value: string) => {
			input(name).value = value;
			input(name).dispatchEvent(new Event('input', { bubbles: true }));
		};
		const click = (action: string) => host.querySelector<HTMLElement>(`[data-provider-action="${action}"]`)!.click();
		return { host, form, draft, input, fill, click };
	}

	test('updates an automatic ID until edited and masks keys on every mount', () => {
		const f = fixture();
		f.fill('name', 'Local Server');
		assert.strictEqual(f.input('id').value, 'local-server');
		f.fill('id', 'custom-id');
		f.fill('name', 'Another name');
		f.fill('apiKey', 'fake-secret');
		f.click('reveal-key');
		assert.deepStrictEqual({ id: f.draft.id, edited: f.draft.idEdited, type: f.input('apiKey').type }, { id: 'custom-id', edited: true, type: 'text' });
		f.form.dispose();
		const next = fixture({}, f.draft);
		assert.deepStrictEqual({ name: next.input('name').value, key: next.input('apiKey').value, type: next.input('apiKey').type }, { name: 'Another name', key: 'fake-secret', type: 'password' });
	});

	test('invalid submissions explain errors inline and focus the first invalid field', async () => {
		let saves = 0;
		const f = fixture({ existingIds: ['taken'], onSubmit: async () => { saves++; } });
		f.fill('name', 'Taken');
		f.fill('baseUrl', 'https://user:fake@example.com');
		f.click('save');
		await flush();
		assert.deepStrictEqual({ saves, focused: document.activeElement === f.input('id'), invalid: ['id', 'baseUrl'].map(name => f.input(name).getAttribute('aria-invalid')), errors: f.host.querySelectorAll('.openide-provider-setup-error:not([hidden])').length }, { saves: 0, focused: true, invalid: ['true', 'true'], errors: 2 });
	});

	test('failed saves retain entries, prevent duplicate writes and never expose a rejected key', async () => {
		const pending = new DeferredPromise<void>();
		let saves = 0;
		const f = fixture({ onSubmit: () => { saves++; return pending.p; } });
		f.fill('name', 'My provider');
		f.fill('baseUrl', 'http://localhost:1234/v1');
		f.fill('apiKey', 'fake-secret');
		f.click('save'); f.click('save');
		assert.strictEqual(f.form.domNode.getAttribute('aria-busy'), 'true');
		await pending.error(new Error('Rejected fake-secret'));
		await flush();
		assert.deepStrictEqual({ saves, key: f.input('apiKey').value, busy: f.form.domNode.getAttribute('aria-busy'), hasError: !!f.host.querySelector('.openide-provider-setup-status.error'), leaked: f.form.domNode.textContent!.includes('fake-secret') }, { saves: 1, key: 'fake-secret', busy: 'false', hasError: true, leaked: false });
	});

	test('testing is separate from saving and secrets never enter the provider configuration', async () => {
		const calls: string[] = [];
		const f = fixture({
			onCheck: async (_configuration, apiKey) => { calls.push(`check:${apiKey}`); return { ok: true, message: 'Endpoint available' }; },
			onSubmit: async (configuration, apiKey) => {
				assert.strictEqual('apiKey' in configuration, false);
				calls.push(`save:${apiKey}`);
			},
		});
		f.fill('name', 'My provider'); f.fill('baseUrl', 'http://localhost:1234/v1'); f.fill('apiKey', ' fake-secret ');
		f.click('check'); await flush();
		assert.deepStrictEqual(calls, ['check:fake-secret']);
		f.input('apiKey').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await flush();
		assert.deepStrictEqual({ calls, draft: f.draft.apiKey, field: f.input('apiKey').value }, { calls: ['check:fake-secret', 'check:fake-secret', 'save:fake-secret'], draft: '', field: '' });
	});

	test('saving a rejected replacement key preserves the draft and never writes the provider', async () => {
		let saves = 0;
		const draft = createProviderSetupDraft({ id: 'saved', label: 'Saved provider', company: 'Saved', baseUrl: 'https://example.invalid/v1', auth: 'apiKey', protocol: 'openai' });
		const f = fixture({ existingIds: ['saved'], onSubmit: async () => { saves++; }, onCheck: async () => ({ ok: false, message: 'Credential rejected', canSave: false }) }, draft);
		f.fill('apiKey', 'rejected-fake-key');
		f.click('save'); await flush();
		f.click('save-unchecked'); await flush();
		assert.deepStrictEqual({ saves, key: f.input('apiKey').value, status: f.host.querySelector('.openide-provider-setup-status')!.textContent, uncheckedHidden: f.host.querySelector<HTMLElement>('[data-provider-action="save-unchecked"]')!.hidden },
			{ saves: 0, key: 'rejected-fake-key', status: 'Credential rejected', uncheckedHidden: true });
	});

	test('offline saving requires an explicit action, and changing any field invalidates that permission', async () => {
		let checks = 0, saves = 0;
		const f = fixture({ onSubmit: async () => { saves++; }, onCheck: async () => { checks++; return { ok: false, message: 'Server offline', canSave: false, canSaveUnchecked: true }; } });
		f.fill('name', 'Offline provider'); f.fill('baseUrl', 'https://example.invalid/v1'); f.fill('apiKey', 'fake-secret');
		f.click('save'); await flush();
		const unchecked = f.host.querySelector<HTMLElement>('[data-provider-action="save-unchecked"]')!;
		assert.deepStrictEqual({ checks, saves, visible: !unchecked.hidden }, { checks: 1, saves: 0, visible: true });
		f.fill('defaultModel', 'manual-model');
		f.click('save-unchecked'); await flush();
		assert.deepStrictEqual({ saves, hidden: unchecked.hidden }, { saves: 0, hidden: true });
		f.click('save'); await flush();
		f.click('save-unchecked'); await flush();
		assert.deepStrictEqual({ checks, saves, key: f.input('apiKey').value }, { checks: 2, saves: 1, key: '' });
	});

	test('a save waiting for credential validation never writes after the form is disposed', async () => {
		let saves = 0;
		const pending = new DeferredPromise<{ ok: boolean; message: string }>();
		const f = fixture({ onSubmit: async () => { saves++; }, onCheck: () => pending.p });
		f.fill('name', 'Pending provider'); f.fill('baseUrl', 'https://example.invalid/v1'); f.fill('apiKey', 'fake-secret');
		f.click('save');
		f.form.dispose();
		await pending.complete({ ok: true, message: 'Available' }); await flush();
		assert.strictEqual(saves, 0);
	});

	test('a completed check does not update a disposed form', async () => {
		const pending = new DeferredPromise<{ ok: boolean; message: string }>();
		const f = fixture({ onCheck: () => pending.p });
		f.fill('name', 'Local'); f.fill('baseUrl', 'http://localhost:1234/v1');
		f.click('check');
		const status = f.host.querySelector('.openide-provider-setup-status')!;
		const before = status.textContent;
		f.form.dispose();
		await pending.complete({ ok: true, message: 'late response' }); await flush();
		assert.deepStrictEqual({ attached: f.form.domNode.isConnected, status: status.textContent }, { attached: false, status: before });
	});

	test('no-auth drafts hide the key and existing identifiers remain stable', async () => {
		let savedKey: string | undefined = 'not-called';
		const draft = createProviderSetupDraft({ id: 'local', label: 'Local', company: 'Local', baseUrl: 'http://localhost:1234/v1', auth: 'none', protocol: 'openai' });
		draft.apiKey = 'unused-fake-key';
		const f = fixture({ existingIds: ['local'], onSubmit: async (_configuration, apiKey) => { savedKey = apiKey; } }, draft);
		f.fill('name', 'Renamed local'); f.click('save'); await flush();
		assert.deepStrictEqual({ keyHidden: f.input('apiKey').closest<HTMLElement>('.openide-provider-setup-field')!.hidden, readOnly: f.input('id').readOnly, id: f.input('id').value, savedKey }, { keyHidden: true, readOnly: true, id: 'local', savedKey: undefined });
	});
});
