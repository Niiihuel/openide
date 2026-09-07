/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IOpenideRunJournal, isOpenideRunJournalError, OPENIDE_UNKNOWN_TOOL_OUTCOME, reconstructOpenideJournalRequest } from '../../../../../platform/openideAgentHost/common/openideRunJournal.js';
import { OpenideRunJournalStore } from '../../../../../platform/openideAgentHost/node/openideRunJournalStore.js';
import { IChatMessage, ILLMProvider, IProviderRequest } from '../../common/openideAgentTypes.js';
import { OpenideContextCompactor } from '../../common/openideContextCompactor.js';
import { OpenideProviderStream } from '../../common/openideProviderStream.js';
import { applyOpenideJournalRecovery, reconstructOpenideJournalMessages } from '../../common/openideRunJournal.js';
import { runOpenideTurn } from '../../common/openideTurnRuntime.js';

suite('OpenIDE journal runtime composition (real disk)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	setup(async () => { root = await mkdtemp(join(tmpdir(), 'openide-runtime-journal-')); });
	teardown(async () => { await rm(root, { recursive: true, force: true }); });
	const provider: Omit<IProviderRequest, 'messages'> = { model: 'scripted', providerId: 'test', credential: { kind: 'apiKey', value: 'never-store-this-credential' }, extraHeaders: { Authorization: 'never-store-this-header' }, system: 'stable system', tools: [] };

	test('request reconstruction includes retrieved context and excludes transport credentials across retry', async () => {
		const store = new OpenideRunJournalStore(root);
		const journal: IOpenideRunJournal = { append: event => store.append('session', event) };
		const requests: IProviderRequest[] = [];
		const stream = new OpenideProviderStream({ staleTimeoutSeconds: () => 0, wait: async () => {}, random: () => 0 });
		const adapter: ILLMProvider = { id: 'scripted', streamChat: async request => {
			requests.push(structuredClone(request));
			if (requests.length === 1) { throw new Error('HTTP 503 Service Unavailable'); }
			return { message: { role: 'assistant', content: 'done' } };
		} };
		const messages: IChatMessage[] = [{ role: 'user', content: 'task' }];
		await runOpenideTurn({ messages, provider, token: CancellationToken.None, onEvent: () => {}, maxIterations: 3, runtimeContext: 'retrieved source', runId: 'run' }, {
			journal, stream: (request, emit, context) => stream.stream(adapter, request, emit, CancellationToken.None, () => {}, context), compact: async () => false,
			executeTools: async () => false, enrichUsage: () => ({ type: 'usage' }), planDraft: () => {}, stop: () => {},
		});
		const records = await new OpenideRunJournalStore(root).read('session');
		const attempts = records.filter(record => record.event.kind === 'model/request' && record.event.payload['phase'] === 'attempt');
		assert.strictEqual(attempts.length, 2);
		for (const record of attempts) {
			const envelope = reconstructOpenideJournalRequest(records, record.seq) as unknown as { messages: IChatMessage[] };
			assert.deepStrictEqual(envelope.messages, requests[0].messages);
			assert.strictEqual(envelope.messages[0].content, 'task\n\nretrieved source');
		}
		assert.ok(!JSON.stringify(records).includes('never-store-this'));
		assert.strictEqual(records.filter(record => record.event.kind === 'model/retry').length, 1);
		assert.deepStrictEqual(reconstructOpenideJournalMessages(records), messages);
	});

	test('a rejected tool checkpoint prevents the real filesystem effect', async () => {
		const store = new OpenideRunJournalStore(root, { records: 3 });
		const messages: IChatMessage[] = [{ role: 'user', content: 'write' }];
		let effects = 0;
		await assert.rejects(runOpenideTurn({ messages, provider, token: CancellationToken.None, onEvent: () => {}, maxIterations: 2, runId: 'run' }, {
			journal: { append: event => store.append('session', event) },
			stream: async () => ({ message: { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'write_file', argumentsJson: '{}' }] } }),
			compact: async () => false, executeTools: async () => { effects++; await writeFile(join(root, 'effect'), 'unsafe'); return false; },
			enrichUsage: () => ({ type: 'usage' }), planDraft: () => {}, stop: () => {},
		}), /capacity/);
		assert.strictEqual(effects, 0);
		await assert.rejects(readFile(join(root, 'effect')), { code: 'ENOENT' });
	});

	test('a journal error mentioning a provider outage never retries a model request', async () => {
		let requests = 0;
		const stream = new OpenideProviderStream({ staleTimeoutSeconds: () => 0, wait: async () => {} });
		const adapter: ILLMProvider = { id: 'scripted', streamChat: async () => { requests++; return { message: { role: 'assistant', content: 'done' } }; } };
		await assert.rejects(stream.stream(adapter, { ...provider, messages: [] }, () => {}, CancellationToken.None, () => {}, {
			runId: 'run', journal: { append: async () => { throw new Error('HTTP 503 network checkpoint unavailable'); } },
		}), isOpenideRunJournalError);
		assert.strictEqual(requests, 0);
	});

	test('a failed final checkpoint never publishes a successful terminal event', async () => {
		const events: string[] = [];
		await assert.rejects(runOpenideTurn({ messages: [{ role: 'user', content: 'task' }], provider, token: CancellationToken.None, onEvent: event => events.push(event.type), maxIterations: 2 }, {
			journal: { append: async event => { if (event.kind === 'run/end') { throw new Error('final checkpoint failed'); } } },
			stream: async () => ({ message: { role: 'assistant', content: 'done' } }), compact: async () => false, executeTools: async () => false,
			enrichUsage: () => ({ type: 'usage' }), planDraft: () => {}, stop: () => {},
		}), isOpenideRunJournalError);
		assert.ok(!events.includes('done'));
	});

	test('missing UI assistant preserves a newer prompt and adds uncertainty once', async () => {
		const store = new OpenideRunJournalStore(root);
		await store.append('session', { kind: 'tool/intent', runId: 'old-run', payload: { operationId: '0:call', callId: 'call', name: 'write_file', argumentsJson: '{"path":"file.txt"}' } });
		const records = await store.recover('session');
		const current: IChatMessage = { role: 'user', content: 'A newer instruction', messageId: 'new-user' };
		const messages = [current];
		assert.strictEqual(applyOpenideJournalRecovery(messages, records), 1);
		assert.strictEqual(messages.at(-1), current);
		assert.ok(messages[0].hidden);
		assert.ok(messages[0].content.includes(OPENIDE_UNKNOWN_TOOL_OUTCOME));
		assert.strictEqual(applyOpenideJournalRecovery(messages, records), 0);
		assert.strictEqual(messages.length, 2);
	});

	test('effect followed by failure recovers an unknown result without running it again', async () => {
		const store = new OpenideRunJournalStore(root);
		const messages: IChatMessage[] = [{ role: 'user', content: 'write' }];
		let effects = 0;
		await assert.rejects(runOpenideTurn({ messages, provider, token: CancellationToken.None, onEvent: () => {}, maxIterations: 2, runId: 'run' }, {
			journal: { append: event => store.append('session', event) },
			stream: async () => ({ message: { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'write_file', argumentsJson: '{}' }] } }),
			compact: async () => false, executeTools: async () => { effects++; await writeFile(join(root, 'effect'), 'once'); throw new Error('lost result'); },
			enrichUsage: () => ({ type: 'usage' }), planDraft: () => {}, stop: () => {},
		}), /lost result/);
		const records = await new OpenideRunJournalStore(root).recover('session');
		const recovered = reconstructOpenideJournalMessages(records)!;
		assert.strictEqual(recovered.at(-1)?.content, OPENIDE_UNKNOWN_TOOL_OUTCOME);
		assert.strictEqual(effects, 1);
		assert.strictEqual(await readFile(join(root, 'effect'), 'utf8'), 'once');
	});

	test('compaction preserves original history on disk and rejects a changed projection', async () => {
		const store = new OpenideRunJournalStore(root);
		const messages: IChatMessage[] = Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Message ${index} ${'source detail '.repeat(200)}` }));
		const before = structuredClone(messages);
		const compactor = new OpenideContextCompactor();
		const adapter: ILLMProvider = { id: 'scripted', streamChat: async () => ({ message: { role: 'assistant', content: 'Goal: continue the task. Completed: read the source. Pending: finish the tests. Decisions: preserve original history and user edits.' } }) };
		const stream = new OpenideProviderStream({ staleTimeoutSeconds: () => 0 });
		const request = { messages, runtime: { adapter, credential: provider.credential, model: provider.model }, token: CancellationToken.None, onEvent: () => {}, system: '', toolDefs: [], contextLimit: 10000, origin: 'manual' as const, journal: { journal: { append: (event: Parameters<IOpenideRunJournal['append']>[0]) => store.append('session', event) }, runId: 'run' } };
		assert.strictEqual(await compactor.compact(request, { stream: (...args) => stream.stream(...args), auxiliary: async () => undefined }), true);
		assert.ok(messages.length < before.length);
		const records = await new OpenideRunJournalStore(root).read('session');
		assert.deepStrictEqual(records.find(record => record.event.kind === 'compaction')?.event.payload['before'], before);
		const concurrent = structuredClone(before);
		assert.strictEqual(await compactor.compact({ ...request, messages: concurrent }, { auxiliary: async () => undefined, stream: async () => { concurrent.push({ role: 'user', content: 'new steering' }); return adapter.streamChat({ ...provider, messages: [] }, () => {}, CancellationToken.None); } }), false);
		assert.strictEqual(concurrent.at(-1)?.content, 'new steering');
		assert.strictEqual(concurrent.length, before.length + 1);
	});
});
