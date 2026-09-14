/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { spawn } from 'child_process';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { IOpenideGoal } from '../../common/openideGoal.js';
import { OpenideGoalStore } from '../../node/openideGoalStore.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('OpenIDE durable goals (real disk)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	let store: OpenideGoalStore;
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-goal-')); store = new OpenideGoalStore(root); });
	teardown(async () => { await rm(root, { recursive: true, force: true }); });
	const version = (goal: IOpenideGoal) => ({ goalId: goal.id, expectedVersion: goal.version });
	const create = () => store.create({ sessionId: 'session', objective: 'Repair the failing integration', criteria: [{ text: 'Regression test passes', command: 'npm test' }], maxTurns: 2 });

	test('snapshots create input, survives reopening, and protects unfinished session ownership', async () => {
		const request = { sessionId: 'session', objective: 'Original goal', criteria: ['Original criterion'] };
		const pending = store.create(request);
		request.criteria[0] = 'mutated'; request.objective = 'mutated';
		const goal = await pending;
		assert.deepStrictEqual(await new OpenideGoalStore(root).get('session'), goal);
		assert.deepStrictEqual([goal.objective, goal.criteria[0].text], ['Original goal', 'Original criterion']);
		await assert.rejects(create(), /unfinished/);
		await assert.rejects(store.update('other-session', { ...version(goal), action: 'cancel' }), /changed/);
	});

	test('serializes CAS across store instances; stale updates cannot overwrite accepted reports', async () => {
		const goal = await create();
		const second = new OpenideGoalStore(root);
		const results = await Promise.allSettled([store.update('session', { ...version(goal), action: 'report', text: 'First' }), second.update('session', { ...version(goal), action: 'report', text: 'Second' })]);
		assert.deepStrictEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
		const current = (await store.get('session'))!;
		assert.deepStrictEqual([current.version, current.reports.length], [2, 1]);
	});

	test('requires verified current criteria and a report; a new turn invalidates prior evidence', async () => {
		let goal = await create();
		await assert.rejects(store.update('session', { ...version(goal), action: 'complete' }), /verified criteria/);
		goal = await store.update('session', { ...version(goal), action: 'startTurn', runId: 'run-1' });
		goal = await store.verify('session', { ...version(goal), criterionId: 'C1', summary: 'Test succeeded', runId: 'run-1', source: 'verifier', command: 'npm test', workspaceVersion: 1 });
		await assert.rejects(store.update('session', { ...version(goal), action: 'complete' }), /report/);
		goal = await store.update('session', { ...version(goal), action: 'report', text: 'Regression suite passed' });
		goal = await store.update('session', { ...version(goal), action: 'startTurn', runId: 'run-2' });
		assert.deepStrictEqual([goal.criteria[0].verified, goal.criteria[0].evidenceIds, goal.evidence.length], [false, [], 1]);
		await assert.rejects(store.verify('session', { ...version(goal), criterionId: 'C1', summary: 'Old result', runId: 'run-1', source: 'verifier', command: 'npm test' }), /current turn/);
		goal = await store.verify('session', { ...version(goal), criterionId: 'C1', summary: 'Current test succeeded', runId: 'run-2', source: 'verifier', command: 'npm test' });
		await assert.rejects(store.update('session', { ...version(goal), action: 'complete' }), /report/);
		goal = await store.update('session', { ...version(goal), action: 'report', text: 'Final regression suite passed again' });
		goal = await store.update('session', { ...version(goal), action: 'complete' });
		await assert.rejects(store.update('session', { ...version(goal), action: 'resume' }), /finished/);
		assert.strictEqual((await store.get('session'))?.status, 'completed');
	});

	test('bounds turns durably, requires explicit increased budget to resume, and preserves goal history', async () => {
		let goal = await create();
		goal = await store.update('session', { ...version(goal), action: 'startTurn', runId: 'run-1' });
		goal = await store.update('session', { ...version(goal), action: 'startTurn', runId: 'run-2' });
		goal = await store.update('session', { ...version(goal), action: 'startTurn', runId: 'run-3' });
		assert.deepStrictEqual([goal.turns, goal.status, goal.runIds], [2, 'limit_reached', ['run-1', 'run-2']]);
		await assert.rejects(store.update('session', { ...version(goal), action: 'resume' }), /Increase/);
		goal = await store.update('session', { ...version(goal), action: 'resume', maxTurns: 3 });
		goal = await store.update('session', { ...version(goal), action: 'cancel' });
		const next = await create();
		assert.deepStrictEqual((await store.list()).map(item => item.id), [goal.id, next.id]);
	});

	test('contract revision requires pause and invalidates evidence, external changes also invalidate', async () => {
		let goal = await create();
		await assert.rejects(store.update('session', { ...version(goal), action: 'revise', objective: 'New', criteria: ['New'] }), /Pause/);
		goal = await store.verify('session', { ...version(goal), criterionId: 'C1', summary: 'Reviewed by user', runId: 'manual', source: 'user' });
		goal = await store.update('session', { ...version(goal), action: 'invalidate', reason: 'Workspace changed' });
		assert.strictEqual(goal.criteria[0].verified, false);
		goal = await store.update('session', { ...version(goal), action: 'pause' });
		goal = await store.update('session', { ...version(goal), action: 'revise', objective: 'New contract', criteria: ['New criterion'] });
		assert.deepStrictEqual([goal.revision, goal.criteria[0].verified, goal.evidence.length], [2, false, 0]);
	});

	test('recovers a torn tail but fails closed on complete corruption', async () => {
		const goal = await create();
		const file = join(root, (await readdir(root))[0]);
		await appendFile(file, '{"partial":');
		assert.deepStrictEqual(await store.get('session'), goal);
		const durable = await readFile(file, 'utf8');
		await writeFile(file, durable.replace('Repair the failing integration', 'Tampered objective'));
		await assert.rejects(store.update('session', { ...version(goal), action: 'cancel' }), /corrupt/);
	});

	test('reopening paused or blocked goals invalidates earlier command evidence without changing their lifecycle', async () => {
		for (const status of ['paused', 'blocked'] as const) {
			const sessionId = `session-${status}`;
			let goal = await store.create({ sessionId, objective: 'Verify current files and review manually', criteria: [{ text: 'Command passes', command: 'npm test' }, 'Manual review'] });
			goal = await store.update(sessionId, { ...version(goal), action: 'startTurn', runId: `run-${status}` });
			goal = await store.verify(sessionId, { ...version(goal), criterionId: 'C1', summary: 'Old disk contents passed', runId: `run-${status}`, source: 'verifier', command: 'npm test' });
			goal = await store.update(sessionId, { ...version(goal), action: 'report', text: 'Command passed; manual criterion remains' });
			goal = await store.update(sessionId, status === 'paused' ? { ...version(goal), action: 'pause' } : { ...version(goal), action: 'block', reason: 'Awaiting manual review' });
			const reopened = new OpenideGoalStore(root);
			const recovered = (await reopened.recover(sessionId))!;
			assert.deepStrictEqual([recovered.status, recovered.criteria.map(item => item.verified), recovered.evidence.length, recovered.version], [status, [false, false], 1, goal.version + 1]);
			assert.match(recovered.reason, /workspace may have changed/);
			assert.deepStrictEqual(await reopened.recover(sessionId), recovered);
			const reviewed = await reopened.verify(sessionId, { ...version(recovered), criterionId: 'C2', summary: 'User reviewed the current UI', runId: 'manual', source: 'user' });
			await assert.rejects(reopened.update(sessionId, { ...version(reviewed), action: 'complete' }), /verified criteria/);
			assert.strictEqual((await reopened.get(sessionId))?.criteria[1].verified, true);
		}
	});

	test('recovery does not rewrite completed or cancelled goals', async () => {
		for (const status of ['completed', 'cancelled'] as const) {
			const sessionId = `terminal-${status}`;
			let goal = await store.create({ sessionId, objective: 'Already finished goal', criteria: ['Manual review'] });
			goal = await store.verify(sessionId, { ...version(goal), criterionId: 'C1', summary: 'User accepted this result', runId: 'manual', source: 'user' });
			goal = await store.update(sessionId, { ...version(goal), action: 'report', text: 'Final review report' });
			goal = await store.update(sessionId, { ...version(goal), action: status === 'completed' ? 'complete' : 'cancel' });
			assert.deepStrictEqual(await new OpenideGoalStore(root).recover(sessionId), goal);
		}
	});

	test('SIGKILL recovery records interruption once and never starts another turn', async function () {
		if (process.platform === 'win32') { this.skip(); }
		this.timeout(15000);
		const moduleUrl = new URL('../../node/openideGoalStore.js', import.meta.url).href;
		const code = `import { OpenideGoalStore } from ${JSON.stringify(moduleUrl)};
const store = new OpenideGoalStore(${JSON.stringify(root)});
const goal = await store.create({sessionId:'session',objective:'Survive crash',criteria:['Verify recovery']});
await store.update('session',{goalId:goal.id,expectedVersion:goal.version,action:'startTurn',runId:'run-1'});
process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`;
		const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stderr = '';
		child.stderr.on('data', chunk => { stderr += chunk; });
		const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()); });
		try {
			await Promise.race([new Promise<void>(resolve => child.stdout.once('data', () => resolve())), exited.then(() => { throw new Error(`child exited: ${stderr}`); })]);
			child.kill('SIGKILL'); await exited;
			const recovered = (await store.recover('session'))!;
			assert.deepStrictEqual([recovered.status, recovered.turns, recovered.runIds, recovered.version], ['interrupted', 1, ['run-1'], 3]);
			assert.deepStrictEqual(await store.recover('session'), recovered);
			await assert.rejects(store.update('session', { ...version(recovered), action: 'startTurn', runId: 'run-2' }), /active/);
		} finally { if (child.exitCode === null) { child.kill('SIGKILL'); } await exited; }
	});
});
