/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — deciding whether a run that ran out of quota should continue on another account.
 *
 *  A provider can hold several subscription accounts. When the active one is spent, the run dies
 *  with a red glyph and no explanation, while a second account sits there with room. This is the
 *  decision — and ONLY the decision: no secret storage, no retry, no UI. That separation is what
 *  makes the awkward cases assertable, and every one of them below came from a real hazard rather
 *  than from imagination.
 *--------------------------------------------------------------------------------------------*/

/**
 * `off` is the default ON PURPOSE. Switching accounts spends someone else's subscription, and a
 * product that starts doing that on its own the first time a limit is hit has made a billing
 * decision the user never asked for. Off still explains why the run stopped; it just does not act.
 */
export type OpenideAccountFailoverMode = 'off' | 'auto' | 'ask';

export interface IOpenideFailoverCandidate {
	readonly accountId: string;
	readonly label: string;
	/**
	 * Consumption of the account's TIGHTEST window, 0-100. Undefined when the roster knows nothing
	 * about it — which is not the same as zero, and is treated as its own case below.
	 */
	readonly usedPercent?: number;
	/** When that window resets, for the sentence the user reads afterwards. */
	readonly resetsAt?: number;
	/** Metered rather than included in a subscription: moving here can cost money. */
	readonly paid?: boolean;
}

export interface IOpenideFailoverInput {
	readonly mode: OpenideAccountFailoverMode;
	/**
	 * The failure is THIS account's quota. A saturated shared pool on a free variant and an expired
	 * credential both surface as 429/401 too, and neither is fixed by paying with another account —
	 * one needs waiting and the other needs a login.
	 */
	readonly exhausted: boolean;
	readonly activeAccountId: string | undefined;
	readonly accounts: readonly IOpenideFailoverCandidate[];
	/**
	 * Another run of the SAME provider is in flight. Activating an account rewrites the provider's
	 * active credential in secret storage, so switching now pulls it out from under that run — the
	 * same class of shared mutable state the per-file claims exist for.
	 */
	readonly providerBusy: boolean;
	/** This turn already moved once. One retry, never a walk down the whole account list. */
	readonly alreadySwitched: boolean;
}

export type OpenideFailoverStopReason = 'off' | 'not-exhausted' | 'no-candidate' | 'provider-busy' | 'already-switched';

export type IOpenideFailoverDecision =
	| { readonly kind: 'stop'; readonly reason: OpenideFailoverStopReason }
	| { readonly kind: 'switch'; readonly to: IOpenideFailoverCandidate }
	| { readonly kind: 'ask'; readonly candidates: readonly IOpenideFailoverCandidate[] };

/** At or above this, the account is treated as spent — retrying into it just fails again. */
export const OPENIDE_FAILOVER_HEADROOM_LIMIT = 98;

/**
 * Accounts worth moving to, best first.
 *
 * An account the roster knows nothing about is KEPT, and ranked last. Excluding it would be
 * pretending that "no data" means "no room", and the alternative to trying it is stopping for
 * certain — but a measured account with room is always the better bet, hence the ordering.
 */
export function openideFailoverCandidates(input: IOpenideFailoverInput): readonly IOpenideFailoverCandidate[] {
	return input.accounts
		.filter(account => account.accountId !== input.activeAccountId)
		.filter(account => account.usedPercent === undefined || account.usedPercent < OPENIDE_FAILOVER_HEADROOM_LIMIT)
		.slice()
		.sort((a, b) => headroom(b) - headroom(a));
}

function headroom(account: IOpenideFailoverCandidate): number {
	// Unknown sorts below every measured account without being dropped: -1, not 100.
	return account.usedPercent === undefined ? -1 : 100 - account.usedPercent;
}

/**
 * What to do about a run that just ran out of quota.
 *
 * The escalations to `ask` are deliberate and survive `auto`: two accounts with room is a choice
 * about whose subscription pays, and a metered account is a choice about whether to spend at all.
 * Answering those silently is the kind of helpfulness that shows up on a bill.
 */
export function decideOpenideAccountFailover(input: IOpenideFailoverInput): IOpenideFailoverDecision {
	if (!input.exhausted) { return { kind: 'stop', reason: 'not-exhausted' }; }
	if (input.mode === 'off') { return { kind: 'stop', reason: 'off' }; }
	// Checked before the candidates so the reason names the real obstacle: with a run in flight the
	// answer is "not now", not "nowhere to go".
	if (input.alreadySwitched) { return { kind: 'stop', reason: 'already-switched' }; }
	if (input.providerBusy) { return { kind: 'stop', reason: 'provider-busy' }; }

	const candidates = openideFailoverCandidates(input);
	if (!candidates.length) { return { kind: 'stop', reason: 'no-candidate' }; }
	if (input.mode === 'ask') { return { kind: 'ask', candidates }; }
	if (candidates.length > 1 || candidates[0].paid) { return { kind: 'ask', candidates }; }
	return { kind: 'switch', to: candidates[0] };
}
