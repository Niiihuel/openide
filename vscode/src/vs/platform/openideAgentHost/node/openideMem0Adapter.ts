/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IOpenideMemoryDocument } from '../../openideCodebase/common/openideMemoryRecord.js';

interface Mem0Result { readonly results?: { readonly id?: string; readonly metadata?: { readonly record_id?: string; readonly source_hash?: string }; readonly user_id?: string }[] }
/** Optional loopback OSS REST adapter. Mem0 receives authored text with inference disabled. */
export class OpenideMem0Adapter {
	private readonly endpoint: URL;
	private readonly deadline = Date.now() + 4000;
	constructor(endpoint: string, private readonly scope: string, private readonly apiKey?: string) {
		this.endpoint = new URL(endpoint);
		if (!['http:', 'https:'].includes(this.endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname) || this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash) { throw new Error('Mem0 requires a loopback HTTP endpoint without embedded credentials.'); }
	}
	private async call(path: string, method: string, body?: object): Promise<Mem0Result> {
		if (Date.now() >= this.deadline) { throw new Error('Mem0 operation budget exceeded.'); }
		const response = await fetch(new URL(`${this.endpoint.pathname.replace(/\/$/, '')}${path}`, this.endpoint.origin), {
			method, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(3000, this.deadline - Date.now()))),
			headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}) },
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) { throw new Error(`Mem0 HTTP ${response.status}`); }
		const reader = response.body?.getReader(); const decoder = new TextDecoder(); let text = ''; let size = 0;
		if (reader) {
			try {
				while (true) {
					const chunk = await reader.read(); if (chunk.done) { break; }
					size += chunk.value.byteLength;
					if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Mem0 response exceeds its limit.'); }
					text += decoder.decode(chunk.value, { stream: true });
				}
				text += decoder.decode();
			} finally { reader.releaseLock(); }
		}
		return text ? JSON.parse(text) : {};
	}
	async remove(id: string): Promise<void> {
		await this.call(`/memories?${new URLSearchParams({ user_id: this.scope, run_id: id })}`, 'DELETE');
	}
	async put(document: IOpenideMemoryDocument): Promise<void> {
		// Delete by both scope and record, so replay after a crash cannot accumulate orphan vectors.
		await this.remove(document.record.id);
		await this.call('/memories', 'POST', { messages: [{ role: 'user', content: document.record.body }], user_id: this.scope, run_id: document.record.id,
			infer: false, metadata: { record_id: document.record.id, source_hash: document.hash } });
	}
	async search(query: string, documents: readonly IOpenideMemoryDocument[]): Promise<string[]> {
		const response = await this.call('/search', 'POST', { query: query.slice(0, 8000), filters: { user_id: this.scope }, top_k: 24 });
		const canonical = new Map(documents.map(document => [document.record.id, document.hash]));
		return [...new Set((response.results ?? []).filter(hit => (!hit.user_id || hit.user_id === this.scope) && hit.metadata?.record_id && canonical.get(hit.metadata.record_id) === hit.metadata.source_hash).map(hit => hit.metadata!.record_id!))];
	}
}
