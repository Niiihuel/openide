/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type OpenideJournalValue = null | boolean | number | string | OpenideJournalValue[] | { [key: string]: OpenideJournalValue };
export type OpenideJournalKind = 'run/start' | 'run/end' | 'model/request' | 'model/result' | 'model/retry' | 'tool/intent' | 'tool/result' | 'tool/unknown' | 'compaction' | 'memory/checkpoint';

/** Credentials and transport headers never belong in this model/history journal. */
export interface IOpenideRunJournalEvent {
	readonly kind: OpenideJournalKind;
	readonly runId: string;
	readonly payload: { readonly [key: string]: OpenideJournalValue };
}

export interface IOpenideRunJournalRecord {
	readonly version: 1;
	readonly seq: number;
	readonly time: number;
	readonly event: IOpenideRunJournalEvent;
	readonly previousHash: string;
	readonly hash: string;
}

/** Resolution is a durability barrier. Failure must prevent the dependent effect. */
export interface IOpenideRunJournal {
	append(event: IOpenideRunJournalEvent): Promise<void>;
}

export interface IOpenideJournalContext {
	readonly journal: IOpenideRunJournal;
	readonly runId: string;
}

export class OpenideRunJournalError extends Error {
	readonly code = 'OPENIDE_JOURNAL_CHECKPOINT_FAILED';
	constructor(cause: unknown) { super(`OpenIDE could not checkpoint this run. Execution stopped: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); this.name = 'OpenideRunJournalError'; }
}

export function isOpenideRunJournalError(error: unknown): error is OpenideRunJournalError {
	return error instanceof OpenideRunJournalError || !!error && typeof error === 'object' && 'code' in error && error.code === 'OPENIDE_JOURNAL_CHECKPOINT_FAILED';
}

export async function appendOpenideJournal(context: IOpenideJournalContext | undefined, kind: OpenideJournalKind, payload: { [key: string]: unknown }): Promise<void> {
	if (context) {
		try { await context.journal.append({ kind, runId: context.runId, payload: openideJournalSnapshot(payload) as IOpenideRunJournalEvent['payload'] }); }
		catch (error) { throw isOpenideRunJournalError(error) ? error : new OpenideRunJournalError(error); }
	}
}

export const OPENIDE_UNKNOWN_TOOL_OUTCOME = 'OpenIDE was interrupted after recording this tool intent. Its effect may already have happened, but no result was durably recorded. Inspect the current state before acting. Do not retry this operation blindly.';

/** Make an owned JSON snapshot, rejecting values which cannot be recorded faithfully. */
export function openideJournalSnapshot(value: unknown): OpenideJournalValue {
	const seen = new Set<object>();
	const visit = (item: unknown): OpenideJournalValue => {
		if (item === null || typeof item === 'string' || typeof item === 'boolean') { return item; }
		if (typeof item === 'number' && Number.isFinite(item)) { return item; }
		if (typeof item !== 'object' || !item || seen.has(item)) { throw new Error('OpenIDE journal requires finite, acyclic JSON data'); }
		seen.add(item);
		try {
			if (Array.isArray(item)) { return item.map(visit); }
			if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) { throw new Error('OpenIDE journal requires plain JSON objects'); }
			const result: { [key: string]: OpenideJournalValue } = {};
			for (const [key, entry] of Object.entries(item)) { if (entry !== undefined) { Object.defineProperty(result, key, { value: visit(entry), enumerable: true, writable: true, configurable: true }); } }
			return result;
		} finally { seen.delete(item); }
	};
	return visit(value);
}

export function openideUnknownToolEvents(records: readonly IOpenideRunJournalRecord[]): IOpenideRunJournalEvent[] {
	const pending = new Map<string, IOpenideRunJournalEvent>();
	for (const { event } of records) {
		const id = event.payload['operationId'];
		if (typeof id !== 'string') { continue; }
		const key = `${event.runId}:${id}`;
		if (event.kind === 'tool/intent') { pending.set(key, event); }
		if (event.kind === 'tool/result' || event.kind === 'tool/unknown') { pending.delete(key); }
	}
	return [...pending.values()].map(event => ({ kind: 'tool/unknown', runId: event.runId, payload: { ...event.payload, outcome: OPENIDE_UNKNOWN_TOOL_OUTCOME } }));
}

/** Reconstruct a recorded model envelope without contacting any provider or executing tools. */
export function reconstructOpenideJournalRequest(records: readonly IOpenideRunJournalRecord[], seq: number): OpenideJournalValue {
	const record = records.find(record => record.seq === seq);
	if (record?.event.kind !== 'model/request') { throw new Error('No model request at this journal sequence'); }
	return openideJournalSnapshot(record.event.payload['request']);
}
