/*---------------------------------------------------------------------------------------------
 * Copyright (c) OpenIDE. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken } from '../../../base/common/cancellation.js';
import { ICodebaseMemorySnapshotDto } from '../common/openideCodebaseMemoryProtocol.js';
import { ICodebaseMemoryEdge, ICodebaseMemoryNode } from '../common/openideCodebaseMemoryTypes.js';
import { NativeCodebase } from './openideNativeCodebase.js';

interface FilePayload { readonly nodes: readonly ICodebaseMemoryNode[]; readonly edges: readonly ICodebaseMemoryEdge[]; }
export interface INativeGraphResult { aliases: Record<string, string>; groups: string[][]; degreeByUri: Record<string, number>; }
const CHUNK_BYTES = 4 * 1024 * 1024;

/** Native state belongs to one trusted workspace. Epoch changes force replay after idle or crash. */
export class NativeGraphRuntime {
	private graphEpoch = -1;
	private queryEpoch = -1;
	private files = new Map<string, FilePayload>();
	private snapshot: ICodebaseMemorySnapshotDto | undefined;
	private queryKey = '';
	private sequence = 0;
	constructor(private readonly native: NativeCodebase) { }

	reset(): void {
		this.files.clear(); this.snapshot = undefined; this.graphEpoch = this.queryEpoch = -1; this.native.reset();
	}

	async finalize(fileUris: string[], payloads: ReadonlyMap<string, FilePayload>, token = CancellationToken.None): Promise<INativeGraphResult | undefined> {
		const before = this.native.epoch;
		const reset = this.graphEpoch !== before;
		const removed = reset ? [] : [...this.files.keys()].filter(uri => !payloads.has(uri));
		if (await this.native.call('graphUpdate', { reset, removed, files: [] }, token) !== true) { this.graphEpoch = -1; return undefined; }
		const epoch = this.native.epoch;
		if (!reset && epoch !== before) { this.graphEpoch = -1; return undefined; }
		const changed = [...payloads].filter(([uri, payload]) => reset || this.files.get(uri) !== payload).map(([uri, payload]) => ({ uri, ...payload }));
		if (!await this.chunks('graphUpdate', 'files', changed, {}, token)) { this.graphEpoch = -1; return undefined; }
		const result = await this.native.call<INativeGraphResult>('graphFinalize', { fileUris }, token);
		if (epoch !== this.native.epoch || !result || !Array.isArray(result.groups) || !result.aliases || !result.degreeByUri) { this.graphEpoch = -1; return undefined; }
		this.files = new Map(payloads); this.graphEpoch = this.native.epoch;
		return result;
	}

	async querySnapshot(snapshot: ICodebaseMemorySnapshotDto, method: string, args: unknown, includeHeuristic: boolean, token = CancellationToken.None): Promise<unknown | undefined> {
		const key = `${snapshot.version.version}:${includeHeuristic}`;
		if (this.queryEpoch !== this.native.epoch || this.snapshot !== snapshot || this.queryKey !== key) {
			this.queryEpoch = -1;
			const version = `${key}:${++this.sequence}`;
			if (await this.native.call('queryReset', { version, indexVersion: snapshot.version.version, includeHeuristic }, token) !== true) { return undefined; }
			const collationIds = snapshot.nodes.map(node => node.id).sort((a, b) => a.localeCompare(b));
			for (const [field, values] of Object.entries({ nodes: snapshot.nodes, edges: snapshot.edges, communities: snapshot.communities ?? [], dirtyUris: snapshot.dirtyUris, collationIds })) {
				if (!await this.chunks('queryAppend', field, values, { version }, token)) { return undefined; }
			}
			this.snapshot = snapshot; this.queryKey = key; this.queryEpoch = this.native.epoch;
		}
		const result = await this.native.call('queryRun', { version: `${key}:${this.sequence}`, method, args }, token);
		if (result === undefined) { this.queryEpoch = -1; }
		return result;
	}

	private async chunks(method: string, field: string, values: readonly unknown[], metadata: object, token: CancellationToken): Promise<boolean> {
		let batch: unknown[] = []; let size = 0;
		for (const value of values) {
			const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
			if (batch.length && size + bytes > CHUNK_BYTES) {
				if (await this.native.call(method, { ...metadata, [field]: batch }, token) !== true) { return false; }
				batch = []; size = 0;
			}
			batch.push(value); size += bytes;
		}
		return !batch.length || await this.native.call(method, { ...metadata, [field]: batch }, token) === true;
	}
}
