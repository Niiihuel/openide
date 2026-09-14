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
		host.querySelector<HTMLButtonElement>('.openide-chat-queue-toggle')!.click();
		assert.strictEqual(host.querySelectorAll('.openide-chat-queue-row').length, 1);
		assert.strictEqual(host.querySelector('.openide-chat-queue-count')?.textContent, t('chatSurface.queue.one'));
		assert.strictEqual(host.querySelector('.openide-chat-queue-text')?.textContent, 'hola');
	});

	test('companion mutations share one queue and survive disposing the companion', () => {
		const owner = create();
		const companion = create(owner.storage);
		owner.queue.setConversation('shared');
		companion.queue.shareWith(owner.queue);
		companion.queue.setConversation('shared');
		companion.queue.push(entry('from companion'));
		assert.deepStrictEqual([owner.queue.length, companion.queue.length, owner.host.querySelector('.openide-chat-queue-count')?.textContent], [1, 1, t('chatSurface.queue.one')]);
		assert.strictEqual(owner.queue.shift()?.inputText, 'from companion');
		assert.strictEqual(companion.queue.length, 0);
		companion.queue.push(entry('kept after closing'));
		companion.queue.dispose();
		assert.strictEqual(owner.queue.shift()?.inputText, 'kept after closing');
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
		host.querySelector<HTMLButtonElement>('.openide-chat-queue-toggle')!.click();
		const edited: string[] = [];
		const sent: string[] = [];
		store.add(queue.onDidRequestEdit(({ entry }) => edited.push(entry.inputText)));
		store.add(queue.onDidRequestSendNow(({ entry }) => sent.push(entry.inputText)));
		const rows = () => Array.from(host.querySelectorAll('.openide-chat-queue-row'));
		assert.strictEqual(rows()[1].querySelector('.openide-chat-queue-intent')?.textContent, t('chat.queue.afterPlan'));
		rows()[0].querySelector<HTMLElement>('.codicon-edit')!.parentElement!.click();
		assert.deepStrictEqual(edited, ['e']);
		rows()[0].querySelector<HTMLButtonElement>('.openide-chat-queue-send')!.click();
		assert.deepStrictEqual(sent, ['s']);
		rows()[0].querySelector<HTMLElement>('.codicon-trash')!.parentElement!.click();
		assert.strictEqual(queue.length, 0);
		assert.ok(queue.domNode.classList.contains('hidden'));
	});

	test('collapse keeps the next request visible while folding the remainder', () => {
		const { host, queue } = create();
		queue.setConversation('c1');
		queue.push(entry('x')); queue.push(entry('y'));
		const toggle = host.querySelector<HTMLButtonElement>('.openide-chat-queue-toggle')!;
		assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
		toggle.click();
		assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
		toggle.click();
		assert.ok(!host.querySelector<HTMLElement>('.openide-chat-queue-body')!.inert);
		assert.strictEqual(host.querySelectorAll('.openide-chat-queue-row').length, 1);
		assert.strictEqual(host.querySelector('.openide-chat-queue-count')?.textContent, t('chatSurface.queue.many', 2));
	});
});
