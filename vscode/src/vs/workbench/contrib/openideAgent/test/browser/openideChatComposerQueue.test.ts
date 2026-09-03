/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IComposerQueueEntry, OpenideChatComposerQueue, QUEUE_LIMIT } from '../../browser/chat/openideChatComposerQueue.js';
import { t } from '../../common/openideStrings.js';

suite('OpenIDE ChatComposerQueue', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function entry(text: string, mode: IComposerQueueEntry['mode'] = 'agent'): IComposerQueueEntry {
		return { inputText: text, images: [], references: [], capabilities: [], links: [], mode, providerId: 'p', modelId: 'm' };
	}

	function create(storage = store.add(new InMemoryStorageService())) {
		const host = $('div');
		const queue = store.add(new OpenideChatComposerQueue(host, storage, NullHoverService));
		return { host, queue, storage };
	}

	test('hidden while empty, rows once pushed', () => {
		const { host, queue } = create();
		queue.setConversation('c1');
		assert.ok(queue.domNode.classList.contains('hidden'));
		assert.strictEqual(queue.push(entry('hola')), true);
		assert.ok(!queue.domNode.classList.contains('hidden'));
		assert.strictEqual(host.querySelectorAll('.openide-chat-queue-row').length, 1);
		assert.strictEqual(host.querySelector('.openide-chat-queue-count')?.textContent, '1 pendiente');
		assert.strictEqual(host.querySelector('.openide-chat-queue-text')?.textContent, 'hola');
	});

	test('caps at the limit', () => {
		const { queue } = create();
		queue.setConversation('c1');
		for (let i = 0; i < QUEUE_LIMIT; i++) { assert.strictEqual(queue.push(entry(`m${i}`)), true); }
		assert.strictEqual(queue.push(entry('one too many')), false);
		assert.strictEqual(queue.length, QUEUE_LIMIT);
	});

	test('shift is FIFO and persists', () => {
		const storage = store.add(new InMemoryStorageService());
		const { queue } = create(storage);
		queue.setConversation('c1');
		queue.push(entry('a'));
		queue.push(entry('b'));
		assert.strictEqual(queue.shift()?.inputText, 'a');
		// A fresh instance over the same storage sees what was left.
		const again = create(storage);
		again.queue.setConversation('c1');
		assert.strictEqual(again.queue.length, 1);
		assert.strictEqual(again.queue.shift()?.inputText, 'b');
		assert.strictEqual(again.queue.shift(), undefined);
	});

	test('queues are per conversation; the pending queue is adopted by the first conversation', () => {
		const { queue } = create();
		queue.push(entry('typed before any session'));
		queue.setConversation('c1');
		assert.strictEqual(queue.length, 1);
		queue.setConversation('c2');
		assert.strictEqual(queue.length, 0);
		queue.push(entry('for c2'));
		queue.setConversation('c1');
		assert.strictEqual(queue.shift()?.inputText, 'typed before any session');
	});

	test('edit / send now / remove leave the queue through their events', () => {
		const { host, queue } = create();
		queue.setConversation('c1');
		queue.push(entry('e'));
		queue.push(entry('s', 'plan'));
		queue.push(entry('r'));
		const edited: string[] = [];
		const sent: string[] = [];
		store.add(queue.onDidRequestEdit(({ entry }) => edited.push(entry.inputText)));
		store.add(queue.onDidRequestSendNow(({ entry }) => sent.push(entry.inputText)));
		const rows = () => Array.from(host.querySelectorAll('.openide-chat-queue-row'));
		assert.strictEqual(rows()[1].querySelector('.openide-chat-queue-intent')?.textContent, t('chat.queue.afterPlan'));
		rows()[0].querySelectorAll<HTMLButtonElement>('.openide-chat-queue-btn')[0].click();
		assert.deepStrictEqual(edited, ['e']);
		rows()[0].querySelectorAll<HTMLButtonElement>('.openide-chat-queue-btn')[1].click();
		assert.deepStrictEqual(sent, ['s']);
		rows()[0].querySelectorAll<HTMLButtonElement>('.openide-chat-queue-btn')[2].click();
		assert.strictEqual(queue.length, 0);
		assert.ok(queue.domNode.classList.contains('hidden'));
	});

	test('collapse toggle hides the body and keeps the count', () => {
		const { host, queue } = create();
		queue.setConversation('c1');
		queue.push(entry('x'));
		host.querySelector<HTMLButtonElement>('.openide-chat-queue-toggle')!.click();
		assert.ok(host.querySelector('.openide-chat-queue-body')!.classList.contains('hidden'));
		assert.strictEqual(host.querySelector('.openide-chat-queue-count')?.textContent, '1 pendiente');
	});
});
