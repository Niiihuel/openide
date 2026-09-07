/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IOpenideMemoryDocument } from '../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { estimateTextTokens } from './openideTokens.js';

export function activeMemoryDocuments(documents: readonly IOpenideMemoryDocument[]): IOpenideMemoryDocument[] {
	const superseded = new Set(documents.map(document => document.record.supersedes).filter(Boolean));
	return documents.filter(document => document.record.status === 'active' && !superseded.has(document.record.id) && document.record.kind !== 'session');
}

/** Deterministic local recall remains available while the derived graph is rebuilding. */
export function recallMemory(documents: readonly IOpenideMemoryDocument[], query: string, maxTokens = 1000, includeSessions = false, semanticIds: readonly string[] = []): string {
	const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])].slice(0, 80);
	const active = [...activeMemoryDocuments(documents), ...(includeSessions ? documents.filter(document => document.record.kind === 'session' && document.record.status === 'active') : [])];
	const ranked = active.map(document => {
		const { topic_key, body, related } = document.record;
		const text = `${topic_key} ${body} ${related.join(' ')}`.toLowerCase();
		return { document, score: (semanticIds.includes(document.record.id) ? 3 : 0) + terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0) + (topic_key.includes(term) ? 2 : 0), 0) };
	}).filter(hit => !terms.length || hit.score > 0).sort((a, b) => b.score - a.score || b.document.record.updated.localeCompare(a.document.record.updated));
	const parts: string[] = [];
	const budget = Math.max(0, Math.min(12000, Math.floor(maxTokens)));
	for (const { document } of ranked.slice(0, 24)) {
		const r = document.record;
		const reason = terms.filter(term => `${r.topic_key} ${r.body}`.toLowerCase().includes(term)).slice(0, 8).join(', ') || (semanticIds.includes(r.id) ? 'semantic candidate, source hash matched' : 'recent note');
		const prefix = `[${r.id}] ${document.path} revision=${r.revision} hash=${document.hash}\nSource: ${r.source_kind} session=${r.source_session} message=${r.source_message}; evidence=${r.evidence_kind}; matched=${reason}\n`;
		let body = r.body;
		while (body.length && estimateTextTokens([...parts, prefix + body].join('\n\n')) > budget) { body = body.slice(0, Math.max(0, body.length - 100)); }
		if (!body) { continue; }
		parts.push(prefix + body + (body.length < r.body.length ? '\n[Excerpt; memory_get returns the full note.]' : ''));
		if (estimateTextTokens(parts.join('\n\n')) > budget) { parts.pop(); }
	}
	return parts.join('\n\n');
}
