/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — the CLI subscriptions' credential stores, transcribed from Orca's rate-limit
 *  fetchers (one per provider: Claude, Codex, Gemini, Grok). Orca's roster is not limited to the
 *  accounts connected
 *  inside the app: any agent CLI the user signed into on this machine (Claude Code, Codex,
 *  Gemini CLI, Grok) counts as an account, read from that CLI's own credential file. This module
 *  is only the PARSING — where each CLI keeps its token and what the JSON looks like — so it can
 *  be unit-tested; the file reads and the HTTP live in `openideCliUsage.ts`.
 *--------------------------------------------------------------------------------------------*/

import { numberClaimFromJwt } from './openideJwt.js';
import { ProtocolId } from './openideProviderCatalog.js';

export type CliUsageKind = 'anthropic' | 'codex' | 'gemini' | 'grok';

export interface ICliUsageAccountDef {
	/** `cli-` prefix keeps these ids out of the provider catalog's namespace. */
	readonly id: string;
	readonly label: string;
	readonly company: string;
	readonly protocol: ProtocolId;
	/** Credential store of the CLI, as path segments under the user's home. */
	readonly credentialSegments: readonly string[];
	readonly kind: CliUsageKind;
}

/**
 * The CLIs whose subscription usage we can read. Paths are the CLIs' defaults (Orca also honors
 * CODEX_HOME/GROK_HOME and the macOS keychain; the files below are where every CLI ends up on
 * Linux and what all of them keep as fallback elsewhere).
 */
export const OPENIDE_CLI_USAGE_ACCOUNTS: readonly ICliUsageAccountDef[] = [
	{ id: 'cli-claude', label: 'Claude Code', company: 'Anthropic', protocol: 'anthropic', credentialSegments: ['.claude', '.credentials.json'], kind: 'anthropic' },
	{ id: 'cli-codex', label: 'Codex CLI', company: 'OpenAI', protocol: 'codex', credentialSegments: ['.codex', 'auth.json'], kind: 'codex' },
	{ id: 'cli-gemini', label: 'Gemini CLI', company: 'Google', protocol: 'gemini-cloudcode', credentialSegments: ['.gemini', 'oauth_creds.json'], kind: 'gemini' },
	{ id: 'cli-grok', label: 'Grok CLI', company: 'xAI', protocol: 'openai', credentialSegments: ['.grok', 'auth.json'], kind: 'grok' },
];

export function isCliUsageAccountId(id: string): boolean {
	return id.startsWith('cli-');
}

export function cliUsageAccountOf(id: string): ICliUsageAccountDef | undefined {
	return OPENIDE_CLI_USAGE_ACCOUNTS.find(def => def.id === id);
}

export interface ICliOAuthCredential {
	readonly token: string;
	/** Epoch ms, or null when the store does not say (a 401 is then the only truth). */
	readonly expiresAt: number | null;
	readonly refreshToken: string | null;
	/** Plan named by the store (Claude's `subscriptionType`); the usage endpoint's answer wins. */
	readonly plan: string | null;
}

/** Orca's TOKEN_SKEW_MS: a token about to die is already dead for a poller. */
export const CLI_TOKEN_SKEW_MS = 5 * 60 * 1000;

export function cliCredentialExpired(credential: ICliOAuthCredential, now = Date.now()): boolean {
	return credential.expiresAt !== null && credential.expiresAt - now <= CLI_TOKEN_SKEW_MS;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function asEpochMs(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseJson(text: string): unknown {
	try { return JSON.parse(text); } catch { return undefined; }
}

/** `~/.claude/.credentials.json` → `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, subscriptionType } }`. */
export function parseClaudeCliCredentials(text: string): ICliOAuthCredential | undefined {
	const oauth = asRecord(asRecord(parseJson(text))?.claudeAiOauth);
	const token = asNonEmptyString(oauth?.accessToken);
	if (!token) { return undefined; }
	return {
		token,
		expiresAt: asEpochMs(oauth!.expiresAt),
		refreshToken: asNonEmptyString(oauth!.refreshToken) ?? null,
		plan: asNonEmptyString(oauth!.subscriptionType) ?? null,
	};
}

/** `~/.codex/auth.json` → `{ tokens: { access_token, refresh_token, account_id } }`; expiry lives in the JWT's `exp`. */
export function parseCodexCliAuth(text: string): ICliOAuthCredential | undefined {
	const tokens = asRecord(asRecord(parseJson(text))?.tokens);
	const token = asNonEmptyString(tokens?.access_token);
	if (!token) { return undefined; }
	const exp = numberClaimFromJwt(token, 'exp');
	return {
		token,
		expiresAt: exp !== undefined ? exp * 1000 : null,
		refreshToken: asNonEmptyString(tokens!.refresh_token) ?? null,
		plan: null,
	};
}

/** `~/.gemini/oauth_creds.json` → `{ access_token, refresh_token, expiry_date }` (google-auth-library shape). */
export function parseGeminiCliCredentials(text: string): ICliOAuthCredential | undefined {
	const creds = asRecord(parseJson(text));
	const token = asNonEmptyString(creds?.access_token);
	if (!token) { return undefined; }
	return {
		token,
		expiresAt: asEpochMs(creds!.expiry_date),
		refreshToken: asNonEmptyString(creds!.refresh_token) ?? null,
		plan: null,
	};
}

/** Stale alternate issuers can precede the default xAI session in the file (Orca's comment). */
const GROK_PREFERRED_ISSUER = 'https://auth.x.ai';

/** `~/.grok/auth.json` → `{ "<issuer>": { key, expires_at } }`; prefer `https://auth.x.ai` entries. */
export function parseGrokCliAuth(text: string): ICliOAuthCredential | undefined {
	const entries = asRecord(parseJson(text));
	if (!entries) { return undefined; }
	let preferredKeySeen = false;
	let expiredPreferred: ICliOAuthCredential | undefined;
	let fallback: ICliOAuthCredential | undefined;
	for (const [issuer, value] of Object.entries(entries)) {
		const isPreferred = issuer === GROK_PREFERRED_ISSUER || issuer.startsWith(`${GROK_PREFERRED_ISSUER}::`);
		preferredKeySeen ||= isPreferred;
		const entry = asRecord(value);
		const token = asNonEmptyString(entry?.key);
		if (!token) { continue; }
		const expiresAtIso = asNonEmptyString(entry!.expires_at);
		const expiresAtMs = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
		const credential: ICliOAuthCredential = {
			token,
			expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
			refreshToken: null,
			plan: null,
		};
		if (isPreferred) {
			if (!cliCredentialExpired(credential)) { return credential; }
			expiredPreferred ??= credential;
			continue;
		}
		fallback ??= credential;
	}
	// Alternate issuers are compatibility fallbacks only when no default entry exists at all.
	return expiredPreferred ?? (preferredKeySeen ? undefined : fallback);
}

export function parseCliCredential(kind: CliUsageKind, text: string): ICliOAuthCredential | undefined {
	switch (kind) {
		case 'anthropic': return parseClaudeCliCredentials(text);
		case 'codex': return parseCodexCliAuth(text);
		case 'gemini': return parseGeminiCliCredentials(text);
		case 'grok': return parseGrokCliAuth(text);
	}
}
