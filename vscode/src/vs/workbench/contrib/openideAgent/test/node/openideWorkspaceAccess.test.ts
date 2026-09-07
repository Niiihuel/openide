/*---------------------------------------------------------------------------------------------
 *  Copyright (c) OpenIDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { bufferToReadable, VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { DiskFileSystemProvider } from '../../../../../platform/files/node/diskFileSystemProvider.js';
import { validateOpenideWorkspacePath } from '../../../../../platform/openideAgentHost/node/openideWorkspacePaths.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { OpenideWorkspaceAccess } from '../../browser/openideWorkspaceAccess.js';

suite('OpenIDE workspace observations (real filesystem and text model)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let cwd: string;
	setup(async () => { cwd = await mkdtemp(join(tmpdir(), 'openide-observation-')); });
	teardown(async () => { await rm(cwd, { recursive: true, force: true }); });

	async function fixture(open = false, encoding: 'utf8' | 'utf16le' = 'utf8') {
		const encode = (value: string) => encoding === 'utf16le'
			? VSBuffer.wrap(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')]))
			: VSBuffer.fromString(value);
		const uri = URI.file(join(cwd, 'file.txt'));
		await writeFile(uri.fsPath, encode('original').buffer);
		const log = new NullLogService();
		const files = store.add(new FileService(log));
		store.add(files.registerProvider('file', store.add(new DiskFileSystemProvider(log))));
		const model = open ? store.add(createTextModel('original', null, undefined, uri)) : undefined;
		let dirty = false;
		let duringEncoding: (() => Promise<void>) | undefined;
		const textFiles = upcastPartial<ITextFileService>({
			isDirty: () => dirty,
			getEncodedReadable: (async (_resource: URI, value: string) => {
				const effect = duringEncoding; duringEncoding = undefined;
				await effect?.();
				return encoding === 'utf16le' ? bufferToReadable(encode(value)) : encode(value);
			}) as ITextFileService['getEncodedReadable'],
			files: upcastPartial<ITextFileService['files']>({ get: () => undefined }),
		});
		const access = store.add(new OpenideWorkspaceAccess(files, upcastPartial<IModelService>({ getModel: resource => resource.toString() === uri.toString() ? model ?? null : null }), textFiles, (resource, _root, mutation) => validateOpenideWorkspacePath({ path: resource.fsPath, roots: [cwd], mutation })));
		return { uri, model, access, setDirty: (value: boolean) => { dirty = value; }, duringEncoding: (effect: () => Promise<void>) => { duringEncoding = effect; } };
	}

	test('reads the actual unsaved editor text and rejects writes without changing buffer or disk', async () => {
		const { uri, model, access, setDirty } = await fixture(true);
		model!.setValue('user unsaved text'); setDirty(true);
		const observation = await access.read(uri, 'run-a');
		assert.deepStrictEqual([observation.text, observation.source, observation.dirty], ['user unsaved text', 'editor', true]);
		await assert.rejects(access.write(uri, 'run-a', 'agent replacement', observation.id), /unsaved changes/);
		assert.strictEqual(model!.getValue(), 'user unsaved text');
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'original');
	});

	test('rejects a clean editor that already lagged disk when the observation was taken', async () => {
		const { uri, model, access } = await fixture(true);
		await writeFile(uri.fsPath, 'external');
		const observation = await access.read(uri, 'run-a');
		assert.strictEqual(observation.text, 'original');
		assert.strictEqual(observation.dirty, false);
		await assert.rejects(access.write(uri, 'run-a', 'stale replacement', observation.id), /not synchronized with disk/);
		await assert.rejects(access.remove(uri, 'run-a', observation.id), /not synchronized with disk/);
		await assert.rejects(access.rename(uri, URI.file(join(cwd, 'moved.txt')), 'run-a', observation.id), /not synchronized with disk/);
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'external');
		model!.setValue('external');
		await access.read(uri, 'run-a');
		await access.write(uri, 'run-a', 'fresh replacement');
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'fresh replacement');
	});

	test('compares clean editor content in the owner encoding, retaining UTF-16 and BOM', async () => {
		const { uri, access } = await fixture(true, 'utf16le');
		await access.read(uri, 'run-a');
		await access.write(uri, 'run-a', 'encoded replacement');
		const bytes = await readFile(uri.fsPath);
		assert.deepStrictEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
		assert.strictEqual(bytes.subarray(2).toString('utf16le'), 'encoded replacement');
	});

	test('rejects same-size external disk changes and requires a fresh observation', async () => {
		const { uri, access } = await fixture();
		const observation = await access.read(uri, 'run-a');
		await writeFile(uri.fsPath, 'external');
		await assert.rejects(access.write(uri, 'run-a', 'replacement', observation.id), /changed since/);
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'external');
		await access.read(uri, 'run-a');
		await access.write(uri, 'run-a', 'approved replacement');
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'approved replacement');
	});

	test('does not share observations across runs or files and refuses blind overwrite', async () => {
		const { uri, access } = await fixture();
		await assert.rejects(access.write(uri, 'run-a', 'blind'), /Read this file/);
		const observation = await access.read(uri, 'run-a');
		await assert.rejects(access.write(uri, 'run-b', 'foreign', observation.id), /Read this file/);
		const second = URI.file(join(cwd, 'second.txt'));
		await writeFile(second.fsPath, 'other');
		await access.read(second, 'run-a');
		await assert.rejects(access.write(second, 'run-a', 'foreign', observation.id), /Read this file/);
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'original');
	});

	test('rechecks both disk content and dirty buffer after asynchronous encoding', async () => {
		const { uri, access, duringEncoding, setDirty } = await fixture();
		await access.read(uri, 'run-a');
		duringEncoding(() => writeFile(uri.fsPath, 'external'));
		await assert.rejects(access.write(uri, 'run-a', 'replacement'), /changed since/);
		await access.read(uri, 'run-a');
		duringEncoding(async () => { setDirty(true); });
		await assert.rejects(access.write(uri, 'run-a', 'replacement'), /unsaved changes/);
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'external');
	});

	test('model version invalidates an observation even if the visible text returns to its original value', async () => {
		const { uri, model, access } = await fixture(true);
		await access.read(uri, 'run-a');
		model!.setValue('temporary'); model!.setValue('original');
		await assert.rejects(access.write(uri, 'run-a', 'replacement'), /changed since/);
	});

	test('keeps an unsaved editor buffer readable after its disk file disappears', async () => {
		const { uri, model, access, setDirty } = await fixture(true);
		model!.setValue('unsaved surviving buffer'); setDirty(true);
		await rm(uri.fsPath);
		const observation = await access.read(uri, 'run-a');
		assert.strictEqual(observation.text, 'unsaved surviving buffer');
		assert.strictEqual(observation.dirty, true);
		await assert.rejects(access.write(uri, 'run-a', 'overwrite', observation.id), /no longer exists/);
	});

	test('a concurrent fresh read cannot authorize an edit computed from an older observation', async () => {
		const { uri, access, duringEncoding } = await fixture();
		await access.read(uri, 'run-a');
		duringEncoding(async () => {
			await writeFile(uri.fsPath, 'external');
			await access.read(uri, 'run-a');
		});
		await assert.rejects(access.write(uri, 'run-a', 'computed from original'), /Read this file/);
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'external');
	});

	test('creates exclusively, guards rename/delete, and does not silently recreate a deleted observed file', async () => {
		const { uri, access } = await fixture();
		const destination = URI.file(join(cwd, 'new.txt'));
		await access.write(destination, 'run-a', 'created');
		await assert.rejects(access.rename(uri, destination, 'run-a'), /destination already exists/);
		await assert.rejects(access.remove(uri, 'run-a'), /Read this file/);
		await access.read(uri, 'run-a');
		await rm(uri.fsPath);
		await assert.rejects(access.write(uri, 'run-a', 'resurrection'), /no longer exists/);
		await access.remove(destination, 'run-a');
		await assert.rejects(readFile(destination.fsPath), { code: 'ENOENT' });
	});

	test('canonical validation rejects existing and dangling symlink escapes, including new descendants', async function () {
		const root = join(cwd, 'workspace');
		const outside = join(cwd, 'outside');
		await mkdir(root); await mkdir(outside);
		await writeFile(join(outside, 'secret.txt'), 'outside');
		try {
			await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
			await symlink(join(outside, 'missing'), join(root, 'dangling'), process.platform === 'win32' ? 'junction' : 'dir');
		} catch (error) {
			if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { this.skip(); }
			throw error;
		}
		for (const path of [join(root, 'link', 'secret.txt'), join(root, 'link', 'new.txt'), join(root, 'dangling', 'new.txt')]) {
			await assert.rejects(validateOpenideWorkspacePath({ path, roots: [root] }), /outside the assigned workspace/);
		}
		await validateOpenideWorkspacePath({ path: join(root, 'new', 'safe.txt'), roots: [root] });
	});
	test('Git metadata cannot be changed through file tools, including canonical aliases', async function () {
		const { access } = await fixture();
		const directory = join(cwd, '.git'); await mkdir(directory);
		const metadata = URI.file(join(directory, 'config')); await writeFile(metadata.fsPath, 'original config');
		await access.read(metadata, 'run-a');
		await assert.rejects(access.write(metadata, 'run-a', 'filter command'), /Git metadata/);
		await assert.rejects(access.remove(metadata, 'run-a'), /Git metadata/);
		try { await symlink(directory, join(cwd, 'alias'), process.platform === 'win32' ? 'junction' : 'dir'); }
		catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { this.skip(); } throw error; }
		const alias = URI.file(join(cwd, 'alias', 'config')); await access.read(alias, 'run-a');
		await assert.rejects(access.write(alias, 'run-a', 'filter command'), /Git metadata/);
		assert.strictEqual(await readFile(metadata.fsPath, 'utf8'), 'original config');
	});

	test('cancellation during asynchronous encoding prevents the filesystem effect', async () => {
		const { uri, access, duringEncoding } = await fixture();
		const token = store.add(new CancellationTokenSource());
		await access.read(uri, 'run-a');
		duringEncoding(async () => token.cancel());
		await assert.rejects(access.write(uri, 'run-a', 'must not write', undefined, undefined, token.token), /Canceled/);
		assert.strictEqual(await readFile(uri.fsPath, 'utf8'), 'original');
	});

});
