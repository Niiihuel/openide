/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — isolation of writer subagents. It uses a worktree when the backend provides one;
 *  safe fallback: a single-writer lock (never two writers over the main workspace).
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ISubagentWorkspaceService = createDecorator<ISubagentWorkspaceService>('openideSubagentWorkspaceService');

export interface ISubagentWorkspaceLease {
	readonly runId: string;
	readonly root: URI;
	readonly kind: 'readonly-shared' | 'worktree' | 'single-writer';
}

export interface ISubagentWorkspaceBackend {
	createWorktree(runId: string): Promise<URI>;
	applyWorktree(runId: string): Promise<void>;
	discardWorktree(runId: string): Promise<void>;
}

export interface ISubagentWorkspaceService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeWriter: Event<string | undefined>;
	setBackend(backend: ISubagentWorkspaceBackend): void;
	acquire(runId: string, workspaceRoot: URI, readonly: boolean, preferWorktree: boolean): Promise<ISubagentWorkspaceLease>;
	release(runId: string): Promise<void>;
	apply(runId: string): Promise<void>;
	discard(runId: string): Promise<void>;
}

export class SubagentWorkspaceService implements ISubagentWorkspaceService {
	declare readonly _serviceBrand: undefined;
	private writer: string | undefined;
	private backend: ISubagentWorkspaceBackend | undefined;
	private readonly leases = new Map<string, ISubagentWorkspaceLease>();
	private readonly _onDidChangeWriter = new Emitter<string | undefined>();
	readonly onDidChangeWriter = this._onDidChangeWriter.event;
	setBackend(backend: ISubagentWorkspaceBackend): void { this.backend = backend; }

	async acquire(runId: string, workspaceRoot: URI, readonly: boolean, preferWorktree: boolean): Promise<ISubagentWorkspaceLease> {
		if (readonly) { const lease = { runId, root: workspaceRoot, kind: 'readonly-shared' as const }; this.leases.set(runId, lease); return lease; }
		if (preferWorktree && this.backend) {
			try { const lease = { runId, root: await this.backend.createWorktree(runId), kind: 'worktree' as const }; this.leases.set(runId, lease); return lease; }
			catch { /* fallback explícito al single-writer lock */ }
		}
		if (this.writer && this.writer !== runId) { throw new Error(`El subagente escritor ${this.writer} ya posee el workspace.`); }
		this.writer = runId; this._onDidChangeWriter.fire(runId);
		const lease = { runId, root: workspaceRoot, kind: 'single-writer' as const }; this.leases.set(runId, lease); return lease;
	}
	async release(runId: string): Promise<void> { const lease = this.leases.get(runId); if (lease?.kind !== 'worktree') { this.leases.delete(runId); } if (this.writer === runId) { this.writer = undefined; this._onDidChangeWriter.fire(undefined); } }
	async apply(runId: string): Promise<void> { const lease = this.leases.get(runId); if (!lease) { throw new Error('Lease inexistente.'); } if (lease.kind === 'worktree') { if (!this.backend) { throw new Error('Backend de worktree no disponible.'); } await this.backend.applyWorktree(runId); } }
	async discard(runId: string): Promise<void> { const lease = this.leases.get(runId); if (lease?.kind === 'worktree' && this.backend) { await this.backend.discardWorktree(runId); } await this.release(runId); }
}
