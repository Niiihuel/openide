/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { formatVoiceSetting, isVoiceSettingFor, modelAcceptsAudio, parseVoiceSetting, selectVoiceModels } from '../../common/openideVoiceModels.js';

const model = (id: string, ...input: string[]) => ({ id, input });

/** The three built-ins that declare a `voiceModel` today, plus the two that cannot dictate. */
const PROTOCOLS: Record<string, string> = {
	openai: 'openai-responses',
	gemini: 'openai',
	dashscope: 'openai',
	anthropic: 'anthropic',
	'openai-codex': 'codex',
};
const protocolOf = (id: string) => PROTOCOLS[id];

suite('OpenIDE voice models', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('audio is read off the input modalities, case and padding tolerant', () => {
		assert.strictEqual(modelAcceptsAudio(model('a', 'text', 'audio')), true);
		assert.strictEqual(modelAcceptsAudio(model('b', 'text', ' Audio ')), true);
		assert.strictEqual(modelAcceptsAudio(model('c', 'text', 'image')), false);
		assert.strictEqual(modelAcceptsAudio(model('d')), false);
		// Audio OUT is a different capability: a model that speaks does not necessarily hear, and
		// only `input` is asked about here.
		assert.strictEqual(modelAcceptsAudio({ id: 'e', input: ['text'] }), false);
	});

	test('keeps the models that hear and drops the rest', () => {
		const result = selectVoiceModels([
			{ id: 'openai', label: 'OpenAI', models: [model('gpt-5.6', 'text', 'image'), model('gpt-audio-mini', 'text', 'audio')] },
			{ id: 'gemini', label: 'Gemini', models: [model('gemini-3.5-flash', 'text', 'image', 'audio')] },
		], protocolOf);

		assert.deepStrictEqual(result.groups.map(g => g.id), ['openai', 'gemini']);
		assert.deepStrictEqual(result.groups[0].models.map(m => m.id), ['gpt-audio-mini']);
		assert.deepStrictEqual(result.excluded, []);
	});

	test('a provider whose protocol cannot carry audio is excluded WITH a reason', () => {
		// Anthropic models do accept audio upstream; the transcription path here is an
		// `input_audio` content part, which their protocol has no place for. Listing the model and
		// failing at the microphone would be the worse answer, and silence the worst of the three.
		const result = selectVoiceModels([
			{ id: 'anthropic', label: 'Anthropic', models: [model('claude-x', 'text', 'audio')] },
		], protocolOf);

		assert.deepStrictEqual(result.groups, []);
		assert.deepStrictEqual(result.excluded, [{ id: 'anthropic', label: 'Anthropic', reason: 'protocol' }]);
	});

	test('right protocol, no audio model: excluded for the other reason', () => {
		const result = selectVoiceModels([
			{ id: 'openai', label: 'OpenAI', models: [model('gpt-5.6', 'text', 'image')] },
		], protocolOf);

		assert.deepStrictEqual(result.groups, []);
		assert.deepStrictEqual(result.excluded, [{ id: 'openai', label: 'OpenAI', reason: 'noAudioModel' }]);
	});

	test('an unknown provider id is excluded rather than assumed compatible', () => {
		const result = selectVoiceModels([
			{ id: 'ghost', label: 'Ghost', models: [model('m', 'audio')] },
		], () => undefined);

		assert.deepStrictEqual(result.excluded, [{ id: 'ghost', label: 'Ghost', reason: 'protocol' }]);
	});

	test('provider order survives the filter', () => {
		const groups = ['gemini', 'openai', 'dashscope'].map(id => ({ id, label: id, models: [model('m', 'audio')] }));
		const result = selectVoiceModels(groups, protocolOf);
		assert.deepStrictEqual(result.groups.map(g => g.id), ['gemini', 'openai', 'dashscope']);
	});

	test('the setting tells "nothing chosen" apart from "written wrong"', () => {
		assert.deepStrictEqual(parseVoiceSetting(''), { kind: 'auto' });
		assert.deepStrictEqual(parseVoiceSetting('   '), { kind: 'auto' });
		assert.deepStrictEqual(parseVoiceSetting(undefined), { kind: 'auto' });
		assert.deepStrictEqual(parseVoiceSetting('gpt-audio-mini'), { kind: 'invalid' });
		assert.deepStrictEqual(parseVoiceSetting('/gpt-audio-mini'), { kind: 'invalid' });
		assert.deepStrictEqual(parseVoiceSetting('openai/'), { kind: 'invalid' });
	});

	test('a model id with slashes of its own keeps them', () => {
		// OpenRouter publishes ids like `openai/gpt-4o-audio-preview`. Splitting on the last slash
		// would name a provider `openrouter/openai`, which exists nowhere, and the error would then
		// blame the provider instead of the value.
		assert.deepStrictEqual(
			parseVoiceSetting('openrouter/openai/gpt-4o-audio-preview'),
			{ kind: 'pinned', providerId: 'openrouter', model: 'openai/gpt-4o-audio-preview' },
		);
	});

	test('what the selector writes is what the resolver reads', () => {
		const stored = formatVoiceSetting('openrouter', 'openai/gpt-4o-audio-preview');
		assert.deepStrictEqual(parseVoiceSetting(stored), {
			kind: 'pinned', providerId: 'openrouter', model: 'openai/gpt-4o-audio-preview',
		});
		assert.strictEqual(isVoiceSettingFor(parseVoiceSetting(stored), 'openrouter', 'openai/gpt-4o-audio-preview'), true);
		assert.strictEqual(isVoiceSettingFor(parseVoiceSetting(stored), 'openrouter', 'other'), false);
		assert.strictEqual(isVoiceSettingFor({ kind: 'auto' }, 'openrouter', 'openai/gpt-4o-audio-preview'), false);
	});
});
