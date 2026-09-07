/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { asText } from '../../../../platform/request/common/request.js';
import { ICredential } from '../common/openideAgentTypes.js';
import { IOpenideAgentRequestService } from '../common/openideNativeServices.js';
import { IOpenidePickerModel, IOpenidePickerGroup } from '../common/openidePickerModels.js';
import { IProviderEntry } from '../common/openideProviderCatalog.js';
import { IVoiceCapability, IVoiceModelSelection, parseVoiceSetting, selectVoiceModels } from '../common/openideVoiceModels.js';
import { parseVoiceTranscription, voiceTranscriptionRequest } from '../common/openideVoiceRequest.js';
import { hasVoiceTransport, resolveVoiceTransport } from '../common/openideVoiceTransport.js';
import { t } from '../common/openideStrings.js';

export interface IOpenideVoiceProviders {
	getActiveProviderId(): string;
	findProvider(id: string): IProviderEntry | undefined;
	isConnected(id: string): Promise<boolean>;
	describeModel(providerId: string, model: string): IOpenidePickerModel;
	getConnectedModelGroups(providerId?: string, model?: string, includeEmpty?: boolean): Promise<IOpenidePickerGroup[]>;
	resolveCredential(entry: IProviderEntry): Promise<ICredential>;
}

/** Dictation depends on provider facts and a request transport, never the chat or turn runtime. */
export class OpenideVoiceService {
	constructor(private readonly providers: IOpenideVoiceProviders, private readonly configurationService: IConfigurationService, private readonly netRequests: IOpenideAgentRequestService) { }

	private async resolveVoiceTarget(providerId?: string, model?: string): Promise<{ capability: IVoiceCapability; entry?: IProviderEntry }> {
		const configured = parseVoiceSetting(String(this.configurationService.getValue('openide.agent.voiceModel') ?? ''));
		let targetProvider = providerId?.trim() ?? '';
		let targetModel = model?.trim() ?? '';
		let overridden = false;
		if (!targetProvider && !targetModel && configured.kind !== 'auto') {
			if (configured.kind === 'invalid') {
				return { capability: { available: false, reason: t('agentSurface.voice.settingFormat') } };
			}
			targetProvider = configured.providerId;
			targetModel = configured.model;
			overridden = true;
		}
		if (!targetProvider) {
			targetProvider = this.providers.getActiveProviderId();
		}
		const entry = this.providers.findProvider(targetProvider);
		if (!entry) {
			return { capability: { available: false, reason: t('agentSurface.voice.selectProvider') } };
		}
		if (!targetModel) {
			targetModel = entry.voiceModel ?? '';
		}
		if (!targetModel) {
			return { capability: { available: false, providerId: entry.id, providerLabel: entry.label, reason: t('agentSurface.voice.noTranscriptionModel', entry.label) }, entry };
		}
		if (!hasVoiceTransport(entry)) {
			return { capability: { available: false, providerId: entry.id, providerLabel: entry.label, model: targetModel, reason: t('agentSurface.voice.noAudioProtocol', entry.label) }, entry };
		}
		if (!(await this.providers.isConnected(entry.id))) {
			return { capability: { available: false, providerId: entry.id, providerLabel: entry.label, model: targetModel, reason: t('agentSurface.voice.connectProvider', entry.label) }, entry };
		}
		if (!resolveVoiceTransport(entry, this.providers.describeModel(entry.id, targetModel))) {
			return { capability: { available: false, providerId: entry.id, providerLabel: entry.label, model: targetModel, reason: t('agentSurface.voice.modelUnsupported', targetModel, entry.label) }, entry };
		}
		return { capability: { available: true, providerId: entry.id, providerLabel: entry.label, model: targetModel, overridden }, entry };
	}

	async getVoiceCapability(): Promise<IVoiceCapability> {
		return (await this.resolveVoiceTarget()).capability;
	}

	/**
	 * The connected models that can hear, grouped as the picker groups them.
	 *
	 * Built on `getConnectedModelGroups` rather than on a query of its own: dictation must offer
	 * what the chat offers, minus what cannot carry audio. A second enumeration would drift from
	 * the first the day discovery changes, and the user would be looking at two different ideas of
	 * "the models you have".
	 */
	async listVoiceModels(): Promise<IVoiceModelSelection<IOpenidePickerModel>> {
		const groups = await this.providers.getConnectedModelGroups(undefined, undefined, true);
		// STT-only services need not appear in a provider's chat-model catalog.
		const candidates = groups.map(group => {
			const entry = this.providers.findProvider(group.id);
			const models = [...group.models];
			for (const id of [entry?.voiceModel, ...Object.keys(entry?.voiceModelTransports ?? {})]) {
				if (id && !models.some(model => model.id === id)) { models.push(this.providers.describeModel(group.id, id)); }
			}
			return { ...group, models };
		});
		return selectVoiceModels(candidates, providerId => {
			const entry = this.providers.findProvider(providerId);
			return entry && hasVoiceTransport(entry) ? entry.protocol : undefined;
		}, (providerId, model) => {
			const entry = this.providers.findProvider(providerId);
			return !!entry && !!resolveVoiceTransport(entry, model);
		});
	}

	async transcribeAudio(wavBase64: string, providerId?: string, model?: string, token: CancellationToken = CancellationToken.None): Promise<string> {
		const resolved = await this.resolveVoiceTarget(providerId, model);
		const pick = resolved.capability;
		if (!pick.available || !resolved.entry || !pick.model) {
			throw new Error(pick.reason ?? t('agentSurface.voice.notAvailable'));
		}
		const credential = await this.providers.resolveCredential(resolved.entry);
		const base = (resolved.entry.baseUrl || '').replace(/\/+$/, '');
		const request = voiceTranscriptionRequest(resolved.entry, this.providers.describeModel(resolved.entry.id, pick.model), wavBase64);
		const headers: Record<string, string> = { ...resolved.entry.extraHeaders, 'Content-Type': request.contentType };
		const authToken = credential.kind === 'apiKey' ? credential.value : credential.token;
		if (authToken) {
			headers['Authorization'] = `Bearer ${authToken}`;
		}
		if (request.transport === 'gemini-inline' && credential.kind === 'apiKey') {
			delete headers.Authorization;
			headers['x-goog-api-key'] = credential.value;
		}
		const ctx = await this.netRequests.request({
			type: 'POST',
			url: `${base}${request.path}`,
			data: request.data,
			dataBase64: request.dataBase64,
			timeout: 60_000,
			headers,
			callSite: 'openideAgentVoice',
		}, token);
		const text = (await asText(ctx)) ?? '';
		const status = ctx.res.statusCode ?? 0;
		if (status < 200 || status >= 300) {
			let detail = '';
			try {
				const parsed = JSON.parse(text) as { error?: { message?: unknown } };
				detail = typeof parsed.error?.message === 'string' ? `: ${parsed.error.message.slice(0, 240)}` : '';
			} catch { /* no exponemos el body crudo del provider */ }
			throw new Error(t('agentSurface.voice.transcriptionFailed', status, detail));
		}
		return parseVoiceTranscription(text, request.response);
	}

}
