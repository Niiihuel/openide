/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { SSEParser } from '../../../../base/common/sseParser.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { t } from './openideStrings.js';
import { IVoiceModelMetadata, IVoiceProviderTarget, resolveVoiceTransport, VoiceTransportId } from './openideVoiceTransport.js';

export interface IVoiceHttpRequest {
	readonly path: string;
	readonly contentType: string;
	readonly data?: string;
	/** Binary uploads cross the main-process channel as base64, never a UTF-8 string. */
	readonly dataBase64?: string;
	readonly response: 'chat' | 'text' | 'gemini' | 'sse-chat';
	readonly transport: VoiceTransportId;
}

const TRANSCRIBE_PROMPT = 'Transcribe the audio EXACTLY as spoken, in the same language. Return ONLY the transcription, with no quotes and no comments.';

/** Builds one bounded phrase request. The registry decides the contract, adapters encode it. */
export function voiceTranscriptionRequest(target: IVoiceProviderTarget, model: IVoiceModelMetadata, wavBase64: string): IVoiceHttpRequest {
	const transport = resolveVoiceTransport(target, model);
	if (!transport) { throw new Error(t('agentSurface.voice.modelUnsupported', model.id, target.id)); }
	const json = (path: string, body: object, response: IVoiceHttpRequest['response'] = 'chat'): IVoiceHttpRequest =>
		({ path, data: JSON.stringify(body), contentType: 'application/json', response, transport });
	if (transport === 'audio-transcriptions' || transport === 'xai-stt') {
		const boundary = `openide-${generateUuid()}`;
		const fields: Record<string, string> = transport === 'xai-stt' ? {} : { model: model.id, response_format: 'json' };
		if (model.id.includes('transcribe-diarize')) { fields.chunking_strategy = 'auto'; }
		const prefix = Object.entries(fields).map(([name, value]) =>
			`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('');
		const bytes = VSBuffer.concat([
			VSBuffer.fromString(`${prefix}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dictation.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
			decodeBase64(wavBase64),
			VSBuffer.fromString(`\r\n--${boundary}--\r\n`),
		]);
		return { path: transport === 'xai-stt' ? '/stt' : '/audio/transcriptions', contentType: `multipart/form-data; boundary=${boundary}`, dataBase64: encodeBase64(bytes), response: 'text', transport };
	}
	if (transport === 'transcriptions-json') {
		return json('/audio/transcriptions', { model: model.id, input_audio: { data: wavBase64, format: 'wav' } }, 'text');
	}
	if (transport === 'gemini-inline') {
		return json(`/models/${encodeURIComponent(model.id)}:generateContent`, {
			contents: [{ role: 'user', parts: [{ text: TRANSCRIBE_PROMPT }, { inlineData: { mimeType: 'audio/wav', data: wavBase64 } }] }],
			generationConfig: { temperature: 0 },
		}, 'gemini');
	}
	const audio = transport === 'chat-audio-url'
		? { type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${wavBase64}` } }
		: transport === 'mistral-audio' ? { type: 'input_audio', input_audio: wavBase64 }
			: { type: 'input_audio', input_audio: { data: transport === 'dashscope-audio' ? `data:audio/wav;base64,${wavBase64}` : wavBase64, format: 'wav' } };
	return json('/chat/completions', {
		model: model.id,
		temperature: 0,
		messages: [{ role: 'user', content: [{ type: 'text', text: TRANSCRIBE_PROMPT }, audio] }],
		...(transport === 'dashscope-audio' ? { stream: true, modalities: ['text'], enable_thinking: false } : {}),
		...(transport === 'chat-audio-url' && model.id === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
			? { chat_template_kwargs: { enable_thinking: false } } : {}),
	}, transport === 'dashscope-audio' ? 'sse-chat' : 'chat');
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function first(value: unknown): Record<string, unknown> { return record(Array.isArray(value) ? value[0] : undefined); }

function contentText(value: unknown): string {
	if (typeof value === 'string') { return value; }
	return Array.isArray(value) ? value.map(part => {
		const entry = record(part);
		return entry.thought !== true && typeof entry.text === 'string' ? entry.text : '';
	}).join('') : '';
}

/** Normalize only transcript-bearing fields. Reasoning, refusals and SSE errors are not dictation. */
export function parseVoiceTranscription(text: string, response: IVoiceHttpRequest['response']): string {
	const parse = (value: string): Record<string, unknown> => {
		const body = record(JSON.parse(value));
		if (body.error) { throw new Error(t('agentSurface.voice.providerRejected')); }
		return body;
	};
	let result = '';
	if (response === 'sse-chat') {
		const parser = new SSEParser(event => {
			if (event.data.trim() === '[DONE]') { return; }
			const body = parse(event.data);
			const choice = first(body.choices);
			const delta = record(choice.delta);
			if (delta.refusal) { throw new Error(t('agentSurface.voice.providerRejected')); }
			result += contentText(delta.content);
		});
		parser.feed(VSBuffer.fromString(`${text}\n\n`).buffer);
	} else {
		const body = parse(text);
		if (response === 'text') { result = typeof body.text === 'string' ? body.text : ''; }
		else if (response === 'gemini') { result = contentText(record(first(body.candidates).content).parts); }
		else {
			const message = record(first(body.choices).message);
			if (message.refusal) { throw new Error(t('agentSurface.voice.providerRejected')); }
			result = contentText(message.content);
		}
	}
	if (!result.trim()) { throw new Error(t('agentSurface.voice.emptyTranscription')); }
	return result.trim();
}
