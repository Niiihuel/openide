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
import { t } from '../../common/openideStrings.js';
import { IOpenideChatContent } from '../../common/chat/openideChatContent.js';
import { advanceOpenideChatResponseItem, createOpenideChatResponseItem, IOpenideChatItem } from '../../common/chat/openideChatItem.js';
import '../../browser/chat/media/openideChatNative.css';
import '../../browser/chat/media/openideChatLayout.css';

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

	test('settled actions group between prose without rebuilding parts or hiding failures', async () => {
		const command: IOpenideChatContent = { kind: 'terminal', callId: 'command', command: 'npm test', output: 'passed', state: 'exited', exitCode: 0, background: false };
		const read: IOpenideChatContent = { kind: 'explore', id: 'read', isComplete: true, entries: [{ callId: 'file', tool: 'read_file', target: 'app.ts', state: 'success' }] };
		const prose: IOpenideChatContent = { kind: 'markdown', value: new MarkdownString('A useful update') };
		const h = create([read, command, prose]);
		const group = h.host.querySelector<HTMLDetailsElement>('.openide-chat-work-group')!;
		const part = h.template.parts[1];
		assert.deepStrictEqual({ label: group.querySelector('summary')?.textContent, open: group.open, parts: group.querySelector('.openide-chat-work-group-body')?.children.length }, { label: 'Read files, ran commands', open: false, parts: 2 });
		group.open = true;
		h.update([read, command, prose, { ...command, callId: 'second' }], true);
		assert.strictEqual(h.template.parts[1], part);
		assert.strictEqual(h.host.querySelector('.openide-chat-work-group'), group);
		assert.ok(group.open);
		assert.strictEqual(h.host.querySelectorAll('.openide-chat-work-group').length, 2);
		h.update([read, { ...command, exitCode: 1 }, prose], true);
		assert.strictEqual(h.template.parts[1].domNode?.parentElement, h.template.partsHost);
		await flush();
	});

	test('live activity disclosure reuses records and returns the status node when prose starts', async () => {
		const phase: IOpenideChatContent = { kind: 'explore', id: 'phase', entries: [{ callId: 'read', tool: 'read_file', target: 'a.ts', state: 'running' }], isComplete: false };
		const h = create([phase]);
		const details = h.template.partsHost.querySelector<HTMLDetailsElement>('.openide-chat-activity-group')!;
		const button = h.template.status.domNode.querySelector<HTMLButtonElement>('.openide-chat-status-disclosure')!;
		assert.deepStrictEqual({ parent: h.template.status.domNode.parentElement === h.template.partsHost, next: h.template.status.domNode.nextSibling === details, expanded: button.getAttribute('aria-expanded') }, { parent: true, next: true, expanded: 'false' });
		button.click();
		assert.deepStrictEqual({ open: details.open, shown: getComputedStyle(details).display, expanded: button.getAttribute('aria-expanded') }, { open: true, shown: 'block', expanded: 'true' });
		h.update([phase]);
		assert.strictEqual(h.template.partsHost.querySelector('.openide-chat-activity-group'), details);
		h.update([phase, { kind: 'markdown', value: new MarkdownString('Result') }], true);
		await flush();
		assert.deepStrictEqual({ parent: h.template.status.domNode.parentElement === h.template.row, hidden: h.template.status.domNode.classList.contains('hidden'), open: details.open }, { parent: true, hidden: true, open: true });
	});

	test('questions share one bottom status through parallel activity and clear on completion', async () => {
		const ask: IOpenideChatContent = { kind: 'ask', requestId: 'ask', questions: [], isComplete: false };
		const phase: IOpenideChatContent = { kind: 'explore', id: 'phase', entries: [{ callId: 'read', tool: 'read_file', target: 'a.ts', state: 'running' }], isComplete: false };
		const h = create([ask, phase]);
		assert.strictEqual(h.template.status.domNode.parentElement, h.template.row);
		assert.strictEqual(h.template.status.domNode.querySelector('.openide-chat-response-working-label')?.textContent, t('chat.working.response'));
		assert.strictEqual(h.host.querySelector('.openide-chat-ask')?.getAttribute('hidden'), '');
		assert.strictEqual(h.host.querySelectorAll('.openide-chat-ask .openide-chat-shimmer').length, 0);
		h.update([{ ...ask, isComplete: true, answers: [] }], true);
		await flush();
		assert.ok(h.template.status.domNode.classList.contains('hidden'));
		assert.strictEqual(h.host.querySelector('.openide-chat-ask')?.hasAttribute('hidden'), false);
	});

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
		// Electron may throttle animation frames when another test window owns focus.
		// Wait for the observer outcome, retaining the strict height and geometry assertions.
		for (let i = 0; i < 200 && h.item().currentRenderedHeight === before; i++) { await timeout(10); }
		assert.ok(h.item().currentRenderedHeight! > before);
		assert.strictEqual(h.item().currentRenderedHeight, Math.ceil(h.template.row.getBoundingClientRect().height));
	});
});
