/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { createFileChange } from '../../common/openideMessageChanges.js';

suite('OpenIDE ChatSessions change sets', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Changes retain exact ownership across switching, interleaved edits and restart', () => {
		const storage = new TestStorageService();
		try {
			const sessions = new OpenideChatSessions(storage);
			const a = sessions.createBackground('A', [{ role: 'user', content: 'A' }]);
			const b = sessions.createBackground('B', [{ role: 'user', content: 'B' }]);
			sessions.saveChangeSet(a, { messageId: 'a1', timestamp: 1, state: 'finalized', files: [createFileChange('file:///shared.ts', 'modify', 'initial', 'A')] });
			sessions.saveChangeSet(b, { messageId: 'b1', timestamp: 2, state: 'finalized', files: [createFileChange('file:///shared.ts', 'modify', 'A', 'B')] });
			sessions.saveChangeSet(a, { messageId: 'a2', timestamp: 3, state: 'finalized', files: [createFileChange('file:///shared.ts', 'modify', 'B', 'A again')] });
			assert.deepStrictEqual(sessions.changesOf(a).map(f => [f.before, f.after]), [['initial', 'A'], ['B', 'A again']]);
			assert.deepStrictEqual(sessions.changesOf(b).map(f => [f.before, f.after]), [['A', 'B']]);
			const restored = new OpenideChatSessions(storage);
			assert.deepStrictEqual(restored.changesOf(a), sessions.changesOf(a));
			assert.deepStrictEqual(restored.changesOf(b), sessions.changesOf(b));
			assert.deepStrictEqual(restored.changesOf('missing'), []);
			const before = restored.changesOf(a);
			restored.rename(a, 'Renamed');
			assert.strictEqual(restored.changesOf(a), before, 'metadata never recomputes receipts');
			restored.removeChangeSets(a, ['a2']);
			assert.strictEqual(restored.changesOf(a).length, 1);
		} finally { storage.dispose(); }
	});

	test('contiguous receipts combine without including unrelated paths or unavailable history', () => {
		const storage = new TestStorageService();
		try {
			const sessions = new OpenideChatSessions(storage);
			const id = sessions.create();
			sessions.saveChangeSet(id, { messageId: '1', timestamp: 1, state: 'finalized', files: [createFileChange('file:///a.ts', 'create', undefined, 'one')] });
			sessions.saveChangeSet(id, { messageId: '2', timestamp: 2, state: 'open', files: [createFileChange('file:///a.ts', 'modify', 'one', 'two')] });
			assert.deepStrictEqual(sessions.changesOf(id).map(f => [f.before, f.after]), [['', 'two']]);
			sessions.saveChangeSet(id, { messageId: '3', timestamp: 3, state: 'finalized', files: [createFileChange('file:///a.ts', 'delete', 'two', undefined)] });
			assert.deepStrictEqual(sessions.changesOf(id), []);
		} finally { storage.dispose(); }
	});

	test('message revisions ignore metadata and track in-place streaming saves', () => {
		const storage = new TestStorageService();
		const sessions = new OpenideChatSessions(storage);
		const child = sessions.createBackground('Explore', [{ role: 'assistant', content: 'First' }]);
		const unrelated = sessions.createBackground('Other', []);
		assert.strictEqual(sessions.messageVersionOf(child), 0);
		sessions.rename(child, 'Custom title');
		sessions.save(unrelated, [{ role: 'user', content: 'Unrelated' }], false);
		assert.strictEqual(sessions.messageVersionOf(child), 0);
		const messages = sessions.messagesOf(child);
		messages[0].content += ' chunk';
		sessions.save(child, messages, false);
		assert.strictEqual(sessions.messageVersionOf(child), 1);
		sessions.save(child, messages, false);
		assert.strictEqual(sessions.messageVersionOf(child), 2);
		assert.strictEqual(sessions.messageVersionOf('missing'), undefined);
		storage.dispose();
	});

	test('specialist identity, owning conversation and name survive transcript updates and reload', () => {
		const storage = new TestStorageService();
		const sessions = new OpenideChatSessions(storage);
		const parent = sessions.create();
		const messages = [{ role: 'user' as const, content: 'A very long detailed task prompt' }];
		const child = sessions.createBackground('Explore', messages, 'run-1', parent);
		sessions.save(child, [...messages, { role: 'assistant', content: 'Done' }], false);
		const restored = new OpenideChatSessions(storage);
		assert.strictEqual(restored.metaOf(child)?.subagentRunId, 'run-1');
		assert.strictEqual(restored.metaOf(child)?.parentSessionId, parent);
		assert.strictEqual(restored.metaOf(child)?.title, 'A very long detailed task prompt');
		storage.dispose();
	});

	test('restored generic subagent names use the task while custom names survive', () => {
		const storage = new TestStorageService();
		const sessions = new OpenideChatSessions(storage);
		const parent = sessions.create();
		const child = sessions.createBackground('Explore', [], 'run-1', parent);
		sessions.linkSubagentParent(child, parent, 'Check the Spanish landing. Report broken links.', 'Explore');
		assert.strictEqual(sessions.metaOf(child)?.title, 'Check the Spanish landing.');
		sessions.rename(child, 'My review');
		sessions.linkSubagentParent(child, parent, 'Changed task', 'Explore');
		assert.strictEqual(sessions.metaOf(child)?.title, 'My review');
		storage.dispose();
	});

	test('persists messageId association across service restart', () => {
		const storage = new TestStorageService();
		const first = new OpenideChatSessions(storage);
		const id = first.create();
		const messages = [{ role: 'user' as const, content: 'edit', messageId: 'message-A' }];
		first.save(id, messages, false);
		first.saveChangeSet(id, { messageId: 'message-A', timestamp: 1, state: 'finalized', files: [createFileChange('a.ts', 'modify', 'before', 'after')] });
		const restored = new OpenideChatSessions(storage);
		assert.strictEqual(restored.messagesOf(id)[0].messageId, 'message-A');
		assert.strictEqual(restored.changeSetOf(id, 'message-A')?.files[0].afterContent, 'after');
		storage.dispose();
	});

	test('fork deep-copies messages and change sets', () => {
		const storage = new TestStorageService();
		const sessions = new OpenideChatSessions(storage);
		const id = sessions.create();
		sessions.save(id, [{ role: 'user', content: 'edit', messageId: 'message-A' }], false);
		sessions.saveChangeSet(id, { messageId: 'message-A', timestamp: 1, state: 'finalized', files: [createFileChange('a.ts', 'modify', 'before', 'after')] });
		const fork = sessions.fork(id)!;
		const forkSet = sessions.changeSetOf(fork, 'message-A')!;
		(forkSet.files as any[])[0].afterContent = 'mutated';
		assert.strictEqual(sessions.changeSetOf(id, 'message-A')?.files[0].afterContent, 'after');
		assert.strictEqual(sessions.changeSetOf(fork, 'message-A')?.files[0].afterContent, 'after');
		storage.dispose();
	});

	test('persists image assets without embedding base64 and keeps a fallback when needed', () => {
		const storage = new TestStorageService();
		const first = new OpenideChatSessions(storage);
		const id = first.create();
		first.save(id, [{
			role: 'user', content: 'compará estas imágenes', messageId: 'message-images', images: [
				{ mimeType: 'image/png', data: 'large-base64', assetUri: 'file:///workspaceStorage/openide/image.png' },
				{ mimeType: 'image/webp', data: 'fallback-base64' },
			],
		}], false);

		const restored = new OpenideChatSessions(storage).messagesOf(id)[0].images!;
		assert.deepStrictEqual(restored[0], { mimeType: 'image/png', data: '', assetUri: 'file:///workspaceStorage/openide/image.png' });
		assert.deepStrictEqual(restored[1], { mimeType: 'image/webp', data: 'fallback-base64' });

		const fork = first.fork(id)!;
		assert.strictEqual(first.messagesOf(fork)[0].images?.[0].assetUri, 'file:///workspaceStorage/openide/image.png');
		storage.dispose();
	});

	test('change sets remain outside transcript truncation and are removed explicitly', () => {
		const storage = new TestStorageService();
		const sessions = new OpenideChatSessions(storage);
		const id = sessions.create();
		sessions.saveChangeSet(id, { messageId: 'message-A', timestamp: 1, state: 'finalized', files: [] });
		sessions.save(id, [{ role: 'assistant', content: 'compacted', compaction: { beforeTokens: 10, afterTokens: 2, savingsPercent: 80, origin: 'automatic' } }], false);
		assert.ok(sessions.changeSetOf(id, 'message-A'));
		sessions.removeChangeSets(id, ['message-A']);
		assert.strictEqual(sessions.changeSetOf(id, 'message-A'), undefined);
		storage.dispose();
	});
});

suite('OpenIDE ChatSessions — VS Code session semantics', () => {
	function make() {
		const storage = new TestStorageService();
		return { storage, sessions: new OpenideChatSessions(storage) };
	}
	const user = (content: string) => ({ role: 'user' as const, content, messageId: content });

	test('create() reuses the active empty session instead of stacking tabs', () => {
		const { storage, sessions } = make();
		const first = sessions.create();
		assert.strictEqual(sessions.create(), first, 'an empty active chat IS the new chat');
		sessions.save(first, [user('hola')], false);
		const second = sessions.create();
		assert.notStrictEqual(second, first, 'a chat with turns is not reused');
		assert.strictEqual(sessions.openTabs().length, 2);
		storage.dispose();
	});

	test('closing the tab of an empty unnamed session deletes it outright', () => {
		const { storage, sessions } = make();
		const used = sessions.create();
		sessions.save(used, [user('hola')], false);
		const empty = sessions.create();
		sessions.closeTab(empty);
		assert.ok(!sessions.listAll().some(s => s.id === empty), 'the husk is gone from history');
		sessions.closeTab(used);
		assert.ok(sessions.listAll().some(s => s.id === used), 'a real conversation survives its tab');
		storage.dispose();
	});

	test('a manual rename freezes the title; clearing it returns to the derived one', () => {
		const { storage, sessions } = make();
		const id = sessions.create();
		sessions.save(id, [user('primer mensaje')], false);
		sessions.rename(id, 'Mi investigación');
		sessions.save(id, [user('primer mensaje')], false);
		assert.strictEqual(sessions.listAll()[0].title, 'Mi investigación');
		sessions.rename(id, '');
		assert.strictEqual(sessions.listAll()[0].title, 'primer mensaje');
		storage.dispose();
	});

	test('pins and custom titles survive reload without changing activity order', () => {
		const { storage, sessions } = make();
		const id = sessions.create();
		sessions.save(id, [user('Original title')], false);
		const before = sessions.metaOf(id)!.updatedAt;
		sessions.rename(id, 'Pinned investigation');
		sessions.setPinned(id, true);
		const restored = new OpenideChatSessions(storage);
		assert.strictEqual(restored.metaOf(id)?.pinned, true);
		assert.strictEqual(restored.metaOf(id)?.title, 'Pinned investigation');
		assert.strictEqual(restored.metaOf(id)?.updatedAt, before);
		restored.save(id, [user('Different automatic title')], false);
		assert.strictEqual(restored.metaOf(id)?.title, 'Pinned investigation');
		restored.setPinned(id, false);
		assert.strictEqual(new OpenideChatSessions(storage).metaOf(id)?.pinned, false);
		storage.dispose();
	});

	test('a pinned empty conversation survives tab closure and history pruning', () => {
		const { storage, sessions } = make();
		const pinned = sessions.create();
		sessions.setPinned(pinned, true);
		sessions.closeTab(pinned);
		assert.strictEqual(sessions.metaOf(pinned)?.empty, false);
		for (let index = 0; index < 205; index++) {
			sessions.createBackground(`Recent ${index}`, [user(`Task ${index}`)]);
		}
		assert.strictEqual(sessions.listAll().length, 200);
		assert.strictEqual(new OpenideChatSessions(storage).metaOf(pinned)?.pinned, true);
		storage.dispose();
	});

	test('renaming a CLI preserves provider identity and clearing restores its agent label', () => {
		const { storage, sessions } = make();
		const id = sessions.createCli('codex', 'Codex', '/work/project', 'provider-session');
		sessions.rename(id, 'Investigate routing');
		let restored = new OpenideChatSessions(storage);
		assert.strictEqual(restored.metaOf(id)?.title, 'Investigate routing');
		assert.strictEqual(restored.metaOf(id)?.providerSessionId, 'provider-session');
		assert.strictEqual(restored.metaOf(id)?.cwd, '/work/project');
		restored.rename(id, '');
		restored = new OpenideChatSessions(storage);
		assert.strictEqual(restored.metaOf(id)?.title, 'Codex');
		storage.dispose();
	});

	test('background status transitions persist unread once and activation clears it', () => {
		const { storage, sessions } = make();
		const first = sessions.create();
		sessions.save(first, [user('Background work')], false);
		sessions.create();
		assert.strictEqual(sessions.setStatus(first, 'in-progress'), true);
		assert.ok(!sessions.metaOf(first)?.unread);
		assert.strictEqual(sessions.setStatus(first, 'completed'), true);
		assert.strictEqual(sessions.setStatus(first, 'completed'), false);
		const restored = new OpenideChatSessions(storage);
		assert.strictEqual(restored.metaOf(first)?.unread, true);
		restored.activate(first);
		assert.strictEqual(restored.metaOf(first)?.unread, false);
		assert.strictEqual(restored.setStatus(first, 'failed'), true);
		assert.strictEqual(restored.metaOf(first)?.hasError, true);
		assert.strictEqual(restored.metaOf(first)?.unread, false);
		storage.dispose();
	});

	test('conversation titles retain descriptive text beyond the old 48-character cap', () => {
		const { storage, sessions } = make();
		const id = sessions.create();
		const title = 'Implementar la conexión de micrófono y seleccionar proveedores de transcripción';
		sessions.save(id, [user(title)], false);
		assert.strictEqual(new OpenideChatSessions(storage).metaOf(id)?.title, title);
		storage.dispose();
	});

	test('compacting history preserves the conversation title across later messages', () => {
		const { storage, sessions } = make();
		const id = sessions.create();
		sessions.save(id, [user('Corregir micrófono')], false);
		sessions.save(id, [{ role: 'assistant', content: 'summary', compaction: { beforeTokens: 100, afterTokens: 10, savingsPercent: 90, origin: 'automatic' } }, user('Continuar')], false);
		assert.strictEqual(new OpenideChatSessions(storage).metaOf(id)?.title, 'Corregir micrófono');
		storage.dispose();
	});

	test('skips empty opening messages and uses the visible command instead of expanded instructions', () => {
		const { storage, sessions } = make();
		const id = sessions.create();
		sessions.save(id, [user(''), { ...user('expanded private instructions'), displayText: '/revisar mi proyecto' }], false);
		assert.strictEqual(sessions.metaOf(id)?.title, '/revisar mi proyecto');
		storage.dispose();
	});

	test('a renamed empty session is no longer empty, so it survives', () => {
		const { storage, sessions } = make();
		const id = sessions.create();
		sessions.rename(id, 'Guardar esta');
		sessions.closeTab(id);
		assert.ok(sessions.listAll().some(s => s.id === id));
		assert.strictEqual(sessions.listAll().find(s => s.id === id)?.empty, false);
		storage.dispose();
	});

	test('reorderTab moves a tab beside another', () => {
		const { storage, sessions } = make();
		const a = sessions.create(); sessions.save(a, [user('a')], false);
		const b = sessions.create(); sessions.save(b, [user('b')], false);
		const c = sessions.create(); sessions.save(c, [user('c')], false);
		sessions.reorderTab(c, a, false);
		assert.deepStrictEqual(sessions.openTabs().map(s => s.id), [c, a, b]);
		sessions.reorderTab(c, b, true);
		assert.deepStrictEqual(sessions.openTabs().map(s => s.id), [a, b, c]);
		storage.dispose();
	});

	test('deleteAll leaves an empty store and ensureActive starts fresh', () => {
		const { storage, sessions } = make();
		const id = sessions.create();
		sessions.save(id, [user('hola')], false);
		sessions.deleteAll();
		assert.strictEqual(sessions.listAll().length, 0);
		const fresh = sessions.ensureActive();
		assert.notStrictEqual(fresh, id);
		storage.dispose();
	});
});
