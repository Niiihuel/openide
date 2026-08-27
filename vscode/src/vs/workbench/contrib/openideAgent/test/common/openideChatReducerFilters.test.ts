/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { AgentLoopEvent, IMessageChangeSet } from '../../common/openideAgentTypes.js';
import { createOpenideChatRequestItem, IOpenideChatItem, isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { applyAgentEvent, applyAgentEvents } from '../../common/chat/openideChatReducer.js';
import { filterAgentEvent, isOpenideChatHostOnlyEvent, unwrapSubagentEvent } from '../../common/chat/openideChatReducerFilters.js';
import { beginOpenideChatTurn, createOpenideChatReducerState } from '../../common/chat/openideChatReducerState.js';

/**
 * The four behaviours of browser/openideChatView.ts:1436-1478 that never had a test.
 *
 * All four were `if`s inside a live run callback, unreachable from any harness. Each one is
 * load-bearing in a way that fails SILENTLY: a leaked change set paints host metadata as a chat
 * row, and a mode handoff that is not swallowed ends the turn visually while the engine keeps
 * working.
 */
suite('OpenIDE chat reducer filters', () => {

	const NOW = 2_000;

	function armed() {
		return beginOpenideChatTurn(createOpenideChatReducerState(), createOpenideChatRequestItem({ id: 'req_1', text: 'dale' }));
	}

	function contentKinds(items: readonly IOpenideChatItem[]): string[] {
		const last = items[items.length - 1];
		return last && isOpenideChatResponseItem(last) ? last.content.map(content => content.kind) : [];
	}

	const changeSet: IMessageChangeSet = { messageId: 'msg_1', timestamp: NOW, state: 'finalized', files: [] };

	function wrap(inner: AgentLoopEvent, id = 'sub_1'): AgentLoopEvent {
		return { type: 'subagentEvent', id, parentId: 'del_1', index: 0, total: 1, status: 'running', ev: inner };
	}

	test('subagentEvent is unwrapped recursively, keeping the innermost frame', () => {
		// A specialist can delegate in turn, so the payload really does nest. Throwing the frames
		// away is what would dump a specialist's tool calls into the user's transcript.
		const envelope = unwrapSubagentEvent(wrap(wrap({ type: 'text', delta: 'hola' }, 'inner'), 'outer'));
		assert.strictEqual(envelope.depth, 2);
		assert.deepStrictEqual(envelope.event, { type: 'text', delta: 'hola' });
		assert.strictEqual(envelope.subagent?.id, 'inner');
	});

	test('a root event unwraps to itself at depth 0', () => {
		const envelope = unwrapSubagentEvent({ type: 'done' });
		assert.strictEqual(envelope.depth, 0);
		assert.strictEqual(envelope.subagent, undefined);
	});

	test('a specialist\'s events never reach the main transcript, only its mirror session', () => {
		// R7: trackSubagentEvent is not UI. It accumulates the messages that get PERSISTED for the
		// specialist's own conversation, so a reducer that ignored nested events would quietly stop
		// saving them.
		const step = applyAgentEvents(armed(), [
			{ type: 'subagentStart', id: 'sub_1', parentId: 'del_1', index: 0, total: 1, status: 'running', title: 'A', prompt: 'p', model: 'm' },
			wrap({ type: 'text', delta: 'trabajando' }),
			wrap({ type: 'toolStart', id: 'c1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' }),
			wrap({ type: 'toolResult', id: 'c1', name: 'read_file', result: 'x', isError: false }),
		], { now: NOW });

		assert.deepStrictEqual(contentKinds(step.items), ['delegation', 'subagent']);
		const last = step.items[step.items.length - 1];
		const card = isOpenideChatResponseItem(last) ? last.content[1] as { timeline: readonly unknown[] } : undefined;
		assert.strictEqual(card?.timeline.length, 2);

		const mirrored = step.sessionEffects.filter(effect => effect.type === 'subagentSessionMessage');
		assert.deepStrictEqual(mirrored.map(effect => effect.type === 'subagentSessionMessage' && effect.message.role), ['assistant', 'assistant', 'tool']);
		// Streamed text merges into the previous assistant message and does NOT trigger a write.
		assert.strictEqual(mirrored[0].type === 'subagentSessionMessage' && mirrored[0].mergeText, true);
		assert.strictEqual(step.sessionEffects.filter(effect => effect.type === 'subagentSessionSave').length, 2);
	});

	test('fileCheckpoint does not cross and does not resurrect the legacy format', () => {
		// Legacy internal compatibility only: new conversations persist messageChangeSet. Emitting
		// an effect here would start writing a storage format the product abandoned.
		const result = filterAgentEvent({ type: 'fileCheckpoint', checkpoint: { path: 'a.ts', content: 'x', existed: true } });
		assert.strictEqual(result.kind, 'drop');
		assert.strictEqual(result.kind === 'drop' && result.reason, 'file-checkpoint');
		assert.deepStrictEqual(result.sessionEffects, []);

		const step = applyAgentEvent(armed(), { type: 'fileCheckpoint', checkpoint: { path: 'a.ts', content: 'x', existed: true } }, { now: NOW });
		assert.strictEqual(step.items.length, 1);
		assert.strictEqual(step.dropped, 'file-checkpoint');
	});

	test('a checkpoint produced INSIDE a specialist is dropped just the same', () => {
		const result = filterAgentEvent(wrap({ type: 'fileCheckpoint', checkpoint: { path: 'a.ts', content: 'x', existed: true } }));
		assert.strictEqual(result.kind === 'drop' && result.reason, 'file-checkpoint');
	});

	test('messageChangeSet is saved and never crosses into the transcript', () => {
		// It is the data "Go back here" reverts, not something the user reads.
		const step = applyAgentEvent(armed(), { type: 'messageChangeSet', changeSet }, { now: NOW });
		assert.strictEqual(step.dropped, 'message-change-set');
		assert.strictEqual(step.items.length, 1);
		assert.deepStrictEqual(step.sessionEffects, [{ type: 'saveChangeSet', changeSet }]);
	});

	test('a change set from a specialist is saved too, never rendered', () => {
		const result = filterAgentEvent(wrap({ type: 'messageChangeSet', changeSet }));
		assert.strictEqual(result.kind === 'drop' && result.reason, 'message-change-set');
		assert.strictEqual(result.sessionEffects[0].type, 'saveChangeSet');
	});

	test('done{mode-switch} is swallowed: the same turn resumes under another mode', () => {
		// Letting it through clears the caret, re-enables send and ends the turn while the engine
		// is still working — the user sees a finished, empty answer.
		const streaming = applyAgentEvent(armed(), { type: 'text', delta: 'analizando' }, { now: NOW });
		const step = applyAgentEvent(streaming.state, { type: 'done', reason: 'mode-switch' }, { now: NOW });
		assert.strictEqual(step.dropped, 'mode-switch');
		assert.deepStrictEqual(step.sessionEffects, [{ type: 'modeHandoff' }]);
		const reply = step.items[step.items.length - 1];
		assert.strictEqual(reply.isComplete, false);
		assert.deepStrictEqual(step.state, streaming.state);
	});

	test('a plain done still completes the turn', () => {
		const step = applyAgentEvent(armed(), { type: 'done' }, { now: NOW });
		assert.strictEqual(step.dropped, undefined);
		assert.strictEqual(step.items[step.items.length - 1].isComplete, true);
	});

	test('done{mode-switch} from a specialist ends the specialist, not the user\'s turn', () => {
		// The rule reads the ORIGINAL event on purpose: swallowing a nested done would leave the
		// parent card spinning forever.
		const result = filterAgentEvent(wrap({ type: 'done', reason: 'mode-switch' }));
		assert.strictEqual(result.kind, 'pass');
	});

	test('host-only events are identifiable without running the reducer', () => {
		assert.strictEqual(isOpenideChatHostOnlyEvent({ type: 'messageChangeSet', changeSet }), true);
		assert.strictEqual(isOpenideChatHostOnlyEvent(wrap({ type: 'fileCheckpoint', checkpoint: { path: 'a', content: '', existed: false } })), true);
		assert.strictEqual(isOpenideChatHostOnlyEvent({ type: 'done' }), false);
	});
});
