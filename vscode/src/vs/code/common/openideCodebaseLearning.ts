/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 *  OpenIDE — the Project Map's work memory: which entities of the graph proved useful in earlier
 *  turns, with time decay. A pure core (no DI, no storage) so it can be tested with an injectable
 *  `now` and produce deterministic output.
 *
 *  The idea comes from Graphify: the outcome of an answer is free signal that today is thrown
 *  away. An old lesson weighs less on its own (30-day half-life) — knowledge about code that
 *  changed fades without anybody purging it by hand.
 *--------------------------------------------------------------------------------------------*/

export type LearningState = 'preferred' | 'tentative' | 'contested';

export interface ILearningEntry {
	/** Weighted sum of the positive signals. */
	pos: number;
	/** Weighted sum of the negative signals. */
	neg: number;
	/** Timestamp of the last signal (the decay is measured from it). */
	lastAt: number;
}

export const LEARNING_HALF_LIFE_DAYS = 30;
/** Below this weight the entry says nothing and is pruned (≈4 half-lives ≈ 120 days). */
export const LEARNING_EPSILON = 0.06;
/** Weighted positive signal needed to go from `tentative` to `preferred`. */
const MIN_CORROBORATION = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A node's stable key: WITHOUT the line number, so the lesson survives editing (the graph's
 *  `id` includes the line and would be invalidated by any change above it in the file). */
export function learningKey(uri: string, qualifiedNameOrName: string): string {
	return `${uri}#${qualifiedNameOrName}`;
}

/** Weight of a signal by its age: 0.5^(days/30). */
export function decayWeight(lastAt: number, now: number): number {
	if (!lastAt || lastAt > now) { return 1; }
	return Math.pow(0.5, (now - lastAt) / DAY_MS / LEARNING_HALF_LIFE_DAYS);
}

/** Applies a signal to an entry, decaying what was accumulated so far first. */
export function applySignal(entry: ILearningEntry | undefined, weight: number, now: number): ILearningEntry {
	const decay = entry ? decayWeight(entry.lastAt, now) : 1;
	const pos = (entry ? entry.pos * decay : 0) + Math.max(0, weight);
	const neg = (entry ? entry.neg * decay : 0) + Math.max(0, -weight);
	// Stable rounding: it keeps floating point from making noise in the tests and in the stored JSON.
	return { pos: round(pos), neg: round(neg), lastAt: now };
}

function round(value: number): number { return Math.round(value * 1e6) / 1e6; }

/** Graphify's classification: contested when there is signal both ways; preferred needs
 *  corroboration (2+), a single positive signal is only tentative. Negative-only is not exposed
 *  (the model is not told "this is useless", it is simply not highlighted). */
export function classify(entry: ILearningEntry, now: number): LearningState | undefined {
	const decay = decayWeight(entry.lastAt, now);
	const pos = entry.pos * decay;
	const neg = entry.neg * decay;
	if (pos < LEARNING_EPSILON && neg < LEARNING_EPSILON) { return undefined; }
	if (pos >= LEARNING_EPSILON && neg >= LEARNING_EPSILON) { return 'contested'; }
	if (pos >= MIN_CORROBORATION) { return 'preferred'; }
	if (pos >= LEARNING_EPSILON) { return 'tentative'; }
	return undefined;
}

/** True when the entry carries no signal any more and can be pruned. */
export function isExpired(entry: ILearningEntry, now: number): boolean {
	const decay = decayWeight(entry.lastAt, now);
	return entry.pos * decay < LEARNING_EPSILON && entry.neg * decay < LEARNING_EPSILON;
}

/** Prunes the expired entries. It returns a new map (the original is not mutated). */
export function pruneExpired(entries: ReadonlyMap<string, ILearningEntry>, now: number): Map<string, ILearningEntry> {
	const out = new Map<string, ILearningEntry>();
	for (const [key, entry] of entries) {
		if (!isExpired(entry, now)) { out.set(key, entry); }
	}
	return out;
}
