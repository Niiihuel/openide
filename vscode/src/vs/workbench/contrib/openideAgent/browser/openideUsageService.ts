/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — OAuth usage/billing service for Anthropic, Codex and Grok.
 *  It never logs nor exposes the bearer token.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { OPENIDE_REQUEST_CHANNEL, OpenideRequestChannelClient } from '../../../../platform/request/common/openideRequestIpc.js';
import {
	IProviderRateLimits,
	normalizeAnthropicUsageJson,
	normalizeCodexUsageJson,
	normalizeGeminiQuotaJson,
	normalizeGrokUsageJson,
	normalizeOpenRouterCreditsJson,
	providerSupportsUsage,
	UsageFailureKind,
} from '../common/openideUsage.js';
import { chatGptAccountIdFromJwt, stringClaimFromJwt } from '../common/openideJwt.js';
import { usageAccountKeyFromToken } from '../common/openideUsageIdentity.js';
import { t } from '../common/openideStrings.js';

export const IOpenideUsageService = createDecorator<IOpenideUsageService>('openideUsageService');

export interface IOpenideUsageService {
	readonly _serviceBrand: undefined;
	/** Cached usage, or undefined when never queried / not applicable. */
	getCached(providerId: string): IProviderRateLimits | undefined;
	/** Invalidates a provider's cache (or all of them). */
	invalidate(providerId?: string): void;
	/**
	 * Queries the provider's usage. `accessToken` is the OAuth bearer already resolved by the caller
	 * (the service does NOT touch SecretStorage). Returns normalized windows or a soft error.
	 */
	fetchAnthropicOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits>;
	fetchCodexOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits>;
	fetchGrokOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits>;
	/** Google Code Assist quota (Antigravity / Gemini CLI accounts): one bucket per model. */
	fetchGeminiQuota(providerId: string, accessToken: string, opts?: { force?: boolean; projectOverride?: string }): Promise<IProviderRateLimits>;
	/** OpenRouter prepaid balance (`/api/v1/credits`), keyed by the API key. */
	fetchOpenRouterCredits(providerId: string, apiKey: string, opts?: { force?: boolean }): Promise<IProviderRateLimits>;
	/** Helper: does this catalog entry support an OAuth usage query? */
	supportsProvider(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean;
}

const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const GROK_USAGE_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
const GROK_FALLBACK_USAGE_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
const GEMINI_CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
/** Same metadata the chat provider sends: loadCodeAssist keys the managed project on it. */
const GEMINI_CLIENT_METADATA = { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' };
/** Short cache: avoids hammering billing on every row expand. */
const CACHE_TTL_MS = 60_000;

/**
 * Stamps the account identity onto a usage result, for EVERY OAuth provider and without naming
 * any of them: the key is read from the token's own claims, so a provider added tomorrow gets
 * deduplicated against its CLI with no change here. A token that says nothing gets no key, and a
 * row with no key never merges — see openideUsageIdentity.ts.
 */
function withAccountKey(usage: IProviderRateLimits, token: string): IProviderRateLimits {
	return { ...usage, accountKey: usageAccountKeyFromToken(token) ?? null };
}

export class OpenideUsageService extends Disposable implements IOpenideUsageService {

	declare readonly _serviceBrand: undefined;

	private readonly net: IRequestService;
	private readonly cache = new Map<string, IProviderRateLimits>();

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		// Same MAIN channel as OAuth/providers: no CORS and no leaking the bearer into the renderer log.
		this.net = new OpenideRequestChannelClient(mainProcessService.getChannel(OPENIDE_REQUEST_CHANNEL));
	}

	supportsProvider(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean {
		return providerSupportsUsage(entry);
	}

	/** Orca keeps the HTTP failure kind and the Retry-After: the monitor's backoff needs both. */
	private failure(providerId: string, status: number, headers: Record<string, string | string[] | undefined> | undefined, message: string): IProviderRateLimits {
		const kind: UsageFailureKind = status === 401 || status === 403 ? 'stale-token' : status === 429 ? 'rate-limited' : status >= 500 ? 'server' : 'unknown';
		let retryAt: number | null = null;
		if (status === 429) {
			const raw = headers?.['retry-after'];
			const value = Array.isArray(raw) ? raw[0] : raw;
			const seconds = Number(value);
			retryAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : Date.now() + 60 * 60 * 1000;
		}
		const result: IProviderRateLimits = { providerId, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: kind, retryAt, error: message };
		this.cache.set(providerId, result);
		return result;
	}

	private networkFailure(providerId: string, message: string): IProviderRateLimits {
		const result: IProviderRateLimits = { providerId, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'network', error: message };
		this.cache.set(providerId, result);
		return result;
	}

	async fetchGeminiQuota(providerId: string, accessToken: string, opts?: { force?: boolean; projectOverride?: string }): Promise<IProviderRateLimits> {
		const token = (accessToken ?? '').trim();
		if (!providerId || !token) {
			return { providerId, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'missing-credentials', error: t('service.usage.noTokenQuota') };
		}
		if (!opts?.force) {
			const cached = this.getCached(providerId);
			if (cached && !cached.error) { return cached; }
		}
		const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'GeminiCLI/0.10.0 (linux; x64)' };
		try {
			// The quota is per project: loadCodeAssist answers with the account's managed project
			// once the account is onboarded (the chat provider does the onboarding on first use).
			const override = (opts?.projectOverride ?? '').trim();
			const load = await this.net.request({
				type: 'POST', url: `${GEMINI_CODE_ASSIST_BASE}:loadCodeAssist`, headers,
				data: JSON.stringify({ ...(override ? { cloudaicompanionProject: override } : {}), metadata: { ...GEMINI_CLIENT_METADATA, ...(override ? { duetProject: override } : {}) } }),
				callSite: 'openideUsageGemini',
			}, CancellationToken.None);
			const loadStatus = load.res.statusCode ?? 0;
			const loadText = (await asText(load)) ?? '';
			if (loadStatus < 200 || loadStatus >= 300) {
				return this.failure(providerId, loadStatus, load.res.headers, loadStatus === 401 || loadStatus === 403 ? t('service.usage.googleSessionCodeAssist') : t('service.usage.googleCodeAssistHttp', loadStatus));
			}
			let loaded: Record<string, unknown> | undefined;
			try { loaded = loadText ? JSON.parse(loadText) as Record<string, unknown> : undefined; } catch { loaded = undefined; }
			const project = typeof loaded?.cloudaicompanionProject === 'string' ? loaded.cloudaicompanionProject
				: typeof (loaded?.cloudaicompanionProject as { id?: unknown } | undefined)?.id === 'string' ? (loaded!.cloudaicompanionProject as { id: string }).id
					: override;
			if (!project) {
				const result: IProviderRateLimits = { providerId, fetchedAt: Date.now(), windows: [], status: 'unavailable', failureKind: 'not-onboarded', error: t('service.usage.googleNotOnboarded') };
				this.cache.set(providerId, result);
				return result;
			}
			const ctx = await this.net.request({
				type: 'POST', url: `${GEMINI_CODE_ASSIST_BASE}:retrieveUserQuota`, headers,
				data: JSON.stringify({ project }),
				callSite: 'openideUsageGemini',
			}, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			const text = (await asText(ctx)) ?? '';
			if (status < 200 || status >= 300) {
				return this.failure(providerId, status, ctx.res.headers, status === 401 || status === 403 ? t('service.usage.googleSessionQuota') : t('service.usage.googleQuotaHttp', status));
			}
			let json: unknown;
			try { json = text ? JSON.parse(text) : null; } catch {
				const bad: IProviderRateLimits = { providerId, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'parse', error: t('service.usage.googleQuotaUnreadable') };
				this.cache.set(providerId, bad);
				return bad;
			}
			const result = withAccountKey(normalizeGeminiQuotaJson(json, providerId), token);
			this.cache.set(providerId, result);
			return result;
		} catch {
			return this.networkFailure(providerId, t('service.usage.googleQuotaUnreachable'));
		}
	}

	async fetchOpenRouterCredits(providerId: string, apiKey: string, opts?: { force?: boolean }): Promise<IProviderRateLimits> {
		const key = (apiKey ?? '').trim();
		if (!providerId || !key) {
			return { providerId, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'missing-credentials', error: t('service.usage.noApiKeyCredits') };
		}
		if (!opts?.force) {
			const cached = this.getCached(providerId);
			if (cached && !cached.error) { return cached; }
		}
		try {
			const ctx = await this.net.request({
				type: 'GET', url: OPENROUTER_CREDITS_URL,
				headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
				callSite: 'openideUsageOpenRouter',
			}, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			const text = (await asText(ctx)) ?? '';
			if (status < 200 || status >= 300) {
				return this.failure(providerId, status, ctx.res.headers, status === 401 || status === 403 ? t('service.usage.openRouterRejectedKey') : t('service.usage.openRouterCreditsHttp', status));
			}
			let json: unknown;
			try { json = text ? JSON.parse(text) : null; } catch {
				const bad: IProviderRateLimits = { providerId, fetchedAt: Date.now(), windows: [], status: 'error', failureKind: 'parse', error: t('service.usage.openRouterUnreadable') };
				this.cache.set(providerId, bad);
				return bad;
			}
			const result = normalizeOpenRouterCreditsJson(json, providerId);
			this.cache.set(providerId, result);
			return result;
		} catch {
			return this.networkFailure(providerId, t('service.usage.openRouterUnreachable'));
		}
	}

	getCached(providerId: string): IProviderRateLimits | undefined {
		const hit = this.cache.get(providerId);
		if (!hit) {
			return undefined;
		}
		if (Date.now() - hit.fetchedAt > CACHE_TTL_MS) {
			return undefined;
		}
		return hit;
	}

	invalidate(providerId?: string): void {
		if (!providerId) {
			this.cache.clear();
			return;
		}
		this.cache.delete(providerId);
	}

	async fetchAnthropicOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits> {
		const token = (accessToken ?? '').trim();
		if (!providerId || !token) {
			return { providerId, fetchedAt: Date.now(), windows: [], error: t('service.usage.noTokenUsage') };
		}
		if (!opts?.force) {
			const cached = this.getCached(providerId);
			if (cached && !cached.error) {
				return cached;
			}
		}
		try {
			const ctx = await this.net.request({
				type: 'GET',
				url: ANTHROPIC_USAGE_URL,
				headers: {
					'Authorization': `Bearer ${token}`,
					'anthropic-beta': 'oauth-2025-04-20',
					'User-Agent': 'claude-code/2.1.0',
					'Accept': 'application/json',
				},
				callSite: 'openideUsageAnthropic',
			}, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			const text = (await asText(ctx)) ?? '';
			if (status < 200 || status >= 300) {
				// No incluir body crudo si pudiera filtrar PII; mensaje corto alcanza.
				const result: IProviderRateLimits = {
					providerId,
					fetchedAt: Date.now(),
					windows: [],
					error: status === 401 || status === 403
						? t('service.usage.unavailableSession')
						: t('service.usage.unavailableHttp', status),
				};
				this.cache.set(providerId, result);
				return result;
			}
			let json: unknown;
			try {
				json = text ? JSON.parse(text) : null;
			} catch {
				const bad: IProviderRateLimits = {
					providerId,
					fetchedAt: Date.now(),
					windows: [],
					error: t('service.usage.nonJson'),
				};
				this.cache.set(providerId, bad);
				return bad;
			}
			// Anthropic's tokens are opaque, so this resolves to no key and the row never merges.
			// Applied anyway: the rule is "ask the credential", not "ask the provider we remembered".
			const normalized = withAccountKey(normalizeAnthropicUsageJson(json, providerId), token);
			this.cache.set(providerId, normalized);
			return normalized;
		} catch {
			const fail: IProviderRateLimits = {
				providerId,
				fetchedAt: Date.now(),
				windows: [],
				error: t('service.usage.unreachable'),
			};
			this.cache.set(providerId, fail);
			return fail;
		}
	}

	async fetchCodexOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits> {
		const token = (accessToken ?? '').trim();
		if (!providerId || !token) {
			return { providerId, fetchedAt: Date.now(), windows: [], error: t('service.usage.noTokenUsage') };
		}
		if (!opts?.force) {
			const cached = this.getCached(providerId);
			if (cached && !cached.error) { return cached; }
		}
		const accountId = chatGptAccountIdFromJwt(token);
		try {
			const ctx = await this.net.request({
				type: 'GET',
				url: CODEX_USAGE_URL,
				headers: {
					'Authorization': `Bearer ${token}`,
					'User-Agent': 'codex_cli_rs/0.0.0 (OpenIDE)',
					'originator': 'codex_cli_rs',
					'Accept': 'application/json',
					...(accountId ? { 'ChatGPT-Account-ID': accountId } : {}),
				},
				callSite: 'openideUsageCodex',
			}, CancellationToken.None);
			const status = ctx.res.statusCode ?? 0;
			const text = (await asText(ctx)) ?? '';
			if (status < 200 || status >= 300) {
				const error = { providerId, fetchedAt: Date.now(), windows: [], error: status === 401 || status === 403 ? t('service.usage.codexExpired') : t('service.usage.codexHttp', status) };
				this.cache.set(providerId, error);
				return error;
			}
			const result = withAccountKey(normalizeCodexUsageJson(text ? JSON.parse(text) : null, providerId), token);
			this.cache.set(providerId, result);
			return result;
		} catch {
			const error = { providerId, fetchedAt: Date.now(), windows: [], error: t('service.usage.codexUnreachable') };
			this.cache.set(providerId, error);
			return error;
		}
	}

	async fetchGrokOAuthUsage(providerId: string, accessToken: string, opts?: { force?: boolean }): Promise<IProviderRateLimits> {
		const token = (accessToken ?? '').trim();
		if (!providerId || !token) {
			return { providerId, fetchedAt: Date.now(), windows: [], error: t('service.usage.noTokenUsage') };
		}
		if (!opts?.force) {
			const cached = this.getCached(providerId);
			if (cached && !cached.error) { return cached; }
		}
		const userId = stringClaimFromJwt(token, 'sub');
		const headers = {
			'Authorization': `Bearer ${token}`,
			'X-XAI-Token-Auth': 'xai-grok-cli',
			'Accept': 'application/json',
			...(userId ? { 'x-userid': userId } : {}),
		};
		try {
			for (const url of [GROK_USAGE_URL, GROK_FALLBACK_USAGE_URL]) {
				const ctx = await this.net.request({ type: 'GET', url, headers, callSite: 'openideUsageGrok' }, CancellationToken.None);
				const status = ctx.res.statusCode ?? 0;
				const text = (await asText(ctx)) ?? '';
				if (status === 401 || status === 403) {
					const error = { providerId, fetchedAt: Date.now(), windows: [], error: t('service.usage.grokExpired') };
					this.cache.set(providerId, error);
					return error;
				}
				if (status < 200 || status >= 300) { continue; }
				const result = withAccountKey(normalizeGrokUsageJson(text ? JSON.parse(text) : null, providerId), token);
				if (result.windows.length) {
					this.cache.set(providerId, result);
					return result;
				}
			}
		} catch { /* se normaliza abajo */ }
		const error = { providerId, fetchedAt: Date.now(), windows: [], error: t('service.usage.grokUnreachable') };
		this.cache.set(providerId, error);
		return error;
	}
}

registerSingleton(IOpenideUsageService, OpenideUsageService, InstantiationType.Delayed);
