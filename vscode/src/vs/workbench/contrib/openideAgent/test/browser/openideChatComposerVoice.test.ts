/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IVoiceCapability } from '../../browser/openideAgentService.js';
import { OpenideChatComposerVoice, VoiceState } from '../../browser/chat/openideChatComposerVoice.js';
import { t } from '../../common/openideStrings.js';

suite('OpenIDE ChatComposerVoice', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const capability: IVoiceCapability = { available: true, providerId: 'audio', model: 'model' };

	async function flush(): Promise<void> {
		for (let i = 0; i < 20; i++) { await Promise.resolve(); }
	}

	function create(options: { media?: () => Promise<MediaStream>; resolve?: () => Promise<IVoiceCapability>; transcribe?: () => Promise<string>; resume?: () => Promise<void> } = {}) {
		let stopped = 0;
		let closed = 0;
		let requested = 0;
		let transcribed = 0;
		let requestToken: CancellationToken | undefined;
		const errors: string[] = [];
		const states: VoiceState[] = [];
		const texts: string[] = [];
		const processor: ScriptProcessorNode = new class extends mock<ScriptProcessorNode>() {
			override onaudioprocess: ((this: ScriptProcessorNode, ev: AudioProcessingEvent) => void) | null = null;
			override connect = () => processor;
			override disconnect() { }
		};
		const source = new class extends mock<MediaStreamAudioSourceNode>() {
			override connect = () => processor;
			override disconnect() { }
		};
		const track = new class extends mock<MediaStreamTrack>() {
			override onended = null;
			override stop() { stopped++; }
		};
		const stream = new class extends mock<MediaStream>() {
			override getTracks = () => [track];
			override getAudioTracks = () => [track];
		};
		const context = new class extends mock<AudioContext>() {
			override sampleRate = 48000;
			override destination = new class extends mock<AudioDestinationNode>() { };
			override resume = options.resume ?? (async () => {});
			override async close() { closed++; }
			override createMediaStreamSource = () => source;
			override createScriptProcessor = () => processor;
		};
		const voice = store.add(new OpenideChatComposerVoice({
			getVoiceCapability: options.resolve ?? (async () => capability),
			transcribeAudio: async (_wav, _provider, _model, token) => { transcribed++; requestToken = token; return options.transcribe ? options.transcribe() : 'Hola mundo'; },
		}, { playSignal: async () => {} }, mainWindow,
			state => states.push(state), text => texts.push(text), message => errors.push(message), () => {}, {
				getUserMedia: async () => { requested++; return options.media ? options.media() : stream; },
				createContext: () => context,
			}));
		const speak = () => {
			const event = new class extends mock<AudioProcessingEvent>() {
				override inputBuffer = new class extends mock<AudioBuffer>() {
					override getChannelData = () => new Float32Array(4096).fill(0.1);
				};
			};
			for (let i = 0; i < 6; i++) { processor.onaudioprocess?.(event); }
		};
		return { voice, stream, states, texts, errors, speak, requestToken: () => requestToken, counts: () => ({ stopped, closed, requested, transcribed }) };
	}

	test('disposal releases an active microphone without uploading audio', async () => {
		const h = create();
		await h.voice.refreshCapability();
		h.voice.toggle();
		await flush();
		h.speak();
		h.voice.dispose();
		assert.deepStrictEqual({ state: h.voice.state, ...h.counts() }, { state: 'idle', stopped: 1, closed: 1, requested: 1, transcribed: 0 });
	});

	test('cancellation during the permission prompt releases a late stream', async () => {
		const media = new DeferredPromise<MediaStream>();
		const h = create({ media: () => media.p });
		await h.voice.refreshCapability();
		h.voice.toggle();
		await flush();
		h.voice.cancel();
		await media.complete(h.stream);
		await flush();
		assert.deepStrictEqual({ states: h.states, errors: h.errors, ...h.counts() }, { states: ['starting', 'idle'], errors: [], stopped: 1, closed: 0, requested: 1, transcribed: 0 });
	});

	test('cancellation before capability resolution never opens the microphone', async () => {
		const pending = new DeferredPromise<IVoiceCapability>();
		let calls = 0;
		const h = create({ resolve: () => ++calls === 1 ? Promise.resolve(capability) : pending.p });
		await h.voice.refreshCapability();
		h.voice.toggle();
		h.voice.cancel();
		await pending.complete(capability);
		await flush();
		assert.strictEqual(h.counts().requested, 0);
	});

	test('hold released during startup does not leave the microphone on', async () => {
		const media = new DeferredPromise<MediaStream>();
		const h = create({ media: () => media.p });
		await h.voice.refreshCapability();
		h.voice.beginHold();
		h.voice.endHold();
		await media.complete(h.stream);
		await flush();
		assert.deepStrictEqual({ state: h.voice.state, ...h.counts() }, { state: 'idle', stopped: 1, closed: 1, requested: 1, transcribed: 0 });
	});

	test('stopping transcribes speech and releases capture before the response', async () => {
		const response = new DeferredPromise<string>();
		const h = create({ transcribe: () => response.p });
		await h.voice.refreshCapability();
		h.voice.toggle();
		await flush();
		h.speak();
		h.voice.toggle();
		await flush();
		assert.deepStrictEqual({ state: h.voice.state, ...h.counts() }, { state: 'busy', stopped: 1, closed: 1, requested: 1, transcribed: 1 });
		await response.complete('Hola mundo');
		await flush();
		assert.deepStrictEqual({ state: h.voice.state, texts: h.texts, errors: h.errors }, { state: 'idle', texts: ['Hola mundo'], errors: [] });
	});

	test('cancellation ignores late transcription results', async () => {
		const response = new DeferredPromise<string>();
		const h = create({ transcribe: () => response.p });
		await h.voice.refreshCapability();
		h.voice.toggle();
		await flush();
		h.speak();
		h.voice.toggle();
		await flush();
		h.voice.cancel();
		await response.complete('Late result');
		await flush();
		assert.deepStrictEqual({ state: h.voice.state, texts: h.texts, errors: h.errors, requestCancelled: h.requestToken()?.isCancellationRequested }, { state: 'idle', texts: [], errors: [], requestCancelled: true });
	});

	test('failed audio setup closes the context and releases the stream', async () => {
		const h = create({ resume: async () => { throw new Error('Audio context failed'); } });
		await h.voice.refreshCapability();
		h.voice.toggle();
		await flush();
		assert.deepStrictEqual({ state: h.voice.state, ...h.counts() }, { state: 'idle', stopped: 1, closed: 1, requested: 1, transcribed: 0 });
	});

	test('denied permissions produce an actionable error', async () => {
		const h = create({ media: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } });
		await h.voice.refreshCapability();
		h.voice.toggle();
		await flush();
		assert.deepStrictEqual(h.errors, [`${t('chatSurface.voice.startFailed')}: ${t('chatSurface.voice.permissionDenied')}`]);
	});
});
