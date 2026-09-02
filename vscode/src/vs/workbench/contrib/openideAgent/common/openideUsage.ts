/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — per-provider usage/rate-limit types and normalization (OAuth).
 *  Scope inicial: respuesta de `GET https://api.anthropic.com/api/oauth/usage`.
 *--------------------------------------------------------------------------------------------*/

export type UsageBand = 'green' | 'amber' | 'red';

export interface IRateLimitWindow {
	readonly label: string;
	/** 0–100; null si el provider no reporta porcentaje. */
	readonly usedPercent: number | null;
	/** Window in minutes (5h=300, 7d=10080) when known. */
	readonly limitMinutes: number | null;
	/** Reset epoch in ms, or null when not provided. */
	readonly resetsAt: number | null;
	readonly resetDescription: string | null;
}

/** Orca's `ProviderRateLimitStatus`: what the last fetch concluded about this account. */
export type UsageStatus = 'ok' | 'error' | 'unavailable';

/**
 * Orca's `UsageRateLimitFailureKind`, reduced to what we can tell apart. `unavailable` is the
 * honest one: the provider has no usage endpoint at all, so no retry will ever help.
 */
export type UsageFailureKind = 'missing-credentials' | 'stale-token' | 'network' | 'server' | 'parse' | 'rate-limited' | 'usage-unavailable' | 'not-onboarded' | 'unknown';

export interface IUsageCredits {
	/** Remaining balance in `currency`, or null when the provider only reports consumption. */
	readonly remaining: number | null;
	/** Total granted/purchased, when reported; lets the bar show a percentage. */
	readonly total: number | null;
	readonly used: number | null;
	readonly currency: string;
}

export interface IProviderRateLimits {
	readonly providerId: string;
	readonly fetchedAt: number;
	readonly windows: readonly IRateLimitWindow[];
	readonly error?: string;
	/** Defaults to `ok` when there are windows and no error (legacy shape). */
	readonly status?: UsageStatus;
	readonly failureKind?: UsageFailureKind;
	/** Subscription tier reported by the provider (Codex `plan_type`, Anthropic plan). */
	readonly plan?: string | null;
	/** Prepaid credits (OpenRouter). Independent from the windows. */
	readonly credits?: IUsageCredits | null;
	/** Epoch ms before which no refetch should be attempted (HTTP Retry-After). */
	readonly retryAt?: number | null;
	/**
	 * WHO this subscription belongs to, taken from a claim in the credential itself — never from
	 * the provider id. The same ChatGPT account reaches the roster twice (connected in OpenIDE and
	 * signed into the Codex CLI) and those are one subscription with one set of limits, so showing
	 * two rows counts the same quota twice.
	 *
	 * Absent when the credential carries no identity claim, and that ABSENCE MUST NOT MERGE
	 * anything: a missing claim contradicts nothing, but it proves nothing either.
	 */
	readonly accountKey?: string | null;
}

/** The minimum a roster row has to expose for the identity merge to reason about it. */
export interface IUsageMergeCandidate {
	readonly id: string;
	readonly label: string;
	readonly usage: IProviderRateLimits | undefined;
}

export interface IMergedUsageAccount<T extends IUsageMergeCandidate> {
	readonly account: T;
	/** Labels of the OTHER rows folded into this one, so the merge is visible and not a deletion. */
	readonly alsoFrom: readonly string[];
}

/**
 * Folds rows that are the SAME subscription into one, transcribed from how Orca decides two
 * accounts are the same (its per-provider duplicate-account and auth-identity readers). Orca's
 * rule, and the one that matters here:
 *
 *   - identity comes from a claim in the credential, never from which integration produced it;
 *   - a STRONG identity (an account id) is what merges; nothing else does. Orca will fall back to
 *     an email only when neither side carries an id at all, because a rename leaves the email
 *     stale while the id keeps pointing at the same account;
 *   - a row with no identity claim stays on its own. It might be the same account, and "might" is
 *     not enough to hide a subscription the user can see limits for.
 *
 * Which row survives: the one that actually has usage data, and on a tie the one connected inside
 * OpenIDE rather than the one read off a CLI's credential file — that is the account the chat
 * itself will spend, so it is the one whose name should be on the row.
 */
export function mergeUsageAccountsByIdentity<T extends IUsageMergeCandidate>(
	accounts: readonly T[],
	isCliAccount: (id: string) => boolean,
): IMergedUsageAccount<T>[] {
	const merged: IMergedUsageAccount<T>[] = [];
	const byIdentity = new Map<string, number>();
	for (const account of accounts) {
		const key = String(account.usage?.accountKey ?? '').trim();
		if (!key) {
			merged.push({ account, alsoFrom: [] });
			continue;
		}
		const existing = byIdentity.get(key);
		if (existing === undefined) {
			byIdentity.set(key, merged.length);
			merged.push({ account, alsoFrom: [] });
			continue;
		}
		const winner = merged[existing];
		const keep = preferredUsageAccount(winner.account, account, isCliAccount);
		const folded = keep === winner.account ? account : winner.account;
		merged[existing] = {
			account: keep,
			alsoFrom: [...winner.alsoFrom, folded.label].filter((label, index, all) => label && all.indexOf(label) === index),
		};
	}
	return merged;
}

function preferredUsageAccount<T extends IUsageMergeCandidate>(a: T, b: T, isCliAccount: (id: string) => boolean): T {
	const aHasData = usageStatusOf(a.usage) === 'ok';
	const bHasData = usageStatusOf(b.usage) === 'ok';
	if (aHasData !== bHasData) {
		return aHasData ? a : b;
	}
	const aIsCli = isCliAccount(a.id);
	const bIsCli = isCliAccount(b.id);
	if (aIsCli !== bIsCli) {
		return aIsCli ? b : a;
	}
	return a;
}

/** Resolves the legacy shape (windows + optional error) into an explicit status. */
export function usageStatusOf(usage: IProviderRateLimits | undefined): UsageStatus {
	if (!usage) { return 'unavailable'; }
	if (usage.status) { return usage.status; }
	if (usage.error) { return 'error'; }
	return usage.windows.length || usage.credits ? 'ok' : 'unavailable';
}

/** Banda de color del UsageBar (green <60, amber <80, red ≥80). */
export function usageBand(usedPercent: number | null | undefined): UsageBand {
	if (usedPercent == null || !Number.isFinite(usedPercent)) {
		return 'green';
	}
	if (usedPercent >= 80) {
		return 'red';
	}
	if (usedPercent >= 60) {
		return 'amber';
	}
	return 'green';
}

/** Countdown legible tipo "Resets in 3h 54m" a partir de un epoch ms. */
export function formatResetCountdown(resetsAt: number | null | undefined, now = Date.now()): string | null {
	if (resetsAt == null || !Number.isFinite(resetsAt)) {
		return null;
	}
	const ms = Math.max(0, resetsAt - now);
	if (ms <= 0) {
		return 'Resets soon';
	}
	const totalMin = Math.floor(ms / 60_000);
	const days = Math.floor(totalMin / (60 * 24));
	const hours = Math.floor((totalMin % (60 * 24)) / 60);
	const mins = totalMin % 60;
	if (days > 0) {
		return hours > 0 ? `Resets in ${days}d ${hours}h` : `Resets in ${days}d`;
	}
	if (hours > 0) {
		return mins > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${hours}h`;
	}
	if (mins > 0) {
		return `Resets in ${mins}m`;
	}
	return 'Resets in <1m';
}

function asFiniteNumber(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) {
		return v;
	}
	if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
		return Number(v);
	}
	return null;
}

function clampPercent(v: number | null): number | null {
	if (v == null) {
		return null;
	}
	return Math.max(0, Math.min(100, v));
}

/** Interpreta un timestamp (segundos o ms) a epoch ms. */
function toEpochMs(v: unknown): number | null {
	if (typeof v === 'string' && v.trim() && !Number.isFinite(Number(v))) {
		const parsed = Date.parse(v);
		return Number.isFinite(parsed) ? parsed : null;
	}
	const n = asFiniteNumber(v);
	if (n == null || n <= 0) {
		return null;
	}
	// segundos Unix (~1e9–1e10) → ms
	return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function windowFromUnknown(label: string, raw: unknown, fallbackLimitMinutes: number | null): IRateLimitWindow | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const o = raw as Record<string, unknown>;
	// Anthropic / Orca shapes: used/utilized percent bajo varios nombres.
	const usedPercent = clampPercent(
		asFiniteNumber(o.usedPercent)
		?? asFiniteNumber(o.used_percent)
		?? asFiniteNumber(o.utilization)
		?? asFiniteNumber(o.percent_used)
	);
	// Absolute: resetsAt / resets_at / reset_at. NEVER resets_in (that one is relative, in seconds).
	const resetsAt = toEpochMs(o.resetsAt ?? o.resets_at ?? o.reset_at ?? o.resetAt);
	let absoluteReset = resetsAt;
	if (absoluteReset == null) {
		const rel = asFiniteNumber(
			o.resets_in_seconds
			?? o.reset_in_seconds
			?? o.seconds_until_reset
			?? o.resets_in // relativo (segundos), no timestamp
			?? o.reset_in
		);
		if (rel != null && rel >= 0) {
			absoluteReset = Date.now() + Math.round(rel * 1000);
		}
	}
	const limitSeconds = asFiniteNumber(o.limit_window_seconds ?? o.window_seconds);
	const limitMinutes = asFiniteNumber(o.limitMinutes ?? o.limit_minutes ?? o.window_minutes)
		?? (limitSeconds != null && limitSeconds > 0 ? Math.ceil(limitSeconds / 60) : null)
		?? fallbackLimitMinutes;
	const resetDescription = typeof o.resetDescription === 'string' ? o.resetDescription
		: typeof o.reset_description === 'string' ? o.reset_description
			: null;
	// With neither a percentage nor a reset, the window contributes nothing useful.
	if (usedPercent == null && absoluteReset == null && !resetDescription) {
		return null;
	}
	return {
		label,
		usedPercent,
		limitMinutes,
		resetsAt: absoluteReset,
		resetDescription,
	};
}

/**
 * Normalizes the JSON from Anthropic's `GET /api/oauth/usage` (and Orca-compatible variants)
 * a ventanas de rate-limit legibles. Tolera shapes parciales / renombrados.
 */
export function normalizeAnthropicUsageJson(raw: unknown, providerId = 'anthropic'): IProviderRateLimits {
	const fetchedAt = Date.now();
	if (!raw || typeof raw !== 'object') {
		return { providerId, fetchedAt, windows: [], error: 'Respuesta de usage vacía o inválida.' };
	}
	const root = raw as Record<string, unknown>;
	// Algunos proxies envuelven en { data: {...} } o { usage: {...} }.
	const body = (root.data && typeof root.data === 'object' ? root.data
		: root.usage && typeof root.usage === 'object' ? root.usage
			: root) as Record<string, unknown>;

	const windows: IRateLimitWindow[] = [];
	const fiveHour = windowFromUnknown(
		'Session',
		body.five_hour ?? body.fiveHour ?? body.session ?? body.rate_limit_5h ?? body['5h'],
		300,
	);
	if (fiveHour) {
		windows.push(fiveHour);
	}
	const sevenDay = windowFromUnknown(
		'Weekly',
		body.seven_day ?? body.sevenDay ?? body.weekly ?? body.rate_limit_7d ?? body['7d'],
		10_080,
	);
	if (sevenDay) {
		windows.push(sevenDay);
	}
	const sevenDaySonnet = windowFromUnknown(
		'Weekly (Sonnet)',
		body.seven_day_sonnet ?? body.sevenDaySonnet ?? body.weekly_sonnet,
		10_080,
	);
	if (sevenDaySonnet) {
		windows.push(sevenDaySonnet);
	}
	// Fallback: a single flat object with usedPercent at the root.
	if (!windows.length) {
		const flat = windowFromUnknown('Usage', body, null);
		if (flat) {
			windows.push(flat);
		}
	}
	return { providerId, fetchedAt, windows };
}

/** Normaliza `GET /backend-api/wham/usage` de ChatGPT/Codex. */
export function normalizeCodexUsageJson(raw: unknown, providerId = 'openai-codex'): IProviderRateLimits {
	const fetchedAt = Date.now();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { providerId, fetchedAt, windows: [], error: 'Respuesta de usage vacía o inválida.' };
	}
	const root = raw as Record<string, unknown>;
	const rateLimit = root.rate_limit && typeof root.rate_limit === 'object' && !Array.isArray(root.rate_limit)
		? root.rate_limit as Record<string, unknown>
		: {};
	const candidates = [rateLimit.primary_window, rateLimit.secondary_window]
		.map(candidate => windowFromUnknown('Usage', candidate, null))
		.filter((window): window is IRateLimitWindow => window !== null)
		.sort((a, b) => (a.limitMinutes ?? Number.MAX_SAFE_INTEGER) - (b.limitMinutes ?? Number.MAX_SAFE_INTEGER));
	const windows = candidates.map((window, index) => ({
		...window,
		label: (window.limitMinutes ?? 0) >= 7 * 24 * 60 ? 'Weekly' : index === 0 ? 'Session' : 'Usage',
	}));
	const plan = typeof root.plan_type === 'string' && root.plan_type.trim() ? root.plan_type.trim() : null;
	return { providerId, fetchedAt, windows, plan, status: windows.length ? 'ok' : 'unavailable', error: windows.length ? undefined : 'ChatGPT no reportó ventanas de cuota para esta cuenta.' };
}

/** Bucket names of Google Code Assist quota, humanized like Orca's `gemini-bucket-formatting`. */
const GEMINI_BUCKET_NAMES: Record<string, string> = {
	'gemini-2.5-pro': 'Gemini 2.5 Pro',
	'gemini-2.5-flash': 'Gemini 2.5 Flash',
	'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
	'gemini-3-pro-preview': 'Gemini 3 Pro',
	'gemini-3-flash-preview': 'Gemini 3 Flash',
};

function humanizeGeminiModelId(modelId: string): string {
	return GEMINI_BUCKET_NAMES[modelId] ?? modelId
		.replace(/-preview$/, '')
		.split('-')
		.map(part => /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

/**
 * Normalizes `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` (Antigravity /
 * Gemini CLI accounts). One bucket per model with `remainingFraction` and `resetTime`; buckets
 * that share the same fraction and reset are the same pool under two model ids, so they are
 * folded into one window (Orca's `deduplicateBuckets`). The windows are hourly.
 */
export function normalizeGeminiQuotaJson(raw: unknown, providerId = 'antigravity-oauth'): IProviderRateLimits {
	const fetchedAt = Date.now();
	const root = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
	const rawBuckets: unknown[] = Array.isArray(raw) ? raw : Array.isArray(root?.buckets) ? root!.buckets as unknown[] : [];
	const seen = new Map<string, { window: IRateLimitWindow; models: string[] }>();
	for (const candidate of rawBuckets) {
		const bucket = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : undefined;
		const fraction = asFiniteNumber(bucket?.remainingFraction);
		const modelId = typeof bucket?.modelId === 'string' ? bucket.modelId : '';
		if (fraction == null || !modelId) { continue; }
		const usedPercent = Math.max(0, Math.min(100, Math.round((1 - fraction) * 100)));
		const resetsAt = toEpochMs(bucket?.resetTime);
		const key = `${usedPercent}-${resetsAt ?? 'null'}`;
		const existing = seen.get(key);
		if (existing) {
			existing.models.push(humanizeGeminiModelId(modelId));
			continue;
		}
		seen.set(key, { window: { label: humanizeGeminiModelId(modelId), usedPercent, limitMinutes: 60, resetsAt, resetDescription: null }, models: [humanizeGeminiModelId(modelId)] });
	}
	const windows = [...seen.values()].map(({ window, models }) => ({ ...window, label: models.slice(0, 2).join(' · ') + (models.length > 2 ? ` +${models.length - 2}` : '') }));
	if (!windows.length) {
		return { providerId, fetchedAt, windows: [], status: 'unavailable', failureKind: 'usage-unavailable', error: 'Google no devolvió cuotas para esta cuenta.' };
	}
	return { providerId, fetchedAt, windows, status: 'ok' };
}

/**
 * Normalizes `GET https://openrouter.ai/api/v1/credits`: `{ data: { total_credits, total_usage } }`
 * in USD. No time windows — the balance is the whole story, so it becomes a credits block plus
 * one synthetic credits window so the status bar can show a percentage.
 */
export function normalizeOpenRouterCreditsJson(raw: unknown, providerId = 'openrouter'): IProviderRateLimits {
	const fetchedAt = Date.now();
	const root = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
	const data = root?.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
	const total = asFiniteNumber(data?.total_credits);
	const used = asFiniteNumber(data?.total_usage);
	if (total == null && used == null) {
		return { providerId, fetchedAt, windows: [], status: 'unavailable', failureKind: 'parse', error: 'OpenRouter no reportó créditos para esta clave.' };
	}
	const remaining = total != null && used != null ? Math.max(0, total - used) : null;
	const credits: IUsageCredits = { remaining, total, used, currency: 'USD' };
	const windows: IRateLimitWindow[] = total != null && total > 0 && used != null
		? [{ label: 'Créditos', usedPercent: Math.max(0, Math.min(100, used / total * 100)), limitMinutes: null, resetsAt: null, resetDescription: null }]
		: [];
	return { providerId, fetchedAt, windows, credits, status: 'ok' };
}

/** Normalizes the Grok CLI billing endpoint (weekly credits or monthly plan). */
export function normalizeGrokUsageJson(raw: unknown, providerId = 'xai-oauth'): IProviderRateLimits {
	const fetchedAt = Date.now();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { providerId, fetchedAt, windows: [], error: 'Respuesta de usage vacía o inválida.' };
	}
	const root = raw as Record<string, unknown>;
	const body = root.config && typeof root.config === 'object' && !Array.isArray(root.config)
		? root.config as Record<string, unknown>
		: root;
	const currentPeriod = body.currentPeriod && typeof body.currentPeriod === 'object' && !Array.isArray(body.currentPeriod)
		? body.currentPeriod as Record<string, unknown>
		: {};
	const periodEnd = currentPeriod.end ?? body.billingPeriodEnd;
	const confirmedWeeklyZero = currentPeriod.type === 'USAGE_PERIOD_TYPE_WEEKLY'
		&& typeof currentPeriod.start === 'string'
		&& typeof body.billingPeriodStart === 'string'
		&& Date.parse(currentPeriod.start) === Date.parse(body.billingPeriodStart)
		&& typeof currentPeriod.end === 'string'
		&& typeof body.billingPeriodEnd === 'string'
		&& Date.parse(currentPeriod.end) === Date.parse(body.billingPeriodEnd);
	const weekly = windowFromUnknown('Weekly', {
		usedPercent: body.creditUsagePercent ?? (confirmedWeeklyZero ? 0 : undefined),
		reset_at: periodEnd,
		window_minutes: 10_080,
	}, 10_080);
	if (weekly) {
		return { providerId, fetchedAt, windows: [weekly] };
	}
	const limit = asFiniteNumber((body.monthlyLimit as { val?: unknown } | undefined)?.val);
	const used = asFiniteNumber((body.used as { val?: unknown } | undefined)?.val);
	const monthly = limit != null && used != null && limit > 0
		? windowFromUnknown('Monthly', { usedPercent: used / limit * 100, reset_at: periodEnd, window_minutes: 43_200 }, 43_200)
		: null;
	return monthly
		? { providerId, fetchedAt, windows: [monthly] }
		: { providerId, fetchedAt, windows: [], error: 'El plan de Grok no reportó una cuota visible.' };
}

/** True when this provider can query Anthropic OAuth usage. */
export function providerSupportsAnthropicUsage(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean {
	if (!entry || entry.auth !== 'oauth' || entry.protocol !== 'anthropic') {
		return false;
	}
	const base = (entry.baseUrl ?? '').toLowerCase();
	// MiniMax and other Anthropic-compatible providers do NOT use Anthropic's endpoint.
	if (!base || base.includes('api.anthropic.com') || base.includes('claude.com')) {
		return true;
	}
	return entry.id === 'anthropic' || entry.id === 'anthropic-oauth' || entry.id === 'claude';
}

export function providerSupportsOAuthUsage(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean {
	return providerSupportsAnthropicUsage(entry) || entry?.id === 'openai-codex' || entry?.id === 'xai-oauth' || entry?.id === 'antigravity-oauth';
}

/** Every provider with SOME usage endpoint, OAuth or API key (OpenRouter credits). */
export function providerSupportsUsage(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean {
	return providerSupportsOAuthUsage(entry) || entry?.id === 'openrouter';
}

/**
 * Why an account shows no usage. Only providers that are connected reach this; the answer is the
 * honest reason (no endpoint, plan without quota) so the popover never says a generic "unavailable".
 */
export function usageUnavailableReason(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string; label?: string } | undefined): string {
	if (!entry) { return 'Proveedor desconocido.'; }
	if (entry.auth === 'none') { return 'Es un endpoint local: no tiene cuotas.'; }
	if (entry.id === 'copilot') { return 'GitHub Copilot no expone el consumo del plan por API.'; }
	if (entry.id === 'minimax-oauth') { return 'MiniMax no publica un endpoint de cuota para la suscripción.'; }
	if (entry.id === 'zhipu-coding') { return 'El Coding Plan de Z.ai no expone el consumo por API.'; }
	if (entry.auth === 'apiKey') { return 'Este proveedor factura por token y no publica saldo por API.'; }
	return 'Este proveedor no expone datos de uso.';
}
