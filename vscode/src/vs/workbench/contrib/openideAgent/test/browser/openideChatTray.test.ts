/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { OpenideChatComposerQueue } from '../../browser/chat/openideChatComposerQueue.js';
import { createChatTray } from '../../browser/chat/openideChatTray.js';
import { OpenideChatTerminalsTray } from '../../browser/chat/parts/openideChatTerminalsTray.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';

suite('OpenIDE composer tray expansion', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('one expanded sibling per parent, independent panes, and disposal releases ownership', () => {
		const parent = $('div');
		const first = store.add(createChatTray(parent, 'terms', 'terminal'));
		const second = store.add(createChatTray(parent, 'files', 'files'));
		const otherPane = store.add(createChatTray($('div'), 'terms', 'terminal'));
		const states: boolean[] = [];
		store.add(first.onDidChangeExpanded(expanded => states.push(expanded)));
		first.setExpanded(true);
		otherPane.setExpanded(true);
		second.setExpanded(true);
		assert.strictEqual(first.toggle.getAttribute('aria-expanded'), 'false');
		assert.ok(first.body.inert);
		assert.strictEqual(otherPane.toggle.getAttribute('aria-expanded'), 'true');
		assert.deepStrictEqual(states, [true, false]);
		first.setExpanded(false);
		assert.deepStrictEqual(states, [true, false], 'rendering unchanged state emits nothing');
		second.dispose();
		first.setExpanded(true);
		second.setExpanded(true);
		assert.strictEqual(first.toggle.getAttribute('aria-expanded'), 'true', 'a disposed tray cannot reclaim the composer');
		assert.strictEqual(second.domNode.parentElement, null);
	});

	test('real queue and terminals synchronize owner state, height events and restored queue data', () => {
		const parent = $('div');
		const storage = store.add(new InMemoryStorageService());
		const queue = store.add(new OpenideChatComposerQueue(parent, storage, NullHoverService));
		queue.setConversation('session');
		queue.push({ inputText: 'first', images: [], references: [], capabilities: [], links: [], mode: 'agent', providerId: 'p', modelId: 'm' });
		const terminal = store.add(new OpenideChatTerminalsTray(parent, { onDidChangeBackgroundTerminal: Event.None } as unknown as IOpenideAgentService, NullHoverService));
		terminal.update({ id: 'server', command: 'npm run dev', status: 'running' });
		const queueToggle = queue.domNode.querySelector<HTMLButtonElement>('.openide-chat-tray-toggle')!;
		const terminalToggle = terminal.domNode.querySelector<HTMLButtonElement>('.openide-chat-tray-toggle')!;
		let queueHeights = 0;
		let terminalHeights = 0;
		store.add(queue.onDidChangeHeight(() => queueHeights++));
		store.add(terminal.onDidChangeHeight(() => terminalHeights++));
		queueToggle.click();
		assert.strictEqual(queueToggle.getAttribute('aria-expanded'), 'true');
		const beforeCollapse = queueHeights;
		terminalToggle.click();
		assert.strictEqual(queueToggle.getAttribute('aria-expanded'), 'false');
		assert.ok(queueHeights > beforeCollapse, 'the peer collapse announces its settled height');
		assert.ok(!terminal.domNode.querySelector<HTMLElement>('.openide-chat-tray-body')!.inert);
		queue.push({ inputText: 'second', images: [], references: [], capabilities: [], links: [], mode: 'agent', providerId: 'p', modelId: 'm' });
		assert.strictEqual(queueToggle.getAttribute('aria-expanded'), 'false', 'a data refresh must not restore stale owner expansion');
		assert.strictEqual(terminalToggle.getAttribute('aria-expanded'), 'true');
		const beforeTerminalCollapse = terminalHeights;
		queueToggle.click();
		assert.strictEqual(queueToggle.getAttribute('aria-expanded'), 'true', 'one click reopens a peer-collapsed owner');
		assert.strictEqual(terminalToggle.getAttribute('aria-expanded'), 'false');
		assert.ok(terminalHeights > beforeTerminalCollapse);
		assert.strictEqual(queue.domNode.querySelectorAll('.openide-chat-queue-row').length, 2);
		queue.dispose();
		const restored = store.add(new OpenideChatComposerQueue(parent, storage, NullHoverService));
		restored.setConversation('session');
		assert.strictEqual(restored.length, 2, 'expansion never mutates queued work');
		const restoredToggle = restored.domNode.querySelector<HTMLButtonElement>('.openide-chat-tray-toggle')!;
		assert.strictEqual(restoredToggle.getAttribute('aria-expanded'), 'false');
		restoredToggle.click();
		assert.strictEqual(restored.domNode.querySelectorAll('.openide-chat-queue-row').length, 2);
	});
});
