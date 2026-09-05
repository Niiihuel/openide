/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseVoiceTranscription, voiceTranscriptionRequest } from '../../common/openideVoiceRequest.js';
import { IVoiceProviderTarget, resolveVoiceTransport } from '../../common/openideVoiceTransport.js';
import { encodeWav, encodeWavBase64 } from '../../common/openideVoiceWav.js';
import { resolveProviders } from '../../common/openideProviderCatalog.js';
import { modelModalitiesFromProviderResponse } from '../../common/openideProviderCapabilities.js';

suite('OpenIDE voice request', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const samples = new Float32Array([0.5, -0.5, 0.25, -1, 1]);
	const wav = encodeWavBase64(samples, 16000);
	const audioModel = (id: string) => ({ id, input: ['audio', 'text'] });
	const provider = (id: string): IVoiceProviderTarget => resolveProviders(undefined).find(provider => provider.id === id)!;

	for (const [id, model, expected] of [
		['nvidia-nim', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'chat-audio-url'],
		['openrouter', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'chat-input-audio'],
		['openrouter', 'openai/whisper-1', 'transcriptions-json'],
		['openai', 'gpt-audio-mini', 'chat-input-audio'],
		['openai', 'gpt-transcribe', 'audio-transcriptions'],
		['openai', 'gpt-4o-mini-transcribe', 'audio-transcriptions'],
		['groq', 'whisper-large-v3-turbo', 'audio-transcriptions'],
		['mistral', 'voxtral-mini-latest', 'audio-transcriptions'],
		['mistral', 'voxtral-small-latest', 'mistral-audio'],
		['gemini', 'gemini-3.5-flash', 'chat-input-audio'],
		['dashscope', 'qwen3-omni-flash', 'dashscope-audio'],
		['together', 'nvidia/parakeet-tdt-0.6b-v3', 'audio-transcriptions'],
		['fireworks', 'accounts/user/models/qwen3-omni#accounts/user/deployments/audio', 'chat-audio-url'],
		['xai', 'stt', 'xai-stt'],
	] as const) {
		test(`${id}/${model} resolves ${expected}`, () => {
			assert.strictEqual(resolveVoiceTransport(provider(id), audioModel(model)), expected);
		});
	}

	test('NIM carries all WAV bytes in a data URL', () => {
		const request = voiceTranscriptionRequest(provider('nvidia-nim'), audioModel('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'), wav);
		const body = JSON.parse(request.data!);
		assert.deepStrictEqual({ path: request.path, audio: body.messages[0].content[1], options: body.chat_template_kwargs }, {
			path: '/chat/completions', audio: { type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${wav}` } }, options: { enable_thinking: false },
		});
	});

	test('Mistral uses a base64 string, Google-compatible uses an audio object', () => {
		const mistral = JSON.parse(voiceTranscriptionRequest(provider('mistral'), audioModel('voxtral-small-latest'), wav).data!);
		const google = JSON.parse(voiceTranscriptionRequest(provider('gemini'), audioModel('gemini-3.5-flash'), wav).data!);
		assert.deepStrictEqual([mistral.messages[0].content[1], google.messages[0].content[1]], [
			{ type: 'input_audio', input_audio: wav }, { type: 'input_audio', input_audio: { data: wav, format: 'wav' } },
		]);
	});

	test('Qwen sends a data URL and requests streamed text only', () => {
		const request = voiceTranscriptionRequest(provider('dashscope'), audioModel('qwen3-omni-flash'), wav);
		const body = JSON.parse(request.data!);
		assert.deepStrictEqual({ audio: body.messages[0].content[1], stream: body.stream, modalities: body.modalities, response: request.response }, {
			audio: { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wav}`, format: 'wav' } }, stream: true, modalities: ['text'], response: 'sse-chat',
		});
	});

	test('multipart retains binary PCM, boundaries and field order', () => {
		const request = voiceTranscriptionRequest(provider('groq'), audioModel('whisper-large-v3-turbo'), wav);
		const bytes = decodeBase64(request.dataBase64!).buffer;
		const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
		const fileStart = binary.indexOf('RIFF');
		const boundary = request.contentType.split('boundary=')[1];
		assert.deepStrictEqual({
			path: request.path,
			wav: [...bytes.slice(fileStart, fileStart + encodeWav(samples, 16000).length)],
			modelBeforeFile: binary.indexOf('name="model"') < binary.indexOf('name="file"'),
			closed: binary.endsWith(`\r\n--${boundary}--\r\n`),
		}, { path: '/audio/transcriptions', wav: [...encodeWav(samples, 16000)], modelBeforeFile: true, closed: true });
	});

	test('xAI STT sends a file without inventing a model parameter', () => {
		const request = voiceTranscriptionRequest(provider('xai'), audioModel('stt'), wav);
		assert.deepStrictEqual({ path: request.path, hasModelField: decodeBase64(request.dataBase64!).toString().includes('name="model"') }, { path: '/stt', hasModelField: false });
	});

	test('native Gemini request escapes model names and carries inline WAV', () => {
		const target = { ...provider('gemini'), baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
		const request = voiceTranscriptionRequest(target, audioModel('gemini-audio'), wav);
		assert.deepStrictEqual({ path: request.path, part: JSON.parse(request.data!).contents[0].parts[1] }, {
			path: '/models/gemini-audio:generateContent', part: { inlineData: { mimeType: 'audio/wav', data: wav } },
		});
	});

	test('custom aliases resolve by endpoint, exact model overrides take precedence', () => {
		const target = { id: 'my-nim', protocol: 'openai', custom: true, baseUrl: 'https://integrate.api.nvidia.com/v1/', voiceTransport: 'chat-input-audio' as const, voiceModelTransports: { custom: 'audio-transcriptions' as const } };
		assert.deepStrictEqual([
			resolveVoiceTransport({ ...target, voiceTransport: undefined, voiceModelTransports: undefined }, audioModel('custom')),
			resolveVoiceTransport(target, audioModel('custom')),
			resolveVoiceTransport(target, audioModel('other')),
		], ['chat-audio-url', 'audio-transcriptions', 'chat-input-audio']);
	});

	test('discovery gaps allow documented STT models, not arbitrary text models', () => {
		assert.deepStrictEqual([
			resolveVoiceTransport(provider('groq'), { id: 'whisper-large-v3', input: [] }),
			resolveVoiceTransport(provider('openai'), { id: 'text-model', input: ['text'] }),
			resolveVoiceTransport(provider('openai'), audioModel('gpt-realtime')),
			resolveVoiceTransport(provider('nvidia-nim'), audioModel('nvidia/parakeet-tdt-0.6b-v3')),
			resolveVoiceTransport(provider('openai-codex'), audioModel('audio')),
			resolveVoiceTransport(provider('opencode'), audioModel('audio')),
		], ['audio-transcriptions', undefined, undefined, undefined, undefined, undefined]);
	});

	test('live modality metadata selects transcription models and preserves explicit text-only declarations', () => {
		const live = modelModalitiesFromProviderResponse({ data: [
			{ id: 'speech', architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] } },
			{ id: 'text-only', modalities: { input: ['text'], output: ['text'] } },
			{ id: 'unknown' },
		] });
		assert.deepStrictEqual([
			resolveVoiceTransport(provider('openrouter'), { id: 'speech', input: live.get('speech')!.input!, output: live.get('speech')!.output }),
			resolveVoiceTransport(provider('openrouter'), { id: 'text-only', input: live.get('text-only')!.input! }),
			live.has('unknown'),
		], ['transcriptions-json', undefined, false]);
	});

	test('custom transport settings survive normalization and reject unknown formats', () => {
		const custom = resolveProviders([{ id: 'voice-local', baseUrl: 'http://localhost:8000/v1', voiceTransport: 'audio-transcriptions', voiceModelTransports: { audio: 'chat-audio-url', invalid: 'unknown' } }]).find(entry => entry.id === 'voice-local')!;
		assert.deepStrictEqual({ transport: custom.voiceTransport, models: custom.voiceModelTransports }, { transport: 'audio-transcriptions', models: { audio: 'chat-audio-url' } });
		assert.strictEqual(resolveVoiceTransport(custom, { id: 'text-only', input: ['text'] }), undefined);
	});

	test('JSON, content parts and SSE normalize to the transcript', () => {
		assert.deepStrictEqual([
			parseVoiceTranscription('{"text":" hola "}', 'text'),
			parseVoiceTranscription('{"choices":[{"message":{"content":[{"type":"text","text":"hola"}]}}]}', 'chat'),
			parseVoiceTranscription('{"candidates":[{"content":{"parts":[{"thought":true,"text":"private"},{"text":"hola"}]}}]}', 'gemini'),
			parseVoiceTranscription('data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"ho"}}]}\n\ndata: {"choices":[{"delta":{"content":"la"}}]}\n\ndata: [DONE]\n\n', 'sse-chat'),
		], ['hola', 'hola', 'hola', 'hola']);
	});

	test('refusals, error events and empty responses cannot become dictated text', () => {
		assert.throws(() => parseVoiceTranscription('{"choices":[{"message":{"refusal":"no","content":"not a transcript"}}]}', 'chat'));
		assert.throws(() => parseVoiceTranscription('data: {"error":{"message":"bad audio"}}\n\n', 'sse-chat'));
		assert.throws(() => parseVoiceTranscription('{"choices":[{"message":{"reasoning_content":"thinking"}}]}', 'chat'));
	});
});
