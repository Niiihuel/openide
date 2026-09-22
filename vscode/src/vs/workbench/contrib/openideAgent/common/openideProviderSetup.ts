/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IProviderEntry } from './openideProviderCatalog.js';

export type OpenideSetupProtocol = 'openai' | 'openai-responses' | 'anthropic';

/** An in-memory form draft. The API key must never be written to provider configuration. */
export interface IOpenideProviderSetupDraft {
	name: string;
	id: string;
	baseUrl: string;
	protocol: OpenideSetupProtocol;
	auth: 'apiKey' | 'none';
	defaultModel: string;
	apiKey: string;
	idEdited: boolean;
	originalId?: string;
	/** Preserve an advanced discovery override when editing an existing provider. */
	dynamicModels?: boolean;
}

/** The non-secret portion of the form; credentials travel separately to the secret store. */
export interface IOpenideCustomProviderSetup {
	readonly id: string;
	readonly label: string;
	readonly company: string;
	readonly baseUrl: string;
	readonly protocol: OpenideSetupProtocol;
	readonly auth: 'apiKey' | 'none';
	readonly defaultModel?: string;
	readonly dynamicModels: boolean;
}

export type OpenideProviderSetupField = 'name' | 'id' | 'baseUrl' | 'protocol' | 'auth' | 'defaultModel' | 'apiKey';
export type OpenideProviderSetupError = 'nameRequired' | 'idInvalid' | 'idExists' | 'idImmutable' | 'urlRequired' | 'urlInvalid' | 'urlCredentials' | 'urlQuery' | 'apiKeyInvalid';

/** Stable IDs are independent of display names once the user edits or saves them. */
export function providerIdFromName(name: string): string {
	return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z]+/, '').replace(/[-._]+$/, '');
}

export function createProviderSetupDraft(provider?: IProviderEntry): IOpenideProviderSetupDraft {
	return {
		name: provider?.label ?? '',
		id: provider?.id ?? '',
		baseUrl: provider?.baseUrl ?? '',
		protocol: provider?.protocol === 'anthropic' || provider?.protocol === 'openai-responses' ? provider.protocol : 'openai',
		auth: provider?.auth === 'none' ? 'none' : 'apiKey',
		defaultModel: provider?.defaultModel ?? '',
		apiKey: '',
		idEdited: !!provider,
		originalId: provider?.id,
		...(provider?.dynamicModels === undefined ? {} : { dynamicModels: provider.dynamicModels }),
	};
}

/** Pure validation shared by the form and tests. Error values never contain entered secrets. */
export function validateProviderSetupDraft(draft: IOpenideProviderSetupDraft, existingIds: readonly string[] = []): Partial<Record<OpenideProviderSetupField, OpenideProviderSetupError>> {
	const errors: Partial<Record<OpenideProviderSetupField, OpenideProviderSetupError>> = {};
	const id = draft.id.trim();
	if (!draft.name.trim()) {
		errors.name = 'nameRequired';
	}
	if (draft.originalId && id !== draft.originalId) {
		errors.id = 'idImmutable';
	} else if (!/^[a-z][a-z0-9._-]*$/i.test(id)) {
		errors.id = 'idInvalid';
	} else if (existingIds.some(existing => existing.toLowerCase() === id.toLowerCase() && existing !== draft.originalId)) {
		errors.id = 'idExists';
	}
	if (!draft.baseUrl.trim()) {
		errors.baseUrl = 'urlRequired';
	} else {
		try {
			const address = draft.baseUrl.trim();
			const url = new URL(address);
			if (!/^https?:\/\//i.test(address) || /[\s\x00-\x1f\x7f]/.test(address) || !url.hostname) {
				errors.baseUrl = 'urlInvalid';
			} else if (url.username || url.password) {
				errors.baseUrl = 'urlCredentials';
			} else if (url.search || url.hash) {
				errors.baseUrl = 'urlQuery';
			}
		} catch {
			errors.baseUrl = 'urlInvalid';
		}
	}
	if (draft.auth === 'apiKey' && /[\s\x00-\x1f\x7f]/.test(draft.apiKey.trim())) {
		errors.apiKey = 'apiKeyInvalid';
	}
	return errors;
}

/** Normalize only whitespace and a terminal slash; never guess an endpoint's API version. */
export function providerSetupConfiguration(draft: IOpenideProviderSetupDraft): IOpenideCustomProviderSetup {
	return {
		id: draft.id.trim(),
		label: draft.name.trim(),
		company: draft.name.trim(),
		baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
		protocol: draft.protocol,
		auth: draft.auth,
		defaultModel: draft.defaultModel.trim() || undefined,
		dynamicModels: draft.dynamicModels ?? draft.protocol !== 'anthropic',
	};
}
