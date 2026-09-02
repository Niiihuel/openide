/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — pure scheduling and formatting for account usage, transcribed from Orca's
 *  rate-limit service in its main process. Orca centralizes polling,
 *  stale-data handling and the failure backoff in one main-process service; the constants and
 *  the decisions are reproduced here as pure functions so the browser monitor stays small and
 *  every rule is unit-testable without timers.
 *--------------------------------------------------------------------------------------------*/

import { IProviderRateLimits, IRateLimitWindow, usageStatusOf } from './openideUsage.js';

/** Orca `DEFAULT_POLL_MS`: the background cadence when nothing is looking at the numbers. */
export const USAGE_DEFAULT_POLL_MS = 15 * 60 * 1000;
/** Orca `MIN_POLL_MS`: renderer input must never create a tight loop. */
export const USAGE_MIN_POLL_MS = 30 * 1000;
/** While the popover is open the numbers are live: one cycle per minute, like Orca's "visible" lane. */
export const USAGE_VISIBLE_POLL_MS = 60 * 1000;
/** Orca `MIN_REFETCH_MS`: focus/resume bursts are debounced to one fetch per five minutes. */
export const USAGE_MIN_REFETCH_MS = 5 * 60 * 1000;
/** Orca `ACTIVE_FAILURE_REFETCH_MS` / `MAX_ACTIVE_FAILURE_REFETCH_MS`: the failure lane. */
export const USAGE_FAILURE_BASE_MS = USAGE_MIN_POLL_MS;
export const USAGE_FAILURE_MAX_MS = USAGE_DEFAULT_POLL_MS;
/** Orca `STALE_THRESHOLD_MS`: after this a snapshot is shown greyed out, then dropped. */
export const USAGE_STALE_MS = 30 * 60 * 1000;
/** Orca `RATE_LIMITED_STALE_THRESHOLD_MS`: a 429 with Retry-After ~1h must not blank the bar. */
export const USAGE_RATE_LIMITED_STALE_MS = 24 * 60 * 60 * 1000;
/** A turn just ended: the provider counted it, so the windows moved. Short grace for the backend. */
export const USAGE_AFTER_TURN_DELAY_MS = 2_500;

/**
 * Orca: `ACTIVE_FAILURE_REFETCH_MS * 2 ** (streak - 1)`, capped at the default poll. The first
 * failure retries in 30 s, the second in 1 min, … until it settles at the 15 min cadence.
 */
export function usageFailureDelayMs(failureStreak: number): number {
	if (failureStreak <= 0) {
		return 0;
	}
	return Math.min(USAGE_FAILURE_MAX_MS, USAGE_FAILURE_BASE_MS * 2 ** Math.max(0, failureStreak - 1));
}

/** Orca clamps the poll interval the user configures between MIN and the sane maximum. */
export function clampUsagePollMs(ms: number): number {
	if (!Number.isFinite(ms) || ms <= 0) {
		return USAGE_DEFAULT_POLL_MS;
	}
	return Math.max(USAGE_MIN_POLL_MS, ms);
}

export type UsageStaleness = 'fresh' | 'stale' | 'expired';

/**
 * Orca drops data older than 30 min, except after a rate-limited answer, where an old snapshot
 * beats a bare "Limited" for a full day. `stale` = still shown, dimmed; `expired` = not shown.
 */
export function usageStaleness(usage: IProviderRateLimits | undefined, now = Date.now()): UsageStaleness {
	if (!usage) {
		return 'expired';
	}
	const age = now - usage.fetchedAt;
	const limit = usage.failureKind === 'rate-limited' ? USAGE_RATE_LIMITED_STALE_MS : USAGE_STALE_MS;
	if (age > limit) {
		return 'expired';
	}
	// Half the window: the snapshot is old enough to say so, not old enough to hide it.
	return age > limit / 2 ? 'stale' : 'fresh';
}

/**
 * Whether a refresh is due now. `visible` is the popover/status lane (Orca's fetch-on-open),
 * `force` is the user's click — Orca lets that one bypass the poll throttle on purpose, "else the
 * click can no-op after wake/focus and feel broken".
 */
export function isUsageRefreshDue(options: {
	readonly lastFetchAt: number;
	readonly failureStreak: number;
	readonly retryAt?: number | null;
	readonly pollMs: number;
	readonly visible: boolean;
	readonly force?: boolean;
	readonly now?: number;
}): boolean {
	const now = options.now ?? Date.now();
	if (options.force) {
		return options.retryAt == null || now >= options.retryAt;
	}
	if (options.retryAt != null && now < options.retryAt) {
		return false;
	}
	if (options.failureStreak > 0) {
		return now - options.lastFetchAt >= usageFailureDelayMs(options.failureStreak);
	}
	const cadence = options.visible ? Math.min(options.pollMs, USAGE_VISIBLE_POLL_MS) : options.pollMs;
	return now - options.lastFetchAt >= cadence;
}

/** Orca `clampUsedPercent`: one rounding shared by the bar and the label, never NaN. */
export function clampUsedPercent(usedPercent: number | null | undefined): number | undefined {
	if (usedPercent == null || !Number.isFinite(usedPercent)) {
		return undefined;
	}
	return Math.max(0, Math.min(100, Math.round(usedPercent)));
}

/** The window closest to its limit: what the status bar and the compact row summarize. */
export function tightestUsageWindow(usage: IProviderRateLimits | undefined): IRateLimitWindow | undefined {
	if (!usage || usageStatusOf(usage) !== 'ok') {
		return undefined;
	}
	return usage.windows.reduce<IRateLimitWindow | undefined>((current, candidate) => {
		if (!current) { return candidate; }
		return (clampUsedPercent(candidate.usedPercent) ?? -1) > (clampUsedPercent(current.usedPercent) ?? -1) ? candidate : current;
	}, undefined);
}

/** "5 h" / "Semanal" / "Mensual" / "1 h": the window's own label when it is not a known size. */
export function usageWindowTitle(window: IRateLimitWindow): string {
	switch (window.limitMinutes) {
		case 60: return window.label && window.label !== 'Usage' ? window.label : '1 h';
		case 300: return '5 h';
		case 10_080: return window.label.toLowerCase().includes('sonnet') ? 'Semanal · Sonnet' : 'Semanal';
		case 43_200: return 'Mensual';
		default:
			return window.label === 'Session' ? 'Sesión' : window.label === 'Weekly' ? 'Semanal' : window.label === 'Usage' ? 'Uso' : window.label;
	}
}

/** "se reinicia en 3 h 54 min" — Spanish, and `null` when the reset is unknown. */
export function formatUsageReset(resetsAt: number | null | undefined, now = Date.now()): string | null {
	if (resetsAt == null || !Number.isFinite(resetsAt)) {
		return null;
	}
	const ms = resetsAt - now;
	if (ms <= 0) {
		return 'se reinicia en breve';
	}
	return `se reinicia en ${formatUsageDuration(ms)}`;
}

/** "27d 1h", "3 h 54 min", "12 min", "<1 min". Compact enough for the status bar. */
export function formatUsageDuration(ms: number): string {
	const totalMin = Math.floor(Math.max(0, ms) / 60_000);
	const days = Math.floor(totalMin / (60 * 24));
	const hours = Math.floor((totalMin % (60 * 24)) / 60);
	const mins = totalMin % 60;
	if (days > 0) {
		return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
	}
	if (hours > 0) {
		return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
	}
	if (mins > 0) {
		return `${mins} min`;
	}
	return '<1 min';
}

/** "actualizado hace 12 s" / "hace 3 min" / "hace 2 h". */
export function formatUsageUpdatedAgo(fetchedAt: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - fetchedAt) / 1000));
	if (seconds < 60) {
		return `hace ${seconds} s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `hace ${minutes} min`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `hace ${hours} h`;
	}
	return `hace ${Math.floor(hours / 24)} d`;
}

/** "$12.40" style balance for credits; provider currencies are all USD today. */
export function formatUsageCredits(amount: number, currency = 'USD'): string {
	const value = amount >= 100 ? amount.toFixed(0) : amount.toFixed(2);
	return currency === 'USD' ? `$${value}` : `${value} ${currency}`;
}
