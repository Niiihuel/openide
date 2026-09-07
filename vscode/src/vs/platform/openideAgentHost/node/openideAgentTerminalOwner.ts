/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { realpath } from 'fs/promises';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { IPtyService } from '../../terminal/common/terminal.js';
import { IOpenideAgentTerminalRegistration } from '../common/openideProcessIsolation.js';
import { OpenideSubagentWorktrees } from './openideSubagentWorktrees.js';

const owners = new Map<number, OpenideAgentTerminalOwner>();
interface IOwnedTerminal { readonly request: IOpenideAgentTerminalRegistration; readonly exited: Promise<void>; readonly resolveExit: () => void }

/** Main-process ownership survives renderer crashes; only backend-confirmed exits settle shutdown. */
export class OpenideAgentTerminalOwner {
	private readonly ready = new Map<number, number>();
	private readonly terminals = new Map<number, IOwnedTerminal>();
	private readonly listeners: IDisposable[] = [];
	private disposed = false;
	constructor(private readonly pty: IPtyService | undefined, private readonly worktrees: OpenideSubagentWorktrees) {
		if (!pty) { return; }
		this.listeners.push(pty.onProcessReady(({ id, event }) => this.ready.set(id, event.pid)));
		this.listeners.push(pty.onProcessExit(({ id }) => {
			this.ready.delete(id);
			const terminal = this.terminals.get(id);
			if (!terminal) { return; }
			this.terminals.delete(id);
			owners.delete(id);
			terminal.resolveExit();
			this.releaseListenersIfDone();
		}));
	}

	async register(request: IOpenideAgentTerminalRegistration): Promise<void> {
		if (!this.pty || this.disposed) { throw new Error('The native agent terminal owner is unavailable.'); }
		if (!Number.isSafeInteger(request.terminalId) || !Number.isSafeInteger(request.processId) || request.processId <= 0 || this.ready.get(request.terminalId) !== request.processId) { throw new Error('The terminal process identity was not confirmed by the native PTY backend.'); }
		const existing = this.terminals.get(request.terminalId);
		if (existing) {
			if (JSON.stringify(existing.request) !== JSON.stringify(request)) { throw new Error('An agent terminal cannot change its owner or workspace.'); }
			return;
		}
		if (owners.has(request.terminalId)) { throw new Error('This terminal belongs to another agent owner.'); }
		const [initial, root] = await Promise.all([realpath(await this.pty.getInitialCwd(request.terminalId)), realpath(request.workspaceRoot)]);
		if (initial !== root) { throw new Error('The terminal working directory does not match its assigned workspace.'); }
		// Record the PID before any payload can be sent. Recovery after a whole-main-process
		// crash conservatively refuses live/reused PIDs; no unverified OS PID is ever killed.
		await this.worktrees.trackShell(root, request.processId);
		if (this.disposed || this.ready.get(request.terminalId) !== request.processId || owners.has(request.terminalId)) { throw new Error('The terminal owner changed during registration.'); }
		let resolveExit!: () => void;
		const exited = new Promise<void>(resolve => { resolveExit = resolve; });
		this.terminals.set(request.terminalId, { request, exited, resolveExit });
		owners.set(request.terminalId, this);
	}

	async shutdown(conversationId?: string): Promise<void> {
		if (!this.pty) { throw new Error('The native PTY service is unavailable.'); }
		const terminals = [...this.terminals.values()].filter(terminal => conversationId === undefined || terminal.request.conversationId === conversationId);
		await Promise.all(terminals.map(async terminal => {
			await this.pty!.shutdown(terminal.request.terminalId, true);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([terminal.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The PTY backend has not confirmed process exit; worktree changes remain protected.')), 10000); })]);
			} finally { if (timer) { clearTimeout(timer); } }
		}));
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		try { await this.shutdown(); } finally { this.releaseListenersIfDone(); }
	}

	private releaseListenersIfDone(): void {
		if (this.disposed && !this.terminals.size) { for (const listener of this.listeners.splice(0)) { listener.dispose(); } }
	}
}
