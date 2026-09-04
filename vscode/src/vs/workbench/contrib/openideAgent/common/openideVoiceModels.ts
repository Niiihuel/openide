/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — which connected models can actually hear, as data.
 *
 *  Dictation used to be a text box: `openide.agent.voiceModel`, typed by hand as `provider/model`,
 *  validated only when the microphone was already pressed. It had to be a text box because the
 *  product only knew three audio models -- the `voiceModel` each provider entry declares -- so for
 *  every other provider the answer was "type the name yourself and hope".
 *
 *  It does know, though. The models.dev registry publishes `modalities.input` per model and the
 *  catalog already carries it through to the picker (`IOpenidePickerModel.input`); 644 of the
 *  registry's models list `audio` there. So the list a selector needs is a filter over what the
 *  chat's own model picker already shows, and this module is that filter -- pure, so it can be
 *  tested without a provider, a network or a workbench.
 *
 *  ── Why the protocol matters as much as the modality ──────────────────────────────────────
 *  Transcription is a chat completion carrying an `input_audio` content part, which is OpenAI's
 *  shape. A model that hears audio behind Anthropic's protocol still cannot be dictated to here,
 *  and it is a worse experience to list it and fail at the microphone than to say why up front.
 *  Hence two filters, and hence `excluded`: a provider the user connected and does NOT see in the
 *  list deserves a reason, not silence.
 *--------------------------------------------------------------------------------------------*/

import { parseProviderModelTarget } from './openideFallback.js';

/** Protocols whose chat completion accepts an `input_audio` content part. */
export const VOICE_PROTOCOLS: ReadonlySet<string> = new Set(['openai', 'openai-responses']);

/** The shape this module needs from a model. `IOpenidePickerModel` satisfies it. */
export interface IVoiceCandidateModel {
	readonly id: string;
	readonly input: readonly string[];
}

/** The shape this module needs from a provider's group of models. */
export interface IVoiceCandidateGroup<M extends IVoiceCandidateModel> {
	readonly id: string;
	readonly label: string;
	readonly models: readonly M[];
}

/** Why a connected provider is not offering dictation. */
export type VoiceExclusionReason =
	/** Its protocol has no way to carry audio (Anthropic, the Codex backend). */
	| 'protocol'
	/** Right protocol, but not one of its models publishes audio input. */
	| 'noAudioModel';

export interface IVoiceExclusion {
	readonly id: string;
	readonly label: string;
	readonly reason: VoiceExclusionReason;
}

export interface IVoiceModelSelection<M extends IVoiceCandidateModel> {
	/** Providers that can dictate, each with only the models that can hear. */
	readonly groups: readonly IVoiceCandidateGroup<M>[];
	/** Connected providers that cannot, and why. */
	readonly excluded: readonly IVoiceExclusion[];
}

/**
 * True when the model publishes audio among its INPUT modalities.
 *
 * Case and padding are normalized because the value travels from a third-party registry: this is
 * the one place that decides what "audio" means, so a `"Audio"` upstream does not silently drop a
 * model from the list.
 */
export function modelAcceptsAudio(model: IVoiceCandidateModel): boolean {
	return model.input.some(modality => modality.trim().toLowerCase() === 'audio');
}

/**
 * Splits the connected groups into what can dictate and what cannot.
 *
 * Order is preserved from the input: the caller has already sorted providers the way the user
 * arranged them in the picker, and a second opinion here would just be a different list in a
 * second place.
 */
export function selectVoiceModels<M extends IVoiceCandidateModel>(
	groups: readonly IVoiceCandidateGroup<M>[],
	protocolOf: (providerId: string) => string | undefined,
): IVoiceModelSelection<M> {
	const usable: IVoiceCandidateGroup<M>[] = [];
	const excluded: IVoiceExclusion[] = [];
	for (const group of groups) {
		if (!VOICE_PROTOCOLS.has(protocolOf(group.id) ?? '')) {
			excluded.push({ id: group.id, label: group.label, reason: 'protocol' });
			continue;
		}
		const models = group.models.filter(modelAcceptsAudio);
		if (!models.length) {
			excluded.push({ id: group.id, label: group.label, reason: 'noAudioModel' });
			continue;
		}
		usable.push({ id: group.id, label: group.label, models });
	}
	return { groups: usable, excluded };
}

/** What `openide.agent.voiceModel` holds, once read. */
export type VoiceSetting =
	/** Empty: follow the active provider's own `voiceModel`. */
	| { readonly kind: 'auto' }
	/** Written by hand and not in `provider/model` form. */
	| { readonly kind: 'invalid' }
	| { readonly kind: 'pinned'; readonly providerId: string; readonly model: string };

/**
 * Reads the setting.
 *
 * The split itself is `parseProviderModelTarget`'s, the same one the fallback chain uses -- one
 * rule for what `provider/model` means, in one place. It splits on the FIRST slash, never the
 * last, because a model id can carry slashes of its own (OpenRouter publishes
 * `openai/gpt-4o-audio-preview`) and a provider id cannot.
 *
 * What is added here is the distinction that parser folds away: it answers `undefined` both for
 * "nothing written" and for "written wrong", and those owe the user different words -- the first
 * is the default, the second is a mistake to point at.
 */
export function parseVoiceSetting(raw: string | undefined): VoiceSetting {
	const value = (raw ?? '').trim();
	if (!value) {
		return { kind: 'auto' };
	}
	const target = parseProviderModelTarget(value);
	if (!target?.model) {
		return { kind: 'invalid' };
	}
	return { kind: 'pinned', providerId: target.providerId, model: target.model };
}

/** The inverse: what to store when a row in the selector is chosen. */
export function formatVoiceSetting(providerId: string, model: string): string {
	return `${providerId}/${model}`;
}

/** True when the stored setting points at exactly this row. */
export function isVoiceSettingFor(setting: VoiceSetting, providerId: string, model: string): boolean {
	return setting.kind === 'pinned' && setting.providerId === providerId && setting.model === model;
}
