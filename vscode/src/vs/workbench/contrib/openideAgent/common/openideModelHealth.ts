/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — health and cooldowns per (provider, model), and the choice of which target a turn
 *  actually runs on.
 *
 *  WHY THIS EXISTS: a failover that forgets pays the same toll on every message. A saturated
 *  free pool answers 429 in 200ms, the run spends three retries plus the walk down the chain to
 *  rediscover it, and the next message starts over. Remembering turns that toll into one line of
 *  info.
 *
 *  The pure part lives here so the rules can be tested without a workbench: the store that holds
 *  the map and persists it is `SubagentRoutingService`, which is where it already lived when only
 *  subagents consulted it.
 *
 *  Upstream reference (`refs/vscode`, chat/common/modelSelection.ts): VS Code separates the model
 *  a conversation is MEANT to run on from what the catalog can serve right now, and refuses to
 *  give up on a model unless its absence is conclusive. Same shape here: `planModelRun` never
 *  discards the intended target, it only redirects THIS turn and says so.
 *--------------------------------------------------------------------------------------------*/

import { IClassifiedProviderError } from './openideErrorClassifier.js';
import { t } from './openideStrings.js';
import { ISubagentTargetHealth, SubagentTargetHealthStatus, subagentTargetKey } from './openideSubagentRouting.js';

export interface IModelTarget {
	readonly providerId: string;
	readonly model: string;
}

export type ModelHealthLookup = (target: IModelTarget) => ISubagentTargetHealth | undefined;

/**
 * How long a target stays out after CONSECUTIVE failures.
 *
 * The first failure trusts the provider: if it said "retry in 5s", that is the wait. From the
 * second on, that answer has been proven wrong — OpenRouter's shared free pool suggests 5s while
 * being saturated for hours — so the wait escalates on our own terms and the suggestion becomes a
 * floor, never a ceiling.
 */
export const MODEL_COOLDOWN_LADDER_MS = [30_000, 120_000, 600_000, 1_800_000];

/**
 * How long a failure still counts as part of a streak. Two 429s twenty seconds apart are the same
 * incident; two a day apart are two bad afternoons, and the second one deserves the provider's
 * benefit of the doubt all over again.
 */
const FAILURE_STREAK_WINDOW_MS = 30 * 60_000;

const NOT_FOUND_COOLDOWN_MS = 24 * 60 * 60_000;
const GENERIC_COOLDOWN_MS = 60_000;

/**
 * Whether a failure says anything about the TARGET's health.
 *
 * A tool that threw, a context overflow, a malformed answer — those are facts about the turn, not
 * about the model being reachable. Recording them would put a healthy model in cooldown and send
 * the next turn somewhere else for no reason, so the list is explicit rather than "anything that
 * is not fatal".
 */
const HEALTH_SIGNAL_REASONS: ReadonlySet<string> = new Set([
	'authentication', 'billing', 'rate-limit', 'overloaded',
	'model-not-found', 'model-retired', 'project-not-found', 'provider-unavailable',
	'network', 'connection-refused',
]);

export function isModelHealthSignal(error: IClassifiedProviderError): boolean {
	return HEALTH_SIGNAL_REASONS.has(error.reason);
}

export function modelHealthStatus(error: IClassifiedProviderError): SubagentTargetHealthStatus {
	if (error.kind === 'auth') { return 'auth'; }
	if (error.kind === 'billing') { return 'billing'; }
	if (error.kind === 'rate-limit') { return 'rate-limit'; }
	if (error.reason === 'model-not-found' || error.reason === 'model-retired') { return 'model-not-found'; }
	if (error.reason === 'provider-unavailable' || error.reason === 'project-not-found') { return 'provider-unavailable'; }
	return 'cooldown';
}

/**
 * When the target may be tried again, or `undefined` for the failures that waiting does not fix.
 *
 * Auth and billing have no cooldown on purpose: they are cleared by the user reconnecting or
 * paying, and a timer that silently re-enables them would just spend another turn to fail again.
 * They are still recorded, so a surface can show WHY the target is out.
 */
export function modelCooldownUntil(error: IClassifiedProviderError, now: number, failures: number): number | undefined {
	if (error.kind === 'auth' || error.kind === 'billing' || error.reason === 'project-not-found') {
		return undefined;
	}
	if (error.reason === 'model-not-found' || error.reason === 'model-retired' || error.reason === 'provider-unavailable') {
		return now + NOT_FOUND_COOLDOWN_MS;
	}
	if (error.kind === 'rate-limit' || error.reason === 'overloaded') {
		const suggested = error.retryAfterMs ?? 0;
		if (failures <= 1) {
			return now + Math.max(suggested, 1_000);
		}
		const escalated = MODEL_COOLDOWN_LADDER_MS[Math.min(failures - 2, MODEL_COOLDOWN_LADDER_MS.length - 1)];
		return now + Math.max(suggested, escalated);
	}
	return now + GENERIC_COOLDOWN_MS;
}

/** The record after a failure. Consecutive failures of the same target accumulate. */
export function recordModelFailure(
	previous: ISubagentTargetHealth | undefined,
	target: IModelTarget,
	error: IClassifiedProviderError,
	now: number,
): ISubagentTargetHealth {
	const status = modelHealthStatus(error);
	// The streak counts REPEATED trouble of the same nature: a healthy answer in between clears it
	// (success records no reason), and so does a failure of a different kind — a 404 says nothing
	// about a 429. It is compared against the RAW record on purpose: an expired cooldown reads as
	// available, and letting that reset the streak was exactly the bug — the model would fail, wait
	// out the 5s it asked for, fail again, and be trusted with another 5s forever.
	const sameIncident = !!previous
		&& previous.reason === error.reason
		&& now - previous.updatedAt <= FAILURE_STREAK_WINDOW_MS;
	const failures = sameIncident ? (previous.failures ?? 1) + 1 : 1;
	const until = modelCooldownUntil(error, now, failures);
	return {
		providerId: target.providerId,
		model: target.model,
		status,
		reason: error.reason,
		...(until ? { until } : {}),
		failures,
		updatedAt: now,
	};
}

export function recordModelSuccess(target: IModelTarget, now: number): ISubagentTargetHealth {
	return { providerId: target.providerId, model: target.model, status: 'available', failures: 0, updatedAt: now };
}

/** The record as of `now`: an expired cooldown reads as available without having to be swept. */
export function activeModelHealth(health: ISubagentTargetHealth | undefined, now: number): ISubagentTargetHealth | undefined {
	if (!health) {
		return undefined;
	}
	if (health.until && health.until <= now) {
		return { ...health, status: 'available', reason: undefined, until: undefined, updatedAt: now };
	}
	return health;
}

/**
 * Whether a target is serving a cooldown right now.
 *
 * Only a live `until` blocks. A status with no deadline (auth, billing) is deliberately NOT a
 * block: the record may be stale — the user reconnected the provider in another window — and
 * refusing to even try would lock them out of their own model with no way back.
 */
export function isModelCoolingDown(health: ISubagentTargetHealth | undefined, now: number): boolean {
	const active = activeModelHealth(health, now);
	return !!active?.until && active.until > now;
}

/**
 * The wait, said the way a person would say it.
 *
 * Ported from upstream's `secondsToHumanReadableTime` (`chat/common/chatErrorMessages.ts`), which
 * renders a rate limit as "6 hours 50 minutes" rather than a timestamp: what the reader wants to
 * know is how long, not when.
 */
export function describeCooldown(untilMs: number, now: number): string {
	const seconds = Math.max(1, Math.round((untilMs - now) / 1000));
	if (seconds < 90) {
		return t('cooldown.seconds', seconds);
	}
	const minutes = Math.floor(seconds / 60);
	if (seconds <= 5400) {
		return t('cooldown.minutes', minutes);
	}
	const hours = Math.floor(minutes / 60);
	const remaining = minutes % 60;
	return remaining > 0 ? t('cooldown.hoursMinutes', hours, remaining) : t('cooldown.hours', hours);
}

export interface IModelRunPlan {
	/** The target this turn runs on. */
	readonly target: IModelTarget;
	/** Set when the intended target was skipped: what was skipped, and until when. */
	readonly redirectedFrom?: { readonly target: IModelTarget; readonly until: number };
}

/**
 * Which target a turn should start on.
 *
 * Never discards the intended model — the chip keeps saying what the user chose, this only decides
 * where THIS turn runs. And when nothing in the chain is healthy it runs the intended one anyway:
 * a stale cooldown must never be able to refuse a turn outright, and the provider is the only
 * authority on whether it is back.
 */
export function planModelRun(
	intended: IModelTarget,
	chain: readonly IModelTarget[],
	healthOf: ModelHealthLookup,
	now: number,
): IModelRunPlan {
	const health = activeModelHealth(healthOf(intended), now);
	if (!isModelCoolingDown(health, now)) {
		return { target: intended };
	}
	const intendedKey = subagentTargetKey(intended);
	const healthy = chain.find(step =>
		subagentTargetKey(step) !== intendedKey && !isModelCoolingDown(healthOf(step), now));
	if (!healthy) {
		return { target: intended };
	}
	return { target: healthy, redirectedFrom: { target: intended, until: health!.until! } };
}
