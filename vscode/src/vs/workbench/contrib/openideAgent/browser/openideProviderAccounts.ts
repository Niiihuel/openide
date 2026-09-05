/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — multiple saved accounts per provider, with one "active" at a time.
 *
 *  Deliberately NON-invasive design: openideAuth.ts/openideOAuth.ts keep reading and writing
 *  the active credential exactly as always, under the SAME long-standing key
 *  (`openide.agent.apiKey.<providerId>` / `openide.agent.oauth.<providerId>`). This
 *  service only manages extra copies ("accounts") under `<baseKey>::<accountId>` plus a
 *  pointer to which one is active — it never knows the token's internal shape (an opaque string),
 *  so it works equally for API keys and for OAuth.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';

export interface IProviderAccountMeta {
	readonly id: string;
	readonly label: string;
	readonly addedAt: number;
}

/**
 * The name an account gets when nothing could identify it. A number is a last resort: it says
 * nothing about WHICH of your sessions this is, which is the only question the list answers.
 * `isPlaceholderAccountLabel` recognises one so it can be upgraded the moment the provider tells
 * us an email — including the `Cuenta N` labels written before this was in English.
 */
export function placeholderAccountLabel(ordinal: number): string {
	return `Account ${ordinal}`;
}

export function isPlaceholderAccountLabel(label: string): boolean {
	return /^(?:Account|Cuenta)\s+\d+$/.test(label.trim());
}

const ACCOUNT_INDEX_PREFIX = 'openide.agent.accounts.index.';
const ACCOUNT_ACTIVE_PREFIX = 'openide.agent.accounts.active.';

export class OpenideProviderAccountsService {

	constructor(
		private readonly secretStorage: ISecretStorageService,
	) { }

	private indexKey(providerId: string): string { return ACCOUNT_INDEX_PREFIX + providerId; }
	private activeKey(providerId: string): string { return ACCOUNT_ACTIVE_PREFIX + providerId; }
	private accountSecretKey(baseKey: string, accountId: string): string { return `${baseKey}::${accountId}`; }

	async list(providerId: string): Promise<IProviderAccountMeta[]> {
		const raw = await this.secretStorage.get(this.indexKey(providerId));
		if (!raw) {
			return [];
		}
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed)
				? parsed.filter((entry): entry is IProviderAccountMeta => !!entry && typeof entry.id === 'string' && typeof entry.label === 'string')
				: [];
		} catch {
			return [];
		}
	}

	async getActiveId(providerId: string): Promise<string | undefined> {
		return (await this.secretStorage.get(this.activeKey(providerId))) || undefined;
	}

	private async setActiveId(providerId: string, accountId: string | undefined): Promise<void> {
		if (accountId) {
			await this.secretStorage.set(this.activeKey(providerId), accountId);
		} else {
			await this.secretStorage.delete(this.activeKey(providerId));
		}
	}

	private async saveIndex(providerId: string, accounts: IProviderAccountMeta[]): Promise<void> {
		await this.secretStorage.set(this.indexKey(providerId), JSON.stringify(accounts));
	}

	/** Stores the CURRENT contents of `baseKey` (the long-standing active credential) as a new
	 *  account (without `id`) or updates an existing one (with `id`), and marks it active. It does
	 *  nothing when `baseKey` is empty (nothing connected yet). */
	async snapshot(providerId: string, baseKey: string, opts: { id?: string; label?: string }): Promise<string | undefined> {
		const current = await this.secretStorage.get(baseKey);
		if (!current) {
			return undefined;
		}
		const accounts = await this.list(providerId);
		const id = opts.id || generateUuid();
		await this.secretStorage.set(this.accountSecretKey(baseKey, id), current);
		const index = accounts.findIndex(account => account.id === id);
		const meta: IProviderAccountMeta = {
			id,
			label: opts.label || (index >= 0 ? accounts[index].label : placeholderAccountLabel(accounts.length + 1)),
			addedAt: index >= 0 ? accounts[index].addedAt : Date.now(),
		};
		if (index >= 0) { accounts[index] = meta; } else { accounts.push(meta); }
		await this.saveIndex(providerId, accounts);
		await this.setActiveId(providerId, id);
		return id;
	}

	/** If there is already an active credential (legacy or from a previous session) but no account
	 *  tracked yet, it registers it as the first account — a transparent migration, without
	 *  touching the active key. ALWAYS call it before connecting/adding/re-authenticating. */
	async ensureActiveTracked(providerId: string, baseKey: string): Promise<boolean> {
		if (await this.getActiveId(providerId)) {
			return false;
		}
		return await this.snapshot(providerId, baseKey, {}) !== undefined;
	}

	/** Copies the saved account `accountId` into the active key and marks it active. */
	async activate(providerId: string, baseKey: string, accountId: string): Promise<boolean> {
		const value = await this.secretStorage.get(this.accountSecretKey(baseKey, accountId));
		if (value === undefined) {
			return false;
		}
		// Save what is in the ACTIVE key back into the account that owns it, before overwriting it.
		//
		// `ensureActiveTracked` cannot do this: it returns early the moment an active id exists, and
		// one always does by the time you are switching. Meanwhile `getValidToken`/`forceRefresh`
		// write refreshed credentials to the base key and never to the per-account copy — so the
		// stored copy drifts behind from the first refresh onwards. Leaving it stale meant switching
		// away and back restored a token that could already be dead, which is exactly the promise
		// "go back to the previous account" has to keep.
		const current = await this.getActiveId(providerId);
		if (current && current !== accountId) {
			await this.snapshot(providerId, baseKey, { id: current });
		} else {
			await this.ensureActiveTracked(providerId, baseKey);
		}
		await this.secretStorage.set(baseKey, value);
		await this.setActiveId(providerId, accountId);
		return true;
	}

	/** Renames a saved account. Used to replace a placeholder with the real identity once the
	 *  provider reveals one — a no-op when the account is gone or already carries that name. */
	async rename(providerId: string, accountId: string, label: string): Promise<boolean> {
		const accounts = await this.list(providerId);
		const index = accounts.findIndex(account => account.id === accountId);
		if (index < 0 || !label.trim() || accounts[index].label === label) {
			return false;
		}
		accounts[index] = { ...accounts[index], label };
		await this.saveIndex(providerId, accounts);
		return true;
	}

	/** Removing the active account selects a remaining saved credential before disconnecting.
	 * Missing account secrets are skipped; deleting the last usable account signs out. */
	async remove(providerId: string, baseKey: string, accountId: string): Promise<void> {
		const accounts = (await this.list(providerId)).filter(account => account.id !== accountId);
		if ((await this.getActiveId(providerId)) === accountId) {
			let replacement: IProviderAccountMeta | undefined;
			for (const account of accounts) {
				const credential = await this.secretStorage.get(this.accountSecretKey(baseKey, account.id));
				if (!credential) { continue; }
				await this.secretStorage.set(baseKey, credential);
				replacement = account;
				break;
			}
			await this.setActiveId(providerId, replacement?.id);
			if (!replacement) { await this.secretStorage.delete(baseKey); }
		}
		await this.secretStorage.delete(this.accountSecretKey(baseKey, accountId));
		await this.saveIndex(providerId, accounts);
	}
}
