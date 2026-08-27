/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — pluggable authentication layer: API key (SecretStorage) or OAuth (delegated to
 *  OpenideOAuthManager, que maneja device-code / PKCE + refresh).
 *--------------------------------------------------------------------------------------------*/

import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ICredential } from '../common/openideAgentTypes.js';
import { IProviderEntry } from '../common/openideProviderCatalog.js';
import { OpenideOAuthManager } from './openideOAuth.js';

export const SECRET_APIKEY_PREFIX = 'openide.agent.apiKey.';

export class OpenideAuthManager {

	constructor(
		private readonly secretStorage: ISecretStorageService,
		private readonly oauth: OpenideOAuthManager,
	) { }

	async setApiKey(providerId: string, key: string): Promise<void> {
		await this.secretStorage.set(SECRET_APIKEY_PREFIX + providerId, key);
	}

	async clearApiKey(providerId: string): Promise<void> {
		await this.secretStorage.delete(SECRET_APIKEY_PREFIX + providerId);
	}

	async hasApiKey(providerId: string): Promise<boolean> {
		return !!(await this.secretStorage.get(SECRET_APIKEY_PREFIX + providerId));
	}

	/** Resolves the credential for a provider; throws with a clear message when missing. */
	async resolveCredential(entry: IProviderEntry): Promise<ICredential> {
		if (entry.auth === 'none') {
			// Local endpoints without a credential (Ollama): empty bearer → the adapter omits the header.
			return { kind: 'apiKey', value: '' };
		}
		if (entry.auth === 'oauth') {
			// Copilot: the GitHub token is exchanged for an ephemeral Copilot JWT.
			const token = entry.id === 'copilot'
				? await this.oauth.getCopilotToken(entry)
				: await this.oauth.getValidToken(entry);
			return { kind: 'oauth', token };
		}
		const key = await this.secretStorage.get(SECRET_APIKEY_PREFIX + entry.id);
		if (!key) {
			throw new Error(`Falta la API key de "${entry.label ?? entry.id}".`);
		}
		return { kind: 'apiKey', value: key };
	}

	/** Renews an OAuth credential after a server rejection. */
	async refreshOAuthCredential(entry: IProviderEntry): Promise<ICredential> {
		if (entry.auth !== 'oauth') {
			throw new Error(`El proveedor "${entry.label ?? entry.id}" no usa OAuth.`);
		}
		return { kind: 'oauth', token: await this.oauth.forceRefresh(entry) };
	}
}
