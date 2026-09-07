/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { OpenideMemoryOwner } from '../../../../../platform/openideAgentHost/node/openideMemoryOwner.js';
import { IOpenideMemoryCheckpointState } from '../../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { OpenideMemoryCaptureQueue } from '../../browser/openideMemoryCaptureQueue.js';
import { IOpenideCheckpointMemory } from '../../browser/openideMemoryCheckpoint.js';

function gate() { let open!: () => void; return { promise: new Promise<void>(resolve => { open = resolve; }), open: () => open() }; }
const pending = (watermark: string): IOpenideMemoryCheckpointState => ({ watermark, status: 'pending', transcript: 'A durable project decision.' });

suite('OpenIDE background memory capture queue', () => {
	let root: string; let owner: OpenideMemoryOwner; let memory: IOpenideCheckpointMemory; let queue: OpenideMemoryCaptureQueue;
	setup(async () => {
		root = await mkdtemp(join(tmpdir(), 'openide-memory-queue-')); owner = new OpenideMemoryOwner(root); await owner.setWorkspace([root]); queue = new OpenideMemoryCaptureQueue();
		memory = { captureMode: 'automatic', request: request => owner.request(request), list: async () => (await owner.request({ action: 'list' })).documents ?? [], savedMessage: document => document.path };
	});
	teardown(async () => { queue.dispose(); owner.dispose(); await rm(root, { recursive: true, force: true }); });
	const unused = () => ({ capture: async () => { throw new Error('Capture should not run.'); } });
	const finish = (session: string) => (id: string, state: IOpenideMemoryCheckpointState) => ({ capture: async () => { await memory.request({ action: 'checkpoint', session, checkpointId: id, checkpoint: { ...state, status: 'saved' } }); } });

	test('enqueue acknowledges only after durable persistence and survives owner restart', async () => {
		const writing = gate(); const release = gate(); let acknowledged = false;
		const delayed: IOpenideCheckpointMemory = { ...memory, request: async request => {
			if (request.action === 'checkpoint' && request.checkpoint) { writing.open(); await release.promise; }
			return memory.request(request);
		} };
		const enqueued = queue.enqueue(delayed, 'chat', pending('one'), unused, false).then(value => { acknowledged = true; return value; });
		await writing.promise; assert.strictEqual(acknowledged, false); release.open(); assert.strictEqual(await enqueued, true);
		owner.dispose(); owner = new OpenideMemoryOwner(root); await owner.setWorkspace([root]);
		assert.strictEqual((await owner.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.[0].id, 'one');
	});

	test('concurrent duplicate enqueue cannot overwrite completed or pending capture', async () => {
		let writes = 0;
		const counted: IOpenideCheckpointMemory = { ...memory, request: async request => { if (request.checkpoint) { writes++; } return memory.request(request); } };
		await Promise.all([queue.enqueue(counted, 'chat', pending('one'), unused, false), queue.enqueue(counted, 'chat', pending('one'), unused, false)]);
		assert.strictEqual(writes, 1);
		await finish('chat')('one', pending('one')).capture();
		assert.strictEqual(await queue.enqueue(counted, 'chat', pending('one'), unused, false), false);
		assert.strictEqual(writes, 1);
	});

	test('different conversations drain independently', async () => {
		const started = gate(); const release = gate();
		await queue.enqueue(memory, 'slow', pending('one'), (id, state) => ({ capture: async () => { started.open(); await release.promise; await finish('slow')(id, state).capture(); } }));
		await started.promise;
		await queue.enqueue(memory, 'fast', pending('two'), finish('fast'));
		assert.strictEqual(await queue.resume(memory, 'fast', finish('fast'), 1000), false);
		assert.strictEqual((await memory.request({ action: 'checkpoint-list', session: 'slow' })).checkpoints?.length, 1);
		release.open(); assert.strictEqual(await queue.resume(memory, 'slow', finish('slow'), 1000), false);
	});

	test('a deferred job remains pending without spinning and retries on resume', async () => {
		let attempts = 0;
		const factory = (id: string, state: IOpenideMemoryCheckpointState) => ({ capture: async () => {
			attempts++;
			await memory.request({ action: 'checkpoint', session: 'chat', checkpointId: id, checkpoint: { ...state, status: attempts === 1 ? 'deferred' : 'saved' } });
		} });
		await queue.enqueue(memory, 'chat', pending('one'), factory, false);
		assert.strictEqual(await queue.resume(memory, 'chat', factory, 1000), true);
		assert.strictEqual(attempts, 1);
		assert.strictEqual(await queue.resume(memory, 'chat', factory, 1000), false);
		assert.strictEqual(attempts, 2);
	});

	test('reset cancels active capture but retains durable work for recovery', async () => {
		const started = gate(); const release = gate(); const finished = gate(); let canceled = false;
		await queue.enqueue(memory, 'chat', pending('one'), (_id, _state, token) => ({ capture: async () => { started.open(); await release.promise; canceled = token.isCancellationRequested; finished.open(); } }));
		await started.promise; queue.reset(); release.open(); await finished.promise;
		assert.strictEqual(canceled, true);
		assert.strictEqual((await memory.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.length, 1);
		assert.strictEqual(await queue.resume(memory, 'chat', finish('chat'), 1000), false);
	});

	test('reset during persistence retains the job without launching it in the new generation', async () => {
		const writing = gate(); const release = gate(); let captures = 0;
		const delayed: IOpenideCheckpointMemory = { ...memory, request: async request => {
			if (request.checkpoint) { writing.open(); await release.promise; }
			return memory.request(request);
		} };
		const enqueued = queue.enqueue(delayed, 'chat', pending('one'), () => ({ capture: async () => { captures++; } }));
		await writing.promise; queue.reset(); release.open();
		assert.strictEqual(await enqueued, true);
		assert.strictEqual(captures, 0);
		assert.strictEqual((await memory.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.length, 1);
		assert.strictEqual(await queue.resume(memory, 'chat', finish('chat'), 1000), false);
	});

	test('next turn barrier times out while capture continues to a durable completion', async () => {
		const started = gate(); const release = gate();
		await queue.enqueue(memory, 'chat', pending('one'), (id, state) => ({ capture: async () => { started.open(); await release.promise; await finish('chat')(id, state).capture(); } }));
		await started.promise;
		assert.strictEqual(await queue.resume(memory, 'chat', finish('chat'), 1), true);
		release.open(); assert.strictEqual(await queue.resume(memory, 'chat', finish('chat'), 1000), false);
	});

	test('enqueue during the final empty scan wakes the same conversation drain', async () => {
		const scannedEmpty = gate(); const release = gate(); let lists = 0;
		const racing: IOpenideCheckpointMemory = { ...memory, request: async request => {
			const response = await memory.request(request);
			if (request.action === 'checkpoint-list' && ++lists === 2) { scannedEmpty.open(); await release.promise; }
			return response;
		} };
		await queue.enqueue(racing, 'chat', pending('one'), finish('chat'));
		await scannedEmpty.promise;
		await queue.enqueue(racing, 'chat', pending('two'), finish('chat'));
		release.open();
		assert.strictEqual(await queue.resume(racing, 'chat', finish('chat'), 1000), false);
		assert.strictEqual((await memory.request({ action: 'checkpoint', session: 'chat', checkpointId: 'two' })).checkpoint?.status, 'saved');
	});

	test('a throwing capture leaves its job pending and does not starve another job', async () => {
		await queue.enqueue(memory, 'chat', pending('one'), unused, false);
		await queue.enqueue(memory, 'chat', pending('two'), unused, false);
		let failed = 0;
		assert.strictEqual(await queue.resume(memory, 'chat', (id, state) => ({ capture: async () => {
			if (id === 'one') { failed++; throw new Error('Provider unavailable'); }
			await finish('chat')(id, state).capture();
		} }), 1000), true);
		assert.strictEqual(failed, 1);
		assert.deepStrictEqual((await memory.request({ action: 'checkpoint-list', session: 'chat' })).checkpoints?.map(job => job.id), ['one']);
	});
});
