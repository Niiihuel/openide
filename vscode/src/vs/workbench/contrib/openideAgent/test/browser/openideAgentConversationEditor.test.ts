/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { OpenideChatListWidget } from '../../browser/chat/openideChatListWidget.js';
import { OpenideChatRequestRenderer } from '../../browser/chat/openideChatRequestRenderer.js';
import { OpenideChatResponseRenderer } from '../../browser/chat/openideChatResponseRenderer.js';
import { OpenideChatWidget } from '../../browser/chat/openideChatWidget.js';
import { OpenideAgentConversationEditor, OpenideAgentConversationInput } from '../../browser/openideAgentConversationEditor.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { IOpenideChatItem } from '../../common/chat/openideChatItem.js';

suite('OpenIDE complete conversation viewer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create() {
		const storage = store.add(new TestStorageService());
		const sessions = new OpenideChatSessions(storage);
		const archived = sessions.createBackground('Archived image', [{ role: 'user', content: 'Look at this', images: [{ mimeType: 'image/png', data: '', assetUri: 'file:///archived.png' }] }]);
		sessions.archiveBeforeCompaction(archived, sessions.messagesOf(archived));
		sessions.save(archived, [{ role: 'user', content: 'Current model context' }], false);
		const other = sessions.createBackground('Other conversation', [{ role: 'user', content: 'Other request' }]);
		const source = new class extends mock<OpenideChatWidget>() { override get sessionStore() { return sessions; } };
		const instantiation = workbenchInstantiationService(undefined, store);
		const read = new DeferredPromise<void>();
		let reads = 0;
		instantiation.stub(IFileService, new class extends mock<IFileService>() {
			override async readFile() {
				reads++;
				await read.p;
				return new class extends mock<IFileContent>() { override value = VSBuffer.fromString('archived image bytes'); };
			}
		});
		let items: readonly IOpenideChatItem[] = [];
		let renders = 0;
		instantiation.stubInstance(OpenideChatListWidget, {
			dispose() {}, getItems: () => items, setItems: value => { items = value; renders++; }, scrollToEnd() {}, setVisible() {}, scrollTop: 0,
		});
		instantiation.stubInstance(OpenideChatRequestRenderer, { dispose() {}, onDidChangeItemHeight: Event.None });
		instantiation.stubInstance(OpenideChatResponseRenderer, { dispose() {}, onDidChangeItemHeight: Event.None });
		const editor = store.add(instantiation.createInstance(OpenideAgentConversationEditor, new class extends mock<IEditorGroup>() {}));
		editor.create($('div'));
		return {
			editor, sessions, archived, other, items: () => items, renders: () => renders, reads: () => reads,
			open: (id: string) => editor.setInput(store.add(new OpenideAgentConversationInput(id, source)), undefined, {}, CancellationToken.None),
			finishRead: async () => { await read.complete(); await timeout(0); },
		};
	}

	test('hydrates archived images without restoring archived turns into the model context', async () => {
		const h = create();
		await h.open(h.archived);
		await h.finishRead();
		assert.deepStrictEqual({
			image: h.items().flatMap(item => item.kind === 'request' ? item.images ?? [] : [])[0]?.data,
			modelContext: h.sessions.messagesOf(h.archived).map(message => message.content),
			archiveData: h.sessions.archivedMessagesOf(h.archived)[0].images?.[0].data,
		}, { image: encodeBase64(VSBuffer.fromString('archived image bytes')), modelContext: ['Current model context'], archiveData: '' });
	});

	test('streaming revisions reuse hydrated archive assets', async () => {
		const h = create();
		await h.open(h.archived);
		await h.finishRead();
		h.sessions.save(h.archived, [{ role: 'user', content: 'Latest model context' }], false);
		h.editor.setVisible(true);
		await timeout(0);
		assert.deepStrictEqual({ reads: h.reads(), text: h.items().filter(item => item.kind === 'request').map(item => item.text) }, { reads: 1, text: ['Look at this', 'Latest model context'] });
	});

	test('a late image read cannot replace the newly selected conversation', async () => {
		const h = create();
		await h.open(h.archived);
		await h.open(h.other);
		const renders = h.renders();
		await h.finishRead();
		assert.deepStrictEqual({ renders: h.renders(), text: h.items().map(item => item.kind === 'request' ? item.text : '') }, { renders, text: ['Other request'] });
	});

	for (const action of ['clear', 'dispose'] as const) {
		test(`a late image read cannot repaint after ${action}`, async () => {
			const h = create();
			await h.open(h.archived);
			if (action === 'clear') { h.editor.clearInput(); } else { h.editor.dispose(); }
			const renders = h.renders();
			await h.finishRead();
			assert.strictEqual(h.renders(), renders);
		});
	}
});
