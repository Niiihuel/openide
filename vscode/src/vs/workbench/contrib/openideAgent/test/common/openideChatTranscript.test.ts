/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import {
	IOpenideChatAskContent, IOpenideChatCompactionContent, IOpenideChatContent, IOpenideChatEditContent,
	IOpenideChatExploreContent, IOpenideChatPlanContent, IOpenideChatSubagentContent, IOpenideChatTerminalContent,
	IOpenideChatTodosContent, OpenideChatContentKind,
} from '../../common/chat/openideChatContent.js';
import { IOpenideChatItem, IOpenideChatRequestItem, isOpenideChatRequestItem, isOpenideChatResponseItem } from '../../common/chat/openideChatItem.js';
import { buildOpenideChatTranscript } from '../../common/chat/openideChatTranscript.js';
import { IChatMessage } from '../../common/openideAgentTypes.js';
import { ISubagentRun } from '../../common/openideSubagentTypes.js';

/**
 * The persisted thread was written by every previous build of OpenIDE and read back by none of the
 * native chat. Opening an existing conversation showed nothing at all, which is why these tests
 * assert on what comes BACK rather than on what the reducer does with a live event.
 */
suite('OpenIDE chat transcript restore', () => {

	const NOW = 2_000_000;

	function build(messages: readonly IChatMessage[], runs?: ReadonlyMap<string, ISubagentRun>): readonly IOpenideChatItem[] {
		return buildOpenideChatTranscript(messages, { now: NOW, runs });
	}

	const storedRun: ISubagentRun = {
		runId: 'run_9', definitionId: 'explore', definitionVersion: 1, definitionName: 'explore',
		parentConversationId: 'conv', parentMessageId: 'm1', depth: 1, task: 'buscar',
		status: 'completed', createdAt: NOW, model: 'grok-4.6', readonly: true, background: true,
		metrics: { inputTokens: 0, outputTokens: 0, toolCalls: 0, filesRead: 0, filesModified: 0, searches: 0, errors: 0, cancellations: 0, routingAttempts: 0, fallbacks: 0 },
		timeline: [{ sequence: 0, timestamp: NOW, type: 'toolStart', toolName: 'read_file' }],
		childRunIds: [], deliveryState: 'delivered', generation: 1, attemptCount: 1,
	};

	function contentOf(items: readonly IOpenideChatItem[], index: number): readonly IOpenideChatContent[] {
		const item = items[index];
		return item && isOpenideChatResponseItem(item) ? item.content : [];
	}

	function kindsOf(items: readonly IOpenideChatItem[], index: number): OpenideChatContentKind[] {
		return contentOf(items, index).map(content => content.kind);
	}

	function requestAt(items: readonly IOpenideChatItem[], index: number): IOpenideChatRequestItem {
		const item = items[index];
		assert.ok(item && isOpenideChatRequestItem(item), `expected a request row at ${index}`);
		return item;
	}

	test('a saved conversation comes back as finished rows, never as a spinning turn', () => {
		const items = build([
			{ role: 'user', content: 'hola', messageId: 'm1' },
			{ role: 'assistant', content: 'buenas' },
			{ role: 'user', content: 'seguimos', messageId: 'm2' },
			{ role: 'assistant', content: 'dale' },
		]);
		assert.deepStrictEqual(items.map(item => item.kind), ['request', 'response', 'request', 'response']);
		assert.ok(items.every(item => item.isComplete), 'a restored turn must not paint the streaming caret');
		assert.deepStrictEqual(contentOf(items, 1), [{ kind: 'markdown', value: { value: 'buenas' } }]);
		assert.strictEqual(requestAt(items, 2).id, 'm2');
	});

	test('an empty conversation restores as an empty transcript, not as an empty bubble', () => {
		assert.deepStrictEqual(build([]), []);
		assert.deepStrictEqual(build([{ role: 'user', content: 'sin respuesta todavía', messageId: 'm1' }]).map(item => item.kind), ['request']);
	});

	test('operational turns stay out of the transcript', () => {
		const items = build([
			{ role: 'system', content: 'prompt' },
			{ role: 'user', content: 'cambio de modo', messageId: 'm1', hidden: true },
			{ role: 'user', content: 'visible', messageId: 'm2' },
		]);
		assert.deepStrictEqual(items.map(item => item.kind), ['request']);
		assert.strictEqual(requestAt(items, 0).text, 'visible');
	});

	test("a tool's picture is not a request the user made", () => {
		// The screenshot rides on a synthetic `user` message because not every provider carries
		// images on a `tool` one. Restored as a bubble it read as something the user sent, and it
		// cut the assistant's turn in two at that point.
		const items = build([
			{ role: 'user', content: 'sacá una captura', messageId: 'm1' },
			{ role: 'assistant', content: 'antes' },
			{ role: 'user', content: '[image: result of browser_screenshot]', images: [{ mimeType: 'image/png', data: 'AAA' }] },
			{ role: 'assistant', content: 'después' },
		]);
		assert.deepStrictEqual(items.map(item => item.kind), ['request', 'response']);
		assert.strictEqual(requestAt(items, 0).text, 'sacá una captura');
	});

	test('a message that only looks like a carrier is still the user talking', () => {
		// The guard is narrow on purpose: the shape AND attached images. Prose that merely
		// mentions the marker, or the marker with nothing attached, stays in the transcript.
		const items = build([
			{ role: 'user', content: '[image: result of browser_screenshot]', messageId: 'm1' },
			{ role: 'user', content: 'mirá esto: [image: result of browser_screenshot] no anda', messageId: 'm2', images: [{ mimeType: 'image/png', data: 'AAA' }] },
		]);
		assert.deepStrictEqual(items.map(item => item.kind), ['request', 'request']);
	});

	test('the user row keeps what was typed AND what the model received', () => {
		const items = build([{
			role: 'user', content: 'cuerpo expandido del comando', displayText: '/review src', messageId: 'm1',
			images: [{ mimeType: 'image/png', data: 'AAA' }],
			capabilities: [{ kind: 'command', name: 'review' }],
			executionMode: 'plan', providerId: 'anthropic', modelId: 'opus',
		}]);
		const request = requestAt(items, 0);
		// Losing either one breaks a different feature: the transcript shows displayText, while
		// rollback and edit-and-resend replay the expanded body.
		assert.strictEqual(request.displayText, '/review src');
		assert.strictEqual(request.text, 'cuerpo expandido del comando');
		assert.deepStrictEqual(request.images, [{ mimeType: 'image/png', data: 'AAA' }]);
		assert.deepStrictEqual(request.capabilities, [{ kind: 'command', name: 'review' }]);
		assert.strictEqual(request.mode, 'plan');
		assert.strictEqual(request.providerId, 'anthropic');
	});

	test('a turn split across several assistant messages restores as ONE reply', () => {
		const items = build([
			{ role: 'user', content: 'dale', messageId: 'm1' },
			{ role: 'assistant', content: 'primero', toolCalls: [{ id: 'c1', name: 'read_file', argumentsJson: '{"path":"src/a.ts"}' }] },
			{ role: 'tool', toolCallId: 'c1', content: 'linea' },
			{ role: 'assistant', content: 'segundo' },
		]);
		assert.strictEqual(items.length, 2);
		assert.deepStrictEqual(kindsOf(items, 1), ['markdown', 'explore', 'markdown']);
	});

	test('explorations fold into their group and keep the range the tool returned', () => {
		const items = build([
			{ role: 'user', content: 'mirá', messageId: 'm1' },
			{
				role: 'assistant', content: '', toolCalls: [
					{ id: 'c1', name: 'read_file', argumentsJson: '{"path":"src/a.ts","start_line":10}' },
					{ id: 'c2', name: 'search_text', argumentsJson: '{"query":"foo"}' },
				],
			},
			{ role: 'tool', toolCallId: 'c1', content: 'uno\ndos\ntres' },
			{ role: 'tool', toolCallId: 'c2', content: 'nada' },
		]);
		const explore = contentOf(items, 1)[0] as IOpenideChatExploreContent;
		assert.strictEqual(explore.kind, 'explore');
		assert.strictEqual(explore.isComplete, true);
		assert.deepStrictEqual(explore.entries.map(entry => entry.target), ['a.ts L10-12', 'foo']);
		assert.deepStrictEqual(explore.entries.map(entry => entry.state), ['success', 'success']);
	});

	test('a tool that failed comes back failed, from the only evidence the thread kept', () => {
		const items = build([
			{ role: 'user', content: 'probá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_diagnostics', argumentsJson: '{"path":"a.ts"}' }] },
			{ role: 'tool', toolCallId: 'c1', content: 'Error: no existe' },
		]);
		const explore = contentOf(items, 1)[0] as IOpenideChatExploreContent;
		assert.deepStrictEqual(explore.entries.map(entry => entry.state), ['error']);
	});

	test('an edit restores its styled card from the persisted diff', () => {
		const items = build([
			{ role: 'user', content: 'editá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'edit_file', argumentsJson: '{"path":"src/a.ts"}' }] },
			{
				role: 'tool', toolCallId: 'c1', content: 'OK: editado',
				fileDiff: { path: 'src/a.ts', editAdded: 3, editRemoved: 1, diffLines: [{ t: 'add', x: 'nuevo' }] },
			},
		]);
		const edit = contentOf(items, 1)[0] as IOpenideChatEditContent;
		assert.strictEqual(edit.kind, 'edit');
		assert.deepStrictEqual(edit.diff.diffLines, [{ t: 'add', x: 'nuevo' }]);
		// The turn totals were never persisted, so the card falls back to this edit's own numbers
		// instead of claiming zero changes.
		assert.deepStrictEqual([edit.added, edit.removed], [3, 1]);
	});

	test('a command restores as a terminal card, and a plan edit as a single line', () => {
		const items = build([
			{ role: 'user', content: 'corré', messageId: 'm1' },
			{
				role: 'assistant', content: '', toolCalls: [
					{ id: 'c1', name: 'run_command', argumentsJson: '{"command":"npm test"}' },
					{ id: 'c2', name: 'edit_file', argumentsJson: '{"path":".openide/plans/x.md"}' },
				],
			},
			{ role: 'tool', toolCallId: 'c1', content: 'ok' },
			{ role: 'tool', toolCallId: 'c2', content: 'OK: editado' },
		]);
		assert.deepStrictEqual(kindsOf(items, 1), ['terminal', 'planUpdate']);
		const terminal = contentOf(items, 1)[0] as IOpenideChatTerminalContent;
		assert.strictEqual(terminal.command, 'npm test');
		assert.strictEqual(terminal.state, 'exited');
	});

	test('to-dos restore as one snapshot, matching what the live turn shows', () => {
		const items = build([
			{ role: 'user', content: 'planeá', messageId: 'm1' },
			{
				role: 'assistant', content: '', toolCalls: [
					{ id: 'c1', name: 'update_todos', argumentsJson: '{"todos":[{"id":"1","title":"uno","status":"pending"}]}' },
					{ id: 'c2', name: 'update_todos', argumentsJson: '{"todos":[{"id":"1","title":"uno","status":"completed"}]}' },
				],
			},
		]);
		assert.deepStrictEqual(kindsOf(items, 1), ['todos']);
		const todos = contentOf(items, 1)[0] as IOpenideChatTodosContent;
		assert.deepStrictEqual(todos.items, [{ id: '1', title: 'uno', status: 'completed' }]);
	});

	test('ask_user restores question by question, splitting the single blob it returned', () => {
		const items = build([
			{ role: 'user', content: 'preguntá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'ask_user', argumentsJson: '{"questions":[{"question":"¿A?"},{"question":"¿B?"}]}' }] },
			{ role: 'tool', toolCallId: 'c1', content: 'P: ¿A?\nR: sí\n\nP: ¿B?\nR: no' },
		]);
		const ask = contentOf(items, 1)[0] as IOpenideChatAskContent;
		assert.strictEqual(ask.kind, 'ask');
		assert.strictEqual(ask.isComplete, true);
		assert.deepStrictEqual(ask.questions.map(question => question.question), ['¿A?', '¿B?']);
		assert.deepStrictEqual(ask.answers, ['sí', 'no']);
	});

	test('a plan card recovers the path from the result, not from a guessed slug', () => {
		const items = build([
			{ role: 'user', content: 'guardá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'plan_save', argumentsJson: '{"title":"Migración","markdown":"# paso"}' }] },
			{ role: 'tool', toolCallId: 'c1', content: 'OK: plan guardado en .openide/plans/migracion-real.md' },
		]);
		const plan = contentOf(items, 1)[0] as IOpenideChatPlanContent;
		assert.strictEqual(plan.kind, 'plan');
		assert.strictEqual(plan.planId, '.openide/plans/migracion-real.md');
		assert.strictEqual(plan.title, 'Migración');
		assert.strictEqual(plan.body.value, '# paso');
		assert.strictEqual(plan.state, 'final');
	});

	test('a delegation restores its envelope and one card per task', () => {
		const items = build([
			{ role: 'user', content: 'delegá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'delegate_task', argumentsJson: '{"tasks":[{"title":"A"},{"title":"B"}]}' }] },
			{ role: 'tool', toolCallId: 'c1', content: 'listo' },
		]);
		assert.deepStrictEqual(kindsOf(items, 1), ['delegation', 'subagent', 'subagent']);
		const children = contentOf(items, 1).slice(1) as IOpenideChatSubagentContent[];
		assert.deepStrictEqual(children.map(child => child.title), ['A', 'B']);
		// The per-task outcome was never persisted; claiming a failure we cannot prove would be worse.
		assert.deepStrictEqual(children.map(child => child.status), ['completed', 'completed']);
	});

	/**
	 * A durable specialist used to come back as a bare `delegate_to_subagent` tool row: the call was
	 * not in the restore switch, so a reload turned the card into a line of plumbing.
	 */
	test('a durable specialist restores as its row, rebuilt from the stored run', () => {
		const items = build([
			{ role: 'user', content: 'delegá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'delegate_to_subagent', argumentsJson: '{"agent":"explore","task":"buscar"}' }] },
			{ role: 'tool', toolCallId: 'c1', content: 'Subagente iniciado en background. runId=run_9' },
		], new Map([['run_9', storedRun]]));
		assert.deepStrictEqual(kindsOf(items, 1), ['subagent']);
		const card = contentOf(items, 1)[0] as IOpenideChatSubagentContent;
		// The transcript persists a sentence, not a run: everything below came from the store.
		assert.strictEqual(card.runId, 'run_9');
		assert.strictEqual(card.model, 'grok-4.6');
		assert.strictEqual(card.status, 'completed');
		assert.strictEqual(card.timeline.length, 1);
	});

	test('a specialist whose run the store no longer has still restores as a row', () => {
		// The run store keeps 300 runs, so a purge is normal on an old conversation. Dropping the row
		// would rewrite history; the arguments still say which specialist was asked for.
		const items = build([
			{ role: 'user', content: 'delegá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'delegate_to_subagent', argumentsJson: '{"agent":"explore","task":"buscar"}' }] },
			{ role: 'tool', toolCallId: 'c1', content: '{"runId":"run_gone","summary":"listo"}' },
		]);
		const card = contentOf(items, 1)[0] as IOpenideChatSubagentContent;
		assert.strictEqual(card.title, 'explore');
		assert.strictEqual(card.model, undefined);
		assert.strictEqual(card.run, undefined);
		assert.strictEqual(card.status, 'completed');
	});

	test('an interrupted run restores as cancelled, the same word the live row uses', () => {
		const items = build([
			{ role: 'user', content: 'delegá', messageId: 'm1' },
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'delegate_to_subagent', argumentsJson: '{"agent":"explore"}' }] },
			{ role: 'tool', toolCallId: 'c1', content: 'Subagente iniciado en background. runId=run_9' },
		], new Map([['run_9', { ...storedRun, status: 'interrupted' as const }]]));
		assert.strictEqual((contentOf(items, 1)[0] as IOpenideChatSubagentContent).status, 'cancelled');
	});

	test('compaction restores as a settled card, including threads saved before it had metadata', () => {
		const items = build([
			{ role: 'user', content: '[Resumen histórico compacto] lo que pasó antes' },
			{ role: 'user', content: 'resumen', compaction: { beforeTokens: 100, afterTokens: 40, savingsPercent: 60, origin: 'manual' } },
			{ role: 'user', content: 'seguimos', messageId: 'm1' },
		]);
		assert.deepStrictEqual(items.map(item => item.kind), ['response', 'request']);
		const cards = contentOf(items, 0) as IOpenideChatCompactionContent[];
		assert.deepStrictEqual(cards.map(card => card.status), ['completed', 'completed']);
		assert.deepStrictEqual(cards.map(card => card.origin), ['automatic', 'manual']);
		// A compaction summary must never be mistaken for something the user asked for.
		assert.strictEqual(items.filter(isOpenideChatRequestItem).length, 1);
	});
});
