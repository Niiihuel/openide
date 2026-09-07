/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { realpath } from 'fs/promises';
import { join } from 'path';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IOpenideRunJournalEvent, IOpenideRunJournalRecord } from '../common/openideRunJournal.js';
import { OpenideRunJournalStore } from './openideRunJournalStore.js';

interface IJournalLease { readonly owner: OpenideRunJournalOwner; readonly key: string }

/** A connection lease prevents another window from recovering a session which is still running. */
export class OpenideRunJournalOwner extends Disposable {
	private static readonly leases = new Map<string, IJournalLease>();
	private directory: string | undefined;
	private workspaceGeneration = 0;
	private workspaceReady = false;
	private readonly sessions = new Map<string, IJournalLease>();
	constructor(private readonly userDataPath: string) { super(); }

	async setWorkspace(workspaceId: string, roots: readonly string[]): Promise<void> {
		const generation = ++this.workspaceGeneration;
		this.workspaceReady = false;
		const canonical = await Promise.all(roots.map(root => realpath(root)));
		if (generation !== this.workspaceGeneration || this._store.isDisposed) { throw new Error('OpenIDE journal workspace registration was superseded'); }
		const scope = createHash('sha256').update(JSON.stringify(canonical.length ? canonical.sort() : [workspaceId])).digest('hex');
		const directory = join(this.userDataPath, 'User', 'globalStorage', 'openide', 'run-journal', scope);
		if (this.directory && directory !== this.directory && this.sessions.size) { throw new Error('OpenIDE cannot change journal workspace during an active run'); }
		if (this._store.isDisposed) { throw new Error('OpenIDE journal owner disconnected'); }
		this.directory = directory;
		this.workspaceReady = true;
	}

	private key(session: string): string {
		if (!this.directory || !this.workspaceReady || this._store.isDisposed || !session || session.length > 256) { throw new Error('OpenIDE journal workspace or session unavailable'); }
		return `${this.directory}\0${session}`;
	}

	async open(session: string): Promise<IOpenideRunJournalRecord[]> {
		const key = this.key(session);
		if (OpenideRunJournalOwner.leases.has(key)) { throw new Error('OpenIDE session already has an active journal owner'); }
		const lease: IJournalLease = { owner: this, key };
		OpenideRunJournalOwner.leases.set(key, lease); this.sessions.set(session, lease);
		try {
			const records = await new OpenideRunJournalStore(this.directory!).recover(session);
			if (this._store.isDisposed || this.sessions.get(session) !== lease || OpenideRunJournalOwner.leases.get(key) !== lease) { throw new Error('OpenIDE journal owner disconnected or replaced'); }
			return records;
		} catch (error) { this.release(session, lease); throw error; }
	}

	async append(session: string, event: IOpenideRunJournalEvent): Promise<void> {
		const lease = this.sessions.get(session);
		if (!lease || OpenideRunJournalOwner.leases.get(this.key(session)) !== lease) { throw new Error('OpenIDE journal session is not owned by this connection'); }
		await new OpenideRunJournalStore(this.directory!).append(session, event);
		if (this.sessions.get(session) !== lease || this._store.isDisposed) { throw new Error('OpenIDE journal owner disconnected or replaced'); }
	}

	close(session: string): void {
		const lease = this.sessions.get(session);
		if (lease) { this.release(session, lease); }
	}

	private release(session: string, lease: IJournalLease): void {
		if (OpenideRunJournalOwner.leases.get(lease.key) === lease) { OpenideRunJournalOwner.leases.delete(lease.key); }
		if (this.sessions.get(session) === lease) { this.sessions.delete(session); }
	}

	override dispose(): void { this.workspaceGeneration++; this.workspaceReady = false; for (const session of this.sessions.keys()) { this.close(session); } super.dispose(); }
}
