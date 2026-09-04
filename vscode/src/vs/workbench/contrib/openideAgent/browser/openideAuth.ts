/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — pluggable authentication layer: API key (SecretStorage) or OAuth (delegated to
 *  OpenideOAuthManager, que maneja device-code / PKCE + refresh).
 *--------------------------------------------------------------------------------------------*/

import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { chooseCredential, CREDENTIAL_KEY, ICredentialOrigin, ICredentialSourcesSnapshot, IResolvedCredential, oauthSignalsFor } from '../../../../platform/openideAgentHost/common/openideCredentialSources.js';
import { ICredential } from '../common/openideAgentTypes.js';
import { IProviderEntry } from '../common/openideProviderCatalog.js';
import { OpenideOAuthManager } from './openideOAuth.js';

export const SECRET_APIKEY_PREFIX = 'openide.agent.apiKey.';

/** What the chain needs to know about a provider, supplied by whoever owns the model registry. */
export interface IProviderRegistryFacts {
	/** models.dev id — how the environment names it and how other tools key it. */
	readonly registryId?: string;
	readonly envNames?: readonly string[];
}

/** How long a snapshot of the environment and the other tools' files stays good. */
const SNAPSHOT_TTL_MS = 60_000;

/**
 * Where a provider's credential comes from, resolved in order and NEVER copied:
 *
 *   1. this store — what the user set here always wins;
 *   2. the environment, under the names models.dev publishes;
 *   3. the credential files of the agent tools the user already has.
 *
 * See `openideCredentialSources.ts` for why copying was the wrong shape. The practical
 * consequence: rotate a key anywhere and OpenIDE follows on the next call, because there is only
 * ever one copy of it.
 */
export class OpenideAuthManager {

	private snapshot: { at: number; value: ICredentialSourcesSnapshot } | undefined;
	private pending: Promise<ICredentialSourcesSnapshot> | undefined;
	private facts: (providerId: string) => IProviderRegistryFacts = () => ({});
	private allEnvNames: () => readonly string[] = () => [];
	private read: ((envNames: readonly string[]) => Promise<ICredentialSourcesSnapshot>) | undefined;

	constructor(
		private readonly secretStorage: ISecretStorageService,
		private readonly oauth: OpenideOAuthManager,
	) { }

	/**
	 * Wires the chain's two data sources: what the registry knows about a provider, and how to
	 * read the machine. Injected rather than constructed here so this stays a credential manager
	 * and does not grow a dependency on the model catalog or on the main process.
	 */
	useRegistry(facts: (providerId: string) => IProviderRegistryFacts, allEnvNames: () => readonly string[], read: (envNames: readonly string[]) => Promise<ICredentialSourcesSnapshot>): void {
		this.facts = facts;
		this.allEnvNames = allEnvNames;
		this.read = read;
	}

	/** Invalidates the snapshot so the next lookup re-reads the machine. */
	forgetExternalCredentials(): void {
		this.snapshot = undefined;
	}

	private async snapshotNow(): Promise<ICredentialSourcesSnapshot | undefined> {
		if (!this.read) {
			return undefined;
		}
		if (this.snapshot && Date.now() - this.snapshot.at < SNAPSHOT_TTL_MS) {
			return this.snapshot.value;
		}
		if (!this.pending) {
			// One read for every provider: the answer is the whole machine's picture, and asking
			// per provider would spawn a login shell per row of the settings page.
			this.pending = this.read(this.allEnvNames())
				.then(value => { this.snapshot = { at: Date.now(), value }; return value; })
				.finally(() => { this.pending = undefined; });
		}
		return this.pending.catch(() => undefined);
	}

	/** The credential in force for a provider, with where it came from. */
	async lookup(providerId: string): Promise<IResolvedCredential | undefined> {
		const stored = await this.secretStorage.get(SECRET_APIKEY_PREFIX + providerId);
		if (stored) {
			return chooseCredential({ stored });
		}
		const facts = this.facts(providerId);
		return chooseCredential({ ...facts, snapshot: await this.snapshotNow() });
	}

	/** Where the credential comes from, for the UI to print. Undefined when there is none. */
	async credentialOrigin(providerId: string): Promise<ICredentialOrigin | undefined> {
		return (await this.lookup(providerId))?.origin;
	}

	/** Providers another tool has connected over OAuth — a hint, never a usable credential. */
	async oauthElsewhere(providerId: string): Promise<{ readonly sourceId: string; readonly label: string }[]> {
		return oauthSignalsFor(this.facts(providerId).registryId, await this.snapshotNow());
	}

	async setApiKey(providerId: string, key: string): Promise<void> {
		await this.secretStorage.set(SECRET_APIKEY_PREFIX + providerId, key);
	}

	async clearApiKey(providerId: string): Promise<void> {
		await this.secretStorage.delete(SECRET_APIKEY_PREFIX + providerId);
	}

	/**
	 * Whether this provider has a usable key AT ALL — from anywhere in the chain.
	 *
	 * It has to be the whole chain and not just the store: `isConnected` reads this, and a
	 * provider whose key is in the environment would otherwise be resolvable at call time and
	 * still show as disconnected, absent from the picker, with no model list.
	 */
	async hasApiKey(providerId: string): Promise<boolean> {
		return !!(await this.lookup(providerId));
	}

	/** Only what the user pasted HERE — for the detail page's "remove this key" affordance. */
	async hasStoredApiKey(providerId: string): Promise<boolean> {
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
		const resolved = await this.lookup(entry.id);
		if (!resolved) {
			throw new Error(`Falta la API key de "${entry.label ?? entry.id}".`);
		}
		return { kind: 'apiKey', value: resolved.values[CREDENTIAL_KEY] };
	}

	/** Renews an OAuth credential after a server rejection. */
	async refreshOAuthCredential(entry: IProviderEntry): Promise<ICredential> {
		if (entry.auth !== 'oauth') {
			throw new Error(`El proveedor "${entry.label ?? entry.id}" no usa OAuth.`);
		}
		return { kind: 'oauth', token: await this.oauth.forceRefresh(entry) };
	}
}
