/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IOpenideRequestOptions } from '../../../../../platform/request/common/openideRequestIpc.js';
import { IOpenideVoiceProviders, OpenideVoiceService } from '../../browser/openideVoiceService.js';
import { IOpenideAgentRequestService } from '../../common/openideNativeServices.js';
import { IOpenidePickerModel } from '../../common/openidePickerModels.js';
import { IProviderEntry, resolveProviders } from '../../common/openideProviderCatalog.js';
import { encodeWavBase64 } from '../../common/openideVoiceWav.js';

suite('OpenIDE voice service independent of the harness', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const wav = encodeWavBase64(new Float32Array([0.5, -0.5]), 16000);

	function setup(setting = '') {
		const entries = new Map(resolveProviders(undefined).map(provider => [provider.id, provider]));
		let active = 'openai';
		let connected = true;
		const credentials: string[] = [];
		const requests: { options: IOpenideRequestOptions; token: CancellationToken }[] = [];
		const providers: IOpenideVoiceProviders = {
			getActiveProviderId: () => active,
			findProvider: id => entries.get(id),
			isConnected: async () => connected,
			describeModel: (_provider, id) => upcastPartial<IOpenidePickerModel>({ id, input: ['audio', 'text'] }),
			getConnectedModelGroups: async () => [...entries.values()].filter(entry => entry.id === active).map(entry => ({ id: entry.id, label: entry.label, defaultModel: '', models: [] })),
			resolveCredential: async entry => { credentials.push(entry.id); return { kind: 'apiKey', value: `${entry.id}-key` }; },
		};
		const net = upcastPartial<IOpenideAgentRequestService>({
			request: async (options, token) => {
				requests.push({ options, token });
				return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(options.headers?.['x-goog-api-key'] ? { candidates: [{ content: { parts: [{ text: 'spoken text' }] } }] } : { text: 'spoken text' }))) };
			},
		});
		return {
			service: new OpenideVoiceService(providers, new TestConfigurationService({ 'openide.agent.voiceModel': setting }), net),
			credentials, requests,
			setActive: (id: string) => { active = id; },
			setConnected: (value: boolean) => { connected = value; },
			setEntry: (entry: IProviderEntry) => entries.set(entry.id, entry),
		};
	}

	test('pins the selected provider, credential and cancellation token despite a changed active provider', async () => {
		const fixture = setup('openai/gpt-4o-mini-transcribe');
		fixture.setActive('anthropic');
		const cancellation = store.add(new CancellationTokenSource());
		const text = await fixture.service.transcribeAudio(wav, 'groq', 'whisper-large-v3-turbo', cancellation.token);
		const request = fixture.requests[0];
		assert.deepStrictEqual({ text, credentials: fixture.credentials, url: request.options.url, bearer: request.options.headers?.Authorization, hasBinary: !!request.options.dataBase64, token: request.token === cancellation.token },
			{ text: 'spoken text', credentials: ['groq'], url: 'https://api.groq.com/openai/v1/audio/transcriptions', bearer: 'Bearer groq-key', hasBinary: true, token: true });
	});

	test('uses the configured override and lists transcription-only models missing from chat discovery', async () => {
		const fixture = setup('groq/whisper-large-v3-turbo');
		const capability = await fixture.service.getVoiceCapability();
		fixture.setActive('groq');
		const models = await fixture.service.listVoiceModels();
		assert.deepStrictEqual({ provider: capability.providerId, overridden: capability.overridden, available: capability.available, offered: models.groups.some(group => group.models.some(model => model.id === 'whisper-large-v3-turbo')), credentials: fixture.credentials },
			{ provider: 'groq', overridden: true, available: true, offered: true, credentials: [] });
	});

	test('unavailable credentials or invalid settings reject before reading credentials or making requests', async () => {
		for (const setting of ['', 'invalid-target']) {
			const fixture = setup(setting);
			fixture.setConnected(false);
			const capability = await fixture.service.getVoiceCapability();
			await assert.rejects(() => fixture.service.transcribeAudio(wav));
			assert.deepStrictEqual({ available: capability.available, reason: !!capability.reason, credentials: fixture.credentials, requests: fixture.requests },
				{ available: false, reason: true, credentials: [], requests: [] });
		}
	});

	test('Gemini inline transport authenticates with its API-key header and parses its response shape', async () => {
		const fixture = setup();
		fixture.setEntry({ id: 'inline', label: 'Inline', company: 'Test', protocol: 'openai', auth: 'apiKey', baseUrl: 'https://inline.invalid/v1beta', voiceModel: 'audio-model', voiceTransport: 'gemini-inline' });
		fixture.setActive('inline');
		const text = await fixture.service.transcribeAudio(wav);
		const options = fixture.requests[0].options;
		assert.deepStrictEqual({ text, apiKey: options.headers?.['x-goog-api-key'], bearer: options.headers?.Authorization, url: options.url },
			{ text: 'spoken text', apiKey: 'inline-key', bearer: undefined, url: 'https://inline.invalid/v1beta/models/audio-model:generateContent' });
	});
});
