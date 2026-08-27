/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { normalizeCodexUsageJson, normalizeGeminiQuotaJson, normalizeOpenRouterCreditsJson, usageStatusOf } from '../../common/openideUsage.js';
import {
	formatUsageDuration,
	formatUsageReset,
	formatUsageUpdatedAgo,
	isUsageRefreshDue,
	tightestUsageWindow,
	USAGE_DEFAULT_POLL_MS,
	USAGE_MIN_POLL_MS,
	USAGE_STALE_MS,
	USAGE_VISIBLE_POLL_MS,
	usageFailureDelayMs,
	usageStaleness,
	usageWindowTitle,
} from '../../common/openideUsageSchedule.js';

/**
 * The scheduling rules are Orca's (rate-limits/service.ts) reproduced as pure functions; these
 * tests pin the constants and decisions so a "small tweak" cannot silently turn the monitor into
 * a tight loop against a billing endpoint.
 */
suite('OpenIDE usage — scheduling (Orca)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('el backoff por fallas dobla desde 30 s y se clava en el poll por defecto', () => {
		assert.strictEqual(usageFailureDelayMs(0), 0);
		assert.strictEqual(usageFailureDelayMs(1), USAGE_MIN_POLL_MS);
		assert.strictEqual(usageFailureDelayMs(2), USAGE_MIN_POLL_MS * 2);
		assert.strictEqual(usageFailureDelayMs(3), USAGE_MIN_POLL_MS * 4);
		assert.strictEqual(usageFailureDelayMs(20), USAGE_DEFAULT_POLL_MS);
	});

	test('un click manual salta el throttle, pero nunca un Retry-After vigente', () => {
		const now = 1_000_000;
		assert.strictEqual(isUsageRefreshDue({ lastFetchAt: now - 1000, failureStreak: 0, pollMs: USAGE_DEFAULT_POLL_MS, visible: false, force: true, now }), true);
		assert.strictEqual(isUsageRefreshDue({ lastFetchAt: now - 1000, failureStreak: 0, pollMs: USAGE_DEFAULT_POLL_MS, visible: false, force: true, retryAt: now + 5000, now }), false);
		assert.strictEqual(isUsageRefreshDue({ lastFetchAt: now - 1000, failureStreak: 0, pollMs: USAGE_DEFAULT_POLL_MS, visible: false, now }), false);
	});

	test('con el popover abierto la cadencia es la de un minuto, no la de fondo', () => {
		const now = 1_000_000;
		const lastFetchAt = now - USAGE_VISIBLE_POLL_MS - 1;
		assert.strictEqual(isUsageRefreshDue({ lastFetchAt, failureStreak: 0, pollMs: USAGE_DEFAULT_POLL_MS, visible: true, now }), true);
		assert.strictEqual(isUsageRefreshDue({ lastFetchAt, failureStreak: 0, pollMs: USAGE_DEFAULT_POLL_MS, visible: false, now }), false);
	});

	test('una cuenta fallando respeta su carril de backoff', () => {
		const now = 1_000_000;
		assert.strictEqual(isUsageRefreshDue({ lastFetchAt: now - USAGE_MIN_POLL_MS + 1, failureStreak: 1, pollMs: USAGE_DEFAULT_POLL_MS, visible: true, now }), false);
		assert.strictEqual(isUsageRefreshDue({ lastFetchAt: now - USAGE_MIN_POLL_MS, failureStreak: 1, pollMs: USAGE_DEFAULT_POLL_MS, visible: true, now }), true);
	});

	test('staleness: fresco, viejo (se muestra atenuado) y vencido (se oculta); un 429 dura un día', () => {
		const now = 10_000_000_000;
		const base = { providerId: 'x', windows: [], status: 'ok' as const };
		assert.strictEqual(usageStaleness({ ...base, fetchedAt: now - 1000 }, now), 'fresh');
		assert.strictEqual(usageStaleness({ ...base, fetchedAt: now - USAGE_STALE_MS / 2 - 1 }, now), 'stale');
		assert.strictEqual(usageStaleness({ ...base, fetchedAt: now - USAGE_STALE_MS - 1 }, now), 'expired');
		assert.strictEqual(usageStaleness({ ...base, fetchedAt: now - USAGE_STALE_MS - 1, failureKind: 'rate-limited' }, now), 'fresh');
		assert.strictEqual(usageStaleness(undefined, now), 'expired');
	});

	test('la ventana más ajustada es la de mayor porcentaje y solo cuenta con status ok', () => {
		const usage = { providerId: 'x', fetchedAt: 0, windows: [
			{ label: 'Session', usedPercent: 20, limitMinutes: 300, resetsAt: null, resetDescription: null },
			{ label: 'Weekly', usedPercent: 64, limitMinutes: 10_080, resetsAt: null, resetDescription: null },
		] };
		assert.strictEqual(tightestUsageWindow(usage)?.label, 'Weekly');
		assert.strictEqual(tightestUsageWindow({ ...usage, status: 'error', error: 'x' }), undefined);
	});

	test('formatos en español: reset, duración y "hace"', () => {
		const now = 5_000_000_000;
		assert.strictEqual(formatUsageReset(now + 27 * 24 * 3_600_000 + 3_600_000, now), 'se reinicia en 27d 1h');
		assert.strictEqual(formatUsageReset(now + 3 * 3_600_000 + 54 * 60_000, now), 'se reinicia en 3 h 54 min');
		assert.strictEqual(formatUsageReset(now - 1, now), 'se reinicia en breve');
		assert.strictEqual(formatUsageReset(null, now), null);
		assert.strictEqual(formatUsageDuration(30_000), '<1 min');
		assert.strictEqual(formatUsageUpdatedAgo(now - 12_000, now), 'hace 12 s');
		assert.strictEqual(formatUsageUpdatedAgo(now - 3 * 60_000, now), 'hace 3 min');
		assert.strictEqual(formatUsageUpdatedAgo(now - 2 * 3_600_000, now), 'hace 2 h');
	});

	test('títulos de ventana por tamaño', () => {
		const window = (label: string, limitMinutes: number | null) => ({ label, limitMinutes, usedPercent: 0, resetsAt: null, resetDescription: null });
		assert.strictEqual(usageWindowTitle(window('Session', 300)), '5 h');
		assert.strictEqual(usageWindowTitle(window('Weekly', 10_080)), 'Semanal');
		assert.strictEqual(usageWindowTitle(window('Weekly (Sonnet)', 10_080)), 'Semanal · Sonnet');
		assert.strictEqual(usageWindowTitle(window('Gemini 2.5 Pro', 60)), 'Gemini 2.5 Pro');
		assert.strictEqual(usageWindowTitle(window('Créditos', null)), 'Créditos');
	});
});

suite('OpenIDE usage — normalizadores nuevos', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('Codex: conserva plan_type y marca unavailable sin ventanas', () => {
		const usage = normalizeCodexUsageJson({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 28, limit_window_seconds: 604800, reset_at: 1_800_000_000 } } });
		assert.strictEqual(usage.plan, 'plus');
		assert.strictEqual(usage.windows[0].label, 'Weekly');
		assert.strictEqual(usageStatusOf(usage), 'ok');
		assert.strictEqual(usageStatusOf(normalizeCodexUsageJson({ plan_type: 'free' })), 'unavailable');
	});

	test('Gemini: buckets por modelo, deduplicados por cuota y reset, en ventanas de una hora', () => {
		const reset = new Date(1_800_000_000_000).toISOString();
		const usage = normalizeGeminiQuotaJson({ buckets: [
			{ modelId: 'gemini-2.5-pro', remainingFraction: 0.25, resetTime: reset },
			{ modelId: 'gemini-2.5-flash', remainingFraction: 0.25, resetTime: reset },
			{ modelId: 'gemini-3-pro-preview', remainingFraction: 0.9, resetTime: reset },
		] });
		assert.strictEqual(usageStatusOf(usage), 'ok');
		assert.strictEqual(usage.windows.length, 2);
		assert.strictEqual(usage.windows[0].label, 'Gemini 2.5 Pro · Gemini 2.5 Flash');
		assert.strictEqual(usage.windows[0].usedPercent, 75);
		assert.strictEqual(usage.windows[0].limitMinutes, 60);
		assert.strictEqual(usage.windows[0].resetsAt, 1_800_000_000_000);
		assert.strictEqual(usage.windows[1].usedPercent, 10);
		assert.strictEqual(usageStatusOf(normalizeGeminiQuotaJson({})), 'unavailable');
	});

	test('OpenRouter: créditos con saldo y una ventana sintética de porcentaje', () => {
		const usage = normalizeOpenRouterCreditsJson({ data: { total_credits: 50, total_usage: 12.5 } });
		assert.strictEqual(usageStatusOf(usage), 'ok');
		assert.strictEqual(usage.credits?.remaining, 37.5);
		assert.strictEqual(usage.windows[0].label, 'Créditos');
		assert.strictEqual(usage.windows[0].usedPercent, 25);
		assert.strictEqual(usageStatusOf(normalizeOpenRouterCreditsJson({ data: {} })), 'unavailable');
	});
});
