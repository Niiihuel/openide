/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { OpenideChatComposer } from '../../browser/chat/openideChatComposer.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import '../../browser/chat/media/openideChatNative.css';
import '../../browser/chat/media/openideChatNotice.css';

suite('OpenIDE composer dock layout', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('companion shares drafts and queues without dispatching the owner queue twice', () => {
		const host = document.body.appendChild($('.openide-chat-native'));
		store.add(toDisposable(() => host.remove()));
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(IOpenideAgentService, new class extends mock<IOpenideAgentService>() {
			override onDidChange = Event.None;
			override onDidChangePlanFollow = Event.None;
			override onDidPickElement = Event.None;
			override getPermissionMode() { return 'ask' as const; }
			override isPlanFollowEnabled() { return false; }
			override async getVoiceCapability() { return { available: false }; }
			override async ensureModelCatalog() { }
			override getActiveProviderId() { return ''; }
			override findProvider() { return undefined; }
			override getModel() { return ''; }
			override getModelReasoning() { return undefined; }
		});
		const sources = { queryFiles: async () => [], queryCommands: async () => [] };
		const owner = store.add(instantiation.createInstance(OpenideChatComposer, host, sources));
		const companion = store.add(instantiation.createInstance(OpenideChatComposer, host, sources));
		companion.shareQueueWith(owner);
		owner.setConversation('shared');
		companion.setConversation('shared');
		store.add(owner.onDidChangeDraft(draft => companion.setSharedDraft(draft)));
		store.add(companion.onDidChangeDraft(draft => owner.setSharedDraft(draft)));
		const sent: string[] = [];
		store.add(owner.onDidSubmit(request => sent.push(`owner:${request.text}`)));
		store.add(companion.onDidSubmit(request => sent.push(`companion:${request.text}`)));
		owner.value = 'shared draft';
		assert.strictEqual(companion.value, 'shared draft');
		companion.value = 'reply while running';
		owner.setBusy(true);
		companion.setBusy(true);
		companion.submit();
		assert.deepStrictEqual([owner.value, companion.value, owner.queueLength, companion.queueLength], ['', '', 1, 1]);
		companion.setBusy(false);
		assert.deepStrictEqual(sent, []);
		owner.setBusy(false);
		assert.deepStrictEqual(sent, ['owner:reply while running']);
	});

	test('notice, questions and trays stay above input and are included once in dock height', async () => {
		const host = document.body.appendChild($('.openide-chat-native'));
		host.style.width = '440px';
		store.add(toDisposable(() => host.remove()));
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(IOpenideAgentService, new class extends mock<IOpenideAgentService>() {
			override onDidChange = Event.None;
			override onDidChangePlanFollow = Event.None;
			override onDidPickElement = Event.None;
			override getPermissionMode() { return 'ask' as const; }
			override isPlanFollowEnabled() { return false; }
			override async getVoiceCapability() { return { available: false }; }
			override async ensureModelCatalog() { }
			override getActiveProviderId() { return ''; }
			override findProvider() { return undefined; }
			override getModel() { return ''; }
			override getModelReasoning() { return undefined; }
		});
		const composer = store.add(instantiation.createInstance(OpenideChatComposer, host, { queryFiles: async () => [], queryCommands: async () => [] }));
		composer.value = 'Keep this draft';
		composer.focus();
		await timeout(0);
		const prompt = composer.domNode.querySelector<HTMLTextAreaElement>('textarea')!;
		prompt.setSelectionRange(2, 6);
		const notice = composer.noticeHost.appendChild($('.openide-chat-notice', undefined, 'Wait for the current run to finish before editing a message.'));
		assert.strictEqual(composer.questionsHost, composer.trayHost);
		const questions = composer.questionsHost.appendChild($('div', undefined, 'Question awaiting an answer'));
		const files = composer.trayHost.appendChild($('div', undefined, '4 changed files'));
		const terminals = composer.trayHost.appendChild($('div', undefined, '1 background terminal'));
		for (const width of [440, 280, 700]) {
			host.style.width = `${width}px`;
			composer.layout(width);
			const nodes = [notice, questions, files, terminals, prompt];
			for (let i = 1; i < nodes.length; i++) {
				assert.ok(nodes[i].getBoundingClientRect().top >= nodes[i - 1].getBoundingClientRect().bottom);
			}
			const before = composer.height.get();
			const noticeHeight = notice.getBoundingClientRect().height + 8;
			notice.classList.add('hidden');
			composer.remeasure();
			assert.ok(Math.abs(before - composer.height.get() - noticeHeight) < 1, JSON.stringify({ before, after: composer.height.get(), noticeHeight, margin: getComputedStyle(notice).margin }));
			notice.classList.remove('hidden');
			composer.remeasure();
			assert.strictEqual(composer.height.get(), before);
		}
		assert.strictEqual(document.activeElement, prompt);
		assert.deepStrictEqual([composer.value, prompt.selectionStart, prompt.selectionEnd], ['Keep this draft', 2, 6]);
	});
});
