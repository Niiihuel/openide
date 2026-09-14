/* Copyright (c) OpenIDE. Licensed under the MIT License. */
import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { ITreeNode } from '../../../../../base/browser/ui/tree/tree.js';
import { FuzzyScore } from '../../../../../base/common/filters.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { BrowserEditorInput } from '../../../browserView/common/browserEditorInput.js';
import { IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { OpenideChatResponseRenderer } from '../../browser/chat/openideChatResponseRenderer.js';
import { IOpenideChatToolContent } from '../../common/chat/openideChatContent.js';
import { advanceOpenideChatResponseItem, createOpenideChatResponseItem, IOpenideChatItem } from '../../common/chat/openideChatItem.js';
import { webPreviewFromTool } from '../../common/chat/openideChatWebPreview.js';

suite('OpenIDE chat web preview', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const tool: IOpenideChatToolContent = { kind: 'tool', callId: 'nav', name: 'browser_navigate', state: 'success', argumentsJson: '{"url":"http://localhost:8091"}', resultText: 'OK: loaded http://localhost:8091/sign-in (title: My app (dev)).' };
	test('uses the final navigated URL and retains titles from saved results', () => {
		assert.deepStrictEqual(webPreviewFromTool(JSON.parse(JSON.stringify(tool))), { url: 'http://localhost:8091/sign-in', title: 'My app (dev)' });
		assert.equal(webPreviewFromTool({ ...tool, resultText: 'OK: loaded http://localhost:8091/ (title: untitled).' })?.title, '');
	});
	test('does not infer a preview from pending, failed, unrelated or unsafe results', () => {
		for (const content of [
			{ ...tool, state: 'running' as const }, { ...tool, state: 'error' as const }, { ...tool, state: 'cancelled' as const },
			{ ...tool, name: 'read_file' }, { ...tool, resultText: 'Error: navigation failed' },
			{ ...tool, resultText: 'OK: loaded command:workbench.action.closeWindow (title: unsafe).' },
			{ ...tool, resultText: 'OK: loaded https://user:secret@example.com/ (title: private).' },
		]) { assert.equal(webPreviewFromTool(content), undefined); }
	});
	test('live completion replaces the activity row; replay and rerender never open a browser', async () => {
		const host = document.body.appendChild($('.openide-chat-native'));
		store.add(toDisposable(() => host.remove()));
		const instantiation = workbenchInstantiationService(undefined, store);
		const opens: unknown[] = [];
		instantiation.stub(IBrowserViewWorkbenchService, { openPreview: async (...args: unknown[]) => { opens.push(args); return new (mock<BrowserEditorInput>())(); } });
		const renderer = store.add(instantiation.createInstance(OpenideChatResponseRenderer, observableValue('width', 440), Event.None));
		const template = renderer.renderTemplate(host);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));
		let item = createOpenideChatResponseItem({ id: 'response', requestId: 'request', content: [{ ...tool, state: 'running', resultText: undefined }] });
		const render = () => renderer.renderElement(new class extends mock<ITreeNode<IOpenideChatItem, FuzzyScore>>() { override element = item; }, 0, template);
		render();
		assert.equal(host.querySelector('.openide-chat-resource-card'), null);
		item = advanceOpenideChatResponseItem(item, { content: [tool], isComplete: true });
		render();
		const card = host.querySelector('.openide-chat-resource-card');
		assert.ok(card);
		render();
		assert.equal(host.querySelector('.openide-chat-resource-card'), card);
		assert.equal(opens.length, 0);
		assert.equal(card.querySelector('.openide-chat-resource-full'), null);
		assert.ok(card.querySelector('.oi-split-more'));
		(card.querySelector('.oi-split-main') as HTMLElement).click();
		await Promise.resolve();
		assert.equal(opens.length, 1);
		assert.equal((opens[0] as [unknown, unknown, { modal: boolean }])[2].modal, false);
		item = advanceOpenideChatResponseItem(item, { content: [tool, { ...tool, callId: 'nav-again' }] });
		render();
		assert.equal(host.querySelectorAll('.openide-chat-resource-card:not([hidden])').length, 1);
		item = createOpenideChatResponseItem({ id: 'replayed', requestId: 'request', content: [tool], isComplete: true });
		render();
		assert.equal(host.querySelectorAll('.openide-chat-resource-card').length, 1);
		assert.equal(opens.length, 1);
	});
});
