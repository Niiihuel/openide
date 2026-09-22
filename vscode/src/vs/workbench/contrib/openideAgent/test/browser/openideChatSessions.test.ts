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
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { StorageValue } from '../../../../../base/parts/storage/common/storage.js';
import { IChatMessage } from '../../common/openideAgentTypes.js';

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

	test('history retains pinned and unpinned conversations beyond 200 sessions', () => {
		const { storage, sessions } = make();
		const pinned = sessions.create();
		sessions.setPinned(pinned, true);
		sessions.closeTab(pinned);
		assert.strictEqual(sessions.metaOf(pinned)?.empty, false);
		const history: string[] = [];
		for (let index = 0; index < 205; index++) {
			history.push(sessions.createBackground(`Recent ${index}`, [user(`Task ${index}`)]));
		}
		const restored = new OpenideChatSessions(storage);
		assert.deepStrictEqual({
			count: restored.listAll().length,
			pinned: restored.metaOf(pinned)?.pinned,
			oldest: restored.messagesOf(history[0])[0].content,
			newest: restored.messagesOf(history[204])[0].content,
		}, { count: 206, pinned: true, oldest: 'Task 0', newest: 'Task 204' });
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

suite('OpenIDE ChatSessions durable history', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const legacyKey = 'openide.chat.sessions.v1';
	const indexKey = 'openide.chat.sessions.v2.index';
	const metaKey = (id: string) => `openide.chat.sessions.v2.meta.${id}`;
	const contentKey = (id: string) => `openide.chat.sessions.v2.content.${id}`;
	const user = (content: string) => ({ role: 'user' as const, content, messageId: content });

	class RecordingStorageService extends TestStorageService {
		readonly reads: string[] = [];
		readonly writes: string[] = [];
		failOnKey: string | undefined;

		override get(key: string, scope: StorageScope, fallbackValue: string): string;
		override get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;
		override get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
			this.reads.push(key);
			return fallbackValue === undefined ? super.get(key, scope) : super.get(key, scope, fallbackValue);
		}

		override store(key: string, value: StorageValue, scope: StorageScope, target: StorageTarget): void {
			if (key === this.failOnKey) { throw new Error('Simulated interrupted migration'); }
			this.writes.push(key);
			super.store(key, value, scope, target);
		}
	}

	function legacyFixture(storage: TestStorageService): string {
		const data = JSON.stringify({
			sessions: [
				{
					id: 'native', title: 'Old automatic title', customTitle: 'Investigation', updatedAt: 12,
					archived: false, pinned: true, hasError: false, forked: false, kind: 'native',
					messages: [user('Original request'), { role: 'assistant', content: 'Investigating', reasoning: 'Check the source' }],
					changeSetsByMessageId: { edit: { messageId: 'edit', timestamp: 11, state: 'open', files: [createFileChange('file:///a.ts', 'modify', 'before', 'after')] } },
					usage: { input: 12, output: 3, used: 15, limit: 100 },
				},
				{
					id: 'cli', title: 'Codex', updatedAt: 13, archived: true, hasError: false, forked: false,
					kind: 'cli', cliId: 'codex', providerSessionId: 'provider-id', cwd: '/work/project', status: 'in-progress', messages: [],
				},
			],
			openTabIds: ['native', 'native', 'missing', 'cli'], activeId: 'native',
		});
		storage.store(legacyKey, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		return data;
	}

	test('metadata operations and startup leave transcripts unloaded until requested', () => {
		const storage = store.add(new RecordingStorageService());
		const first = new OpenideChatSessions(storage);
		const a = first.createBackground('A', [user('A')]);
		const b = first.createBackground('B', [user('B')]);
		first.saveUsage(a, { input: 2, output: 1, used: 3, limit: 100 });
		storage.reads.length = 0;
		const restored = new OpenideChatSessions(storage);
		restored.listAll();
		restored.openTabs();
		restored.metaOf(a);
		restored.rename(a, 'Renamed');
		restored.setPinned(b, true);
		restored.setStatus(a, 'needs-input');
		restored.activate(a);
		restored.archive(b);
		restored.usageOf(a);
		assert.deepStrictEqual(storage.reads.filter(key => key.startsWith('openide.chat.sessions.v2.content.')), []);
		const messages = restored.messagesOf(a);
		assert.strictEqual(restored.messagesOf(a), messages, 'loaded content is reused for streaming readers');
		restored.changesOf(a);
		assert.deepStrictEqual(storage.reads.filter(key => key.startsWith('openide.chat.sessions.v2.content.')), [contentKey(a)]);
	});

	test('saving a transcript and usage writes only the changed conversation', () => {
		const storage = store.add(new RecordingStorageService());
		const first = new OpenideChatSessions(storage);
		const a = first.createBackground('A', [user('A')]);
		const b = first.createBackground('B', [user('B')]);
		const restored = new OpenideChatSessions(storage);
		storage.writes.length = 0;
		restored.save(a, [user('A'), { role: 'assistant', content: 'streamed answer' }], false);
		assert.deepStrictEqual(storage.writes, [contentKey(a), metaKey(a)]);
		storage.writes.length = 0;
		restored.saveUsage(a, { input: 4, output: 2, used: 6, limit: 100 });
		assert.deepStrictEqual(storage.writes, [metaKey(a)]);
		storage.writes.length = 0;
		restored.rename(b, 'Other title');
		assert.deepStrictEqual(storage.writes, [metaKey(b)]);
		assert.deepStrictEqual(new OpenideChatSessions(storage).messagesOf(b), [user('B')]);
	});

	test('migration preserves transcripts, receipts, selection, provider identity and original backup', () => {
		const storage = store.add(new RecordingStorageService());
		const original = legacyFixture(storage);
		const migrated = new OpenideChatSessions(storage);
		assert.deepStrictEqual({
			ids: migrated.listAll().map(meta => meta.id),
			tabs: migrated.openTabs().map(meta => meta.id),
			active: migrated.activeSessionId(),
			title: migrated.metaOf('native')?.title,
			pinned: migrated.metaOf('native')?.pinned,
			reasoning: migrated.messagesOf('native')[1].reasoning,
			receipt: migrated.changeSetOf('native', 'edit')?.state,
			after: migrated.changeSetOf('native', 'edit')?.files[0].afterContent,
			usage: migrated.usageOf('native'),
			provider: migrated.metaOf('cli')?.providerSessionId,
			status: migrated.metaOf('cli')?.status,
			backup: storage.get(legacyKey, StorageScope.WORKSPACE),
		}, {
			ids: ['cli', 'native'], tabs: ['native'], active: 'native', title: 'Investigation', pinned: true,
			reasoning: 'Check the source', receipt: 'cancelled', after: 'after',
			usage: { input: 12, output: 3, used: 15, limit: 100, breakdown: undefined },
			provider: 'provider-id', status: 'unknown', backup: original,
		});
		storage.writes.length = 0;
		storage.reads.length = 0;
		const restarted = new OpenideChatSessions(storage);
		assert.deepStrictEqual({ count: restarted.listAll().length, writes: storage.writes, legacyRead: storage.reads.includes(legacyKey) }, { count: 2, writes: [], legacyRead: false });
	});

	test('a partial migration retries from the original source without losing or duplicating sessions', () => {
		const storage = store.add(new RecordingStorageService());
		const original = legacyFixture(storage);
		storage.failOnKey = metaKey('cli');
		assert.throws(() => new OpenideChatSessions(storage), /Simulated interrupted migration/);
		assert.deepStrictEqual({ backup: storage.get(legacyKey, StorageScope.WORKSPACE), index: storage.get(indexKey, StorageScope.WORKSPACE) }, { backup: original, index: undefined });
		storage.failOnKey = undefined;
		const recovered = new OpenideChatSessions(storage);
		assert.deepStrictEqual({ ids: recovered.listAll().map(meta => meta.id), content: recovered.messagesOf('native')[0].content }, { ids: ['cli', 'native'], content: 'Original request' });
	});

	test('a damaged index recovers individual records without loading or replacing their content', () => {
		const storage = store.add(new RecordingStorageService());
		const first = new OpenideChatSessions(storage);
		const id = first.createBackground('Keep me', [user('Durable request')]);
		storage.store(indexKey, '{broken', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.reads.length = 0;
		const restored = new OpenideChatSessions(storage);
		assert.deepStrictEqual({ title: restored.metaOf(id)?.title, contentReads: storage.reads.filter(key => key === contentKey(id)) }, { title: 'Keep me', contentReads: [] });
		assert.strictEqual(restored.messagesOf(id)[0].content, 'Durable request');
	});

	test('a missing index recovers newer records before the stale migration backup', () => {
		const storage = store.add(new RecordingStorageService());
		legacyFixture(storage);
		const migrated = new OpenideChatSessions(storage);
		migrated.save('native', [...migrated.messagesOf('native'), user('Newer durable request')], false);
		migrated.rename('native', 'Newer title');
		storage.remove(indexKey, StorageScope.WORKSPACE);
		storage.writes.length = 0;
		const restored = new OpenideChatSessions(storage);
		assert.deepStrictEqual({
			title: restored.metaOf('native')?.title,
			last: restored.messagesOf('native').at(-1)?.content,
			contentWrites: storage.writes.filter(key => key.startsWith('openide.chat.sessions.v2.content.')),
		}, { title: 'Newer title', last: 'Newer durable request', contentWrites: [] });
	});

	test('damaged content remains untouched by metadata changes and cannot be silently overwritten', () => {
		const storage = store.add(new RecordingStorageService());
		const first = new OpenideChatSessions(storage);
		const id = first.createBackground('Keep me', [user('Durable request')]);
		storage.store(contentKey(id), '{broken', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const restored = new OpenideChatSessions(storage);
		restored.rename(id, 'Still present');
		restored.archive(id);
		assert.throws(() => restored.messagesOf(id), /No se pudo leer|Could not read/);
		assert.throws(() => restored.save(id, [user('Replacement')], false), /No se pudo leer|Could not read/);
		assert.strictEqual(storage.get(contentKey(id), StorageScope.WORKSPACE), '{broken');
	});

	test('explicit deletion removes session content and migration recovery copies', () => {
		const storage = store.add(new RecordingStorageService());
		legacyFixture(storage);
		const sessions = new OpenideChatSessions(storage);
		sessions.delete('native');
		assert.deepStrictEqual({
			backup: storage.get(legacyKey, StorageScope.WORKSPACE),
			metadata: storage.get(metaKey('native'), StorageScope.WORKSPACE),
			content: storage.get(contentKey('native'), StorageScope.WORKSPACE),
			remaining: new OpenideChatSessions(storage).listAll().map(meta => meta.id),
		}, { backup: undefined, metadata: undefined, content: undefined, remaining: ['cli'] });
		storage.store('openide.chat.sessions.v2.archive.orphan:interrupted', '[]', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		sessions.deleteAll();
		assert.deepStrictEqual({ count: new OpenideChatSessions(storage).listAll().length, keys: storage.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE) }, { count: 0, keys: [indexKey] });
	});

	test('compaction archives survive mutation and restart without repeating retained tails', () => {
		const storage = store.add(new RecordingStorageService());
		const sessions = new OpenideChatSessions(storage);
		const answer: IChatMessage = { role: 'assistant', content: 'Original answer', reasoning: 'Original reasoning' };
		const tool: IChatMessage = { role: 'tool', toolCallId: 'tool-1', content: 'Original tool result' };
		const messages = [user('Original request'), answer, tool];
		const id = sessions.createBackground('Long conversation', messages);
		const summary = (content: string): IChatMessage => ({ role: 'user', content, compaction: { beforeTokens: 100, afterTokens: 20, savingsPercent: 80, origin: 'automatic' } });
		const summary1 = summary('Summary 1');
		const summary2 = summary('Summary 2');
		sessions.archiveBeforeCompaction(id, messages);
		sessions.archiveBeforeCompaction(id, messages);
		messages.splice(0, messages.length, summary1, answer, tool, user('Second request'), { role: 'assistant', content: 'Second answer' });
		sessions.save(id, messages, false);
		sessions.archiveBeforeCompaction(id, messages);
		messages.splice(0, messages.length, summary2, user('Second request'), { role: 'assistant', content: 'Second answer' }, user('Third request'));
		sessions.save(id, messages, false);
		storage.reads.length = 0;
		const restored = new OpenideChatSessions(storage);
		restored.listAll();
		restored.messagesOf(id);
		assert.deepStrictEqual(storage.reads.filter(key => key.startsWith('openide.chat.sessions.v2.archive.')), [], 'model loading never loads archived context');
		assert.deepStrictEqual({
			archiveCount: storage.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE).filter(key => key.startsWith('openide.chat.sessions.v2.archive.')).length,
			transcript: restored.transcriptOf(id).map(message => [message.content, message.reasoning]),
			modelWindow: restored.messagesOf(id).map(message => message.content),
		}, {
			archiveCount: 2,
			transcript: [['Original request', undefined], ['Original answer', 'Original reasoning'], ['Original tool result', undefined], ['Summary 1', undefined], ['Second request', undefined], ['Second answer', undefined], ['Summary 2', undefined], ['Third request', undefined]],
			modelWindow: ['Summary 2', 'Second request', 'Second answer', 'Third request'],
		});
	});

	test('emergency summaries preserve the full original request and forks own their archive', () => {
		const storage = store.add(new RecordingStorageService());
		const sessions = new OpenideChatSessions(storage);
		const original = { ...user('Original request in full'), messageId: 'turn-1' };
		const messages: IChatMessage[] = [original, { role: 'tool', content: 'Large output', toolCallId: 'call-1' }];
		const id = sessions.createBackground('Original', messages);
		sessions.archiveBeforeCompaction(id, messages);
		messages.splice(0, messages.length, { role: 'user', content: '[Resumen histórico compacto]\nEmergency summary' }, { ...original, content: 'Original request [excerpt]' });
		sessions.save(id, messages, false);
		const fork = sessions.fork(id)!;
		sessions.delete(id);
		const restored = new OpenideChatSessions(storage);
		assert.deepStrictEqual(restored.transcriptOf(fork).map(message => message.content), ['Original request in full', 'Large output', '[Resumen histórico compacto]\nEmergency summary']);
		restored.deleteAll();
		assert.deepStrictEqual(storage.keys(StorageScope.WORKSPACE, StorageTarget.MACHINE), [indexKey]);
	});

	test('continued assistant and tool messages with stable IDs are never dropped from archived history', () => {
		const storage = store.add(new RecordingStorageService());
		const sessions = new OpenideChatSessions(storage);
		const first: IChatMessage = { role: 'assistant', messageId: 'response', content: 'First part', reasoning: 'First reasoning' };
		const tool: IChatMessage = { role: 'tool', messageId: 'output', toolCallId: 'call', content: 'First output' };
		const id = sessions.createBackground('Long answer', [user('Continue'), first, tool]);
		sessions.archiveBeforeCompaction(id, sessions.messagesOf(id));
		sessions.save(id, [{ role: 'user', content: '[Resumen histórico compacto]\nSummary' }, { ...first, content: 'Later continuation', reasoning: 'Later reasoning' }, { ...tool, content: 'Later output' }], false);
		assert.deepStrictEqual(sessions.transcriptOf(id).filter(message => message.role !== 'user').map(message => [message.content, message.reasoning]), [['First part', 'First reasoning'], ['First output', undefined], ['Later continuation', 'Later reasoning'], ['Later output', undefined]]);
	});

	test('only actual deletions emit deletion events, while closing or archiving preserves ownership', () => {
		const storage = store.add(new RecordingStorageService());
		const sessions = new OpenideChatSessions(storage);
		const deleted: string[] = [];
		store.add(sessions.onDidDelete(id => deleted.push(id)));
		const a = sessions.createBackground('A', [user('A')]);
		const b = sessions.createCli('codex', 'Codex', '/work');
		sessions.openTab(a);
		sessions.closeTab(a);
		sessions.closeBackgroundTab(b);
		sessions.archive(a);
		assert.deepStrictEqual(deleted, []);
		sessions.delete(a);
		sessions.delete(a);
		sessions.delete('missing');
		const empty = sessions.create();
		sessions.closeTab(empty);
		sessions.deleteAll();
		assert.deepStrictEqual(deleted, [a, empty, b]);
	});
});
