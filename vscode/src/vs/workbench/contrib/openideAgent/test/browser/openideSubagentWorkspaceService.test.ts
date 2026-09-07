/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SubagentWorkspaceService } from '../../browser/openideSubagentWorkspaceService.js';

suite('OpenIDE subagent worktree lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.file('/project');
	const worktree = URI.file('/isolated');

	function fixture() {
		const service = store.add(new SubagentWorkspaceService());
		const calls: string[] = [];
		service.setBackend({
			createWorktree: async (id, requestedRoot) => { assert.strictEqual(requestedRoot, root); calls.push(`create:${id}`); return worktree; },
			applyWorktree: async id => { calls.push(`apply:${id}`); },
			discardWorktree: async id => { calls.push(`discard:${id}`); },
		});
		return { service, calls };
	}

	test('a worktree becomes reviewable only after release; apply retains it for explicit cleanup', async () => {
		const { service, calls } = fixture();
		const lease = await service.acquire('child', root, false, true);
		assert.strictEqual(lease.kind, 'worktree');
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
		await assert.rejects(service.apply('child'), /must finish/);
		await assert.rejects(service.discard('child'), /must finish/);
		assert.deepStrictEqual(calls, ['create:child']);
		await service.release('child');
		assert.deepStrictEqual(service.getCompletedWorktrees(), [lease]);
		await service.apply('child');
		assert.deepStrictEqual(service.getCompletedWorktrees(), [lease]);
		await service.discard('child');
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
		assert.deepStrictEqual(calls, ['create:child', 'apply:child', 'discard:child']);
	});

	test('requested worktrees never fall back after missing backend or creation failure', async () => {
		const service = store.add(new SubagentWorkspaceService());
		const writers: Array<string | undefined> = [];
		store.add(service.onDidChangeWriter(value => writers.push(value)));
		await assert.rejects(service.acquire('child', root, false, true), /backend unavailable/);
		service.setBackend({ createWorktree: async () => { throw new Error('git failed'); }, applyWorktree: async () => {}, discardWorktree: async () => {} });
		await assert.rejects(service.acquire('child', root, false, true), /git failed/);
		assert.deepStrictEqual(writers, []);
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
		assert.strictEqual((await service.acquire('child', root, false, false)).kind, 'single-writer');
		await service.release('child');
		assert.deepStrictEqual(writers, ['child', undefined]);
	});

	test('reserves a run while creation is pending and rejects early release or adoption', async () => {
		const service = store.add(new SubagentWorkspaceService());
		const created = new DeferredPromise<URI>();
		let calls = 0;
		service.setBackend({ createWorktree: () => { calls++; return created.p; }, applyWorktree: async () => {}, discardWorktree: async () => {} });
		const acquiring = service.acquire('child', root, false, true);
		await assert.rejects(service.acquire('child', root, false, true), /already owns/);
		await assert.rejects(service.release('child'), /pending/);
		assert.throws(() => service.adoptCompletedWorktree('child', worktree), /already attached/);
		assert.strictEqual(calls, 1);
		await created.complete(worktree);
		await acquiring;
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
		await service.release('child');
		assert.strictEqual(service.getCompletedWorktrees().length, 1);
	});

	test('apply and discard cannot race; a failed apply preserves the recovered worktree', async () => {
		const service = store.add(new SubagentWorkspaceService());
		const applied = new DeferredPromise<void>();
		let discards = 0;
		service.setBackend({ createWorktree: async () => worktree, applyWorktree: () => applied.p, discardWorktree: async () => { discards++; } });
		service.adoptCompletedWorktree('recovered', worktree);
		const applying = service.apply('recovered');
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
		await assert.rejects(service.discard('recovered'), /must finish/);
		await assert.rejects(service.apply('recovered'), /must finish/);
		await assert.rejects(service.release('recovered'), /pending/);
		await applied.error(new Error('conflict'));
		await assert.rejects(applying, /conflict/);
		assert.strictEqual(service.getCompletedWorktrees().length, 1);
		await service.discard('recovered');
		assert.strictEqual(discards, 1);
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
	});

	test('recovery preserves a lease on missing backend or failed cleanup and can retry', async () => {
		const service = store.add(new SubagentWorkspaceService());
		service.adoptCompletedWorktree('recovered', worktree);
		assert.throws(() => service.adoptCompletedWorktree('recovered', worktree), /already attached/);
		await assert.rejects(service.discard('recovered'), /no disponible/);
		service.setBackend({ createWorktree: async () => worktree, applyWorktree: async () => {}, discardWorktree: async () => { throw new Error('cleanup failed'); } });
		await assert.rejects(service.discard('recovered'), /cleanup failed/);
		assert.strictEqual(service.getCompletedWorktrees().length, 1);
		service.setBackend({ createWorktree: async () => worktree, applyWorktree: async () => {}, discardWorktree: async () => {} });
		await service.discard('recovered');
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
	});

	test('readonly leases and explicitly shared writers do not masquerade as completed worktrees', async () => {
		const { service, calls } = fixture();
		assert.strictEqual((await service.acquire('reader', root, true, true)).kind, 'readonly-shared');
		await service.acquire('writer', root, false, false);
		await assert.rejects(service.acquire('another-writer', root, false, false), /ya posee/);
		await assert.rejects(service.apply('writer'), /requires a completed worktree/);
		assert.deepStrictEqual(service.getCompletedWorktrees(), []);
		await service.release('reader'); await service.release('writer');
		assert.deepStrictEqual(calls, []);
	});
});
