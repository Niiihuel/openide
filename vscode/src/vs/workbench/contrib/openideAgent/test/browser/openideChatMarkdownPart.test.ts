/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { TestClipboardService } from '../../../../../platform/clipboard/test/common/testClipboardService.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IOpenideChatContentPartContext } from '../../browser/chat/openideChatContentPart.js';
import { OpenideChatMarkdownRenderer } from '../../browser/chat/openideChatMarkdown.js';
import { OPENIDE_CHAT_MARKDOWN_STREAMING_CLASS, OpenideChatMarkdownPart } from '../../browser/chat/parts/openideChatMarkdownPart.js';
import { IOpenideChatMarkdownContent } from '../../common/chat/openideChatContent.js';
import { IOpenideChatItem } from '../../common/chat/openideChatItem.js';

/**
 * The streamed prose, and the one property that makes streaming affordable: a delta only touches
 * the blocks that changed. Everything above the caret — tokenized fences, the user's selection,
 * the hovers — has to survive a re-render untouched, and the re-render has to be synchronous so
 * the list can measure the row it just painted.
 */
suite('OpenIDE ChatMarkdownPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function markdown(value: string): IOpenideChatMarkdownContent {
		return { kind: 'markdown', value: new MarkdownString(value) };
	}

	function create(text: string, isComplete = false) {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const opened: string[] = [];
		instantiationService.stub(IOpenerService, {
			open: (target: URI | string) => { opened.push(String(target)); return Promise.resolve(true); },
		} as unknown as IOpenerService);
		const clipboard = new TestClipboardService();
		instantiationService.stub(IClipboardService, clipboard);
		const renderer = instantiationService.createInstance(OpenideChatMarkdownRenderer);
		const element = { isComplete } as IOpenideChatItem;
		const part = store.add(new OpenideChatMarkdownPart(markdown(text), { element } as IOpenideChatContentPartContext, renderer));
		return { part, element, opened, clipboard };
	}

	test('a delta keeps the blocks that did not change and swaps the one that did', () => {
		const { part, element } = create('First paragraph.\n\nSecond paragraph');
		const [first, second] = Array.from(part.domNode.children);
		assert.strictEqual(part.domNode.children.length, 2);

		assert.ok(part.tryUpdate(markdown('First paragraph.\n\nSecond paragraph grows here'), element));

		assert.strictEqual(part.domNode.children.length, 2);
		assert.strictEqual(part.domNode.children[0], first, 'the untouched block is the same node');
		assert.notStrictEqual(part.domNode.children[1], second, 'the block that changed was replaced');
		assert.ok(part.domNode.children[1].textContent?.includes('grows here'));
	});

	test('blocks past the end of the new content are dropped', () => {
		const { part, element } = create('One\n\nTwo\n\nThree');
		assert.strictEqual(part.domNode.children.length, 3);
		part.tryUpdate(markdown('One'), element);
		assert.strictEqual(part.domNode.children.length, 1);
		assert.strictEqual(part.domNode.textContent?.trim(), 'One');
	});

	test('a fence is tokenized synchronously and its source is what the copy button copies', async () => {
		const { part, clipboard } = create('Look:\n\n```plaintext\nline one\nline two\n```\n');
		const fence = part.domNode.querySelector('.openide-chat-codeblock');
		assert.ok(fence, 'the fence is wrapped in the copy frame');
		// No await between render and this assertion: the tokens are there when `render` returns.
		assert.ok(fence.querySelector('div[data-code] .monaco-tokenized-source'), 'the fence is tokenized on the spot');

		const button = fence.querySelector<HTMLButtonElement>('button.openide-chat-codeblock-copy');
		assert.ok(button);
		button.click();
		await new Promise(resolve => setTimeout(resolve, 0));
		// The tokenized markup breaks lines with <br>; the source has to come from the fence itself.
		assert.strictEqual(await clipboard.readText(), 'line one\nline two');
	});

	test('a fence above the caret survives the deltas below it', () => {
		const { part, element } = create('```plaintext\nstable\n```\n\nTail');
		const fence = part.domNode.children[0];
		part.tryUpdate(markdown('```plaintext\nstable\n```\n\nTail keeps'), element);
		part.tryUpdate(markdown('```plaintext\nstable\n```\n\nTail keeps growing'), element);
		assert.strictEqual(part.domNode.children[0], fence, 'the fence was never rebuilt');
	});

	test('links open through the opener, from the part\'s own root', () => {
		const { part, opened } = create('See [the docs](https://example.com/docs).');
		const anchor = part.domNode.querySelector('a');
		assert.ok(anchor);
		anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
		assert.strictEqual(opened.length, 1);
		assert.ok(opened[0].startsWith('https://example.com/docs'), opened[0]);
	});

	test('completing the turn drops the streaming class', () => {
		const { part } = create('Half a **sentence');
		assert.ok(part.domNode.classList.contains(OPENIDE_CHAT_MARKDOWN_STREAMING_CLASS));
		assert.ok(part.tryUpdate(markdown('Half a **sentence**'), { isComplete: true } as IOpenideChatItem));
		assert.ok(!part.domNode.classList.contains(OPENIDE_CHAT_MARKDOWN_STREAMING_CLASS));
		assert.ok(part.domNode.querySelector('strong'));
	});
});
