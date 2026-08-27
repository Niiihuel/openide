/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { CANCELLED_TOOL_RESULT, findOrphanToolCalls, IPairableMessage, sealOrphanToolCalls } from '../../common/openideToolPairing.js';

/**
 * The real failure: cancelling while a tool was running left the assistant turn with its
 * toolCalls in the history and no result. From then on, EVERY new message resent that orphaned
 * call and the provider returned
 * `HTTP 400 … No tool output found for function call call_XXX`. The conversation was dead.
 */
suite('OpenIDE tool pairing', () => {

	function turno(id: string, name = 'run_command'): IPairableMessage {
		return { role: 'assistant', content: '', toolCalls: [{ id, name }] };
	}

	test('una llamada cancelada queda sellada', () => {
		const messages: IPairableMessage[] = [{ role: 'user', content: 'dale' }, turno('call_1')];
		assert.deepStrictEqual(findOrphanToolCalls(messages), ['call_1']);
		assert.strictEqual(sealOrphanToolCalls(messages), 1);
		assert.deepStrictEqual(findOrphanToolCalls(messages), []);
		assert.deepStrictEqual(messages[2], { role: 'tool', toolCallId: 'call_1', content: CANCELLED_TOOL_RESULT });
	});

	test('el resultado sintético DICE que se canceló', () => {
		// An empty result would be indistinguishable from a tool that returned nothing, and the model
		// would read it as success.
		const messages: IPairableMessage[] = [turno('call_1')];
		sealOrphanToolCalls(messages);
		assert.strictEqual(messages[1].content.length > 0, true);
		assert.strictEqual(/cancel/i.test(messages[1].content), true);
	});

	test('un historial sano no se toca', () => {
		const messages: IPairableMessage[] = [
			{ role: 'user', content: 'hola' },
			turno('call_1'),
			{ role: 'tool', toolCallId: 'call_1', content: 'ok' },
			{ role: 'assistant', content: 'listo' },
		];
		const copia = JSON.parse(JSON.stringify(messages));
		assert.strictEqual(sealOrphanToolCalls(messages), 0);
		assert.deepStrictEqual(messages, copia);
	});

	test('sella sólo las que faltan de un turno con varias llamadas', () => {
		const messages: IPairableMessage[] = [
			{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 't' }, { id: 'b', name: 't' }, { id: 'c', name: 't' }] },
			{ role: 'tool', toolCallId: 'a', content: 'ok' },
		];
		assert.strictEqual(sealOrphanToolCalls(messages), 2);
		assert.deepStrictEqual(findOrphanToolCalls(messages), []);
		assert.strictEqual(messages.filter(m => m.role === 'tool').length, 3);
	});

	test('los resultados quedan pegados a SU turno, no al final', () => {
		// If they were appended at the end, the next turn would be separated from its results and
		// the provider would reject it anyway: the tool block must follow the assistant that asked.
		const messages: IPairableMessage[] = [
			turno('call_1'),
			{ role: 'user', content: 'otra cosa' },
			turno('call_2'),
			{ role: 'tool', toolCallId: 'call_2', content: 'ok' },
		];
		assert.strictEqual(sealOrphanToolCalls(messages), 1);
		assert.strictEqual(messages[1].role, 'tool');
		assert.strictEqual(messages[1].toolCallId, 'call_1');
		assert.strictEqual(messages[2].role, 'user');
	});

	test('un id repetido en otro turno no cuenta como respuesta', () => {
		// Searching the WHOLE history for the result would pair with another turn that reused the
		// id, and the real call would still have no output.
		const messages: IPairableMessage[] = [
			turno('dup'),
			{ role: 'user', content: 'seguí' },
			turno('dup'),
			{ role: 'tool', toolCallId: 'dup', content: 'ok' },
		];
		assert.deepStrictEqual(findOrphanToolCalls(messages), ['dup']);
		assert.strictEqual(sealOrphanToolCalls(messages), 1);
		assert.deepStrictEqual(findOrphanToolCalls(messages), []);
	});

	test('sellar es idempotente', () => {
		const messages: IPairableMessage[] = [turno('call_1')];
		sealOrphanToolCalls(messages);
		assert.strictEqual(sealOrphanToolCalls(messages), 0);
		assert.strictEqual(messages.length, 2);
	});

	test('un assistant sin toolCalls no genera nada', () => {
		const messages: IPairableMessage[] = [{ role: 'assistant', content: 'sólo texto' }];
		assert.strictEqual(sealOrphanToolCalls(messages), 0);
		assert.strictEqual(messages.length, 1);
	});
});
