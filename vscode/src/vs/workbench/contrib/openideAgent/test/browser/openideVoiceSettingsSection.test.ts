/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IAccessibilitySignalService } from '../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IOpenideAgentService, IOpenidePickerModel, IVoiceCapability } from '../../browser/openideAgentService.js';
import { OpenideVoiceSettingsSection } from '../../browser/openideVoiceSettingsSection.js';
import { IVoiceModelSelection } from '../../common/openideVoiceModels.js';
import '../../../openideSettings/browser/media/openideSettings.css';
import { t } from '../../common/openideStrings.js';

suite('OpenIDE VoiceSettingsSection', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const capability: IVoiceCapability = { available: true, providerId: 'audio', providerLabel: 'Audio Provider', model: 'audio-model' };

	async function flush(): Promise<void> {
		for (let i = 0; i < 20; i++) { await Promise.resolve(); }
	}

	function create(resolve = async () => capability) {
		const host = document.body.appendChild($('div.openide-settings-list'));
		store.add(toDisposable(() => host.remove()));
		const configuration = new TestConfigurationService({ 'openide.agent.voiceModel': '' });
		const changed = store.add(new Emitter<void>());
		const agent = new class extends mock<IOpenideAgentService>() {
			override onDidChange = changed.event;
			override getVoiceCapability = resolve;
			override getActiveProviderId = () => 'audio';
			override findProvider = () => undefined;
			override listVoiceModels = async (): Promise<IVoiceModelSelection<IOpenidePickerModel>> => ({ groups: [{ id: 'audio', label: 'Audio Provider', models: Array.from({ length: 9 }, (_, index) => ({
				id: `audio-${index}`, name: `Audio ${index}`, context: '', input: ['audio'], output: ['text'], toolCall: false, reasoning: false, costIn: '', costOut: '', hasCost: false, efforts: [], toggle: false,
			})) }], excluded: [] });
		};
		const section = store.add(new OpenideVoiceSettingsSection(configuration, agent, new class extends mock<IContextViewService>() {}, new class extends mock<IAccessibilitySignalService>() {}));
		let navigated = '';
		const rendered = store.add(section.render(host, { scope: 'user', query: '', navigate: category => { navigated = category; } }));
		return { host, changed, rendered, agent, navigated: () => navigated };
	}

	test('configuration is not presented as a successful transcription', async () => {
		const { host } = create();
		await flush();
		assert.deepStrictEqual({
			badge: host.querySelector('.openide-settings-voice-test .openide-settings-status-pill')?.textContent,
			model: host.querySelector('.openide-settings-voice-test .openide-settings-card')?.textContent?.includes('audio-model'),
			hasTranscript: !host.querySelector<HTMLElement>('.openide-settings-voice-transcript')?.hidden,
		}, { badge: t('settings.voice.configured'), model: true, hasTranscript: false });
	});

	test('unavailable dictation explains the reason and links to providers', async () => {
		const h = create(async () => ({ available: false, reason: 'Connect an audio provider' }));
		await flush();
		const actions = h.host.querySelectorAll<HTMLElement>('.openide-settings-voice-test .monaco-button');
		actions[2].click();
		assert.deepStrictEqual({
			disabled: actions[0].getAttribute('aria-disabled'),
			reason: h.host.textContent?.includes('Connect an audio provider'),
			navigated: h.navigated(),
		}, { disabled: 'true', reason: true, navigated: 'openideAgent/providers' });
	});

	test('model filter retains both its visible value and results after repaint', async () => {
		const h = create();
		await flush();
		const input = h.host.querySelector<HTMLInputElement>('.openide-settings-filter input')!;
		input.value = 'audio-8';
		input.dispatchEvent(new Event('input'));
		h.changed.fire();
		await flush();
		assert.deepStrictEqual({
			query: h.host.querySelector<HTMLInputElement>('.openide-settings-filter input')?.value,
			hiddenRows: h.host.querySelectorAll('.openide-settings-row.hidden').length,
		}, { query: 'audio-8', hiddenRows: 8 });
	});

	test('leaving the section ignores pending capability results', async () => {
		const pending = new DeferredPromise<IVoiceCapability>();
		const h = create(() => pending.p);
		h.rendered.dispose();
		await pending.complete(capability);
		await flush();
		assert.strictEqual(h.host.querySelector('.openide-settings-voice-test .monaco-button'), null);
	});
	test('test card keeps its top inset when it is the first settings section', async () => {
		const h = create();
		await flush();
		const card = h.host.querySelector<HTMLElement>('.openide-settings-voice-test')!;
		assert.ok(parseFloat(getComputedStyle(card).paddingTop) >= 16);
	});

	test('provider groups have icons and preserve expansion across connection updates', async () => {
		const h = create();
		await flush();
		const details = h.host.querySelector<HTMLDetailsElement>('details[data-provider-id="audio"]')!;
		const icon = details.querySelector<HTMLElement>('summary .openide-settings-provider-logo')!;
		assert.ok(icon.getBoundingClientRect().width >= 20 && icon.getBoundingClientRect().height >= 20);
		assert.strictEqual(details.open, false);
		details.open = true;
		details.dispatchEvent(new Event('toggle'));
		h.changed.fire();
		await flush();
		assert.strictEqual(h.host.querySelector<HTMLDetailsElement>('details[data-provider-id="audio"]')?.open, true);
	});

	test('connected providers without dictation remain visible and disconnects remove them', async () => {
		const h = create();
		await flush();
		const initial = await h.agent.listVoiceModels();
		h.agent.listVoiceModels = async () => ({ ...initial, excluded: [{ id: 'text-only', label: 'Text Provider', reason: 'noAudioModel' }] });
		h.changed.fire();
		await flush();
		assert.strictEqual(h.host.querySelectorAll('details.openide-settings-voice-provider').length, 2);
		assert.ok(h.host.querySelector('[data-provider-id="text-only"] summary .openide-settings-provider-logo'));
		h.agent.listVoiceModels = async () => ({ groups: [], excluded: [{ id: 'text-only', label: 'Text Provider', reason: 'noAudioModel' }] });
		h.changed.fire();
		await flush();
		assert.strictEqual(h.host.querySelector('[data-provider-id="audio"]'), null);
		assert.ok(h.host.querySelector('[data-provider-id="text-only"]'));
	});

});
