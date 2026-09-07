/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseFrontMatter, YamlParseError } from '../../../base/common/yaml.js';

export const MEMORY_NOTES_DIRECTORY = '.openide/memory/notes';
export const MEMORY_SESSIONS_DIRECTORY = '.openide/memory/sessions';
export const MEMORY_MAX_NOTE_BYTES = 8192;
export const MEMORY_MAX_NOTES = 500;
export type MemoryCaptureMode = 'automatic' | 'manual' | 'off';
export type MemoryRecordKind = 'decision' | 'convention' | 'discovery' | 'bugfix' | 'preference' | 'session';
export interface IOpenideMemoryRecord {
	schema: 1;
	id: string;
	topic_key: string;
	kind: MemoryRecordKind;
	status: 'active' | 'superseded';
	revision: number;
	created: string;
	updated: string;
	source_kind: 'native' | 'external' | 'subagent';
	source_session: string;
	source_message: string;
	evidence_kind: 'inferred' | 'user_asserted';
	operation_id: string;
	/** Bounded receipts survive later edits so checkpoint retries do not append twice. */
	applied_operations?: string[];
	related: string[];
	related_hashes?: string[];
	supersedes?: string;
	body: string;
}
export interface IOpenideMemoryDocument { readonly path: string; readonly hash: string; readonly record: IOpenideMemoryRecord }
export interface IOpenideMemoryCandidate { readonly topic_key: string; readonly body: string; readonly kind?: MemoryRecordKind; readonly related?: string[] }
export interface IOpenideMemoryCheckpointState {
	readonly watermark: string;
	readonly status: 'pending' | 'saved' | 'no_durable_change' | 'deferred';
	readonly transcript?: string;
	readonly message?: string;
	readonly candidates?: readonly IOpenideMemoryCandidate[];
}
export interface IOpenideMemoryRequest {
	readonly action: 'list' | 'get' | 'save' | 'forget' | 'legacy' | 'checkpoint' | 'checkpoint-list' | 'semantic';
	readonly root?: string;
	readonly semanticEndpoint?: string;
	readonly query?: string;
	readonly id?: string;
	readonly session?: string;
	/** Stable identity of a durable capture job within this conversation. */
	readonly checkpointId?: string;
	readonly message?: string;
	readonly origin?: 'native' | 'external' | 'subagent';
	readonly topic?: string;
	readonly kind?: MemoryRecordKind;
	readonly body?: string;
	readonly related?: readonly string[];
	readonly supersedes?: string;
	readonly expectedRevision?: number;
	readonly expectedHash?: string;
	readonly operationId?: string;
	readonly maxBytes?: number;
	readonly maxNotes?: number;
	readonly userMemoryPath?: string;
	readonly legacyTarget?: 'project' | 'user';
	readonly legacyAction?: 'add' | 'replace' | 'remove';
	readonly oldText?: string;
	readonly maxChars?: number;
	readonly checkpoint?: IOpenideMemoryCheckpointState;
}
export interface IOpenideMemoryResponse {
	readonly semanticIds?: readonly string[];
	readonly projectionWarning?: string;
	readonly documents?: readonly IOpenideMemoryDocument[];
	readonly document?: IOpenideMemoryDocument;
	readonly text?: string;
	readonly forgotten?: string;
	readonly forgottenPath?: string;
	readonly checkpoints?: readonly { readonly id: string; readonly state: IOpenideMemoryCheckpointState }[];
	readonly checkpoint?: IOpenideMemoryRequest['checkpoint'];
}

const kinds: readonly string[] = ['decision', 'convention', 'discovery', 'bugfix', 'preference', 'session'];
export function isMemoryRecordId(value: string): boolean { return /^mem_[a-zA-Z0-9_-]{8,80}$/.test(value); }
export function memoryRecordRoot(uri: string): string | undefined {
	const match = /^(.*)\/\.openide\/memory\/(?:notes|sessions)\/[^/]+\.md$/.exec(uri);
	return match?.[1];
}
export function isMemoryRecordUri(uri: string): boolean { return memoryRecordRoot(uri) !== undefined; }

/** Strict metadata and ordinary Markdown body. Unknown frontmatter fields are ignored on read. */
export function parseMemoryRecord(text: string): IOpenideMemoryRecord | undefined {
	const errors: YamlParseError[] = [];
	const parsed = parseFrontMatter(text, errors);
	if (!parsed?.header || errors.length) { return undefined; }
	const get = (key: string) => parsed.getStringValue(key) ?? '';
	const id = get('id'); const revision = Number(get('revision')); const kind = get('kind');
	if (get('schema') !== '1' || !isMemoryRecordId(id) || !Number.isSafeInteger(revision) || revision < 1 || !kinds.includes(kind) || !get('topic_key') || !parsed.body.trim()) { return undefined; }
	const appliedOperations = parsed.getStringArrayValue('applied_operations') ?? [];
	if (appliedOperations.length > 300 || appliedOperations.some(operation => !operation || operation.length > 256)) { return undefined; }
	const origin = get('source_kind'); const status = get('status');
	if (!['native', 'external', 'subagent'].includes(origin) || !['active', 'superseded'].includes(status)) { return undefined; }
	return {
		schema: 1, id, revision, topic_key: get('topic_key'), kind: kind as MemoryRecordKind, status: status as IOpenideMemoryRecord['status'],
		created: get('created'), updated: get('updated'), source_kind: origin as IOpenideMemoryRecord['source_kind'],
		source_session: get('source_session'), source_message: get('source_message'), evidence_kind: get('evidence_kind') === 'user_asserted' ? 'user_asserted' : 'inferred',
		related_hashes: parsed.getStringArrayValue('related_hashes') ?? [],
		operation_id: get('operation_id'), applied_operations: appliedOperations, related: parsed.getStringArrayValue('related') ?? [], supersedes: get('supersedes') || undefined, body: parsed.body.trim(),
	};
}

export function serializeMemoryRecord(record: IOpenideMemoryRecord): string {
	const { body, related, ...fields } = record;
	const lines = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
	if (related.length) { lines.push('related:', ...related.map(value => `  - ${JSON.stringify(value)}`)); }
	return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

/** Legacy callers retain their exact file format, with uniqueness and resulting-size checks. */
export function mutateLegacyMemory(current: string, action: 'add' | 'replace' | 'remove', content: string, oldText: string, limit: number): string {
	let updated: string;
	if (action === 'add') {
		if (!content.trim()) { throw new Error('Empty memory text.'); }
		if (current.includes(content.trim())) { return current; }
		const entry = content.trim().startsWith('-') ? content.trim() : `- ${content.trim()}`;
		updated = current.trim() ? `${current.trimEnd()}\n${entry}\n` : `${entry}\n`;
	} else {
		if (!oldText || current.split(oldText).length !== 2) { throw new Error('Memory edit conflict: old_text must match exactly once.'); }
		updated = current.replace(oldText, action === 'remove' ? '' : content).replace(/\n{3,}/g, '\n\n');
	}
	if (updated.length > limit && updated.length >= current.length) { throw new Error(`Memory exceeds its ${limit}-character limit. Consolidate first.`); }
	return updated;
}

/** Same fingerprint as the code index; detects changed references, not verified truth. */
export function memorySourceFingerprint(content: string): string {
	let value = 0x811c9dc5;
	for (let index = 0; index < content.length; index++) { value ^= content.charCodeAt(index); value = Math.imul(value, 0x01000193); }
	return (value >>> 0).toString(36);
}
