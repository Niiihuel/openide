/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentLoopEvent, AgentStreamEvent, IChatMessage, ILLMProvider, IProviderRequest, IProviderResult } from '../../common/openideAgentTypes.js';
import { OpenideContextCompactor } from '../../common/openideContextCompactor.js';
import { OpenideProviderStream } from '../../common/openideProviderStream.js';
import { IOpenideTurnPorts, OpenideTurnCoordinator, runOpenideTurn } from '../../common/openideTurnRuntime.js';

const final = (content = 'Finished'): IProviderResult => ({ message: { role: 'assistant', content }, stopReason: 'stop' });
const callResult = (): IProviderResult => ({ message: { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'write', argumentsJson: '{"text":"saved"}' }] } });
type Step = (request: IProviderRequest, emit: (event: AgentStreamEvent) => void, token: CancellationToken) => Promise<IProviderResult>;

function fixture(steps: Step[], token = CancellationToken.None, messages: IChatMessage[] = [{ role: 'user', content: 'Task', messageId: 'owner' }]) {
	const requests: IProviderRequest[] = [];
	const events: AgentLoopEvent[] = [];
	const effects: string[] = [];
	const stream = new OpenideProviderStream({ staleTimeoutSeconds: () => 0, wait: async () => { }, random: () => 0 });
	const adapter: ILLMProvider = {
		id: 'scripted',
		streamChat: async (request, emit, token) => {
			requests.push({ ...request, messages: structuredClone(request.messages) });
			const step = steps.shift();
			assert.ok(step, 'unexpected duplicate provider request');
			return step(request, emit, token);
		},
	};
	const ports: IOpenideTurnPorts = {
		stream: (request, emit) => stream.stream(adapter, request, emit, token, event => events.push(event)),
		compact: async () => false,
		executeTools: async (calls, emit) => {
			for (const call of calls) {
				effects.push(call.id);
				messages.push({ role: 'tool', toolCallId: call.id, content: 'saved' });
				emit({ type: 'toolResult', id: call.id, name: call.name, result: 'saved', isError: false });
			}
			return false;
		},
		enrichUsage: () => ({ type: 'usage', contextUsed: 0, contextLimit: 1000 }),
		planDraft: () => { },
		stop: () => { },
	};
	const run = () => runOpenideTurn({ messages, provider: { credential: { kind: 'apiKey', value: 'fixture' }, providerId: 'scripted', model: 'fixture', tools: [] }, token, onEvent: event => events.push(event), maxIterations: 4, messageId: 'owner', runtimeContext: 'retrieved context' }, ports);
	return { run, ports, stream, adapter, messages, events, effects, requests };
}

suite('OpenIDE injected turn runtime', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('runs the real model/tool/model cycle without editor services and preserves stored context', async () => {
		const h = fixture([async () => callResult(), async request => {
			assert.strictEqual(request.messages.at(-1)?.content, 'saved');
			return final();
		}]);
		assert.strictEqual(await h.run(), 'completed');
		assert.deepStrictEqual({ roles: h.messages.map(message => message.role), effects: h.effects, terminals: h.events.filter(event => event.type === 'done' || event.type === 'error').map(event => event.type), storedUser: h.messages[0].content, wireUser: h.requests[0].messages[0].content }, { roles: ['user', 'assistant', 'tool', 'assistant'], effects: ['call'], terminals: ['done'], storedUser: 'Task', wireUser: 'Task\n\nretrieved context' });
	});

	test('retries a transient request before output without duplicating tool effects', async () => {
		const h = fixture([async () => { throw new Error('HTTP 503 Service Unavailable'); }, async () => callResult(), async () => final()]);
		assert.strictEqual(await h.run(), 'completed');
		assert.deepStrictEqual({ requests: h.requests.length, effects: h.effects, retries: h.events.filter(event => event.type === 'retry').length }, { requests: 3, effects: ['call'], retries: 1 });
	});

	test('does not replay an attempt that emitted text or partial tool arguments', async () => {
		for (const event of [{ type: 'text', delta: 'visible' }, { type: 'toolCallDelta', id: 'draft', name: 'plan_save', argumentsJson: '{' }] satisfies AgentStreamEvent[]) {
			const h = fixture([async (_request, emit) => { emit(event); throw new Error('HTTP 503 Service Unavailable'); }]);
			await assert.rejects(h.run(), /503/);
			assert.deepStrictEqual({ requests: h.requests.length, effects: h.effects }, { requests: 1, effects: [] });
		}
	});

	test('cancellation fences late provider events and does not affect another session', async () => {
		const cancellation = store.add(new CancellationTokenSource());
		const started = new DeferredPromise<void>();
		const late = new DeferredPromise<IProviderResult>();
		let emitLate: ((event: AgentStreamEvent) => void) | undefined;
		const h = fixture([async (_request, emit) => { emitLate = emit; void started.complete(); return late.p; }], cancellation.token);
		const running = h.run(); await started.p; cancellation.cancel();
		assert.strictEqual(await running, 'cancelled');
		emitLate?.({ type: 'text', delta: 'stale' }); await late.complete(final('stale'));
		const other = fixture([async () => final('other')]);
		assert.strictEqual(await other.run(), 'completed');
		assert.deepStrictEqual({ cancelledHistory: h.messages.map(message => message.content), cancelledText: h.events.filter(event => event.type === 'text'), other: other.messages.at(-1)?.content }, { cancelledHistory: ['Task'], cancelledText: [], other: 'other' });
	});

	test('cancellation in a tool batch seals all calls and the same history can run again', async () => {
		const cancellation = store.add(new CancellationTokenSource());
		const h = fixture([async () => ({ message: { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'write', argumentsJson: '{}' }, { id: 'b', name: 'read', argumentsJson: '{}' }] } })], cancellation.token);
		h.ports.executeTools = async () => { cancellation.cancel(); return true; };
		assert.strictEqual(await h.run(), 'cancelled');
		assert.deepStrictEqual(h.messages.filter(message => message.role === 'tool').map(message => message.toolCallId), ['a', 'b']);
		const resumed = fixture([async request => { assert.strictEqual(request.messages.filter(message => message.role === 'tool').length, 2); return final('resumed'); }], CancellationToken.None, h.messages);
		assert.strictEqual(await resumed.run(), 'completed');
	});

	test('overflow recovery budgets are isolated between concurrent sessions', async () => {
		const create = () => {
			const h = fixture([async () => { throw new Error('maximum context length exceeded'); }, async () => final()]);
			let recoveries = 0;
			h.ports.compact = async origin => { if (origin === 'recovery') { recoveries++; return true; } return false; };
			return { h, recoveries: () => recoveries };
		};
		const a = create(), b = create();
		assert.deepStrictEqual(await Promise.all([a.h.run(), b.h.run()]), ['completed', 'completed']);
		assert.deepStrictEqual([a.recoveries(), b.recoveries()], [1, 1]);
	});

	test('output continuation is merged and its synthetic request is never persisted', async () => {
		const h = fixture([async () => ({ message: { role: 'assistant', content: 'Hello' }, stopReason: 'length' }), async () => final(' world')]);
		assert.strictEqual(await h.run(), 'completed');
		assert.deepStrictEqual(h.messages.map(message => message.content), ['Task', 'Hello world']);
		assert.match(h.requests[1].messages.at(-1)!.content, /Internal OpenIDE continuation/);
	});

	test('an early tool stop emits only one terminal event', async () => {
		const h = fixture([async () => callResult()]);
		h.ports.executeTools = async (_calls, emit) => { emit({ type: 'done', reason: 'plan-saved' }); emit({ type: 'done', reason: 'duplicate' }); return true; };
		assert.strictEqual(await h.run(), 'stopped');
		assert.strictEqual(h.events.filter(event => event.type === 'done').length, 1);
		assert.strictEqual(h.messages.filter(message => message.role === 'tool').length, 1);
	});

	test('saving a plan pauses for user review without another provider request', async () => {
		const h = fixture([async () => ({ message: { role: 'assistant', content: '', toolCalls: [{ id: 'plan', name: 'plan_save', argumentsJson: '{}' }] } }), async () => { throw new Error('The model must wait for the user to approve the plan'); }]);
		h.ports.executeTools = async (calls, emit) => {
			assert.strictEqual(calls[0].name, 'plan_save');
			h.messages.push({ role: 'tool', toolCallId: 'plan', content: 'Plan saved. Waiting for user review.' });
			emit({ type: 'done', reason: 'plan-saved' });
			return true;
		};
		assert.strictEqual(await h.run(), 'stopped');
		assert.deepStrictEqual({ requests: h.requests.length, terminal: h.events.filter(event => event.type === 'done'), last: h.messages.at(-1)?.role }, { requests: 1, terminal: [{ type: 'done', reason: 'plan-saved' }], last: 'tool' });
	});

	test('coordinator isolates sessions, releases claims on failure, and resumes a queued turn', async () => {
		const coordinator = new OpenideTurnCoordinator();
		const held = new DeferredPromise<void>();
		const began = new DeferredPromise<void>();
		const order: string[] = [];
		const first = coordinator.run('a', CancellationToken.None, async () => { order.push('a1'); void began.complete(); await held.p; throw new Error('failed'); }, () => order.push('release-a1'));
		const failed = assert.rejects(first, /failed/);
		await began.p;
		const queued = coordinator.run('a', CancellationToken.None, async () => { order.push('a2'); }, () => order.push('release-a2'));
		await coordinator.run('b', CancellationToken.None, async () => { order.push('b'); }, () => order.push('release-b'));
		await held.complete(); await failed; await queued;
		assert.deepStrictEqual(order, ['a1', 'b', 'release-b', 'release-a1', 'a2', 'release-a2']);
	});

	test('compactor commits a scripted summary and preserves history on cancelled recovery', async () => {
		const history = (): IChatMessage[] => Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Message ${index}: ${'historical context '.repeat(200)}` }));
		const messages = history();
		const compactor = new OpenideContextCompactor();
		const h = fixture([async () => final('## Goal\nContinue the task.\n## Completed progress\nInvestigated files and fixed validation.\n## Pending work\nFinish the remaining checks.\n## Decisions\nPreserve user edits.')]);
		const request = { messages, runtime: { adapter: h.adapter, credential: { kind: 'apiKey' as const, value: 'fixture' }, model: 'fixture' }, token: CancellationToken.None, onEvent: (event: AgentLoopEvent) => h.events.push(event), system: '', toolDefs: [], contextLimit: 10000, origin: 'manual' as const };
		assert.strictEqual(await compactor.compact(request, { stream: (...args) => h.stream.stream(...args), auxiliary: async () => undefined }), true);
		assert.ok(messages[0].compaction);
		const cancellation = store.add(new CancellationTokenSource());
		const preserved = history(); const before = structuredClone(preserved);
		const stopped = fixture([async () => { cancellation.cancel(); throw new Error('Cancelled'); }], cancellation.token);
		assert.strictEqual(await compactor.compact({ ...request, messages: preserved, token: cancellation.token, runtime: { ...request.runtime, adapter: stopped.adapter }, origin: 'recovery' }, { stream: (...args) => stopped.stream.stream(...args), auxiliary: async () => undefined }), false);
		assert.deepStrictEqual(preserved, before);
	});
});
