/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { ITreeNode } from '../../../../../base/browser/ui/tree/tree.js';
import { timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IOpenideChatItemHeightChange, OpenideChatResponseRenderer } from '../../browser/chat/openideChatResponseRenderer.js';
import { IOpenideChatContent } from '../../common/chat/openideChatContent.js';
import { advanceOpenideChatResponseItem, createOpenideChatResponseItem, IOpenideChatItem } from '../../common/chat/openideChatItem.js';
import '../../browser/chat/media/openideChatNative.css';

suite('OpenIDE ChatResponseRenderer layout', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const reasoning = (complete: boolean): IOpenideChatContent => ({ kind: 'thinking', text: 'A line of reasoning\n'.repeat(20), isComplete: complete, durationMs: 7000 });

	function create(content: readonly IOpenideChatContent[]) {
		const host = document.body.appendChild($('.openide-chat-native'));
		host.style.width = '440px';
		store.add(toDisposable(() => host.remove()));
		const instantiation = workbenchInstantiationService(undefined, store);
		const renderer = store.add(instantiation.createInstance(OpenideChatResponseRenderer, observableValue('width', 440), Event.None));
		const template = renderer.renderTemplate(host);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));
		const heights: IOpenideChatItemHeightChange[] = [];
		store.add(renderer.onDidChangeItemHeight(event => heights.push(event)));
		let item = createOpenideChatResponseItem({ id: 'response', requestId: 'request', content });
		const render = () => renderer.renderElement(new class extends mock<ITreeNode<IOpenideChatItem, FuzzyScore>>() { override element = item; }, 0, template);
		render();
		return { host, template, heights, item: () => item, update: (content: readonly IOpenideChatContent[], complete = false) => {
			item = advanceOpenideChatResponseItem(item, { content, isComplete: complete });
			render();
		} };
	}

	async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

	test('finished reasoning leaves no painted text below its collapsed summary', async () => {
		const h = create([reasoning(false)]);
		await flush();
		const before = h.item().currentRenderedHeight!;
		h.update([reasoning(true), { kind: 'tool', callId: 'eval', name: 'browser_evaluate', argumentsJson: '{}', state: 'success', resultText: 'Done' }]);
		await flush();
		const details = h.template.partsHost.querySelector('details')!;
		const body = details.querySelector<HTMLElement>('.openide-chat-think')!;
		const tool = h.template.partsHost.querySelector<HTMLElement>('.openide-chat-tool-activity')!;
		assert.deepStrictEqual({ open: details.open, hidden: getComputedStyle(body).display, overlaps: tool.getBoundingClientRect().top < details.getBoundingClientRect().bottom }, { open: false, hidden: 'none', overlaps: false });
		assert.ok(h.item().currentRenderedHeight! < before);
	});

	test('new content and completion report the final height once per render burst', async () => {
		const h = create([]);
		await flush();
		h.heights.length = 0;
		h.update([{ kind: 'markdown', value: new MarkdownString('First paragraph') }]);
		h.update([{ kind: 'markdown', value: new MarkdownString('First paragraph\n\nSecond paragraph\n\nThird paragraph') }], true);
		await flush();
		assert.deepStrictEqual(h.heights.map(event => ({ current: event.element === h.item(), height: event.height })), [{ current: true, height: Math.ceil(h.template.row.getBoundingClientRect().height) }]);
	});

	test('measures multiple dirty rows before any list layout notification', async () => {
		const h = create([]);
		await flush();
		const instantiation = workbenchInstantiationService(undefined, store);
		const renderer = store.add(instantiation.createInstance(OpenideChatResponseRenderer, observableValue('width', 440), Event.None));
		const order: string[] = [];
		store.add(renderer.onDidChangeItemHeight(() => order.push('notify')));
		for (const id of ['first', 'second']) {
			const template = renderer.renderTemplate(h.host);
			store.add(toDisposable(() => renderer.disposeTemplate(template)));
			const rect = template.row.getBoundingClientRect.bind(template.row);
			template.row.getBoundingClientRect = () => { order.push('measure'); return rect(); };
			const item = createOpenideChatResponseItem({ id, requestId: 'request', content: [{ kind: 'markdown', value: new MarkdownString(id) }] });
			renderer.renderElement(new class extends mock<ITreeNode<IOpenideChatItem, FuzzyScore>>() { override element = item; }, 0, template);
		}
		order.length = 0;
		await flush();
		assert.deepStrictEqual(order, ['measure', 'measure', 'notify', 'notify']);
	});

	test('layout changes outside content updates refresh the virtual row height', async () => {
		const h = create([{ kind: 'markdown', value: new MarkdownString('Wrapping text '.repeat(100)) }]);
		await flush();
		const before = h.item().currentRenderedHeight!;
		h.host.style.width = '220px';
		for (let i = 0; i < 40 && h.item().currentRenderedHeight === before; i++) { await timeout(10); }
		assert.ok(h.item().currentRenderedHeight! > before);
		assert.strictEqual(h.item().currentRenderedHeight, Math.ceil(h.template.row.getBoundingClientRect().height));
	});
});
