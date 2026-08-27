/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Default import, NOT `{ strict as assert }`: the browser harness shims 'assert' with a module
// that has no `strict` export, so that form throws at evaluation and the whole file is skipped.
// The strict variants are spelled out below instead.
import assert from 'assert';
import { IOpenideChatContent } from '../../common/chat/openideChatContent.js';
import {
	advanceOpenideChatResponseItem,
	computeOpenideChatDataId,
	createOpenideChatRequestItem,
	createOpenideChatResponseItem,
	isOpenideChatRequestItem,
	isOpenideChatResponseItem,
} from '../../common/chat/openideChatItem.js';

/**
 * The real failure this guards against: the list re-renders a row only when the string returned
 * by its diffIdentityProvider changes. A dataId that stands still while the assistant streams
 * leaves the answer frozen on screen with no exception and no log.
 */
suite('OpenIDE chat item', () => {

	const markdown = (value: string): IOpenideChatContent => ({ kind: 'markdown', value: { value, isTrusted: false } });

	test('dataId mixes id, version and completion', () => {
		assert.strictEqual(computeOpenideChatDataId('res_1', 0, false), 'res_1_0');
		assert.strictEqual(computeOpenideChatDataId('res_1', 3, false), 'res_1_3');
		assert.strictEqual(computeOpenideChatDataId('res_1', 3, true), 'res_1_3_done');
	});

	test('a fresh reply starts incomplete, empty and unmeasured', () => {
		const item = createOpenideChatResponseItem({ id: 'res_1', requestId: 'req_1' });
		assert.strictEqual(item.kind, 'response');
		assert.strictEqual(item.isComplete, false);
		assert.strictEqual(item.version, 0);
		assert.deepStrictEqual(item.content, []);
		assert.strictEqual(item.currentRenderedHeight, undefined);
		assert.strictEqual(item.dataId, 'res_1_0');
	});

	test('every streamed delta moves the dataId', () => {
		let item = createOpenideChatResponseItem({ id: 'res_1', requestId: 'req_1' });
		const seen = new Set([item.dataId]);
		for (const text of ['Ho', 'Hola', 'Hola mundo']) {
			item = advanceOpenideChatResponseItem(item, { content: [markdown(text)] });
			assert.strictEqual(seen.has(item.dataId), false, item.dataId);
			seen.add(item.dataId);
		}
		assert.strictEqual(item.version, 3);
		assert.strictEqual(item.dataId, 'res_1_3');
	});

	test('completing the turn changes the dataId even with identical content', () => {
		const streaming = createOpenideChatResponseItem({ id: 'res_1', requestId: 'req_1', content: [markdown('listo')] });
		const done = advanceOpenideChatResponseItem(streaming, { isComplete: true });
		assert.strictEqual(done.isComplete, true);
		assert.deepStrictEqual(done.content, streaming.content);
		assert.notStrictEqual(done.dataId, streaming.dataId);
		assert.strictEqual(done.dataId, 'res_1_1_done');
	});

	test('advancing keeps identity and the measured height', () => {
		const item = createOpenideChatResponseItem({ id: 'res_1', requestId: 'req_1' });
		item.currentRenderedHeight = 142;
		const next = advanceOpenideChatResponseItem(item, { content: [markdown('x')] });
		assert.strictEqual(next.id, item.id);
		assert.strictEqual(next.requestId, item.requestId);
		assert.strictEqual(next.currentRenderedHeight, 142);
	});

	test('cancellation and error survive later advances', () => {
		let item = createOpenideChatResponseItem({ id: 'res_1', requestId: 'req_1' });
		item = advanceOpenideChatResponseItem(item, { isCanceled: true, errorMessage: 'abortado' });
		item = advanceOpenideChatResponseItem(item, { isComplete: true });
		assert.strictEqual(item.isCanceled, true);
		assert.strictEqual(item.errorMessage, 'abortado');
	});

	test('a request is complete on arrival and keeps its captured target', () => {
		const item = createOpenideChatRequestItem({
			id: 'req_1', text: '/fix build', displayText: '/fix', mode: 'agent',
			providerId: 'anthropic', modelId: 'claude-opus-4',
		});
		assert.strictEqual(item.isComplete, true);
		assert.strictEqual(item.dataId, 'req_1_0_done');
		assert.strictEqual(item.mode, 'agent');
		assert.strictEqual(item.providerId, 'anthropic');
	});

	test('editing a request repaints it without changing its identity', () => {
		const first = createOpenideChatRequestItem({ id: 'req_1', text: 'a' });
		const edited = createOpenideChatRequestItem({ id: 'req_1', text: 'b', version: 1 });
		assert.strictEqual(edited.id, first.id);
		assert.notStrictEqual(edited.dataId, first.dataId);
	});

	test('the item guards discriminate the two rows', () => {
		const request = createOpenideChatRequestItem({ id: 'req_1', text: 'a' });
		const response = createOpenideChatResponseItem({ id: 'res_1', requestId: 'req_1' });
		assert.strictEqual(isOpenideChatRequestItem(request), true);
		assert.strictEqual(isOpenideChatResponseItem(request), false);
		assert.strictEqual(isOpenideChatResponseItem(response), true);
		assert.strictEqual(isOpenideChatRequestItem(response), false);
	});

	test('parentId is declared but Stage 1 leaves it unset', () => {
		const response = createOpenideChatResponseItem({ id: 'res_1', requestId: 'req_1' });
		assert.strictEqual(response.parentId, undefined);
		const nested = createOpenideChatResponseItem({ id: 'res_2', requestId: 'req_1', parentId: 'req_1' });
		assert.strictEqual(nested.parentId, 'req_1');
	});
});
