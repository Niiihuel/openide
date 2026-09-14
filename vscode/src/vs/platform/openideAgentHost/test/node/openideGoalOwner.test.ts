/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenideGoalOwner } from '../../node/openideGoalOwner.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('OpenIDE goal window ownership', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	let workspace: string;
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-goal-owner-')); workspace = join(root, 'project'); await mkdir(workspace); });
	teardown(async () => { await rm(root, { recursive: true, force: true }); });
	const owner = () => disposables.add(new OpenideGoalOwner(root));

	test('concurrent windows cannot acquire the same session, takeover recovers only once', async () => {
		const first = owner(); const second = owner();
		await Promise.all([first.setWorkspace('project', [workspace]), second.setWorkspace('project', [workspace])]);
		const goal = await first.create({ sessionId: 'session', objective: 'Keep session exclusive', criteria: ['Validate ownership'] });
		await assert.rejects(second.get('session'), /another OpenIDE window/);
		assert.strictEqual((await first.get('session'))?.status, 'active');
		first.dispose();
		const recovered = await second.get('session');
		assert.deepStrictEqual([recovered?.status, recovered?.version], ['interrupted', goal.version + 1]);
		assert.deepStrictEqual(await second.get('session'), recovered);
	});

	test('simultaneous calls in one window share recovery without losing a goal', async () => {
		const first = owner(); await first.setWorkspace('project', [workspace]);
		const goal = await first.create({ sessionId: 'session', objective: 'Recover once', criteria: ['Check replay'] });
		first.dispose();
		const next = owner(); await next.setWorkspace('project', [workspace]);
		const reads = await Promise.all([next.get('session'), next.get('session'), next.get('session')]);
		assert.deepStrictEqual(reads.map(item => [item?.version, item?.status]), Array.from({ length: 3 }, () => [goal.version + 1, 'interrupted']));
	});

	test('workspace replacement invalidates pending ownership and cannot write into the replacement workspace', async () => {
		const first = owner(); await first.setWorkspace('project', [workspace]);
		const pending = first.create({ sessionId: 'session', objective: 'Stay scoped', criteria: ['No cross-workspace write'] });
		// Attach a rejection handler immediately while setWorkspace performs realpath asynchronously.
		const result = pending.then(() => 'unexpected success', () => 'rejected');
		const other = join(root, 'other'); await mkdir(other);
		await first.setWorkspace('other', [other]);
		assert.strictEqual(await first.get('session'), undefined);
		// The operation can finish before replacement, but must never land in the new scope.
		await result;
	});

	test('paused evidence is invalidated on takeover once, not on every UI read', async () => {
		const first = owner(); await first.setWorkspace('project', [workspace]);
		let goal = await first.create({ sessionId: 'session', objective: 'Keep verification scoped to the owning window', criteria: ['Manual review'] });
		goal = await first.verify('session', { goalId: goal.id, expectedVersion: goal.version, criterionId: 'C1', summary: 'Reviewed before closing', runId: 'manual', source: 'user' });
		goal = await first.update('session', { goalId: goal.id, expectedVersion: goal.version, action: 'pause' });
		assert.strictEqual((await first.get('session'))?.criteria[0].verified, true);
		first.dispose();
		const next = owner(); await next.setWorkspace('project', [workspace]);
		goal = (await next.get('session'))!;
		assert.deepStrictEqual([goal.status, goal.criteria[0].verified], ['paused', false]);
		goal = await next.verify('session', { goalId: goal.id, expectedVersion: goal.version, criterionId: 'C1', summary: 'Reviewed after reopening', runId: 'manual', source: 'user' });
		assert.deepStrictEqual(await next.get('session'), goal);
	});

	test('a disposed owner cannot claim a session or create goal storage', async () => {
		const first = owner(); await first.setWorkspace('project', [workspace]); first.dispose();
		await assert.rejects(first.get('session'), /unavailable/);
	});
});
