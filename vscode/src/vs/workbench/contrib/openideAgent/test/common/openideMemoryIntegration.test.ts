/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IOpenideMemoryDocument, mutateLegacyMemory } from '../../../../../platform/openideCodebase/common/openideMemoryRecord.js';
import { IChatMessage, ILLMProvider } from '../../common/openideAgentTypes.js';
import { OpenideContextCompactor } from '../../common/openideContextCompactor.js';
import { OpenideToolExecutor } from '../../common/openideToolExecutor.js';
import { estimateConversationTokens, estimateTextTokens } from '../../common/openideTokens.js';
import { recallMemory } from '../../common/openideMemoryRecall.js';

suite('OpenIDE Markdown memory integration', () => {
	test('read-only execution needs a dedicated memory capability and cannot turn it into arbitrary writes', async () => {
		const executor = new OpenideToolExecutor();
		const tool = { def: { name: 'memory_save', description: '', parameters: { type: 'object', properties: {} } }, risk: 'write' as const, capability: 'memory' as const };
		const execution = { runId: 'test', origin: 'native' as const, allowedTools: new Set(['memory_save']), allowedRisks: new Set(['safe' as const]), memoryWrite: true };
		assert.strictEqual((await executor.prepare(tool, '{}', CancellationToken.None, execution)).error, undefined);
		assert.ok((await executor.prepare({ ...tool, capability: undefined }, '{}', CancellationToken.None, execution)).error);
		assert.ok((await executor.prepare(tool, '{"target":"user"}', CancellationToken.None, execution)).error);
		assert.ok((await executor.prepare(tool, '{}', CancellationToken.None, { ...execution, memoryWrite: false })).error);
	});
	test('legacy edits require unique targets and every mutation honors the resulting size limit', () => {
		assert.throws(() => mutateLegacyMemory('- same\n- same\n', 'replace', 'new', 'same', 1500), /exactly once/);
		assert.throws(() => mutateLegacyMemory('- original\n', 'replace', 'x'.repeat(7000), 'original', 1500), /limit/);
	});
	test('full-body recall observes the token budget and hides superseded decisions', () => {
		const make = (id: string, body: string, supersedes?: string): IOpenideMemoryDocument => ({ path: `.openide/memory/notes/${id}.md`, hash: 'abc', record: { schema: 1, id, topic_key: 'payments/retry', kind: 'decision', revision: 1, status: 'active', created: '', updated: '', source_kind: 'native', source_session: 's', source_message: 'm', evidence_kind: 'inferred', operation_id: id, related: [], body, supersedes } });
		const old = make('mem_oldrecord', 'QuasarRecovery formerly used a new key.');
		const current = make('mem_newrecord', 'A'.repeat(100) + ' QuasarRecovery reuses the original key.', old.record.id);
		const text = recallMemory([old, current], 'QuasarRecovery', 150);
		assert.ok(text.includes(current.record.id)); assert.ok(!text.includes(old.record.id)); assert.ok(estimateTextTokens(text) <= 150);
	});
	test('short oversized history compacts deterministically without another provider request', async () => {
		const messages: IChatMessage[] = [{ role: 'user', content: 'Fix retries', messageId: 'request' }, { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'read_file', argumentsJson: '{}' }] }, { role: 'tool', toolCallId: 'call', content: 'result '.repeat(30000) }];
		const adapter: ILLMProvider = { id: 'fixture', streamChat: async () => { throw new Error('Must not call provider'); } };
		let checkpoint = false; let archived = false;
		const compacted = await new OpenideContextCompactor().compact({ messages, runtime: { adapter, model: 'fixture', credential: { kind: 'apiKey', value: '' } }, token: CancellationToken.None, onEvent: () => {}, system: 'system', toolDefs: [], contextLimit: 16000, origin: 'automatic', journal: { runId: 'run', journal: { append: async event => { if (event.kind === 'compaction') { assert.ok(checkpoint); assert.ok(JSON.stringify(event.payload).includes('result result')); archived = true; } } } } }, { stream: async () => { throw new Error('Must not stream'); }, auxiliary: async () => undefined, beforeCompact: async () => { checkpoint = true; } });
		assert.ok(compacted && archived); assert.ok(estimateConversationTokens(messages) + 2 <= 16000 * 0.8); assert.strictEqual(messages.at(-1)?.messageId, 'request'); assert.ok(messages.every(message => !message.toolCalls && message.role !== 'tool'));
	});
});
