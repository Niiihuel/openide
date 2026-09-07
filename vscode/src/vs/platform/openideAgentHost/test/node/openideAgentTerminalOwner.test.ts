/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Emitter } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IPtyService } from '../../../terminal/common/terminal.js';
import { IOpenideAgentTerminalRegistration } from '../../common/openideProcessIsolation.js';
import { OpenideAgentTerminalOwner } from '../../node/openideAgentTerminalOwner.js';
import { OpenideSubagentWorktrees } from '../../node/openideSubagentWorktrees.js';

suite('OpenIDE main-process terminal ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-pty-owner-')); });
	teardown(async () => { await rm(root, { recursive: true, force: true }); });
	function fixture() {
		const ready = store.add(new Emitter<{ id: number; event: { pid: number } }>());
		const exit = store.add(new Emitter<{ id: number; event: number }>());
		const killed: number[] = [], recorded: number[] = [];
		const pty = { onProcessReady: ready.event, onProcessExit: exit.event, getInitialCwd: async () => root, shutdown: async (id: number) => { killed.push(id); } } as unknown as IPtyService;
		const worktrees = { trackShell: async (_root: string, pid: number) => { recorded.push(pid); } } as unknown as OpenideSubagentWorktrees;
		const owner = new OpenideAgentTerminalOwner(pty, worktrees);
		const request: IOpenideAgentTerminalRegistration = { terminalId: 71, processId: 701, conversationId: 'child', workspaceRoot: root };
		return { ready, exit, killed, recorded, pty, worktrees, owner, request };
	}

	test('requires backend process identity and cwd, then records the shell before accepting commands', async () => {
		const f = fixture();
		try {
			await assert.rejects(f.owner.register(f.request), /identity/);
			f.ready.fire({ id: 71, event: { pid: 701 } });
			await assert.rejects(f.owner.register({ ...f.request, processId: 702 }), /identity/);
			await assert.rejects(f.owner.register({ ...f.request, workspaceRoot: tmpdir() }), /working directory/);
			await f.owner.register(f.request);
			assert.deepStrictEqual(f.recorded, [701]);
			await assert.rejects(f.owner.register({ ...f.request, conversationId: 'foreign' }), /cannot change/);
		} finally { f.exit.fire({ id: 71, event: 0 }); await f.owner.dispose(); }
	});

	test('shutdown waits for actual backend exit and renderer disposal retains its listener', async () => {
		const f = fixture();
		f.ready.fire({ id: 71, event: { pid: 701 } }); await f.owner.register(f.request);
		let settled = false;
		const disposed = f.owner.dispose().then(() => { settled = true; });
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.deepStrictEqual(f.killed, [71]);
		assert.strictEqual(settled, false);
		f.exit.fire({ id: 71, event: 0 }); await disposed;
		assert.strictEqual(settled, true);
	});

	test('another owner cannot register the same backend terminal', async () => {
		const f = fixture();
		const second = new OpenideAgentTerminalOwner(f.pty, f.worktrees);
		try {
			f.ready.fire({ id: 71, event: { pid: 701 } }); await f.owner.register(f.request);
			await assert.rejects(second.register(f.request), /another agent owner/);
		} finally { f.exit.fire({ id: 71, event: 0 }); await f.owner.dispose(); await second.dispose(); }
	});
});
