/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { realpath } from 'fs/promises';
import { join } from 'path';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IOpenideGoalCreate, IOpenideGoalUpdate, IOpenideGoalVerification } from '../common/openideGoal.js';
import { OpenideGoalStore } from './openideGoalStore.js';

/** An exclusive renderer connection owns reads, mutations and recovery for a goal session. */
export class OpenideGoalOwner extends Disposable {
	private static readonly leases = new Map<string, { owner: OpenideGoalOwner; ready: Promise<void> }>();
	private directory: string | undefined;
	private store: OpenideGoalStore | undefined;
	private generation = 0;
	private readonly claimed = new Set<string>();
	constructor(private readonly userDataPath: string) { super(); }

	async setWorkspace(workspaceId: string, roots: readonly string[]): Promise<void> {
		const generation = ++this.generation;
		const canonical = await Promise.all(roots.map(root => realpath(root)));
		const scope = createHash('sha256').update(JSON.stringify(canonical.length ? canonical.sort() : [workspaceId])).digest('hex');
		if (generation !== this.generation || this._store.isDisposed) { throw new Error('OpenIDE goal workspace was replaced'); }
		const directory = join(this.userDataPath, 'User', 'globalStorage', 'openide', 'goals', scope);
		if (this.directory !== directory) { this.release(); this.directory = directory; this.store = new OpenideGoalStore(directory); }
	}

	private async claim(sessionId: string): Promise<OpenideGoalStore> {
		const store = this.store;
		const generation = this.generation;
		if (!this.directory || !store || this._store.isDisposed || !sessionId || sessionId.length > 256) { throw new Error('OpenIDE goal workspace unavailable'); }
		const key = `${this.directory}\0${sessionId}`;
		let lease = OpenideGoalOwner.leases.get(key);
		if (lease && lease.owner !== this) { throw new Error('This goal is controlled by another OpenIDE window'); }
		if (!lease) {
			lease = { owner: this, ready: store.recover(sessionId).then(() => undefined) };
			OpenideGoalOwner.leases.set(key, lease); this.claimed.add(key);
		}
		try { await lease.ready; }
		catch (error) {
			if (OpenideGoalOwner.leases.get(key) === lease) { OpenideGoalOwner.leases.delete(key); this.claimed.delete(key); }
			throw error;
		}
		if (OpenideGoalOwner.leases.get(key) !== lease || generation !== this.generation || this._store.isDisposed) { throw new Error('OpenIDE goal owner disconnected or workspace replaced'); }
		return store;
	}

	async get(sessionId: string) { return (await this.claim(sessionId)).get(sessionId); }
	async create(request: IOpenideGoalCreate) { return (await this.claim(request.sessionId)).create(request); }
	async update(sessionId: string, request: IOpenideGoalUpdate) { return (await this.claim(sessionId)).update(sessionId, request); }
	async verify(sessionId: string, request: IOpenideGoalVerification) { return (await this.claim(sessionId)).verify(sessionId, request); }
	private release(): void { for (const key of this.claimed) { if (OpenideGoalOwner.leases.get(key)?.owner === this) { OpenideGoalOwner.leases.delete(key); } } this.claimed.clear(); }
	override dispose(): void { this.generation++; this.release(); super.dispose(); }
}
