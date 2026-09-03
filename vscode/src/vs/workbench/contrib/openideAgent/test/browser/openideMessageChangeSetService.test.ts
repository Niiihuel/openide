/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { OpenideMessageChangeSetService, fileEditEvent } from '../../browser/openideMessageChangeSetService.js';

function harness(initial: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(initial).map(([path, content]) => [URI.file('/workspace/' + path).toString(), content]));
	const writes: string[] = [];
	const fileService = new class extends mock<IFileService>() {
		override async readFile(uri: URI) {
			const content = files.get(uri.toString());
			if (content === undefined) { throw new Error('missing'); }
			return { value: VSBuffer.fromString(content) } as IFileContent;
		}
		override async writeFile(uri: URI, buffer: VSBuffer): Promise<any> { writes.push('write:' + uri.path); files.set(uri.toString(), buffer.toString()); return {}; }
		override async createFile(uri: URI, buffer: VSBuffer): Promise<any> {
			if (files.has(uri.toString())) { throw new Error('exists'); }
			writes.push('create:' + uri.path); files.set(uri.toString(), buffer.toString()); return {};
		}
		override async del(uri: URI): Promise<void> { writes.push('del:' + uri.path); files.delete(uri.toString()); }
		override async move(source: URI, target: URI): Promise<any> {
			writes.push(`move:${source.path}:${target.path}`);
			const content = files.get(source.toString());
			if (content === undefined) { throw new Error('missing'); }
			files.delete(source.toString()); files.set(target.toString(), content); return {};
		}
		override async exists(uri: URI): Promise<boolean> { return files.has(uri.toString()); }
	};
	const context = new class extends mock<IWorkspaceContextService>() {
		override getWorkspace(): any { return { folders: [{ uri: URI.file('/workspace'), name: 'workspace', index: 0 }] }; }
	};
	const service = new OpenideMessageChangeSetService(fileService, context);
	const read = (path: string) => files.get(URI.file('/workspace/' + path).toString());
	const writeManual = (path: string, content: string) => files.set(URI.file('/workspace/' + path).toString(), content);
	return { service, read, writeManual, writes };
}

suite('OpenIDE MessageChangeSetService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('empty message is a filesystem no-op', async () => {
		const h = harness({ 'a.ts': 'a' });
		h.service.begin('empty');
		const result = await h.service.rollback(h.service.finalize('empty'));
		assert.strictEqual(result.status, 'noop');
		assert.deepStrictEqual(h.writes, []);
		assert.strictEqual(h.read('a.ts'), 'a');
	});

	test('two messages modifying different files stay isolated', async () => {
		const h = harness({ 'a.ts': 'A1', 'b.ts': 'B1' });
		h.service.begin('A'); h.service.record('A', fileEditEvent('a.ts', 'modify', 'A0', 'A1')); const a = h.service.finalize('A');
		h.service.begin('B'); h.service.record('B', fileEditEvent('b.ts', 'modify', 'B0', 'B1')); const b = h.service.finalize('B');
		await h.service.rollback(b);
		assert.strictEqual(h.read('a.ts'), 'A1'); assert.strictEqual(h.read('b.ts'), 'B0');
		await h.service.rollback(a);
		assert.strictEqual(h.read('a.ts'), 'A0'); assert.strictEqual(h.read('b.ts'), 'B0');
	});

	test('two messages on same file revert only their non-overlapping patch', async () => {
		const original = 'a\nb\nc\nd\ne';
		const afterA = 'a\nB-A\nc\nd\ne';
		const afterB = 'a\nB-A\nc\nD-B\ne';
		const h = harness({ 'file.ts': afterB });
		h.service.begin('A'); h.service.record('A', fileEditEvent('file.ts', 'modify', original, afterA)); const a = h.service.finalize('A');
		h.service.begin('B'); h.service.record('B', fileEditEvent('file.ts', 'modify', afterA, afterB)); const b = h.service.finalize('B');
		assert.strictEqual((await h.service.rollback(a)).status, 'reverted');
		assert.strictEqual(h.read('file.ts'), 'a\nb\nc\nD-B\ne');
		h.writeManual('file.ts', afterB);
		assert.strictEqual((await h.service.rollback(b)).status, 'reverted');
		assert.strictEqual(h.read('file.ts'), afterA);
	});

	test('created file is deleted only if unchanged', async () => {
		const h = harness({ 'new.ts': 'created' });
		h.service.begin('create'); h.service.record('create', fileEditEvent('new.ts', 'create', undefined, 'created')); const set = h.service.finalize('create');
		h.writeManual('new.ts', 'manual');
		assert.strictEqual((await h.service.rollback(set)).status, 'conflict');
		assert.strictEqual(h.read('new.ts'), 'manual');
		h.writeManual('new.ts', 'created');
		await h.service.rollback(set);
		assert.strictEqual(h.read('new.ts'), undefined);
	});

	test('deleted file restores only into an absent path', async () => {
		const h = harness();
		h.service.begin('delete'); h.service.record('delete', fileEditEvent('old.ts', 'delete', 'old')); const set = h.service.finalize('delete');
		await h.service.rollback(set); assert.strictEqual(h.read('old.ts'), 'old');
		h.writeManual('old.ts', 'manual');
		assert.strictEqual((await h.service.rollback(set)).status, 'conflict');
		assert.strictEqual(h.read('old.ts'), 'manual');
	});

	test('delete destination then rename restores both independent files', async () => {
		const h = harness({ 'b.ts': 'oldA' });
		h.service.begin('compound');
		h.service.record('compound', fileEditEvent('b.ts', 'delete', 'oldB'));
		h.service.record('compound', fileEditEvent('b.ts', 'rename', 'oldA', 'oldA', 'a.ts'));
		const result = await h.service.rollback(h.service.finalize('compound'));
		assert.strictEqual(result.status, 'reverted');
		assert.strictEqual(h.read('a.ts'), 'oldA');
		assert.strictEqual(h.read('b.ts'), 'oldB');
	});

	test('rename then recreate source rolls back in virtual reverse order', async () => {
		const h = harness({ 'a.ts': 'newA', 'b.ts': 'oldA' });
		h.service.begin('replace-source');
		h.service.record('replace-source', fileEditEvent('b.ts', 'rename', 'oldA', 'oldA', 'a.ts'));
		h.service.record('replace-source', fileEditEvent('a.ts', 'create', undefined, 'newA'));
		const result = await h.service.rollback(h.service.finalize('replace-source'));
		assert.strictEqual(result.status, 'reverted');
		assert.strictEqual(h.read('a.ts'), 'oldA');
		assert.strictEqual(h.read('b.ts'), undefined);
	});

	test('rename moves back only when both endpoints match', async () => {
		const h = harness({ 'new.ts': 'content' });
		h.service.begin('rename'); h.service.record('rename', fileEditEvent('new.ts', 'rename', 'content', 'content', 'old.ts')); const set = h.service.finalize('rename');
		await h.service.rollback(set);
		assert.strictEqual(h.read('new.ts'), undefined); assert.strictEqual(h.read('old.ts'), 'content');
	});

	test('cancelled message retains only completed operations', async () => {
		const h = harness({ 'a.ts': 'after' });
		h.service.begin('cancelled'); h.service.record('cancelled', fileEditEvent('a.ts', 'modify', 'before', 'after'));
		const set = h.service.finalize('cancelled', true);
		assert.strictEqual(set.state, 'cancelled'); assert.strictEqual(set.files.length, 1);
		await h.service.rollback(set); assert.strictEqual(h.read('a.ts'), 'before');
	});

	test('manual non-overlapping edit survives and overlapping edit conflicts', async () => {
		const before = 'a\nb\nc\nd\ne'; const after = 'a\nB-A\nc\nd\ne';
		const h = harness({ 'a.ts': 'a\nB-A\nc\nD-MANUAL\ne' });
		h.service.begin('A'); h.service.record('A', fileEditEvent('a.ts', 'modify', before, after)); const set = h.service.finalize('A');
		await h.service.rollback(set); assert.strictEqual(h.read('a.ts'), 'a\nb\nc\nD-MANUAL\ne');
		h.writeManual('a.ts', 'a\nB-MANUAL\nc\nd\ne');
		assert.strictEqual((await h.service.rollback(set)).status, 'conflict');
		assert.strictEqual(h.read('a.ts'), 'a\nB-MANUAL\nc\nd\ne');
	});

	test('outside-workspace path conflicts without writes', async () => {
		const h = harness(); h.service.begin('bad'); h.service.record('bad', fileEditEvent('/etc/passwd', 'delete', 'x'));
		assert.strictEqual((await h.service.rollback(h.service.finalize('bad'))).status, 'conflict');
		assert.deepStrictEqual(h.writes, []);
	});
});
