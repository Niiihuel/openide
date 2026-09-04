/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — clasificador de errores de provider (clasificador compacto de errores de
 *  providers). Maps the error message to a CLASS that decides the recovery action:
 *  transient → retry with backoff; rate-limit → retry honoring Retry-After when parseable;
 *  auth/billing → no retry (and candidates for failover to another provider); fatal → report.
 *--------------------------------------------------------------------------------------------*/

// Type-only in the other direction, so the pair does not form a runtime cycle.
import { describeCooldown } from './openideModelHealth.js';
import { t } from './openideStrings.js';

export type ProviderErrorKind = 'transient' | 'rate-limit' | 'auth' | 'billing' | 'fatal';
export type ProviderErrorReason =
	| 'authentication'
	| 'billing'
	| 'rate-limit'
	| 'overloaded'
	| 'model-not-found'
	| 'model-retired'
	| 'project-not-found'
	| 'provider-unavailable'
	| 'context-overflow'
	| 'multimodal-unsupported'
	| 'tool-calling-unsupported'
	| 'format'
	| 'network'
	| 'connection-refused'
	/** The account has to accept or confirm something at the provider; the credential is fine. */
	| 'account-policy'
	| 'fatal';

export interface IProviderErrorContext {
	readonly status?: number;
	readonly providerId?: string;
	readonly model?: string;
	readonly endpoint?: string;
	readonly stage?: 'loadCodeAssist' | 'onboardUser' | 'streamGenerateContent' | 'models' | string;
	readonly body?: string;
}

export interface IClassifiedProviderError {
	readonly kind: ProviderErrorKind;
	readonly reason: ProviderErrorReason;
	readonly shouldCompact?: boolean;
	readonly shouldDropImages?: boolean;
	readonly shouldDropTools?: boolean;
	/** Wait suggested by the provider itself ("retry in 20s", "resets in 4hr 5min"). */
	readonly retryAfterMs?: number;
	/** Actionable hint for the user (appended to the error message). */
	readonly hint?: string;
	/**
	 * The 429 is the provider's shared pool for a free variant, not this account's own quota.
	 *
	 * Structured rather than left implicit in `hint`, because the difference decides an ACTION: a
	 * spent account can be answered by continuing on another one, while a saturated pool is the same
	 * everywhere and only waiting fixes it. Reading that back out of a rendered, translated sentence
	 * would be guessing.
	 */
	readonly sharedPool?: boolean;
}

/** Defensive cap: never wait more than 2 minutes inside an interactive run. */
const MAX_RETRY_AFTER_MS = 120_000;

/**
 * Wait the provider itself asks for, in two shapes and in this order of trust:
 *
 *  1. STRUCTURED — the fields a JSON error body carries: `"retry_after_seconds":5`,
 *     `"retry_after_ms":1500`, `"Retry-After":"5"`. OpenRouter sends all three at once and its
 *     prose never names a number ("Please retry shortly"), so a text-only parser threw the
 *     provider's own answer away and left the caller with an exponential backoff SHORTER than the
 *     wait that was asked for — three attempts burned inside the 5s window, then the raw 429.
 *  2. PROSE — "try again in 20s", "retry after 2 minutes", "resets in 1hr".
 */
function parseRetryAfterMs(lower: string): number | undefined {
	const structured = lower.match(/["']?retry[-_ ]?after(?:[-_ ]?(seconds|secs?|ms|millis(?:econds)?))?["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/);
	if (structured) {
		const unit = structured[1] ?? '';
		const value = parseFloat(structured[2]);
		return Math.min(unit.startsWith('m') ? value : value * 1000, MAX_RETRY_AFTER_MS);
	}
	const m = lower.match(/(?:retry|try again|resets?)[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(ms|s|sec|second|m|min|minute|h|hr|hour)/);
	if (!m) {
		return undefined;
	}
	const value = parseFloat(m[1]);
	const unit = m[2];
	const ms = unit === 'ms' ? value
		: unit.startsWith('h') ? value * 3_600_000
			: unit.startsWith('m') && unit !== 'ms' ? value * 60_000
				: value * 1000;
	return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/**
 * What the user can actually DO about a 429, in one sentence.
 *
 * The distinction that matters is whose limit was hit: a shared free pool ("is_byok":false +
 * "upstream_provider_shared_pool") saturates because of OTHER people's traffic, so "slow down" is
 * useless advice — the way out is a private lane or another model. Upstream draws the same line
 * (`model_overloaded` vs `user_model_rate_limited` in `chat/common/chatErrorMessages.ts`) and names
 * the wait in both, falling back to "a moment" when the provider did not say.
 */
function rateLimitHint(lower: string, retryAfterMs: number | undefined): string {
	const wait = retryAfterMs ? describeCooldown(retryAfterMs, 0) : t('error.rateLimit.aMoment');
	return isSharedPoolLimit(lower) ? t('error.rateLimit.sharedPool', wait) : t('error.rateLimit.generic', wait);
}

/**
 * A 429 that belongs to the provider's free-variant pool rather than to the caller.
 *
 * One predicate, used by both the sentence and the flag, so the two can never disagree about the
 * same error — which they would the moment someone edited one of two copies of this regex.
 */
export function isSharedPoolLimit(lower: string): boolean {
	return /shared_pool|shared pool|rate-limited upstream|upstream_429/.test(lower)
		|| (/is_byok["']?\s*[:=]\s*false/.test(lower) && /:free\b/.test(lower));
}

/**
 * The line the user reads. A provider that fails with JSON hands us a wall of metadata whose only
 * human sentence is buried inside it (OpenRouter puts it in `error.metadata.raw`, and leaves a
 * useless "Provider returned error" in `error.message`), so the chat used to print the whole blob.
 * Keeps the `HTTP <status>` prefix — that is what a bug report needs — and returns the message
 * untouched when there is no JSON envelope to unwrap.
 */
export function humanizeProviderError(message: string): string {
	const start = message.indexOf('{');
	if (start < 0) {
		return message;
	}
	let json: any;
	try { json = JSON.parse(message.slice(start)); } catch { return message; }
	const err = json?.error ?? json;
	const human = [err?.metadata?.raw, err?.message, json?.message, err?.detail]
		.find(v => typeof v === 'string' && v.trim());
	if (!human) {
		return message;
	}
	const prefix = message.slice(0, start).trim().replace(/[:\s]+$/, '');
	return prefix ? `${prefix}: ${human}` : human;
}

export function classifyProviderError(message: string, context?: IProviderErrorContext): IClassifiedProviderError {
	const m = `${message}\n${context?.body ?? ''}`.toLowerCase();
	const status = context?.status ?? Number(/http\s+(\d{3})\b/.exec(m)?.[1] ?? 0);
	const notFound = status === 404 || /\bnot_found\b|requested entity was not found|model not found|unknown model|no such model/.test(m);
	if (notFound) {
		if (context?.stage === 'loadCodeAssist' || context?.stage === 'onboardUser' || /(?:project|cloudaicompanionproject|duetproject).{0,40}(?:not found|does not exist|unknown)/.test(m)) {
			return { kind: 'fatal', reason: 'project-not-found', hint: t('error.projectNotFound') };
		}
		if (context?.stage === 'streamGenerateContent' || /(?:model|model=)[^\n]{0,80}(?:not found|unknown|retired|requested entity)|(?:not found|unknown|retired)[^\n]{0,80}\bmodel\b/.test(m)) {
			const retired = /retired|deprecated|discontinued|no longer available|decommissioned/.test(m);
			return { kind: 'fatal', reason: retired ? 'model-retired' : 'model-not-found', hint: context?.model ? t('error.modelNotFoundNamed', context.model) : t('error.modelNotFound') };
		}
		if (/provider|endpoint|service/.test(m)) {
			return { kind: 'fatal', reason: 'provider-unavailable', hint: t('error.endpointGone') };
		}
		if (context?.providerId) {
			return { kind: 'fatal', reason: 'provider-unavailable', hint: t('error.provider404', context.providerId) };
		}
	}

	// gemini code assist: tier gratis discontinuado por Google (18/jun/2026) → la cuenta no
	// is "eligible". This is NOT a credential problem (OAuth login works); the fix is another provider.
	if (/free_tier_user_not_eligible|not eligible for gemini code assist|gemini code assist for individuals/.test(m)) {
		return { kind: 'billing', reason: 'billing', hint: t('error.geminiCodeAssist') };
	}
	// NVIDIA NIM: a 403 after generating nvapi- usually means the model terms were not accepted on build.nvidia.com
	if (/integrate\.api\.nvidia|nvidia\.com\/v1/.test(m) && /http 403|authorization failed|forbidden/.test(m)) {
		return { kind: 'auth', reason: 'authentication', hint: t('error.nvidiaTerms') };
	}
	if (/context.{0,20}(length|window).{0,30}(exceed|too (?:large|long)|maximum|max)|maximum context|prompt.{0,20}too long|request too large|too many input tokens|token limit exceeded/.test(m)) {
		return { kind: 'fatal', reason: 'context-overflow', shouldCompact: true, hint: t('error.contextOverflow') };
	}
	if (/(?:model|endpoint).{0,40}(?:does not|doesn't|not).{0,20}support.{0,20}(?:image|vision|multimodal)|(?:image|vision|multimodal).{0,30}(?:not supported|unsupported)/.test(m)) {
		return { kind: 'fatal', reason: 'multimodal-unsupported', shouldDropImages: true, hint: t('error.multimodal') };
	}
	if (/(?:does not|doesn't|do not|not) support.{0,40}(?:tool|function)[ _-]?(?:call|calling)?|(?:tool|function)[ _-]?(?:call|calling)?.{0,40}(?:not supported|unsupported|unavailable)|unsupported (?:parameter|field).{0,20}["'`]?tools?["'`]?/.test(m)) {
		return { kind: 'fatal', reason: 'tool-calling-unsupported', shouldDropTools: true, hint: t('error.toolCalling') };
	}
	// Gemini 3 / Antigravity: missing thoughtSignature when resending the history with tools.
	if (/thought_signature|thoughtsignature|missing a thought/.test(m)) {
		return { kind: 'fatal', reason: 'format', hint: t('error.thoughtSignature') };
	}
	// Money, whatever the status code says. OpenCode Zen answers a model the workspace cannot pay
	// for with `401 CreditsError: No payment method` — a perfectly valid key and an unpaid account.
	// Read as auth (the 401 rule below matches first otherwise) it told the user to reconnect a
	// credential that was never the problem, and `kind: 'auth'` additionally refreshed the token
	// and failed over to another provider. The status code is the weakest signal here; the wording
	// is the strong one.
	if (/creditserror|no payment method|add a payment method|payment required|credit balance|insufficient.{0,10}(credit|quota|balance)|out of extra usage|quota exceeded/.test(m)) {
		return { kind: 'billing', reason: 'billing', hint: t('error.billing') };
	}
	// A 403 is very often NOT about the credential: the key is valid and the ACCOUNT is missing a
	// gate the provider requires — OpenRouter's 18+ confirmation, a model whose terms were never
	// accepted, a region or data-policy setting. Calling that "the credential is invalid" sends the
	// user to redo a key that was never the problem, and — worse — `kind: 'auth'` makes the run
	// refresh the token and fail over to another provider behind their back. The provider's own
	// message names the page to open; ours only has to stop contradicting it.
	if (/http 403\b/.test(m) && /before use|complete the following|confirm|verification|verify|accept|agree|terms|not enabled|enable .{0,20}(access|model)|request access|privacy/.test(m)) {
		return { kind: 'fatal', reason: 'account-policy', hint: t('error.accountPolicy') };
	}
	if (/http 40[13]\b|invalid.{0,3}api.{0,3}key|authentication|unauthorized|invalid_grant|refresh_token_reused|token.{0,20}(expired|revoked|invalid)|falta la api key|no iniciaste sesi/.test(m)) {
		return { kind: 'auth', reason: 'authentication', hint: t('error.auth') };
	}
	// billing: quota/invoicing — like auth, we do not retry.
	if (/http 402\b|billing|payment required|credit balance|insufficient.{0,10}(credit|quota|balance)|out of extra usage|quota exceeded/.test(m)) {
		return { kind: 'billing', reason: 'billing', hint: t('error.billing') };
	}
	// Some endpoints encode overload as 429. That is transient, not a signal to rotate
	// credentials or to assume the user's quota is exhausted.
	if (/temporarily overloaded|service.{0,20}overloaded|overload.{0,20}(1305|try again)|code["']?\s*:\s*1305/.test(m)) {
		return { kind: 'transient', reason: 'overloaded', retryAfterMs: parseRetryAfterMs(m) };
	}
	// rate limit: retry using the wait the provider suggests (or backoff).
	if (/http 429\b|rate.?limit|too many requests/.test(m)) {
		const retryAfterMs = parseRetryAfterMs(m);
		return { kind: 'rate-limit', reason: 'rate-limit', retryAfterMs, hint: rateLimitHint(m, retryAfterMs), sharedPool: isSharedPoolLimit(m) };
	}
	// nothing is listening at that URL: typical of a LOCAL provider whose server is down — a retry
	// does not help; the actionable step is to start the server.
	if (/err_connection_refused|econnrefused|connection refused/.test(m)) {
		return { kind: 'fatal', reason: 'connection-refused', hint: t('error.connectionRefused') };
	}
	// transitorios de red/servidor.
	if (/http (408|5\d\d)\b|econn|enotfound|etimedout|eai_again|socket|network|overloaded|cf-mitigated|internal server error|stream stale timeout|stream ended before terminal event|unexpected end of (file|stream)|connection reset/.test(m)) {
		return { kind: 'transient', reason: 'network' };
	}
	return { kind: 'fatal', reason: 'fatal' };
}
