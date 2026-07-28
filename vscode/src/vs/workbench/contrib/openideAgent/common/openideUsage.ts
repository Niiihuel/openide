/*---------------------------------------------------------------------------------------------
 *  OpenIDE — tipos y normalización de usage/rate-limits por provider (OAuth).
 *  Scope inicial: respuesta de `GET https://api.anthropic.com/api/oauth/usage`.
 *--------------------------------------------------------------------------------------------*/

export type UsageBand = 'green' | 'amber' | 'red';

export interface IRateLimitWindow {
	readonly label: string;
	/** 0–100; null si el provider no reporta porcentaje. */
	readonly usedPercent: number | null;
	/** Ventana en minutos (5h=300, 7d=10080) cuando se conoce. */
	readonly limitMinutes: number | null;
	/** Epoch ms del reset, o null si no viene. */
	readonly resetsAt: number | null;
	readonly resetDescription: string | null;
}

export interface IProviderRateLimits {
	readonly providerId: string;
	readonly fetchedAt: number;
	readonly windows: readonly IRateLimitWindow[];
	readonly error?: string;
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
	// Absolutos: resetsAt / resets_at / reset_at. NUNCA resets_in (es relativo en segundos).
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
	const limitMinutes = asFiniteNumber(o.limitMinutes ?? o.limit_minutes ?? o.window_minutes)
		?? fallbackLimitMinutes;
	const resetDescription = typeof o.resetDescription === 'string' ? o.resetDescription
		: typeof o.reset_description === 'string' ? o.reset_description
			: null;
	// Si no hay ni % ni reset, la ventana no aporta nada útil.
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
 * Normaliza el JSON de `GET /api/oauth/usage` de Anthropic (y variantes Orca-compat)
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
	// Fallback: un único objeto plano con usedPercent a nivel raíz.
	if (!windows.length) {
		const flat = windowFromUnknown('Usage', body, null);
		if (flat) {
			windows.push(flat);
		}
	}
	return { providerId, fetchedAt, windows };
}

/** True si este provider puede consultar usage OAuth de Anthropic. */
export function providerSupportsAnthropicUsage(entry: { protocol?: string; auth?: string; baseUrl?: string; id?: string } | undefined): boolean {
	if (!entry || entry.auth !== 'oauth' || entry.protocol !== 'anthropic') {
		return false;
	}
	const base = (entry.baseUrl ?? '').toLowerCase();
	// MiniMax y otros Anthropic-compat NO usan el endpoint de Anthropic.
	if (!base || base.includes('api.anthropic.com') || base.includes('claude.com')) {
		return true;
	}
	return entry.id === 'anthropic' || entry.id === 'anthropic-oauth' || entry.id === 'claude';
}
