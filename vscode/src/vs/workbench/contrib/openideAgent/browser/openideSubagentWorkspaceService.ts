/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  OpenIDE — isolation of writer subagents. Requested worktrees fail closed if unavailable.
 *  An explicitly selected shared workspace permits one subagent writer at a time.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
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
	createWorktree(runId: string, workspaceRoot: URI): Promise<URI>;
	applyWorktree(runId: string): Promise<void>;
	discardWorktree(runId: string): Promise<void>;
}

export interface ISubagentWorkspaceService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeWriter: Event<string | undefined>;
	getCompletedWorktrees(): readonly ISubagentWorkspaceLease[];
	adoptCompletedWorktree(runId: string, root: URI): void;
	setBackend(backend: ISubagentWorkspaceBackend): void;
	acquire(runId: string, workspaceRoot: URI, readonly: boolean, preferWorktree: boolean): Promise<ISubagentWorkspaceLease>;
	release(runId: string): Promise<void>;
	apply(runId: string): Promise<void>;
	discard(runId: string): Promise<void>;
}

export class SubagentWorkspaceService extends Disposable implements ISubagentWorkspaceService {
	declare readonly _serviceBrand: undefined;
	private writer: string | undefined;
	private backend: ISubagentWorkspaceBackend | undefined;
	private readonly active = new Set<string>();
	private readonly pending = new Set<string>();
	private readonly leases = new Map<string, ISubagentWorkspaceLease>();
	private readonly _onDidChangeWriter = this._register(new Emitter<string | undefined>());
	getCompletedWorktrees(): readonly ISubagentWorkspaceLease[] { return [...this.leases.values()].filter(lease => lease.kind === 'worktree' && !this.active.has(lease.runId) && !this.pending.has(lease.runId)); }
	readonly onDidChangeWriter = this._onDidChangeWriter.event;
	setBackend(backend: ISubagentWorkspaceBackend): void { this.backend = backend; }
	adoptCompletedWorktree(runId: string, root: URI): void { if (this.leases.has(runId) || this.pending.has(runId)) { throw new Error('OpenIDE worktree already attached.'); } this.leases.set(runId, { runId, root, kind: 'worktree' }); }

	async acquire(runId: string, workspaceRoot: URI, readonly: boolean, preferWorktree: boolean): Promise<ISubagentWorkspaceLease> {
		if (this.leases.has(runId) || this.pending.has(runId)) { throw new Error('OpenIDE subagent already owns a workspace.'); }
		if (readonly) { const lease = { runId, root: workspaceRoot, kind: 'readonly-shared' as const }; this.leases.set(runId, lease); return lease; }
		if (preferWorktree) {
			if (!this.backend) { throw new Error('OpenIDE worktree backend unavailable.'); }
			this.pending.add(runId);
			try {
				const lease = { runId, root: await this.backend.createWorktree(runId, workspaceRoot), kind: 'worktree' as const };
				this.leases.set(runId, lease); this.active.add(runId); return lease;
			} finally { this.pending.delete(runId); }
		}
		if (this.writer && this.writer !== runId) { throw new Error(`El subagente escritor ${this.writer} ya posee el workspace.`); }
		this.writer = runId; this._onDidChangeWriter.fire(runId);
		const lease = { runId, root: workspaceRoot, kind: 'single-writer' as const }; this.leases.set(runId, lease); return lease;
	}
	async release(runId: string): Promise<void> {
		if (this.pending.has(runId)) { throw new Error('OpenIDE workspace operation is still pending.'); }
		this.active.delete(runId);
		const lease = this.leases.get(runId);
		if (lease?.kind !== 'worktree') { this.leases.delete(runId); }
		if (this.writer === runId) { this.writer = undefined; this._onDidChangeWriter.fire(undefined); }
	}

	private completed(runId: string): ISubagentWorkspaceLease {
		if (this.active.has(runId) || this.pending.has(runId)) { throw new Error('OpenIDE subagent and workspace operations must finish before changing its worktree.'); }
		const lease = this.leases.get(runId);
		if (!lease) { throw new Error('Lease inexistente.'); }
		return lease;
	}

	async apply(runId: string): Promise<void> {
		const lease = this.completed(runId);
		if (lease.kind !== 'worktree') { throw new Error('OpenIDE apply requires a completed worktree.'); }
		if (!this.backend) { throw new Error('Backend de worktree no disponible.'); }
		this.pending.add(runId);
		try { await this.backend.applyWorktree(runId); }
		finally { this.pending.delete(runId); }
	}

	async discard(runId: string): Promise<void> {
		const lease = this.completed(runId);
		if (lease.kind !== 'worktree') { throw new Error('OpenIDE discard requires a completed worktree.'); }
		if (!this.backend) { throw new Error('Backend de worktree no disponible.'); }
		this.pending.add(runId);
		try { await this.backend.discardWorktree(runId); this.leases.delete(runId); }
		finally { this.pending.delete(runId); }
	}
}
