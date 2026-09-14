/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { access, mkdtemp, mkdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { OpenideMemoryOwner } from '../../../../../platform/openideAgentHost/node/openideMemoryOwner.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IOpenideAgentService } from '../../browser/openideAgentService.js';
import { OpenideChatSessions } from '../../browser/openideChatSessions.js';
import { runOpenideChatRollback } from '../../browser/chat/openideChatRollbackOperation.js';
import { OpenideRestoreEngine } from '../../browser/openideRestoreEngine.js';
import { IChatMessage, IMessageChangeSet } from '../../common/openideAgentTypes.js';
import { memoryCaptureChangeSets } from '../../common/openideMemoryRollback.js';

suite('OpenIDE memory rollback transaction', () => {
	let root: string; let owner: OpenideMemoryOwner; let restore: OpenideRestoreEngine;
	setup(async () => {
		root = await mkdtemp(join(tmpdir(), 'openide-memory-rollback-'));
		const profile = join(root, 'profile'); await mkdir(profile);
		owner = new OpenideMemoryOwner(profile); await owner.setWorkspace([root]);
		const files = {
			exists: async (uri: URI) => { try { await access(uri.fsPath); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return false; } throw error; } },
			readFile: async (uri: URI) => ({ value: VSBuffer.fromString(await readFile(uri.fsPath, 'utf8')) }),
			writeFile: async (uri: URI, content: VSBuffer) => { await writeFile(uri.fsPath, content.buffer); return {}; },
			createFile: async (uri: URI, content: VSBuffer) => { await mkdir(dirname(uri.fsPath), { recursive: true }); await writeFile(uri.fsPath, content.buffer, { flag: 'wx' }); return {}; },
			del: async (uri: URI) => { await unlink(uri.fsPath); },
			move: async (source: URI, target: URI) => { await rename(source.fsPath, target.fsPath); },
		} as unknown as IFileService;
		const context = { getWorkspace: () => ({ folders: [{ uri: URI.file(root), name: 'test', index: 0 }] }) } as IWorkspaceContextService;
		restore = new OpenideRestoreEngine(files, context);
	});
	teardown(async () => { owner.dispose(); await rm(root, { recursive: true, force: true }); });
	const save = (message: string) => ({ action: 'save' as const, session: 'chat', message, origin: 'native' as const, topic: 'architecture/rollback', body: 'Use durable receipts.', operationId: `checkpoint:${message}` });
	async function prepare(messageIds: readonly string[]): Promise<readonly IMessageChangeSet[]> {
		const response = await owner.request({ action: 'capture-rollback', session: 'chat', messageIds });
		return memoryCaptureChangeSets(URI.file(root), response, messageIds[0] ?? '');
	}

	test('a memory-only turn removes the exact auto note and cannot recapture after truncation', async () => {
		const document = (await owner.request(save('turn'))).document!;
		const messages: IChatMessage[] = [{ role: 'user', content: 'Do work', messageId: 'turn' }, { role: 'assistant', content: 'Done', messageId: 'reply' }];
		const calls: string[] = [];
		const sessions = {
			messagesOf: () => messages, changeSetOf: () => undefined,
			removeChangeSets: () => calls.push('remove'), clearUsage: () => {}, save: () => calls.push('save'),
		} as unknown as OpenideChatSessions;
		const service = {
			prepareMemoryRollback: async (_session: string, ids: readonly string[]) => { calls.push('prepare'); return prepare(ids); },
			rollbackMessage: async (changeSet: IMessageChangeSet) => { calls.push('restore'); return restore.rollback(changeSet); },
		} as unknown as IOpenideAgentService;
		const result = await runOpenideChatRollback({ sessions, agentService: service, conversationId: 'chat', messageId: 'turn', restoreComposer: true, drainRun: async () => { calls.push('drain'); } });
		assert.strictEqual(result.committed, true); assert.strictEqual(result.warning, undefined);
		assert.deepStrictEqual(calls, ['drain', 'prepare', 'restore', 'remove', 'save']);
		assert.deepStrictEqual(messages, []);
		await assert.rejects(readFile(join(root, document.path)), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
		await assert.rejects(owner.request(save('turn')), /rolled back/);
		assert.deepStrictEqual((await owner.request({ action: 'list' })).documents, [], 'canonical retrieval excludes the deleted note immediately');
	});

	test('discarding multiple turns undoes their memory deltas in reverse order', async () => {
		const first = (await owner.request(save('first'))).document!;
		await owner.request({ ...save('second'), body: 'An additional decision.', id: first.record.id, expectedRevision: first.record.revision, expectedHash: first.hash });
		const messages: IChatMessage[] = ['first', 'second'].map(messageId => ({ role: 'user', content: messageId, messageId }));
		const order: string[] = [];
		const sessions = { messagesOf: () => messages, changeSetOf: () => undefined, removeChangeSets: () => {}, clearUsage: () => {}, save: () => {} } as unknown as OpenideChatSessions;
		const service = { prepareMemoryRollback: (_id: string, ids: readonly string[]) => prepare(ids), rollbackMessage: (change: IMessageChangeSet) => { order.push(change.messageId); return restore.rollback(change); } } as unknown as IOpenideAgentService;
		const result = await runOpenideChatRollback({ sessions, agentService: service, conversationId: 'chat', messageId: 'first', restoreComposer: false, drainRun: async () => {} });
		assert.strictEqual(result.warning, undefined); assert.deepStrictEqual(order, ['second', 'first']);
		assert.deepStrictEqual((await owner.request({ action: 'list' })).documents, []);
	});

	test('two memory writes in one turn with identical timestamps restore newest first', async () => {
		const first = (await owner.request(save('turn'))).document!;
		await owner.request({ ...save('turn'), operationId: 'checkpoint:turn:second', body: 'Second observation.', id: first.record.id, expectedRevision: first.record.revision, expectedHash: first.hash });
		const messages: IChatMessage[] = [{ role: 'user', messageId: 'turn', content: 'Work' }];
		const sessions = { messagesOf: () => messages, changeSetOf: () => undefined, removeChangeSets: () => {}, clearUsage: () => {}, save: () => {} } as unknown as OpenideChatSessions;
		const service = {
			prepareMemoryRollback: async (_id: string, ids: readonly string[]) => (await prepare(ids)).map(change => ({ ...change, timestamp: 10 })),
			rollbackMessage: (change: IMessageChangeSet) => restore.rollback(change),
		} as unknown as IOpenideAgentService;
		const result = await runOpenideChatRollback({ sessions, agentService: service, conversationId: 'chat', messageId: 'turn', restoreComposer: false, drainRun: async () => {} });
		assert.strictEqual(result.warning, undefined);
		assert.deepStrictEqual((await owner.request({ action: 'list' })).documents, []);
	});

	test('a later manual edit to a created note is never deleted', async () => {
		const document = (await owner.request(save('turn'))).document!;
		const path = join(root, document.path); const manual = await readFile(path, 'utf8') + '\nUser addition.\n';
		await writeFile(path, manual);
		const [change] = await prepare(['turn']);
		assert.strictEqual((await restore.rollback(change, true)).status, 'conflict');
		assert.strictEqual(await readFile(path, 'utf8'), manual);
	});

	test('updating existing memory rolls back to exact prior Markdown without deleting it', async () => {
		const document = (await owner.request(save('kept'))).document!;
		const path = join(root, document.path); const baseline = await readFile(path, 'utf8');
		await owner.request({ ...save('discarded'), id: document.record.id, expectedRevision: document.record.revision, expectedHash: document.hash, body: 'Temporary new decision.' });
		const [change] = await prepare(['discarded']);
		assert.strictEqual((await restore.rollback(change)).status, 'reverted');
		assert.strictEqual(await readFile(path, 'utf8'), baseline);
		assert.strictEqual((await owner.request({ action: 'list' })).documents?.[0].record.source_message, 'kept');
	});
});
