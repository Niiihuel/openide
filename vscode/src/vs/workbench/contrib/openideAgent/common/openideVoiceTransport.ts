/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Wire contracts, independent of the chat model's vendor. Sources: docs/voice-transports.md. */
export const VOICE_TRANSPORTS = ['chat-input-audio', 'chat-audio-url', 'mistral-audio', 'dashscope-audio', 'audio-transcriptions', 'transcriptions-json', 'gemini-inline', 'xai-stt'] as const;
export type VoiceTransportId = typeof VOICE_TRANSPORTS[number];

export interface IVoiceProviderTarget {
	readonly id: string;
	readonly protocol: string;
	readonly baseUrl?: string;
	readonly custom?: boolean;
	readonly voiceModel?: string;
	readonly voiceTransport?: VoiceTransportId;
	readonly voiceModelTransports?: Readonly<Record<string, VoiceTransportId>>;
}

export interface IVoiceModelMetadata {
	readonly id: string;
	readonly input: readonly string[];
	readonly output?: readonly string[];
}

interface IVoiceModelRule {
	readonly model: RegExp;
	readonly transport: VoiceTransportId;
	/** A documented STT model can be absent from a chat-oriented discovery catalog. */
	readonly transcription?: boolean;
}

interface IVoiceProviderProfile {
	readonly ids: readonly string[];
	readonly hosts: readonly string[];
	readonly fallback?: VoiceTransportId;
	readonly rules?: readonly IVoiceModelRule[];
	readonly exclude?: RegExp;
}

const TRANSCRIBE = /(?:^|\/)(?:whisper(?:-|$)|gpt-(?:4o(?:-mini)?-)?transcribe(?:-|$))/i;
const PROFILES: readonly IVoiceProviderProfile[] = [
	{ ids: ['openai'], hosts: ['api.openai.com'], fallback: 'chat-input-audio', rules: [{ model: TRANSCRIBE, transport: 'audio-transcriptions', transcription: true }] },
	{ ids: ['openrouter'], hosts: ['openrouter.ai'], fallback: 'chat-input-audio', rules: [{ model: TRANSCRIBE, transport: 'transcriptions-json', transcription: true }] },
	{ ids: ['gemini', 'google'], hosts: ['generativelanguage.googleapis.com'], fallback: 'chat-input-audio' },
	{ ids: ['nvidia-nim', 'nvidia'], hosts: ['integrate.api.nvidia.com'], fallback: 'chat-audio-url', exclude: /(?:parakeet|canary|nemotron.*asr)/i },
	{ ids: ['dashscope', 'alibaba'], hosts: ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com'], fallback: 'dashscope-audio' },
	{ ids: ['groq'], hosts: ['api.groq.com'], rules: [{ model: /^whisper-large-v3(?:-turbo)?$/, transport: 'audio-transcriptions', transcription: true }] },
	{ ids: ['mistral'], hosts: ['api.mistral.ai'], fallback: 'mistral-audio', rules: [{ model: /^voxtral-mini-(?:latest|transcribe(?:-|$)|\d{4}$)/, transport: 'audio-transcriptions', transcription: true }] },
	{ ids: ['together', 'togetherai'], hosts: ['api.together.ai', 'api.together.xyz'], rules: [{ model: /(?:^|\/)(?:whisper-|parakeet-|nemotron-[\d.]+-asr-|nova-)/, transport: 'audio-transcriptions', transcription: true }] },
	{ ids: ['fireworks', 'fireworks-ai'], hosts: ['api.fireworks.ai'], fallback: 'chat-audio-url' },
	{ ids: ['vllm'], hosts: [], fallback: 'chat-input-audio' },
	// /stt is a service rather than a chat model. The internal selection id names that service.
	{ ids: ['xai'], hosts: ['api.x.ai'], rules: [{ model: /^stt$/, transport: 'xai-stt', transcription: true }] },
];

export function isVoiceTransport(value: unknown): value is VoiceTransportId {
	return typeof value === 'string' && (VOICE_TRANSPORTS as readonly string[]).includes(value);
}

function profileFor(provider: IVoiceProviderTarget): IVoiceProviderProfile | undefined {
	let hostname = '';
	try { hostname = new URL(provider.baseUrl ?? '').hostname; } catch { /* Missing/invalid endpoints are rejected by resolution. */ }
	return PROFILES.find(profile => profile.ids.includes(provider.id)) ?? PROFILES.find(profile => profile.hosts.includes(hostname));
}

/** Whether the endpoint has an integrated audio contract; does not imply every model can hear. */
export function hasVoiceTransport(provider: IVoiceProviderTarget): boolean {
	if (!provider.baseUrl || !['openai', 'openai-responses'].includes(provider.protocol)) { return false; }
	// Subscription gateways are not their vendors' public speech APIs.
	if (provider.id.endsWith('-oauth') || provider.id === 'copilot') { return false; }
	return !!(provider.voiceTransport || provider.voiceModelTransports || profileFor(provider) || (provider.custom && provider.voiceModel));
}

/** Shared by the picker, capability check and request builder. No request probes or fallbacks
 * to a different account: changing a contract never silently sends audio to another provider. */
export function resolveVoiceTransport(provider: IVoiceProviderTarget, model: IVoiceModelMetadata): VoiceTransportId | undefined {
	if (!hasVoiceTransport(provider)) { return undefined; }
	const audio = model.input.some(value => value.trim().toLowerCase() === 'audio');
	const explicitModel = provider.voiceModelTransports?.[model.id];
	if (explicitModel) { return explicitModel; }
	if (provider.voiceTransport) { return audio || provider.voiceModel === model.id ? provider.voiceTransport : undefined; }
	if (model.output?.length && !model.output.some(value => value === 'text' || value === 'transcription')) { return undefined; }
	// These are session protocols, not file/phrase transcription APIs.
	if (/(?:realtime|(?:^|[-/])live(?:[-/]|$)|native-audio)/i.test(model.id)) { return undefined; }
	const profile = profileFor(provider);
	if (profile?.exclude?.test(model.id)) { return undefined; }
	const rule = profile?.rules?.find(rule => rule.model.test(model.id));
	if (!audio && !rule?.transcription && provider.voiceModel !== model.id) { return undefined; }
	if (rule) { return rule.transport; }
	if (profile?.ids.includes('openrouter') && model.output?.includes('transcription')) { return 'transcriptions-json'; }
	if (profile?.ids.includes('gemini') && !/\/openai\/?$/.test(provider.baseUrl ?? '')) { return 'gemini-inline'; }
	return profile?.fallback ?? (provider.custom && !profile && provider.voiceModel === model.id ? 'chat-input-audio' : undefined);
}
