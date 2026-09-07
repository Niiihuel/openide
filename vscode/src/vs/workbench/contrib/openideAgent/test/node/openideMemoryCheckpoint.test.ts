/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ICodebaseMemoryService } from '../../browser/openideCodebaseMemoryService.js';
import { OpenideCodebaseQueryService } from '../../browser/openideCodebaseQueryService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { makeEvidence } from '../../../../../platform/openideCodebase/common/openideCodebaseMemoryTypes.js';
import { OpenideProjectMapLearningService } from '../../browser/openideProjectMapLearningService.js';
import { OpenideMemoryOwner } from '../../../../../platform/openideAgentHost/node/openideMemoryOwner.js';
import { OpenideAgentMemory } from '../../browser/openideAgentMemory.js';
import { IOpenideCheckpointMemory, OpenideMemoryCheckpoint } from '../../browser/openideMemoryCheckpoint.js';
import { AgentLoopEvent, IChatMessage } from '../../common/openideAgentTypes.js';

suite('OpenIDE durable memory checkpoints', () => {
	let root: string; let owner: OpenideMemoryOwner; let memory: OpenideAgentMemory;
	const messages: IChatMessage[] = [{ role: 'user', content: 'Use bounded retries', messageId: 'request' }, { role: 'assistant', content: 'The retry policy uses exponential backoff.' }];
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-memory-checkpoint-')); owner = new OpenideMemoryOwner(root); await owner.setWorkspace([root]); memory = { savedMessage: document => `Saved ${document.path}`, captureMode: 'automatic', request: request => owner.request(request), list: async () => (await owner.request({ action: 'list' })).documents ?? [] } as OpenideAgentMemory; });
	teardown(async () => { owner.dispose(); await rm(root, { recursive: true, force: true }); });
	test('saves with provenance and skips a completed checkpoint after restart', async () => {
		let calls = 0;
		const summarize = async () => { calls++; return JSON.stringify({ notes: [{ topic_key: 'retry/policy', body: '# Retry policy\nUse exponential backoff.', kind: 'decision' }] }); };
		await new OpenideMemoryCheckpoint(memory, 'session', 'request', summarize, () => {}).capture(messages, CancellationToken.None, 'completed');
		const documents = await memory.list(); assert.strictEqual(documents.length, 1); assert.strictEqual(documents[0].record.source_message, 'request');
		await new OpenideMemoryCheckpoint(memory, 'session', 'request', summarize, () => {}).capture(messages, CancellationToken.None, 'completed');
		assert.strictEqual(calls, 1); assert.strictEqual((await memory.list()).length, 1);
	});
	test('requires an explicit no-change reason and reports failed extraction as deferred', async () => {
		const events: AgentLoopEvent[] = [];
		await new OpenideMemoryCheckpoint(memory, 'session', 'request', async () => '{"notes":[]}', event => events.push(event)).capture(messages, CancellationToken.None, 'completed');
		assert.strictEqual((await owner.request({ action: 'checkpoint', session: 'session' })).checkpoint?.status, 'deferred'); assert.strictEqual(events.length, 1);
		await new OpenideMemoryCheckpoint(memory, 'session', 'request', async () => '{"notes":[],"reason":"No new durable fact"}', () => {}).capture(messages, CancellationToken.None, 'completed');
		assert.strictEqual((await owner.request({ action: 'checkpoint', session: 'session' })).checkpoint?.status, 'no_durable_change');
	});
	test('graph search finds a word beyond the shortened note name', async () => {
		const memory: Pick<ICodebaseMemoryService, 'onDidChange' | 'getSnapshot'> = { onDidChange: Event.None, getSnapshot: async () => ({ version: { workspaceKey: 'w', version: 1, builtAt: 0, staleCount: 0, nodeCount: 1, edgeCount: 0 }, nodes: [{ id: 'note', kind: 'note' as const, name: 'A long introductory label', uri: 'file:///repo/.openide/MEMORY.md', degree: 0, evidence: makeEvidence('authored'), documentation: 'Ordinary text '.repeat(20) + 'QuasarRecovery' }], edges: [], dirtyUris: [] }) };
		const query = new OpenideCodebaseQueryService(memory as ICodebaseMemoryService, new TestConfigurationService());
		try { assert.strictEqual((await query.search('QuasarRecovery')).data[0]?.id, 'note'); } finally { query.dispose(); }
	});
	test('a later rollback reaches entities after survived feedback and a service restart', () => {
		const storage = new InMemoryStorageService(); let learning = new OpenideProjectMapLearningService(storage);
		try {
			learning.recordContext('request', [{ id: 'node', uri: 'file:///repo/pay.ts', kind: 'function', name: 'retry', degree: 0, evidence: makeEvidence('regex') }]);
			learning.recordOutcome(['request'], 'survived'); learning.recordOutcome(['request'], 'survived');
			learning.dispose(); learning = new OpenideProjectMapLearningService(storage);
			assert.ok(learning.hasContext('request')); learning.recordOutcome(['request'], 'rollback');
			assert.strictEqual(learning.getState('file:///repo/pay.ts', 'retry'), 'contested');
		} finally { learning.dispose(); storage.dispose(); }
	});
	test('a pending candidate resumes without another extraction pass', async () => {
		await owner.request({ action: 'checkpoint', session: 'session', checkpoint: { status: 'pending', watermark: 'interrupted-watermark', message: 'original-request', transcript: 'Original work', candidates: [{ topic_key: 'retry/policy', body: 'Use bounded retries.' }] } });
		await new OpenideMemoryCheckpoint(memory, 'session', 'request', async () => { throw new Error('Must reuse durable candidates'); }, () => {}).capture(messages, CancellationToken.None, 'completed');
		const documents = await memory.list(); assert.strictEqual(documents.length, 1); assert.strictEqual(documents[0].record.source_message, 'original-request');
		assert.strictEqual((await owner.request({ action: 'checkpoint', session: 'session' })).checkpoint?.status, 'pending');
	});
	test('cancellation after extraction never creates a note or calls another model', async () => {
		const cancellation = new CancellationTokenSource(); let calls = 0;
		try {
			await new OpenideMemoryCheckpoint(memory, 'session', 'request', async () => { calls++; cancellation.cancel(); return '{"notes":[{"topic_key":"retry/policy","body":"must not save"}]}'; }, () => {}).capture(messages, cancellation.token, 'completed');
			assert.strictEqual(calls, 1); assert.strictEqual((await memory.list()).length, 0);
			assert.strictEqual((await owner.request({ action: 'checkpoint', session: 'session' })).checkpoint?.status, 'pending');
		} finally { cancellation.dispose(); }
	});
	test('retry after a later canonical update does not append an acknowledged observation twice', async () => {
		const job = { status: 'pending' as const, watermark: 'receipt-retry', message: 'original-request', transcript: 'Use bounded retries.', candidates: [{ topic_key: 'retry/policy', body: 'Use bounded retries.' }] };
		await owner.request({ action: 'checkpoint', session: 'session', checkpointId: 'job', checkpoint: job });
		const checkpoint = () => new OpenideMemoryCheckpoint(memory, 'session', 'request', async () => { throw new Error('Extraction should not repeat'); }, () => {}, undefined, 'job');
		await checkpoint().capture([], CancellationToken.None, 'background');
		const first = (await memory.list())[0];
		await owner.request({ action: 'save', id: first.record.id, expectedRevision: first.record.revision, expectedHash: first.hash, topic: first.record.topic_key, body: `${first.record.body}\n\nAlso enforce a deadline.`, operationId: 'later-request' });
		// Simulate losing the checkpoint completion receipt, while Markdown and later edits survive.
		await owner.request({ action: 'checkpoint', session: 'session', checkpointId: 'job', checkpoint: job });
		await checkpoint().capture([], CancellationToken.None, 'background');
		const current = (await memory.list())[0];
		assert.strictEqual(current.record.body, 'Use bounded retries.\n\nAlso enforce a deadline.');
		assert.strictEqual(current.record.revision, 2);
	});

	test('compaction fails closed when checkpoint persistence cannot acknowledge the delta', async () => {
		const unavailable: IOpenideCheckpointMemory = { captureMode: 'automatic', savedMessage: document => document.path, list: async () => [], request: async () => { throw new Error('Disk unavailable'); } };
		const checkpoint = new OpenideMemoryCheckpoint(unavailable, 'session', 'request', async () => '{"notes":[],"reason":"Nothing durable"}', () => {});
		await assert.rejects(checkpoint.capture(messages, CancellationToken.None, 'compaction'), /Disk unavailable/);
	});

	test('compaction preserves a new delta even when an older deferred extraction fails', async () => {
		await owner.request({ action: 'checkpoint', session: 'session', checkpointId: 'inline', checkpoint: { status: 'deferred', watermark: 'older', transcript: 'Older work.' } });
		const checkpoint = new OpenideMemoryCheckpoint(memory, 'session', 'request', async () => { throw new Error('Provider unavailable'); }, () => {}, undefined, 'inline');
		const delta = (await checkpoint.pendingDelta(messages))!;
		await checkpoint.capture(messages, CancellationToken.None, 'compaction');
		const jobs = (await owner.request({ action: 'checkpoint-list', session: 'session' })).checkpoints!;
		assert.deepStrictEqual(new Set(jobs.map(job => job.state.watermark)), new Set(['older', delta.watermark]));
	});

	test('malformed candidates are not persisted and a later extraction can recover', async () => {
		let calls = 0;
		const checkpoint = new OpenideMemoryCheckpoint(memory, 'session', 'request', async () => ++calls === 1 ? '{"notes":[{"topic_key":"retry/policy","body":"Use retries.","kind":"invalid"}]}' : '{"notes":[{"topic_key":"retry/policy","body":"Use retries.","kind":"decision"}]}', () => {});
		await checkpoint.capture(messages, CancellationToken.None, 'completed');
		assert.strictEqual((await owner.request({ action: 'checkpoint', session: 'session' })).checkpoint?.candidates, undefined);
		await checkpoint.capture(messages, CancellationToken.None, 'completed');
		assert.strictEqual(calls, 2); assert.strictEqual((await memory.list()).length, 1);
	});

	test('cancellation during canonical listing does not start extraction', async () => {
		const cancellation = new CancellationTokenSource(); let calls = 0;
		const canceling: IOpenideCheckpointMemory = { captureMode: 'automatic', request: request => memory.request(request), savedMessage: document => document.path, list: async () => { cancellation.cancel(); return []; } };
		try {
			await new OpenideMemoryCheckpoint(canceling, 'session', 'request', async () => { calls++; return '{"notes":[],"reason":"No change"}'; }, () => {}).capture(messages, cancellation.token, 'completed');
			assert.strictEqual(calls, 0);
			assert.strictEqual((await owner.request({ action: 'checkpoint', session: 'session' })).checkpoint?.status, 'pending');
		} finally { cancellation.dispose(); }
	});

});
